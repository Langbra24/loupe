// Saved work survives the rename from Loupe to Sequence.
//
// Projects saved before the rename live in an IndexedDB database named
// "loupe"; the app now uses "sequence" (`apps/web/lib/storage/db.ts`). This
// builds a real project, moves every record of it under the old name exactly
// as an old build would have left it, then reloads and checks that:
//
//   1. the book comes back: same name, same pages, every photograph;
//   2. the records now live in "sequence", and "loupe" is gone;
//   3. a fresh visitor never gets a "loupe" database at all.
//
// The page is served blank while the records are moved, so the app holds no
// connection to either database during the swap.

import { startApp } from "./lib/server.mjs"
import { dismissIntroduction, importPhotos, openApp, settle, setupBook, FIXTURE_PHOTOS } from "./lib/app.mjs"

const BOOK_NAME = "Before the Rename"
const PAGES = 8

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)
const panel = page.getByRole("complementary").first()

/** Record counts and the project's name/pages in one database, by name. */
const readDb = (name) =>
  page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onerror = () => reject(request.error)
        request.onsuccess = async () => {
          const db = request.result
          const stores = ["originals", "thumbnails", "project"].filter((s) => db.objectStoreNames.contains(s))
          if (stores.length < 3) {
            db.close()
            return resolve(null)
          }
          const tx = db.transaction(stores)
          const count = (store) =>
            new Promise((done) => {
              const r = tx.objectStore(store).count()
              r.onsuccess = () => done(r.result)
            })
          const project = await new Promise((done) => {
            const r = tx.objectStore("project").getAll()
            r.onsuccess = () => done(r.result[0])
          })
          const result = {
            originals: await count("originals"),
            thumbnails: await count("thumbnails"),
            name: project?.name,
            frameIds: (project?.frames ?? []).map((f) => f.id),
          }
          db.close()
          resolve(result)
        }
      }),
    name,
  )

const databaseNames = () => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort())

/** Polls until `predicate` holds or `timeout` passes; returns the last value. */
async function poll(read, predicate, timeout = 5_000) {
  const deadline = Date.now() + timeout
  let value = await read()
  while (!predicate(value) && Date.now() < deadline) {
    await page.waitForTimeout(100)
    value = await read()
  }
  return value
}

try {
  // A real project under the new name.
  await dismissIntroduction(page)
  await importPhotos(page)
  await setupBook(page, { preset: "A5 Portrait", pageCount: PAGES })
  await panel.getByRole("button", { name: "Untitled book", exact: true }).click()
  await panel.getByRole("textbox", { name: "Book name" }).fill(BOOK_NAME)
  await page.keyboard.press("Enter")
  await settle(page)
  const before = await poll(
    () => readDb("sequence"),
    (db) => db?.name === BOOK_NAME && db.frameIds.length === PAGES,
  )
  check(
    before?.name === BOOK_NAME && before.frameIds.length === PAGES && before.originals === FIXTURE_PHOTOS.length,
    `set-up project stored under "sequence" (${before?.frameIds.length} pages, ${before?.originals} originals)`,
  )

  // Move it under the old name, as a pre-rename build would have left it.
  await page.route(app.url + "/", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>blank</title>" }))
  await page.reload()
  const moved = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const stores = ["originals", "thumbnails", "project"]
        const from = indexedDB.open("sequence")
        from.onerror = () => reject(from.error)
        from.onsuccess = () => {
          const src = from.result
          const read = src.transaction(stores)
          const data = {}
          for (const store of stores) {
            const keys = read.objectStore(store).getAllKeys()
            const values = read.objectStore(store).getAll()
            values.onsuccess = () => (data[store] = { keys: keys.result, values: values.result })
          }
          read.oncomplete = () => {
            src.close()
            const to = indexedDB.open("loupe", 1)
            to.onupgradeneeded = () => stores.forEach((store) => to.result.createObjectStore(store))
            to.onerror = () => reject(to.error)
            to.onsuccess = () => {
              const dst = to.result
              const write = dst.transaction(stores, "readwrite")
              for (const store of stores) {
                data[store].keys.forEach((key, i) => write.objectStore(store).put(data[store].values[i], key))
              }
              write.oncomplete = () => {
                dst.close()
                const del = indexedDB.deleteDatabase("sequence")
                del.onsuccess = async () => resolve((await indexedDB.databases()).map((d) => d.name).sort())
                del.onerror = () => reject(del.error)
              }
            }
          }
        }
      }),
  )
  check(JSON.stringify(moved) === JSON.stringify(["loupe"]), `staged: only "loupe" exists (${JSON.stringify(moved)})`)

  // 1. Reload the real app: the book comes back.
  await page.unroute(app.url + "/")
  await page.reload({ waitUntil: "networkidle" })
  await page.getByRole("banner").getByText("Sequence").waitFor()
  await settle(page)
  const nameShown = await panel.getByRole("button", { name: BOOK_NAME, exact: true }).count()
  check(nameShown === 1, `1. the book name "${BOOK_NAME}" is back in the panel`)
  const intro = await page.getByRole("dialog", { name: "About Sequence" }).count()
  check(intro === 0, "1. no first-run introduction, so the app knows it has a project")

  // 2. Everything now lives under "sequence"; "loupe" is gone.
  const after = await readDb("sequence")
  check(
    after?.name === BOOK_NAME &&
      JSON.stringify(after.frameIds) === JSON.stringify(before.frameIds) &&
      after.originals === before.originals &&
      after.thumbnails === before.thumbnails,
    `2. "sequence" holds the same project: ${after?.frameIds.length} pages, ${after?.originals} originals, ${after?.thumbnails} thumbnails`,
  )
  const names = await poll(databaseNames, (n) => !n.includes("loupe"))
  check(JSON.stringify(names) === JSON.stringify(["sequence"]), `2. only "sequence" remains (${JSON.stringify(names)})`)

  // 3. A fresh visitor never gets a "loupe" database.
  const fresh = await openApp(app.url)
  await fresh.page.waitForTimeout(500)
  const freshNames = await fresh.page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort())
  check(!freshNames.includes("loupe"), `3. a fresh visitor's databases: ${JSON.stringify(freshNames)}`)
  await fresh.browser.close()

  check(errors.length === 0, `no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.log(`✗ ${error.message}`)
  await page.screenshot({ path: "screenshots/storage-migration-failure.png" }).catch(() => {})
} finally {
  await browser.close()
  await app.stop()
}

console.log(`\nStorage migration: ${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`}`)
process.exit(failures.length === 0 ? 0 : 1)
