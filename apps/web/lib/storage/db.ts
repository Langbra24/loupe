import { openDB, type DBSchema, type IDBPDatabase } from "idb"
import type { Project } from "@loupe/core"

/**
 * Local-first storage. There is no server and no account, so this database is
 * the only copy of a user's work.
 *
 * Originals and thumbnails are separate stores because the canvas only ever
 * reads thumbnails. Keeping multi-megabyte originals out of that read path is
 * what keeps a large session responsive.
 */
interface LoupeDB extends DBSchema {
  originals: { key: string; value: Blob }
  thumbnails: { key: string; value: Blob }
  project: { key: string; value: Project }
}

const DB_NAME = "loupe"
const DB_VERSION = 1

export const PROJECT_KEY = "current"

let dbPromise: Promise<IDBPDatabase<LoupeDB>> | null = null

export function getDb(): Promise<IDBPDatabase<LoupeDB>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable in this environment"))
  }

  dbPromise ??= openDB<LoupeDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("originals")) db.createObjectStore("originals")
      if (!db.objectStoreNames.contains("thumbnails")) db.createObjectStore("thumbnails")
      if (!db.objectStoreNames.contains("project")) db.createObjectStore("project")
    },
  })

  return dbPromise
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
