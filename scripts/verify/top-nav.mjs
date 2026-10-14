// Top-nav check: the fixed frame carries no dead controls (issue #58).
//
//   npm run verify:top-nav           # builds first
//   SEQUENCE_URL=http://localhost:3000 node scripts/verify/top-nav.mjs
//
// The contract:
//   1. The banner holds exactly one button, and it is "Export". A control
//      goes back in only once it does something.
//   2. No uncaught page errors.

import { openApp } from "./lib/app.mjs"
import { startApp } from "./lib/server.mjs"

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)

try {
  const names = await page
    .getByRole("banner")
    .getByRole("button")
    .evaluateAll((buttons) => buttons.map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim()))
  check(
    names.length === 1 && names[0] === "Export",
    `1. the top nav has exactly one button, "Export" (found: ${names.map((n) => `"${n}"`).join(", ") || "none"})`,
  )
  check(errors.length === 0, `2. no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nTop nav: PASS" : `\nTop nav: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
