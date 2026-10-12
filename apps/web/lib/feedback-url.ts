/**
 * Composes the body of the GitHub issue the feedback control (KTD9, R23,
 * R24) files. Pure and side-effect free — actually calling GitHub's API is
 * `app/api/feedback/route.ts`'s job — which is what makes the body-shape
 * logic here testable without a network call.
 *
 * Direct follow-up on R23/R24: this used to compose a `github.com/.../
 * issues/new?...` URL for the browser to open, requiring the bookmaker to
 * be signed into GitHub themselves. That's gone — the feedback control now
 * POSTs to our own `/api/feedback` route, which files the issue server-side
 * using a repo-scoped token (`GITHUB_FEEDBACK_TOKEN`), so submitting
 * feedback needs no GitHub account at all. See that route for the actual
 * API call and CLAUDE.md's "Hard rules" for why a backend exists here now.
 */
export const GITHUB_REPO = "Langbra24/loupe"

export const FEEDBACK_ISSUE_TITLE = "Feedback from the Loupe app"

/**
 * Optional identity a bookmaker can attach to their feedback — both fields
 * are voluntary (R23's follow-up: "make it optional to provide their name
 * and email"). Folded into the issue body rather than sent anywhere else —
 * this is still the only place either value goes. No confirmation email is
 * sent for a given email address: that's a distinct, bigger feature (an
 * outbound mailer) than "file the issue for me," which is all this route
 * does; email here is contact info the maintainer can read in the filed
 * issue and reply to by hand.
 */
export interface FeedbackContact {
  name?: string
  email?: string
}

/** Enforced in the control's textarea itself (`maxLength`) with a live
 *  counter, not just here at compose time — KTD9's "never truncate silently"
 *  requirement. Also re-checked server-side in the API route, since a client
 *  is never trusted to have actually enforced its own `maxLength`. */
export const FEEDBACK_MAX_LENGTH = 2000

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
