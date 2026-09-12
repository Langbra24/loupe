import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FEEDBACK_MAX_LENGTH, GITHUB_REPO } from "@/lib/feedback-url"

import { POST } from "./route"

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const originalToken = process.env.GITHUB_FEEDBACK_TOKEN

beforeEach(() => {
  process.env.GITHUB_FEEDBACK_TOKEN = "test-token"
})

afterEach(() => {
  process.env.GITHUB_FEEDBACK_TOKEN = originalToken
  vi.unstubAllGlobals()
})

describe("POST /api/feedback", () => {
  it("500s with no issue-filing attempt when GITHUB_FEEDBACK_TOKEN isn't configured", async () => {
    delete process.env.GITHUB_FEEDBACK_TOKEN
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(postRequest({ feedback: "hello" }))

    expect(response.status).toBe(500)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("400s on malformed JSON", async () => {
    const request = new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it("400s on empty/whitespace-only feedback", async () => {
    const response = await POST(postRequest({ feedback: "   " }))
    expect(response.status).toBe(400)
  })

  it("400s on feedback over the length cap", async () => {
    const response = await POST(postRequest({ feedback: "x".repeat(FEEDBACK_MAX_LENGTH + 1) }))
    expect(response.status).toBe(400)
  })

  it("files an issue on the configured repo and returns its URL on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ html_url: "https://github.com/Langbra24/loupe/issues/42" }), {
        status: 201,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(postRequest({ feedback: "It would be great if I could export a PDF." }))
    const json = (await response.json()) as { url?: string }

    expect(response.status).toBe(201)
    expect(json.url).toBe("https://github.com/Langbra24/loupe/issues/42")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://api.github.com/repos/${GITHUB_REPO}/issues`)
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token")
    const sentBody = JSON.parse(init.body as string) as { title: string; body: string }
    expect(sentBody.title).toBe("Feedback from the Loupe app")
    expect(sentBody.body).toContain("It would be great if I could export a PDF.")
  })

  it("folds an optional name/email into the filed issue's body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ html_url: "https://x" }), { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)

    await POST(postRequest({ feedback: "hi", contact: { name: "Jane Doe", email: "jane@example.com" } }))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const sentBody = JSON.parse(init.body as string) as { body: string }
    expect(sentBody.body).toContain("Name: Jane Doe")
    expect(sentBody.body).toContain("Email: jane@example.com")
  })

  it("502s when GitHub rejects the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 422 }))
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(postRequest({ feedback: "hi" }))
    expect(response.status).toBe(502)
  })

  it("502s when the network request to GitHub throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"))
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(postRequest({ feedback: "hi" }))
    expect(response.status).toBe(502)
  })
})
