// Feedback check: submit through the real bottom-left control and the real
// /api/feedback route, with GitHub replaced by a local stand-in.
//
//   npm run verify:feedback          # builds first
//
// The GitHub call happens on the server, out of the browser's reach, so it is
// intercepted by pointing the route's GITHUB_API_URL at a local HTTP server
// that answers each scenario's way. Nothing here touches the real GitHub.
// This verifier starts its own servers, so SEQUENCE_URL can't be used.
//
// The contract:
//   1. A 201 from GitHub shows "Feedback sent", closes the popover, and the
//      issue GitHub received has the right title, body, and bearer token.
//      The popover's only contact field is Email (#70: the issue is public,
//      so there is no Name field), and an entered email reaches the body.
//   2. Every failure shows a toast that says what happened, in the route's
//      own words, and keeps the draft in the popover for a retry.

import http from "node:http"
import path from "node:path"

import { dismissIntroduction, openApp } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const FAKE_TOKEN = "fake-token-for-verifier"
const SETUP_PROBLEM =
  "Feedback couldn't be filed because of a setup problem on our side, not yours. Your note is still here; please try again later."

/** How the stand-in GitHub answers, and what the bookmaker must then see. */
const SCENARIOS = [
  {
    name: "201 created",
    github: { status: 201, body: { html_url: "https://github.com/Langbra24/sequence/issues/999" } },
    route: 201,
    email: "reader@example.com",
    toast: ["Feedback sent", "We'll review your feedback in 2–3 business days."],
  },
  {
    name: "401 bad token",
    github: { status: 401, body: { message: "Bad credentials" } },
    route: 502,
    toast: ["Couldn't send feedback", SETUP_PROBLEM],
  },
  {
    name: "403 missing permission",
    github: { status: 403, body: { message: "Resource not accessible by personal access token" } },
    route: 502,
    toast: ["Couldn't send feedback", SETUP_PROBLEM],
  },
  {
    name: "403 rate limited",
    github: { status: 403, body: { message: "API rate limit exceeded" }, headers: { "x-ratelimit-remaining": "0" } },
    route: 503,
    toast: [
      "Couldn't send feedback",
      "GitHub is limiting requests right now. Your note is still here; please try again in a few minutes.",
    ],
  },
  {
    name: "404 repo not visible to token",
    github: { status: 404, body: { message: "Not Found" } },
    route: 502,
    toast: ["Couldn't send feedback", SETUP_PROBLEM],
  },
  {
    name: "422 validation failed",
    github: { status: 422, body: { message: "Validation Failed" } },
    route: 502,
    toast: ["Couldn't send feedback", "GitHub couldn't accept this feedback. Your note is still here; please try again in a moment."],
  },
  {
    name: "network error",
    github: { destroy: true },
    route: 502,
    toast: ["Couldn't send feedback", "Couldn't reach GitHub. Please try again in a moment."],
  },
]

const NO_TOKEN_SCENARIO = {
  name: "no GITHUB_FEEDBACK_TOKEN",
  route: 503,
  toast: ["Couldn't send feedback", "Feedback isn't set up on this server yet, so it couldn't be sent. Your note is still here."],
}

/** The browser never reaches Sequence's own server (offline, server down). */
const OFFLINE_SCENARIO = {
  name: "browser can't reach /api/feedback",
  offline: true,
  route: null,
  toast: ["Couldn't send feedback", "Couldn't reach Sequence's server. Check your connection; your note is still here."],
}

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

// The stand-in for api.github.com.
let answer = null
const received = []
const github = http.createServer((request, response) => {
  let body = ""
  request.on("data", (chunk) => (body += chunk))
  request.on("end", () => {
    received.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(body || "{}") })
    if (answer.destroy) return request.socket.destroy()
    response.writeHead(answer.status, { "Content-Type": "application/json", ...answer.headers })
    response.end(JSON.stringify(answer.body))
  })
})
await new Promise((resolve) => github.listen(0, "127.0.0.1", resolve))
const githubUrl = `http://127.0.0.1:${github.address().port}`

