// Image cycling check: `]` / `[` step through the images placed in pages, in
// reading order, and Tab is plain browser focus movement (issue #19).
//
//   npm run verify:image-cycling     # builds first, with test hooks on
//
// Reads canvas state from `window.__sequenceCanvas`, which exists only in a build
// made with SEQUENCE_TEST_HOOKS=1 (the npm script does that). With SEQUENCE_URL, the
// server must be such a build.
//
// The contract, with three photos dragged onto two pages (two on page 1, one
// on the last page):
//   1. With nothing selected, `]` repeatedly selects the images in reading
//      order (page position, then element order) and wraps; `[` steps back
//      and, from nothing selected, starts at the last image. Each time the
//      inspector shows that image.
//   2. Zoomed in on page 1, stepping to the image on the last page pans it
//      into view without changing the zoom.
//   3. On a fresh load the first Tab focuses a real UI control, and `[` typed
//      in the book-name field is just a character.
//   4. No uncaught page errors.

import path from "node:path"

import { dismissIntroduction, importPhotos, openApp, settle, setupBook } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const PAGES = 8

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)

/** Screen point of a scene point on the live canvas. */
const screenOf = (selector) =>
  page.evaluate((selector) => {
    const canvas = window.__sequenceCanvas
    const objects = canvas.getObjects()
    const object =
      selector.placementIndex !== undefined
        ? objects.filter((o) => o.placementId)[selector.placementIndex]
        : objects.find((o) => o.frameId === selector.frameId && !o.elementId && o.type === "rect")
    const center = object.getCenterPoint()
    const v = canvas.viewportTransform
    const rect = canvas.upperCanvasEl.getBoundingClientRect()
    return { x: rect.left + v[0] * center.x + v[4], y: rect.top + v[3] * center.y + v[5] }
  }, selector)

/** Page ids in reading order, and every page image in reading order, from IndexedDB. */
const storedBook = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("sequence")
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const get = request.result.transaction("project").objectStore("project").getAll()
          get.onerror = () => reject(get.error)
          get.onsuccess = () => {
            const frames = [...(get.result[0]?.frames ?? [])].sort((a, b) => a.position - b.position)
            resolve({
              frameIds: frames.map((frame) => frame.id),
              images: frames.flatMap((frame) =>
                frame.elements
                  .filter((element) => element.kind === "image")
                  .map((element) => ({ frameId: frame.id, elementId: element.id, name: element.name })),
              ),
            })
          }
        }
      }),
  )

/** The selected element, whether its center is in view, and the zoom. A
 *  page-filling photo can be larger than the viewport, so "wholly in view"
 *  isn't always possible; the pan centers it. */
const selected = () =>
  page.evaluate(() => {
    const canvas = window.__sequenceCanvas
    const object = canvas.getActiveObject()
    if (!object) return null
    const v = canvas.viewportTransform
    const center = object.getCenterPoint()
    const x = v[0] * center.x + v[4]
    const y = v[3] * center.y + v[5]
    return {
      elementId: object.elementId ?? null,
      inView: x >= 0 && y >= 0 && x <= canvas.width && y <= canvas.height,
      zoom: canvas.getZoom(),
    }
  })

/** The image name the inspector currently shows, or null without an Image section. */
const inspectorImageName = () =>
  page
    .getByRole("heading", { name: "Image", exact: true })
    .waitFor({ timeout: 2_000 })
    .then(() =>
      page
        .getByRole("heading", { name: "Image", exact: true })
        .locator("xpath=..")
        .getByText("Name", { exact: true })
        .locator("xpath=following-sibling::*[1]")
        .textContent(),
    )
    .catch(() => null)

const clickEmptyCanvas = async () => {
  const box = await page.locator("canvas.upper-canvas").first().boundingBox()
  await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2)
}

const drag = async (from, to) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 })
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

