// Small fixes from the October UI review (#56: S9, S10, S11, S13).
//
//   npm run verify:small-fixes       # builds first
//
// Feedback goes through the real /api/feedback route with GitHub replaced by
// a local stand-in, as in feedback.mjs, so this starts its own server and
// can't use LOUPE_URL. Nothing here touches the real GitHub.
//
// The contract:
//   1. Toasts sit at the top-right, below the 48px top nav, clear of the
//      canvas zoom controls and the canvas toolbars. Two toasts collapse into
//      a stack that peeks downward and expands downward on hover.
//   2. Escape dismisses the introduction overlay, as its X does.
//   3. The empty project's saddle-stitch line ("Add pages to get started.")
//      is not in the destructive color; a real unstitchable count (10 pages)
//      still is.
//   4. Cmd/Ctrl+Enter in the feedback textarea submits it.

import http from "node:http"
import path from "node:path"

import { dismissIntroduction, importPhotos, openApp, setupBook } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const NAV_HEIGHT = 48
const PLACEHOLDER = "What's wrong, missing, or confusing?"

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

const overlaps = (a, b) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const describe = (box) => `(${Math.round(box.x)}, ${Math.round(box.y)}) ${Math.round(box.width)}×${Math.round(box.height)}`

// The stand-in for api.github.com: 201 for "ok" notes, 422 otherwise, so a
// failing note leaves the popover open for a second submit.
let issues = 0
const github = http.createServer((request, response) => {
  let body = ""
  request.on("data", (chunk) => (body += chunk))
  request.on("end", () => {
    issues++
    const ok = JSON.parse(body || "{}").body?.includes("[ok]")
    response.writeHead(ok ? 201 : 422, { "Content-Type": "application/json" })
    response.end(JSON.stringify(ok ? { html_url: "https://github.com/Langbra24/loupe/issues/999" } : { message: "Validation Failed" }))
  })
})
await new Promise((resolve) => github.listen(0, "127.0.0.1", resolve))
const app = await startApp({
  env: { GITHUB_FEEDBACK_TOKEN: "fake-token-for-verifier", GITHUB_API_URL: `http://127.0.0.1:${github.address().port}` },
})

/** Runs one scenario in a fresh browser, screenshotting the page if it throws or fails. */
async function scenario(name, run) {
  const { browser, page, errors } = await openApp(app.url)
  const before = failures.length
  try {
    await run(page)
  } catch (error) {
    check(false, `${name}: ${error.message.split("\n")[0]}`)
  }
  if (errors.length) check(false, `${name}: page errors: ${errors.join("; ")}`)
  if (failures.length > before) {
    const shot = path.join(repoRoot, "screenshots", `small-fixes-failure-${name.replace(/\W+/g, "-")}.png`)
    await page.screenshot({ path: shot }).catch(() => {})
    console.error(`  page at failure → ${path.relative(repoRoot, shot)}`)
  }
  await browser.close()
}

