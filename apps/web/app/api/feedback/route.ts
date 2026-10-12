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

  const contactObject = typeof rawContact === "object" && rawContact !== null ? (rawContact as Record<string, unknown>) : {}
  const contact: FeedbackContact = {
    name: typeof contactObject.name === "string" ? contactObject.name : undefined,
    email: typeof contactObject.email === "string" ? contactObject.email : undefined,
  }

  const token = process.env.GITHUB_FEEDBACK_TOKEN
  if (!token) {
    console.error("GITHUB_FEEDBACK_TOKEN is not set — feedback cannot be filed.")
    return NextResponse.json({ error: "Feedback isn't configured on the server yet." }, { status: 500 })
  }

  let response: Response
  try {
    response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
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
    console.error("Network error reaching GitHub while filing feedback:", error)
    return NextResponse.json({ error: "Couldn't reach GitHub. Please try again." }, { status: 502 })
  }

  if (!response.ok) {
    console.error("GitHub rejected the feedback issue:", response.status, await response.text())
    return NextResponse.json({ error: "GitHub rejected the issue. Please try again." }, { status: 502 })
  }

  const issue = (await response.json()) as { html_url?: string }
  return NextResponse.json({ url: issue.html_url }, { status: 201 })
}