const configured = await startApp({ env: { GITHUB_FEEDBACK_TOKEN: FAKE_TOKEN, GITHUB_API_URL: githubUrl } })
// An empty value overrides any token in apps/web/.env.local (Next only fills unset keys).
const unconfigured = await startApp({ env: { GITHUB_FEEDBACK_TOKEN: "", GITHUB_API_URL: githubUrl } })

/** Opens the app fresh, submits one note, and checks what the bookmaker sees. */
async function submit(appUrl, scenario) {
  const { browser, page, errors } = await openApp(appUrl)
  const note = `Verifier note for "${scenario.name}"`
  try {
    await dismissIntroduction(page)
    if (scenario.offline) await page.route("**/api/feedback", (route) => route.abort("internetdisconnected"))
    await page.getByRole("button", { name: "Provide feedback" }).click()
    await page.getByPlaceholder("What's wrong, missing, or confusing?").fill(note)
    if (scenario.email) {
      const popup = page.getByRole("dialog", { name: "Send feedback" })
      const nameFields = await popup.getByRole("textbox", { name: /name/i }).count()
      check(nameFields === 0, `the feedback popover has no Name field (found ${nameFields})`)
      await popup.getByRole("textbox", { name: /email/i }).fill(scenario.email)
    }
    const routeResponse = scenario.offline
      ? Promise.resolve(null)
      : page.waitForResponse((response) => response.url().endsWith("/api/feedback"))
    await page.getByRole("button", { name: "Submit feedback" }).click()
    const status = (await routeResponse)?.status() ?? null

    const [title, description] = scenario.toast
    const toastShown = await page
      .getByText(description, { exact: true })
      .waitFor({ timeout: 10_000 })
      .then(() => page.getByText(title, { exact: true }).isVisible())
      .catch(() => false)

    const textarea = page.getByPlaceholder("What's wrong, missing, or confusing?")
    const succeeded = scenario.route === 201
    const draftState = succeeded
      ? await textarea.waitFor({ state: "hidden", timeout: 5_000 }).then(() => true, () => false)
      : (await textarea.isVisible()) && (await textarea.inputValue()) === note

    check(
      status === scenario.route && toastShown && draftState && errors.length === 0,
      `${scenario.name}: route ${status} (want ${scenario.route}), toast "${title}: ${description}"` +
        `${toastShown ? "" : " NOT shown"}, ${succeeded ? "popover closed" : "draft kept"}${draftState ? "" : " FAILED"}` +
        `${errors.length ? `, page errors: ${errors.join("; ")}` : ""}`,
    )
    if (!(status === scenario.route && toastShown && draftState)) {
      const shot = path.join(repoRoot, "screenshots", `feedback-failure-${scenario.name.replace(/\W+/g, "-")}.png`)
      await page.screenshot({ path: shot }).catch(() => {})
      console.error(`  page at failure → ${path.relative(repoRoot, shot)}`)
    }
  } finally {
    await browser.close()
  }
  return note
}

try {
  for (const scenario of SCENARIOS) {
    answer = scenario.github
    received.length = 0
    const note = await submit(configured.url, scenario)

    if (scenario.route === 201) {
      const issue = received[0]
      check(
        received.length === 1 &&
          issue.url === "/repos/Langbra24/sequence/issues" &&
          issue.authorization === `Bearer ${FAKE_TOKEN}` &&
          issue.body.title === "Feedback from the Sequence app" &&
          issue.body.body.includes(note),
        `GitHub received one issue on Langbra24/sequence with the note, title, and bearer token`,
      )
      check(
        Boolean(issue?.body.body.includes(`Email: ${scenario.email}`)) && !/^Name:/m.test(issue?.body.body ?? ""),
        `the issue body carries "Email: ${scenario.email}" and no Name line`,
      )
    }
  }

  received.length = 0
  await submit(unconfigured.url, NO_TOKEN_SCENARIO)
  check(received.length === 0, "with no token, the route never calls GitHub")

  await submit(configured.url, OFFLINE_SCENARIO)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
} finally {
  await configured.stop()
  await unconfigured.stop()
  github.close()
}

console.log(failures.length === 0 ? "\nFeedback: PASS" : `\nFeedback: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
