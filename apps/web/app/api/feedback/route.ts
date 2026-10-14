import { NextResponse } from "next/server"

import {
  composeFeedbackBody,
  FEEDBACK_ISSUE_TITLE,
  FEEDBACK_MAX_LENGTH,
  GITHUB_REPO,
  type FeedbackContact,
} from "@/lib/feedback-url"

/**
 * Files the feedback control's submission as a real GitHub issue, server
 * side. This is the one deliberate exception to CLAUDE.md's "no accounts,
 * no backend beyond thin serverless functions for Stripe" — see that file's
 * Hard rules for the amendment. Direct follow-up: the prior version opened
 * a prefilled `github.com/.../issues/new` URL for the bookmaker to submit
 * themselves, which meant they had to be signed into GitHub and the
 * maintainer got no notification (GitHub doesn't email a repo owner for
 * their *own* API-authored activity, but it does for anything filed by a
 * distinct identity — which is exactly what this route is, using its own
 * token rather than the maintainer's personal one). Now the browser never
 * touches GitHub at all; this route does, with a token only it ever sees.
 *
 * Requires `GITHUB_FEEDBACK_TOKEN` — a token scoped to Issues: write on
 * `GITHUB_REPO` only (a fine-grained personal access token, or a token
 * belonging to a separate lightweight bot account so the notification
 * isn't self-suppressed) — set as a server-only environment variable
 * (never `NEXT_PUBLIC_*`, which Next inlines into client bundles). See
 * apps/web/.env.example.
 *
 * No rate limiting or spam defense beyond the length cap below — this is a
 * single-purpose personal-project endpoint, not a public API; revisit if
 * abuse actually shows up.
 */
export async function POST(request: Request) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  if (typeof payload !== "object" || payload === null) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const { feedback: rawFeedback, contact: rawContact } = payload as {
    feedback?: unknown
    contact?: unknown
  }

  const feedback = typeof rawFeedback === "string" ? rawFeedback.trim() : ""
  if (!feedback || feedback.length > FEEDBACK_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Feedback is required and must be ${FEEDBACK_MAX_LENGTH} characters or fewer.` },
      { status: 400 },
    )
  }

  // Only `email` is read. A `contact.name` from a tab opened before the Name
  // field was removed (#70) is ignored, not rejected, so that note still files.
  const contactObject = typeof rawContact === "object" && rawContact !== null ? (rawContact as Record<string, unknown>) : {}
  const contact: FeedbackContact = {
    email: typeof contactObject.email === "string" ? contactObject.email : undefined,
  }

  const token = process.env.GITHUB_FEEDBACK_TOKEN?.trim()
  if (!token) {
    console.error(
      "[feedback] GITHUB_FEEDBACK_TOKEN is not set, so feedback cannot be filed. " +
        `Create a fine-grained personal access token for ${GITHUB_REPO} with Issues: Read and write, ` +
        "then set it in apps/web/.env.local (local) or the Vercel project's environment variables (deployed) and redeploy. " +
        "Full steps: \"Feedback setup\" in README.md.",
    )
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 })
  }

  let response: Response
  try {
    response = await fetch(`${githubApiUrl()}/repos/${GITHUB_REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "loupe-feedback-control",
      },
      body: JSON.stringify({
        title: FEEDBACK_ISSUE_TITLE,
        body: composeFeedbackBody(feedback, contact),
      }),
    })
  } catch (error) {
    console.error("[feedback] Network error reaching GitHub while filing feedback:", error)
    return NextResponse.json({ error: "Couldn't reach GitHub. Please try again in a moment." }, { status: 502 })
  }

  if (!response.ok) {
    const failure = describeGitHubFailure(response, await response.text())
    console.error(`[feedback] GitHub returned ${response.status}: ${failure.log}`)
    return NextResponse.json({ error: failure.message }, { status: failure.status })
  }

  const issue = (await response.json()) as { html_url?: string }
  return NextResponse.json({ url: issue.html_url }, { status: 201 })
}

const NOT_CONFIGURED_MESSAGE =
  "Feedback isn't set up on this server yet, so it couldn't be sent. Your note is still here."

/** A setup problem on the maintainer's side: nothing the bookmaker can do
 *  except come back later, so they are told that rather than "try again". */
const SETUP_PROBLEM_MESSAGE =
  "Feedback couldn't be filed because of a setup problem on our side, not yours. Your note is still here; please try again later."

/**
 * Overridable only so `scripts/verify/feedback.mjs` can point the real route
 * at a local stand-in for GitHub. Server-only, like the token.
 */
function githubApiUrl(): string {
  return (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "")
}

/**
 * Maps a GitHub rejection to what the server log needs (which setup step to
 * fix) and what the bookmaker is told. The token problems all read the same
 * to the bookmaker; the log is where they differ.
 */
function describeGitHubFailure(
  response: Response,
  bodyText: string,
): { log: string; message: string; status: number } {
  const detail = githubMessage(bodyText)
  const rateLimited =
    response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")

  if (rateLimited) {
    return {
      log: `rate limited (${detail}). Nothing to fix; submissions resume when the limit resets.`,
      message: "GitHub is limiting requests right now. Your note is still here; please try again in a few minutes.",
      status: 503,
    }
  }

  switch (response.status) {
    case 401:
      return {
        log: `GITHUB_FEEDBACK_TOKEN is invalid, expired, or revoked (${detail}). Generate a new token and replace it where it is set.`,
        message: SETUP_PROBLEM_MESSAGE,
        status: 502,
      }
    case 403:
      return {
        log: `GITHUB_FEEDBACK_TOKEN lacks permission to create issues (${detail}). Give it Issues: Read and write on ${GITHUB_REPO}.`,
        message: SETUP_PROBLEM_MESSAGE,
        status: 502,
      }
    case 404:
      return {
        log: `${GITHUB_REPO} is not visible to GITHUB_FEEDBACK_TOKEN (${detail}). Add the repo to the token's "Repository access", or check GITHUB_REPO.`,
        message: SETUP_PROBLEM_MESSAGE,
        status: 502,
      }
    case 410:
      return {
        log: `issues are disabled on ${GITHUB_REPO} (${detail}). Turn them on in the repo's Settings → Features.`,
        message: SETUP_PROBLEM_MESSAGE,
        status: 502,
      }
    case 422:
      return {
        log: `GitHub refused the issue as invalid (${detail}).`,
        message: "GitHub couldn't accept this feedback. Your note is still here; please try again in a moment.",
        status: 502,
      }
    default:
      return {
        log: `unexpected response (${detail}).`,
        message: "GitHub had a problem filing this feedback. Your note is still here; please try again in a moment.",
        status: 502,
      }
  }
}

/** GitHub's own `message` field when the body is its usual JSON error. */
function githubMessage(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { message?: unknown }
    if (typeof parsed.message === "string") return parsed.message
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return bodyText.slice(0, 200) || "no body"
}
