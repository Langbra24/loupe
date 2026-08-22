import { describe, expect, it } from "vitest"

import { composeFeedbackBody, composeGitHubIssueUrl, FEEDBACK_MAX_LENGTH } from "@/lib/feedback-url"

/** Pulls `title`/`body` back out of a composed URL without depending on the
 *  URL constructor's own query-parsing choices matching how they were built. */
function decodeParams(url: string): { title: string; body: string } {
  const query = url.split("?")[1] ?? ""
  const params = new Map(
    query.split("&").map((pair) => {
      const [key, value] = pair.split("=")
      return [key, decodeURIComponent(value ?? "")]
    }),
  )
  return { title: params.get("title") ?? "", body: params.get("body") ?? "" }
}

describe("composeFeedbackBody", () => {
  it("equals exactly the template plus the user's text", () => {
    const feedback = "It would be great if I could export a PDF."
    const body = composeFeedbackBody(feedback)

    expect(body).toBe(
      "Feedback submitted from within the Loupe app, via its bottom-left feedback control.\n\n---\n\n" +
        feedback +
        "\n\n---\nSubmitted through Loupe's in-app feedback control. No project name, filenames, or other project state were included.",
    )
  })
})

describe("composeGitHubIssueUrl", () => {
  it("points at the given repo's issues/new endpoint", () => {
    const url = composeGitHubIssueUrl("hello", "acme/example")
    expect(url.startsWith("https://github.com/acme/example/issues/new?")).toBe(true)
  })

  it("round-trips feedback text containing &, #, and newlines", () => {
    const feedback = "Line one & line two # with a hash\nand a newline\n\nand a blank line"
    const url = composeGitHubIssueUrl(feedback)
    const { body } = decodeParams(url)
    expect(body).toBe(composeFeedbackBody(feedback))
  })

  it("composes successfully at exactly the 2,000-character cap", () => {
    const feedback = "x".repeat(FEEDBACK_MAX_LENGTH)
    const url = composeGitHubIssueUrl(feedback)
    const { body } = decodeParams(url)
    expect(body).toBe(composeFeedbackBody(feedback))
    expect(feedback).toHaveLength(FEEDBACK_MAX_LENGTH)
  })

  it("percent-encodes the static title", () => {
    const url = composeGitHubIssueUrl("hi")
    const { title } = decodeParams(url)
    expect(title).toBe("Feedback from the Loupe app")
  })

  it("never includes anything beyond the template and the user's own text", () => {
    const feedback = "just my feedback text"
    const { body } = decodeParams(composeGitHubIssueUrl(feedback))
    // Exact-equality, not substring-absence: pins the whole shape down rather
    // than checking a few field names aren't present.
    expect(body).toBe(composeFeedbackBody(feedback))
  })
})