try {
  await dismissIntroduction(page)
  if (!(await page.evaluate(() => Boolean(window.__sequenceCanvas)))) {
    throw new Error(
      "window.__sequenceCanvas is missing: this build has no test hooks. Run `npm run verify:image-cycling`, " +
        "or build with SEQUENCE_TEST_HOOKS=1 before pointing SEQUENCE_URL at it.",
    )
  }
  await importPhotos(page)
  await setupBook(page, { preset: "A5 Portrait", pageCount: PAGES })
  await settle(page)
  await page.waitForTimeout(1_000) // the new pages reach IndexedDB after the save debounce

  // Two photos onto page 1, one onto the last page, through real drags. Each
  // drop removes a photo from the pasteboard, so the next is always index 0.
  const { frameIds } = await storedBook()
  for (const frameId of [frameIds[0], frameIds[0], frameIds[PAGES - 1]]) {
    await drag(await screenOf({ placementIndex: 0 }), await screenOf({ frameId }))
  }
  await page.waitForTimeout(1_000) // past the save debounce
  const { images } = await storedBook()
  const pagesUsed = new Set(images.map((image) => image.frameId)).size
  check(images.length === 3 && pagesUsed === 2, `3 photos dragged onto ${pagesUsed} pages (${images.length} page images)`)
  const order = images.map((image) => image.elementId)

  // 1. ] in reading order, wrapping; the inspector follows.
  await clickEmptyCanvas()
  const forward = []
  let inspectorOk = true
  for (let i = 0; i < images.length + 1; i++) {
    await page.keyboard.press("]")
    const now = await selected()
    forward.push(now?.elementId)
    const expected = images[i % images.length]
    if ((await inspectorImageName()) !== expected.name) inspectorOk = false
  }
  check(
    JSON.stringify(forward) === JSON.stringify([...order, order[0]]),
    `1. ] selects the page images in reading order and wraps (${forward.length} presses, matches ${JSON.stringify([...order, order[0]].map((id) => order.indexOf(id)))})`,
  )
  check(inspectorOk, "1. the inspector shows each image's name as it's selected")
  await page.keyboard.press("[")
  check((await selected())?.elementId === order[images.length - 1], "1. [ steps back, wrapping past the first image")
  await clickEmptyCanvas()
  await page.keyboard.press("[")
  check((await selected())?.elementId === order[images.length - 1], "1. [ with nothing selected goes to the last image")

  // 2. Zoom in on page 1; stepping to the last page's image pans to it.
  await clickEmptyCanvas()
  const page1 = await screenOf({ frameId: frameIds[0] })
  await page.mouse.move(page1.x, page1.y)
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -560)
  await page.waitForTimeout(300)
  await clickEmptyCanvas()
  await page.keyboard.press("]")
  await page.keyboard.press("]")
  const before = await selected()
  const offScreenBefore = await page.evaluate((id) => {
    const canvas = window.__sequenceCanvas
    const object = canvas.getObjects().find((o) => o.elementId === id)
    const v = canvas.viewportTransform
    const center = object.getCenterPoint()
    const x = v[0] * center.x + v[4]
    const y = v[3] * center.y + v[5]
    return !(x >= 0 && y >= 0 && x <= canvas.width && y <= canvas.height)
  }, order[2])
  check(offScreenBefore, "2. zoomed in on page 1, the last page's image starts off-screen")
  await page.keyboard.press("]")
  const after = await selected()
  check(
    after?.elementId === order[2] && after.inView && Math.abs(after.zoom - before.zoom) < 1e-9,
    `2. stepping to the last page's image brings it into view at the same zoom (${JSON.stringify(after)})`,
  )

  // 3. Fresh load: Tab reaches the UI; [ types in the name field.
  await page.reload({ waitUntil: "networkidle" })
  await page.getByRole("banner").getByText("Sequence").waitFor()
  await settle(page)
  await page.keyboard.press("Tab")
  const first = await page.evaluate(() => {
    const element = document.activeElement
    return element && element !== document.body ? element.tagName.toLowerCase() : null
  })
  check(["a", "button", "input"].includes(first), `3. the first Tab focuses a real UI control (<${first}>)`)
  await page.getByRole("complementary").first().getByRole("button", { name: "Untitled book", exact: true }).click()
  const field = page.getByRole("textbox", { name: "Book name" })
  await field.press("End")
  await page.keyboard.press("[")
  check((await field.inputValue()) === "Untitled book[", `3. [ in the book-name field types a [`)
  check((await selected()) === null, "   and selects nothing on the canvas")
  await page.keyboard.press("Escape")

  check(errors.length === 0, `4. no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "image-cycling-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nImage cycling: PASS" : `\nImage cycling: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
