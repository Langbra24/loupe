// Shared Playwright steps for driving the app through its real UI.
//
// Selectors are accessible names and visible copy, not CSS classes, so styling
// changes don't break verifiers. When a step here breaks because the UI changed
// on purpose, fix it here once — every verifier goes through these helpers.

import { readdirSync } from "node:fs"
import path from "node:path"
import { chromium } from "playwright"

import { repoRoot } from "./server.mjs"

/** Comfortably above the app's 1024px desktop-only breakpoint. */
export const DESKTOP_VIEWPORT = { width: 1440, height: 900 }

const photosDir = path.join(repoRoot, "scripts/verify/fixtures/photos")
export const FIXTURE_PHOTOS = readdirSync(photosDir)
  .filter((name) => name.endsWith(".jpg"))
  .sort()
  .map((name) => path.join(photosDir, name))

/** A fresh browser context — and so a fresh, empty IndexedDB — per call. */
export async function openApp(url, { acceptDownloads = false } = {}) {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: DESKTOP_VIEWPORT,
    deviceScaleFactor: 1,
    acceptDownloads,
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))

  await page.goto(url, { waitUntil: "networkidle" })
  await page.getByRole("banner").getByText("Loupe").waitFor()
  await page.evaluate(() => document.fonts.ready)

  return { browser, page, errors }
}

export async function dismissIntroduction(page) {
  const intro = page.getByRole("dialog", { name: "About Loupe" })
  await intro.waitFor()
  await intro.getByRole("button", { name: "Get started" }).click()
  await intro.waitFor({ state: "detached" })
}

/** Imports through the real hidden file input, same path as the button. */
export async function importPhotos(page, files = FIXTURE_PHOTOS) {
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles(files)
  await page.getByText(`${files.length} photograph${files.length === 1 ? "" : "s"} on the canvas.`).waitFor()
}

/**
 * Completes the one-time "Set up your book" dialog that appears after the
 * first import, then waits for the frames to exist in the Book overview.
 */
export async function setupBook(page, { preset, pageCount }) {
  const dialog = page.getByText("Set up your book").locator("..")
  await dialog.waitFor()
  await dialog.getByRole("button", { name: preset, exact: true }).click()
  await dialog.getByLabel("Starting page count").fill(String(pageCount))
  await dialog.getByRole("button", { name: "Create book" }).click()
  await page.getByText("Set up your book").waitFor({ state: "detached" })

  await page.getByRole("tab", { name: "Book" }).click()
  // .first(): the Book view's review grid can render the same page label too.
  await page.getByRole("button", { name: new RegExp(`^Page ${pageCount}\\b`) }).first().waitFor()
  await page.getByRole("tab", { name: "Canvas" }).click()
}

/** Lets panel transitions and the Fabric canvas settle before a capture. */
export async function settle(page) {
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(500)
}

/**
 * Center of the book's first page, found from the canvas's own pixels: the
 * first run of page-white in reading order. Verifier and screenshot builds
 * have no access to Fabric's objects, so this reads what is drawn.
 */
export async function firstPageCenter(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas.lower-canvas")
    const { width, height } = canvas
    const data = canvas.getContext("2d").getImageData(0, 0, width, height).data
    const white = (x, y) => {
      const i = (y * width + x) * 4
      return data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!white(x, y)) continue
        let right = x
        while (right + 1 < width && white(right + 1, y)) right++
        let bottom = y
        while (bottom + 1 < height && white(x, bottom + 1)) bottom++
        if (right - x < 20 || bottom - y < 20) continue
        // A spread is two pages flush together; stay in the left one.
        const rect = canvas.getBoundingClientRect()
        const scale = rect.width / width
        return { x: rect.left + (x + (right - x) / 4) * scale, y: rect.top + (y + (bottom - y) / 3) * scale }
      }
    }
    throw new Error("No book page found on the canvas.")
  })
}

/**
 * Sets up a book, places a text box on page 1 with the `T` tool, and opens
 * the sidebar's text Color picker. Returns the open popover.
 */
export async function openColorPicker(page) {
  await dismissIntroduction(page)
  await importPhotos(page)
  await setupBook(page, { preset: "A5 Portrait", pageCount: 8 })
  await settle(page)
  const spot = await firstPageCenter(page)
  await page.keyboard.press("T")
  await page.mouse.click(spot.x, spot.y)
  await page.waitForTimeout(300)
  await page.keyboard.type("Ink")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: /^#[0-9a-f]{6}$/i }).click()
  const popover = page.getByRole("tablist", { name: "Color input mode" }).locator("xpath=ancestor::*[@data-open][1]")
  await popover.waitFor()
  return popover
}