try {
  await scenario("toast placement", async (page) => {
    // A book, so the canvas toolbars are up too.
    await dismissIntroduction(page)
    await importPhotos(page)
    await setupBook(page, { preset: "A5 Portrait", pageCount: 8 })
    await page.getByRole("button", { name: "Provide feedback" }).click()
    const textarea = page.getByPlaceholder(PLACEHOLDER)
    await textarea.fill("Verifier note, rejected")
    await page.getByRole("button", { name: "Submit feedback" }).click()
    const toasts = page.locator('[data-slot="toast"]')
    /** Boxes ordered front (--toast-index 0) to back. */
    const stackBoxes = async () => {
      const boxes = []
      for (const toast of await toasts.all()) {
        const index = await toast.evaluate((node) => Number(getComputedStyle(node).getPropertyValue("--toast-index")))
        boxes[index] = await toast.boundingBox()
      }
      return boxes
    }
    await page.getByText("Couldn't send feedback").first().waitFor()
    await page.waitForTimeout(700) // the enter slide

    const viewport = page.viewportSize()
    const nav = await page.getByRole("banner").boundingBox()
    const zoom = await page.getByRole("button", { name: "Zoom out" }).locator("..").boundingBox()
    const toolbars = await page.getByRole("button", { name: "Add text" }).locator("xpath=../..").boundingBox()
    const toast = await toasts.first().boundingBox()

    check(
      toast.y >= NAV_HEIGHT && toast.y >= nav.y + nav.height,
      `toast top ${Math.round(toast.y)}px is below the ${Math.round(nav.height)}px top nav`,
    )
    check(
      toast.x + toast.width > viewport.width - 32 && toast.x > viewport.width / 2 && toast.y < viewport.height / 3,
      `toast sits at the top-right: ${describe(toast)}`,
    )
    check(!overlaps(toast, zoom), `toast ${describe(toast)} clear of the zoom controls ${describe(zoom)}`)
    check(!overlaps(toast, toolbars), `toast ${describe(toast)} clear of the canvas toolbars ${describe(toolbars)}`)

    // A second toast: the stack collapses, the older card peeking out below
    // the front one, and spreads downward on hover.
    await page.getByRole("button", { name: "Submit feedback" }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-slot="toast"]').length === 2)
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
    await page.waitForTimeout(700)
    const [front, back] = await stackBoxes()
    check(
      front.y >= NAV_HEIGHT && back.y >= front.y && back.y + back.height > front.y + front.height && back.y < front.y + front.height,
      `collapsed: the older toast peeks out below the front one (front ${describe(front)}, back ${describe(back)})`,
    )
    await page.mouse.move(front.x + front.width / 2, front.y + front.height / 2)
    await page.waitForTimeout(700)
    const [expandedFront, expandedBack] = await stackBoxes()
    check(
      expandedFront.y >= NAV_HEIGHT && expandedBack.y >= expandedFront.y + expandedFront.height,
      `hovered: the stack spreads downward (front ${describe(expandedFront)}, back ${describe(expandedBack)})`,
    )
    check(!overlaps(expandedBack, zoom), "expanded stack stays clear of the zoom controls")

    // Swiping up dismisses (toward the edge the stack hangs from).
    const grab = { x: expandedFront.x + 40, y: expandedFront.y + expandedFront.height / 2 }
    await page.mouse.move(grab.x, grab.y)
    await page.mouse.down()
    await page.mouse.move(grab.x, grab.y - 80, { steps: 10 })
    await page.mouse.up()
    const swiped = await page
      .waitForFunction(() => document.querySelectorAll('[data-slot="toast"]').length === 1, null, { timeout: 3_000 })
      .then(() => true, () => false)
    check(swiped, "swiping the front toast up dismisses it")
  })

  await scenario("Escape dismisses the intro", async (page) => {
    const intro = page.getByRole("dialog", { name: "About Loupe" })
    await intro.waitFor()
    await page.waitForTimeout(300)
    const focusInside = await intro.evaluate((node) => node.contains(document.activeElement))
    await page.keyboard.press("Escape")
    const gone = await intro.waitFor({ state: "detached", timeout: 3_000 }).then(() => true, () => false)
    check(focusInside && gone, `Escape with focus in the intro dismisses it${focusInside ? "" : " (focus was not inside)"}`)
  })

  await scenario("saddle-stitch color", async (page) => {
    const destructive = await page.evaluate(() => {
      const probe = document.createElement("span")
      probe.style.color = "var(--destructive)"
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    })
    const colorOf = (text) =>
      page.getByText(text).evaluate((node) => getComputedStyle(node).color)

    await dismissIntroduction(page)
    const empty = await colorOf("Add pages to get started.")
    check(empty !== destructive, `empty project: "Add pages to get started." is ${empty}, not destructive ${destructive}`)

    await importPhotos(page)
    await setupBook(page, { preset: "A5 Portrait", pageCount: 10 })
    const line = page.getByText(/^10 pages\. Saddle stitch needs a multiple of 4/)
    await line.waitFor()
    const ten = await line.evaluate((node) => getComputedStyle(node).color)
    check(ten === destructive, `10 pages: the saddle-stitch line is still destructive (${ten})`)
  })

  await scenario("Cmd/Ctrl+Enter submits", async (page) => {
    await dismissIntroduction(page)
    await page.getByRole("button", { name: "Provide feedback" }).click()
    const textarea = page.getByPlaceholder(PLACEHOLDER)
    await page.getByRole("button", { name: "Submit feedback" }).locator("kbd").waitFor()
    const hint = await page.getByRole("button", { name: "Submit feedback" }).locator("kbd").textContent()
    check(/^(⌘|Ctrl) ↵$/.test(hint), `Submit button shows the shortcut hint "${hint}"`)

    const before = issues
    await textarea.fill("")
    await textarea.press("ControlOrMeta+Enter")
    await page.waitForTimeout(300)
    check(issues === before, "with an empty note, Ctrl/Cmd+Enter does nothing")

    for (const modifier of ["Control", "Meta"]) {
      if (!(await textarea.isVisible())) {
        await page.getByRole("button", { name: "Provide feedback" }).click()
      }
      const start = issues
      await textarea.fill(`Verifier note via ${modifier}+Enter [ok]`)
      const response = page.waitForResponse((r) => r.url().endsWith("/api/feedback"))
      await textarea.press(`${modifier}+Enter`)
      const status = (await response).status()
      const sent = await page.getByText("Feedback sent").last().waitFor({ timeout: 10_000 }).then(() => true, () => false)
      const closed = await textarea.waitFor({ state: "hidden", timeout: 5_000 }).then(() => true, () => false)
      check(
        status === 201 && issues === start + 1 && sent && closed,
        `${modifier}+Enter in the textarea submits: route ${status}, "Feedback sent" ${sent ? "shown" : "NOT shown"}, popover ${closed ? "closed" : "still open"}`,
      )
    }
  })
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
} finally {
  await app.stop()
  github.close()
}

console.log(failures.length === 0 ? "\nSmall fixes: PASS" : `\nSmall fixes: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
