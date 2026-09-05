/**
 * Composes the prefilled GitHub issue URL the feedback control (KTD9, R23,
 * R24) opens on submit. Pure and side-effect free — the control itself is
 * responsible for actually opening the URL — which is what makes the
 * round-trip behavior here testable without a browser.
 *
 * The real deployment target — matches `origin` in this checkout.
 */
export const GITHUB_REPO = "Langbra24/loupe"

/**
 * Optional identity a bookmaker can attach to their feedback — both fields
 * are voluntary (R23's follow-up: "make it optional to provide their name
 * and email"). Folded into the issue body rather than sent anywhere else:
 * there is still no backend here, just more text in the same prefilled URL.
 * No email is ever sent by Loupe itself for this — a confirmation-email
 * flow would need a real backend beyond the Stripe-only one CLAUDE.md
 * allows, so email here is purely contact info the maintainer can read in
 * the filed issue and reply to by hand.
 */
export interface FeedbackContact {
  name?: string
  email?: string
}

/** Enforced in the control's textarea itself (`maxLength`) with a live
 *  counter, not just here at compose time — KTD9's "never truncate silently"
 *  requirement. */
export const FEEDBACK_MAX_LENGTH = 2000

const ISSUE_TITLE = "Feedback from the Loupe app"

const BODY_HEADER =
  "Feedback submitted from within the Loupe app, via its bottom-left feedback control.\n\n---\n\n"

const BODY_FOOTER =
  "\n\n---\nSubmitted through Loupe's in-app feedback control. No project name, filenames, or other project state were included."

/**
 * The exact composed issue body: static template boilerplate, the
 * bookmaker's own text, an optional contact block if they gave a name and/or
 * email, and nothing else. No project name, filenames, or asset metadata are
 * ever appended here — this function doesn't even accept a `Project`, so
 * there is nothing else it could include (KTD9). Blank/whitespace-only
 * `name`/`email` are treated as not given, same as omitting `contact`
 * entirely — a field the user focused and left empty shouldn't produce an
 * empty "Email:" line in the filed issue.
 */
export function composeFeedbackBody(feedback: string, contact?: FeedbackContact): string {
  const lines = [
    contact?.name?.trim() ? `Name: ${contact.name.trim()}` : null,
    contact?.email?.trim() ? `Email: ${contact.email.trim()}` : null,
  ].filter((line): line is string => line !== null)
  const contactBlock = lines.length > 0 ? `\n\n---\n${lines.join("\n")}` : ""

  return `${BODY_HEADER}${feedback}${contactBlock}${BODY_FOOTER}`
}

/**
 * Builds the `github.com/<repo>/issues/new?title=...&body=...` URL the
 * feedback control opens. `repo` defaults to {@link GITHUB_REPO} but is a
 * parameter so callers (and tests) aren't stuck depending on that ever
 * changing.
 */
export function composeGitHubIssueUrl(
  feedback: string,
  contact?: FeedbackContact,
  repo: string = GITHUB_REPO,
): string {
  const body = composeFeedbackBody(feedback, contact)
  const title = encodeURIComponent(ISSUE_TITLE)
  const encodedBody = encodeURIComponent(body)
  return `https://github.com/${repo}/issues/new?title=${title}&body=${encodedBody}`
}
