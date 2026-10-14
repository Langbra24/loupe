// Escape-steps-out check: Escape walks the selection back out one level at a
// time, ending at Book settings (issue #76).
//
//   npm run verify:escape-selection    # builds first, with test hooks on
//
// Reads the Fabric active object off `window.__loupeCanvas`, which exists only
// in a build made with LOUPE_TEST_HOOKS=1 (the npm script does that). With
// LOUPE_URL, the server must be such a build.
//
// The contract, on an 8-page A5 book:
//   1. Image in a page (first, so the text box placed next sits above it):
//      Escape selects its page, then shows Book settings, checked as in 2.
//   2. Text box (placed with `T`, still editing): Escape leaves editing and
//      keeps the box selected (inspector: Text). Escape again selects its page
//      (inspector: Margins; Fabric's active object is the frame). Escape again
//      shows Book settings (Saddle stitch and the Page size row; no active
//      object; no aria-current row in the Book view).
//   3. The text box's Color popover open: Escape closes only the popover; the
//      text box stays selected.
//   4. The text box's Font listbox open: Escape closes only the listbox.
//   5. A page's right-click menu open: Escape closes only the menu.
//   6. The Export dialog open: Escape closes only the dialog.
//   7. `T` armed with a page selected (from the Book view's list, so the
//      canvas has no active object to lose): Escape disarms the tool and keeps
//      the page selected. Escape again shows Book settings.
//   8. No uncaught page errors.

import path from "node:path"

import { dismissIntroduction, firstPageCenter, importPhotos, openApp, placePhotoOnFirstPage, settle, setupBook } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)
const inspector = page.getByRole("complementary").last()
const pagesList = page.getByRole("complementary").first()

/** The Fabric active object, reduced to what tells the levels apart. */
const active = () =>
  page.evaluate(() => {
    const object = window.__loupeCanvas.getActiveObject()
    if (!object) return null
    if (object.elementId) return { level: object.elementKind, editing: Boolean(object.isEditing) }
    if (object.frameId) return { level: "frame", frameId: object.frameId }
    return { level: object.type }
  })

/** Which inspector state is showing, from its section headings. */
const inspectorState = async () => {
  const headings = await inspector.getByRole("heading").allTextContents()
  if (headings.includes("Text")) return "text"
  if (headings.includes("Image")) return "image"
  if (headings.includes("Margins")) return "page"
  if (headings.includes("Saddle stitch")) return "book"
  return `unknown (${headings.join(", ")})`
}

const pressEscape = async () => {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
}

/** Book settings, everywhere: the inspector, Fabric, and the Book view's rows. */
const checkBookSettings = async (label) => {
  check((await inspectorState()) === "book", `${label}: the inspector shows Book settings (${await inspectorState()})`)
  const pageSizeRow = await inspector.getByText("Page size", { exact: true }).isVisible()
  check(pageSizeRow, `${label}: the "Page size" row is visible`)
  const object = await active()
  check(object === null, `${label}: no Fabric active object (${JSON.stringify(object)})`)
  await page.getByRole("tab", { name: "Book" }).click()
  await pagesList.getByRole("button", { name: "Page 1", exact: true }).waitFor()
  const current = await pagesList.locator('[aria-current="true"]').count()
  check(current === 0, `${label}: no aria-current row in the Book view (${current})`)
  await page.getByRole("tab", { name: "Canvas" }).click()
  await settle(page)
}

/** The page level: inspector, and the frame as Fabric's active object. */
const checkPageLevel = async (label) => {
  check((await inspectorState()) === "page", `${label}: the inspector shows Margins/Layout (${await inspectorState()})`)
  const object = await active()
  check(object?.level === "frame", `${label}: Fabric's active object is the frame (${JSON.stringify(object)})`)
}

/** Screen point of the one text box's center. */
const textCenter = () =>
  page.evaluate(() => {
    const canvas = window.__loupeCanvas
    const center = canvas
      .getObjects()
      .find((object) => object.elementKind === "text")
      .getCenterPoint()
    const v = canvas.viewportTransform
    const rect = canvas.upperCanvasEl.getBoundingClientRect()
    return { x: rect.left + v[0] * center.x + v[4], y: rect.top + v[3] * center.y + v[5] }
  })

const selectText = async () => {
  const center = await textCenter()
  await page.mouse.click(center.x, center.y)
  await page.waitForTimeout(250) // past the double-click window
  return (await inspectorState()) === "text" && (await active())?.level === "text"
}

