import { describe, expect, it } from "vitest"

import { composeFeedbackBody } from "@/lib/feedback-url"

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

  it("omits the contact block entirely when no contact is given", () => {
    const body = composeFeedbackBody("hi")
    expect(body).not.toContain("Name:")
    expect(body).not.toContain("Email:")
  })

  it("includes just a Name line when only a name is given", () => {
    const body = composeFeedbackBody("hi", { name: "Jane Doe" })
    expect(body).toContain("\n\n---\nName: Jane Doe\n\n---\n")
    expect(body).not.toContain("Email:")
  })

  it("includes just an Email line when only an email is given", () => {
    const body = composeFeedbackBody("hi", { email: "jane@example.com" })
    expect(body).not.toContain("Name:")
    expect(body).toContain("\n\n---\nEmail: jane@example.com\n\n---\n")
  })

  it("includes both lines, name first, when both are given", () => {
    const body = composeFeedbackBody("hi", { name: "Jane Doe", email: "jane@example.com" })
    expect(body).toContain("\n\n---\nName: Jane Doe\nEmail: jane@example.com\n\n---\n")
  })

  it("treats blank/whitespace-only name and email as not given", () => {
    const body = composeFeedbackBody("hi", { name: "   ", email: "" })
    expect(body).not.toContain("Name:")
    expect(body).not.toContain("Email:")
  })

  it("trims surrounding whitespace from name and email", () => {
    const body = composeFeedbackBody("hi", { name: "  Jane Doe  ", email: "  jane@example.com  " })
    expect(body).toContain("Name: Jane Doe\n")
    expect(body).toContain("Email: jane@example.com\n")
  })

  it("round-trips feedback text containing &, #, and newlines verbatim", () => {
    // No URL/query-string encoding happens anywhere in this path anymore
    // (the body goes straight into a JSON POST body) — this just confirms
    // nothing here mangles characters that used to need percent-encoding.
    const feedback = "Line one & line two # with a hash\nand a newline\n\nand a blank line"
    const body = composeFeedbackBody(feedback)
    expect(body).toContain(feedback)
  })
})
