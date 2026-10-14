import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb"
import type { Project } from "@sequence/core"

/**
 * Local-first storage. There is no server and no account, so this database is
 * the only copy of a user's work.
 *
 * Originals and thumbnails are separate stores because the canvas only ever
 * reads thumbnails. Keeping multi-megabyte originals out of that read path is
 * what keeps a large session responsive.
 */
interface SequenceDB extends DBSchema {
  originals: { key: string; value: Blob }
  thumbnails: { key: string; value: Blob }
  project: { key: string; value: Project }
}

const DB_NAME = "sequence"
const DB_VERSION = 1

/**
 * The database's name before the app was renamed. Every project saved before
 * the rename lives here, so it is moved into `DB_NAME` on first open rather
 * than left behind — otherwise existing work would look like it had vanished.
 */
const LEGACY_DB_NAME = "loupe"

const STORES = ["originals", "thumbnails", "project"] as const

export const PROJECT_KEY = "current"

let dbPromise: Promise<IDBPDatabase<SequenceDB>> | null = null
let openedDb: IDBPDatabase<SequenceDB> | null = null

export function getDb(): Promise<IDBPDatabase<SequenceDB>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable in this environment"))
  }

  dbPromise ??= openWithLegacyMigration().then((db) => (openedDb = db))

  return dbPromise
}

function open(name: string): Promise<IDBPDatabase<SequenceDB>> {
  return openDB<SequenceDB>(name, DB_VERSION, {
    upgrade(db) {
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
      }
    },
  })
}

/**
 * Opens `DB_NAME`, first moving everything over from `LEGACY_DB_NAME` when the
 * new database is still empty and the old one holds a project.
 *
 * The copy is one transaction across all three stores, so it lands whole or
 * not at all, and the old database is deleted only after it commits. If the
 * copy fails (most likely the quota, since originals briefly exist twice),
 * the empty new database is dropped and this session runs on the old one
 * instead, so the work stays visible and the move is retried on the next load.
 */
async function openWithLegacyMigration(): Promise<IDBPDatabase<SequenceDB>> {
  const db = await open(DB_NAME)
  if ((await db.count("project")) > 0) return db

  const legacy = await openLegacy()
  if (!legacy) return db

  try {
    // Read everything first: awaiting the old database mid-transaction would
    // let the new one's transaction auto-commit with nothing in it.
    const contents = await Promise.all(
      STORES.map(async (store) => ({
        store,
        keys: await legacy.getAllKeys(store),
        values: await legacy.getAll(store),
      })),
    )
    const tx = db.transaction(STORES, "readwrite")
    const puts = contents.flatMap(({ store, keys, values }) =>
      keys.map((key, index) => tx.objectStore(store).put(values[index]!, key)),
    )
    await Promise.all([...puts, tx.done])
  } catch (error) {
    console.error("Couldn't move saved work to the renamed database; using the old one for now:", error)
    db.close()
    await deleteDB(DB_NAME)
    return legacy
  }

  legacy.close()
  // Not awaited: a tab still running the old build holds a connection, which
  // blocks the delete until that tab closes. The copy is already committed.
  void deleteDB(LEGACY_DB_NAME)
  return db
}

/** The pre-rename database, if it exists and holds a project; otherwise null
 *  (and a database that opening it just created is deleted again). */
async function openLegacy(): Promise<IDBPDatabase<SequenceDB> | null> {
  let created = false
  const legacy = await openDB<SequenceDB>(LEGACY_DB_NAME, undefined, {
    upgrade() {
      created = true
    },
  })
  const hasProject =
    !created && legacy.objectStoreNames.contains("project") && (await legacy.count("project")) > 0
  if (hasProject) return legacy

  legacy.close()
  if (created) await deleteDB(LEGACY_DB_NAME)
  return null
}

/**
 * The database, if it has already been opened — synchronously.
 *
 * A write issued from `pagehide` has to open its transaction inside the event
 * handler itself. Awaiting `getDb()` first, even when it is already resolved,
 * pushes the `put` past the point where Chromium tears the page down on a
 * reload, and the write is silently dropped.
 */
export function getOpenedDb(): IDBPDatabase<SequenceDB> | null {
  return openedDb
}

/**
 * Ask the browser not to evict this origin.
 *
 * IndexedDB is cleared by a least-recently-used policy when the device fills
 * up, and persistent storage is skipped during that automatic eviction. With no
 * account and no cloud copy, eviction is silent total data loss, so this is the
 * only defence available until project export ships.
 *
 * A denial is not an error — it is a browser policy the user cannot change, and
 * nagging them about it would be worse than degrading quietly.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false

  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

/** True when the failure was the browser refusing more space, which needs a
 *  different message than a generic write error. */
export function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError"
}