try {
  await dismissIntroduction(page)
  if (!(await page.evaluate(() => Boolean(window.__loupeCanvas)))) {
    throw new Error(
      "window.__loupeCanvas is missing: this build has no test hooks. Run `npm run verify:escape-selection`, " +
        "or build with LOUPE_TEST_HOOKS=1 before pointing LOUPE_URL at it.",
    )
  }
  await importPhotos(page)
  await setupBook(page, { preset: "A5 Portrait", pageCount: 8 })
  await settle(page)

  // 1. Image in a page.
  await placePhotoOnFirstPage(page)
  let object = await active()
  check(object?.level === "image" && (await inspectorState()) === "image", `1. the image is selected (${JSON.stringify(object)})`)
  await pressEscape()
  await checkPageLevel("1. Escape selects its page")
  await pressEscape()
  await checkBookSettings("1. a second Escape")

  // 2. Text box, placed with T and still being typed into.
  const spot = await firstPageCenter(page)
  await page.keyboard.press("T")
  await page.mouse.click(spot.x, spot.y)
  await page.waitForFunction(() => window.__loupeCanvas.getActiveObject()?.isEditing === true, null, { timeout: 5_000 })
  await page.keyboard.type("Ink")
  await pressEscape()
  object = await active()
  check(object?.level === "text" && !object.editing, `2. Escape leaves editing; the box stays selected (${JSON.stringify(object)})`)
  check((await inspectorState()) === "text", `2. the inspector still shows Text (${await inspectorState()})`)
  await pressEscape()
  await checkPageLevel("2. a second Escape selects its page")
  await pressEscape()
  await checkBookSettings("2. a third Escape")

  // 3. Color popover.
  check(await selectText(), "3. a click selects the text box again")
  await inspector.getByRole("button", { name: /^Color #[0-9a-f]{6}$/i }).click()
  const popover = page.getByRole("tablist", { name: "Color input mode" })
  await popover.waitFor()
  await pressEscape()
  const popoverOpen = await popover.isVisible()
  object = await active()
  check(!popoverOpen, "3. Escape closes the Color popover")
  check(
    object?.level === "text" && (await inspectorState()) === "text",
    `3. ...and only the popover: the text box stays selected (${JSON.stringify(object)}, ${await inspectorState()})`,
  )

  // 4. Font listbox.
  await inspector.getByRole("combobox", { name: "Font" }).click()
  const listbox = page.getByRole("listbox")
  await listbox.waitFor()
  await pressEscape()
  const listboxOpen = await listbox.isVisible().catch(() => false)
  object = await active()
  check(!listboxOpen, "4. Escape closes the Font listbox")
  check(
    object?.level === "text" && (await inspectorState()) === "text",
    `4. ...and only the listbox: the text box stays selected (${JSON.stringify(object)}, ${await inspectorState()})`,
  )

  // 5. A page's right-click menu, with that page selected.
  await pressEscape()
  await checkPageLevel("5. (setup) Escape from the text box selects its page")
  const pageSpot = await firstPageCenter(page)
  await page.mouse.click(pageSpot.x, pageSpot.y + 120, { button: "right" })
  const menuItem = page.getByRole("button", { name: /^(Set as cover|Remove cover)$/ })
  await menuItem.waitFor()
  await pressEscape()
  check(!(await menuItem.isVisible()), "5. Escape closes the page's context menu")
  await checkPageLevel("5. ...and only the menu")

  // 6. Export dialog.
  await page.getByRole("banner").getByRole("button", { name: "Export" }).click()
  const exportDialog = page.getByRole("dialog", { name: "Export book" })
  await exportDialog.waitFor()
  await pressEscape()
  await exportDialog.waitFor({ state: "detached", timeout: 2_000 }).catch(() => {})
  check(!(await exportDialog.isVisible()), "6. Escape closes the Export dialog")
  await checkPageLevel("6. ...and only the dialog")

  // 7. T armed, with page 2 selected from the Book view's list.
  await pressEscape()
  await page.getByRole("tab", { name: "Book" }).click()
  await pagesList.getByRole("button", { name: "Page 2", exact: true }).click()
  await page.getByRole("tab", { name: "Canvas" }).click()
  await settle(page)
  check((await inspectorState()) === "page", `7. (setup) page 2 is selected from the Book view (${await inspectorState()})`)
  await page.keyboard.press("T")
  const armed = await page.evaluate(() => window.__loupeCanvas.skipTargetFind === true)
  check(armed, "7. T arms the text tool")
  await pressEscape()
  const disarmed = await page.evaluate(
    () => window.__loupeCanvas.skipTargetFind === false && window.__loupeCanvas.defaultCursor === "default",
  )
  check(disarmed, "7. Escape disarms the text tool")
  check((await inspectorState()) === "page", `7. ...and keeps page 2 selected (${await inspectorState()})`)
  await pressEscape()
  check((await inspectorState()) === "book", `7. Escape again shows Book settings (${await inspectorState()})`)

  check(errors.length === 0, `8. no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "escape-selection-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nEscape selection: PASS" : `\nEscape selection: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
