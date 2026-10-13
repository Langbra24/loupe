// Motion check: reduced motion is honoured, the inspector swaps at once, and
// no ui/ component transitions `all` (issue #52).
//
//   npm run verify:motion            # builds first
//   LOUPE_URL=http://localhost:3000 node scripts/verify/motion.mjs
//
// The contract:
//   1. Under `prefers-reduced-motion: reduce`, nothing that opens moves,
//      scales or resizes: the shell grid has no transition, and opening the
//      Export dialog, a sidebar Select, the text Color picker and a tooltip
//      starts no animation or transition whose start and end differ in
//      transform, translate, scale, rotate, filter, width or height. Opacity
//      fades are allowed. The popups' tw-animate `--tw-enter-*` variables
//      resolve to identity, and so does the inspector's swap.
//      How: Chrome's animation playback rate is slowed to 2%, so a 150ms
//      popup takes ~7s; each running CSS animation is then seeked to its
//      start, its target's geometry read, then finished and read again.
//   2. With normal motion, the same checks *do* find motion in the Export
//      dialog, the Select, the Color picker and the tooltip, and the shell
//      grid transitions grid-template-columns. This keeps (1) from passing
//      because it measured nothing.
//   3. With normal motion, the inspector shows the new variant on the first
//      animation frame after a selection change: clicking a Book view row
//      puts the "Margins" heading in the DOM before the next frame, and the
//      fade that follows is opacity-only.
//   4. No file in apps/web/components/ui contains `transition-all`.
//   5. No uncaught page errors.
//   6. Canvas: a page dragged a little and dropped back in its own slot is
//      on that slot by the next frame under reduced motion, and still
//      mid-tween with normal motion. Reads `window.__loupeCanvas`, so the
//      build needs LOUPE_TEST_HOOKS=1.

import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { dismissIntroduction, importPhotos, openApp, placeTextOnFirstPage, settle, setupBook } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

/**
 * Every animation/transition running in the document that changes geometry,
 * as readable strings. CSS animations are judged by what they draw: the
 * target's transform/translate/scale/rotate/filter/size at the animation's
 * start vs. after it ends. Transitions are judged by the property name.
 */
async function geometricMotion(page, scope = null) {
  return page.evaluate((scope) => {
    const GEOMETRY = ["transform", "translate", "scale", "rotate", "filter", "width", "height"]
    const TRANSITION_GEOMETRY =
      /^(all|transform|translate|scale|rotate|filter|width|height|inset|top|left|right|bottom|margin.*|padding.*|grid-template-.*)$/
    const read = (target, pseudo) => {
      const style = getComputedStyle(target, pseudo)
      // tw-animate's keyframes always write a transform and a filter, so an
      // identity matrix and blur(0px) are what "no movement" looks like.
      const normalize = (property, value) => {
        if (property === "transform") return new DOMMatrix(value === "none" ? "" : value).toString()
        if (property === "filter" && value === "blur(0px)") return "none"
        return value
      }
      return GEOMETRY.map((property) => `${property}: ${normalize(property, style.getPropertyValue(property))}`).join("; ")
    }
    const describe = (target) =>
      target.getAttribute("role") ?? target.dataset.slot ?? target.className.toString().split(" ").slice(0, 3).join(".")
    const found = []
    for (const animation of document.getAnimations()) {
      const { target, pseudoElement } = animation.effect ?? {}
      if (!target || (scope && !scope.contains(target))) continue
      if (animation instanceof CSSTransition) {
        if (TRANSITION_GEOMETRY.test(animation.transitionProperty)) {
          found.push(`transition of ${animation.transitionProperty} on ${describe(target)}`)
        }
        continue
      }
      animation.pause()
      animation.currentTime = 0
      const start = read(target, pseudoElement)
      animation.finish()
      const end = read(target, pseudoElement)
      if (start !== end) {
        const name = animation.animationName ?? animation.id ?? "animation"
        found.push(`${name} on ${describe(target)} (start ${start} → end ${end})`)
      }
    }
    return found
  }, scope)
}

/** tw-animate's enter/exit variables on `locator`, unresolved values only. */
async function twAnimateVariables(locator) {
  return locator.evaluate((element) => {
    const identity = {
      scale: ["1", "100%"],
      "translate-x": ["0", "0px", "0%"],
      "translate-y": ["0", "0px", "0%"],
      rotate: ["0", "0deg"],
      blur: ["0", "0px"],
    }
    const style = getComputedStyle(element)
    const off = []
    for (const phase of ["enter", "exit"]) {
      for (const [name, values] of Object.entries(identity)) {
        const value = style.getPropertyValue(`--tw-${phase}-${name}`).trim()
        if (value !== "" && !values.includes(value)) off.push(`--tw-${phase}-${name}: ${value}`)
      }
    }
    return off
  })
}

