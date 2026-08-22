/**
 * Composes the prefilled GitHub issue URL the feedback control (KTD9, R23,
 * R24) opens on submit. Pure and side-effect free — the control itself is
 * responsible for actually opening the URL — which is what makes the
 * round-trip behavior here testable without a browser.
 *
 * The repo slug is a placeholder. Fill in the real owner/repo before shipping
 * the feedback control; this is a deployment detail, not something to guess
 * at from a git remote.
 */
export const GITHUB_REPO = "owner/loupe"

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
 * The exact composed issue body: static template boilerplate plus the
 * bookmaker's own text, and nothing else. No project name, filenames, or
 * asset metadata are ever appended here — this function doesn't even accept
 * a `Project`, so there is nothing else it could include (KTD9).
 */
export function composeFeedbackBody(feedback: string): string {
  return `${BODY_HEADER}${feedback}${BODY_FOOTER}`
}

/**
 * Builds the `github.com/<repo>/issues/new?title=...&body=...` URL the
 * feedback control opens. `repo` defaults to {@link GITHUB_REPO} but is a
 * parameter so callers (and tests) aren't stuck depending on that placeholder
 * ever becoming the real slug.
 */
export function composeGitHubIssueUrl(feedback: string, repo: string = GITHUB_REPO): string {
  const body = composeFeedbackBody(feedback)
  const title = encodeURIComponent(ISSUE_TITLE)
  const encodedBody = encodeURIComponent(body)
  return `https://github.com/${repo}/issues/new?title=${title}&body=${encodedBody}`
}