async function closePopup(page) {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(150)
  // Finish whatever exit animation the slowed timeline is still playing.
  await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()))
  await page.waitForTimeout(100)
}

/** Opens each popup in turn and returns what moved, keyed by popup. */
async function openEachPopup(page) {
  const results = {}
  const inspector = page.getByRole("complementary").last()

  await page.getByRole("button", { name: "Export", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Export book" })
  await dialog.waitFor()
  results["Export dialog"] = { moved: await geometricMotion(page), vars: await twAnimateVariables(dialog) }
  await closePopup(page)

  await page.getByRole("tab", { name: "Book" }).click()
  await page
    .getByRole("complementary")
    .first()
    .getByRole("button", { name: "Page 3", exact: true })
    .click()
  await inspector.getByRole("heading", { name: "Margins" }).waitFor()
  await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()))
  await page.getByRole("tab", { name: "Canvas" }).click()
  await settle(page)
  await inspector.getByRole("combobox", { name: "Position" }).click()
  const listbox = page.getByRole("listbox")
  await listbox.waitFor()
  results["Position select"] = { moved: await geometricMotion(page), vars: await twAnimateVariables(listbox) }
  await closePopup(page)

  await page.keyboard.press("Escape")
  await placeTextOnFirstPage(page)
  await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()))
  await inspector.getByRole("button", { name: /^Color #[0-9a-f]{6}$/i }).click()
  const picker = page.getByRole("tablist", { name: "Color input mode" }).locator("xpath=ancestor::*[@data-open][1]")
  await picker.waitFor()
  results["Color picker"] = { moved: await geometricMotion(page), vars: await twAnimateVariables(picker) }
  await closePopup(page)

  await page.getByRole("button", { name: "Add text" }).hover()
  const tooltip = page.locator('[data-slot="tooltip-content"]')
  await tooltip.waitFor()
  results["Add text tooltip"] = { moved: await geometricMotion(page), vars: await twAnimateVariables(tooltip) }
  await page.mouse.move(0, 450)
  await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()))

  return results
}

/**
 * Drags the first page a short way, staying in its own slot, and lets go.
 * Returns how far (scene units) it still is from its slot on the next frame:
 * 0 under reduced motion, mid-tween otherwise. Needs `window.__loupeCanvas`.
 */
async function frameSnapGap(page) {
  const frame = await page.evaluate(() => {
    const canvas = window.__loupeCanvas
    const rect = canvas.getObjects().find((o) => o.frameId && !o.elementId && o.type === "rect")
    const box = canvas.upperCanvasEl.getBoundingClientRect()
    const [zoom, , , , panX, panY] = canvas.viewportTransform
    return {
      frameId: rect.frameId,
      slot: { x: rect.left, y: rect.top },
      screen: { x: box.left + rect.left * zoom + panX, y: box.top + rect.top * zoom + panY },
    }
  })
  await page.mouse.move(frame.screen.x, frame.screen.y)
  await page.mouse.down()
  await page.mouse.move(frame.screen.x + 15, frame.screen.y + 10, { steps: 4 })
  await page.mouse.move(frame.screen.x + 30, frame.screen.y + 20, { steps: 4 })
  await page.mouse.up()
  const gap = await page.evaluate(
    ({ frameId, slot }) =>
      new Promise((resolve) =>
        requestAnimationFrame(() => {
          const rect = window.__loupeCanvas.getObjects().find((o) => o.frameId === frameId && !o.elementId && o.type === "rect")
          resolve(Math.hypot(rect.left - slot.x, rect.top - slot.y))
        }),
      ),
    frame,
  )
  await page.waitForTimeout(400)
  await page.keyboard.press("Escape")
  return gap
}

async function shellGridTransition(page) {
  return page.locator('div[style*="grid-template-columns"]').evaluate((grid) => {
    const style = getComputedStyle(grid)
    return { property: style.transitionProperty, duration: style.transitionDuration }
  })
}

async function prepare(url, reducedMotion) {
  const session = await openApp(url)
  const { page } = session
  await page.emulateMedia({ reducedMotion })
  await dismissIntroduction(page)
  await importPhotos(page)
  await setupBook(page, { preset: "A5 Portrait", pageCount: 8 })
  await settle(page)
  return session
}

async function slowAnimations(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Animation.enable")
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.02 })
}

const app = await startApp()
const sessions = []

try {
  // 4. Static: no transition-all in ui/.
  const uiDir = path.join(repoRoot, "apps/web/components/ui")
  const offenders = readdirSync(uiDir).filter((file) => readFileSync(path.join(uiDir, file), "utf8").includes("transition-all"))
  check(offenders.length === 0, `4. no transition-all in components/ui${offenders.length ? `: ${offenders.join(", ")}` : ""}`)

  // 1. Reduced motion.
  const reduced = await prepare(app.url, "reduce")
  sessions.push(reduced)
  {
    const { page } = reduced
    const grid = await shellGridTransition(page)
    check(
      grid.property === "none" || /^0s(, 0s)*$/.test(grid.duration),
      `1. reduced: the shell grid has no transition (${grid.property} ${grid.duration})`,
    )

    const gap = await frameSnapGap(page)
    check(gap < 0.5, `6. reduced: a page dropped back in its slot lands there on the next frame (${gap.toFixed(1)} units off)`)

    await slowAnimations(page)
    await page.getByRole("tab", { name: "Book" }).click()
    await page.getByRole("complementary").first().getByRole("button", { name: "Page 2", exact: true }).click()
    await page.getByRole("complementary").last().getByRole("heading", { name: "Margins" }).waitFor()
    const inspectorMotion = await geometricMotion(page, await page.getByRole("complementary").last().elementHandle())
    check(
      inspectorMotion.length === 0,
      `1. reduced: the inspector's variant swap doesn't move${inspectorMotion.length ? `: ${inspectorMotion.join(" | ")}` : ""}`,
    )
    await page.getByRole("tab", { name: "Canvas" }).click()
    await page.keyboard.press("Escape")
    await settle(page)

    for (const [popup, { moved, vars }] of Object.entries(await openEachPopup(page))) {
      check(moved.length === 0, `1. reduced: ${popup} opens without moving${moved.length ? `: ${moved.join(" | ")}` : ""}`)
      check(vars.length === 0, `1. reduced: ${popup}'s tw-animate variables are identity${vars.length ? `: ${vars.join(", ")}` : ""}`)
    }
    check(reduced.errors.length === 0, `5. reduced: no uncaught page errors${reduced.errors.length ? `: ${reduced.errors.join("; ")}` : ""}`)
  }

  // 2–3. Normal motion.
  const normal = await prepare(app.url, "no-preference")
  sessions.push(normal)
  {
    const { page } = normal
    const grid = await shellGridTransition(page)
    check(
      grid.property.includes("grid-template-columns") && grid.duration !== "0s",
      `2. normal: the shell grid still transitions its columns (${grid.property} ${grid.duration})`,
    )

    const gap = await frameSnapGap(page)
    check(gap >= 0.5, `6. normal: a page dropped back in its slot still tweens there (${gap.toFixed(1)} units off on the next frame)`)

    // 3. Click a row in-page, then look on the very next animation frame.
    await slowAnimations(page)
    await page.getByRole("tab", { name: "Book" }).click()
    const row = page.getByRole("complementary").first().getByRole("button", { name: "Page 1", exact: true })
    await row.evaluate((element) => element.setAttribute("data-verify-row", ""))
    const inspectorHandle = await page.getByRole("complementary").last().elementHandle()
    const swap = await inspectorHandle.evaluate(
      (inspector) =>
        new Promise((resolve) => {
          const before = [...inspector.querySelectorAll("h2")].map((h) => h.textContent)
          document.querySelector("[data-verify-row]").click()
          requestAnimationFrame(() => {
            const after = [...inspector.querySelectorAll("h2")].map((h) => h.textContent)
            resolve({ before, after })
          })
        }),
    )
    check(
      !swap.before.includes("Margins") && swap.after.includes("Margins"),
      `3. normal: "Margins" is in the inspector on the first frame after selecting a page (before ${JSON.stringify(swap.before)}, after ${JSON.stringify(swap.after)})`,
    )
    const running = await inspectorHandle.evaluate((inspector) => inspector.getAnimations({ subtree: true }).length)
    const fade = await geometricMotion(page, inspectorHandle)
    check(
      fade.length === 0,
      `3. normal: the inspector's swap is opacity-only (${running} animation${running === 1 ? "" : "s"} running)${fade.length ? `: ${fade.join(" | ")}` : ""}`,
    )
    await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()))
    await page.getByRole("tab", { name: "Canvas" }).click()
    await page.keyboard.press("Escape")
    await settle(page)

    for (const [popup, { moved }] of Object.entries(await openEachPopup(page))) {
      check(moved.length > 0, `2. normal: ${popup} still animates in (${moved.length} geometric animation${moved.length === 1 ? "" : "s"} found)`)
    }
    check(normal.errors.length === 0, `5. normal: no uncaught page errors${normal.errors.length ? `: ${normal.errors.join("; ")}` : ""}`)
  }
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const page = sessions.at(-1)?.page
  const shot = path.join(repoRoot, "screenshots", "motion-failure.png")
  if (page) {
    await page.screenshot({ path: shot }).then(
      () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
      () => {},
    )
  }
} finally {
  for (const { browser } of sessions) await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nMotion: PASS" : `\nMotion: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
