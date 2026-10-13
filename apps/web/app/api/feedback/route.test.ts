import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"

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
const originalApiUrl = process.env.GITHUB_API_URL
let consoleError: MockInstance<typeof console.error>

/** Everything the route logged with `console.error`, joined. */
const loggedError = () => consoleError.mock.calls.map((call) => call.map(String).join(" ")).join("\n")

beforeEach(() => {
  process.env.GITHUB_FEEDBACK_TOKEN = "test-token"
  delete process.env.GITHUB_API_URL
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(() => {
  restoreEnv("GITHUB_FEEDBACK_TOKEN", originalToken)
  restoreEnv("GITHUB_API_URL", originalApiUrl)
  consoleError.mockRestore()
  vi.unstubAllGlobals()
})

describe("POST /api/feedback", () => {
  it("503s with no issue-filing attempt, and logs the setup step, when GITHUB_FEEDBACK_TOKEN isn't configured", async () => {
    delete process.env.GITHUB_FEEDBACK_TOKEN
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(postRequest({ feedback: "hello" }))
    const json = (await response.json()) as { error: string }

    expect(response.status).toBe(503)
    expect(json.error).toBe("Feedback isn't set up on this server yet, so it couldn't be sent. Your note is still here.")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(loggedError()).toMatch(/GITHUB_FEEDBACK_TOKEN is not set.*Issues: Read and write.*\.env\.local.*Vercel/)
  })

  it("treats a whitespace-only token as not configured", async () => {
    process.env.GITHUB_FEEDBACK_TOKEN = "   "
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(postRequest({ feedback: "hello" }))

    expect(response.status).toBe(503)
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

  const setupProblem =
    "Feedback couldn't be filed because of a setup problem on our side, not yours. Your note is still here; please try again later."

  it.each([
    { status: 401, log: /GITHUB_FEEDBACK_TOKEN is invalid, expired, or revoked \(Bad credentials\)/, message: setupProblem },
    {
      status: 403,
      log: /GITHUB_FEEDBACK_TOKEN lacks permission to create issues \(Resource not accessible by personal access token\).*Issues: Read and write/,
      message: setupProblem,
    },
    { status: 404, log: /not visible to GITHUB_FEEDBACK_TOKEN \(Not Found\).*Repository access/, message: setupProblem },
    { status: 410, log: /issues are disabled/, message: setupProblem },
    {
      status: 422,
      log: /GitHub refused the issue as invalid \(Validation Failed\)/,
      message: "GitHub couldn't accept this feedback. Your note is still here; please try again in a moment.",
    },
  ])("502s on a GitHub $status, with a log line naming what to fix", async ({ status, log, message }) => {
    const githubMessages: Record<number, string> = {
      401: "Bad credentials",
      403: "Resource not accessible by personal access token",
      404: "Not Found",
      410: "Issues are disabled for this repo",
      422: "Validation Failed",
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(githubError(status, githubMessages[status])))

    const response = await POST(postRequest({ feedback: "hi" }))
    const json = (await response.json()) as { error: string }

    expect(response.status).toBe(502)
    expect(json.error).toBe(message)
    expect(loggedError()).toMatch(new RegExp(`GitHub returned ${status}: `))
    expect(loggedError()).toMatch(log)
  })

  it("503s with a wait-and-retry message when GitHub rate-limits the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(githubError(403, "API rate limit exceeded", { "x-ratelimit-remaining": "0" })),
    )

    const response = await POST(postRequest({ feedback: "hi" }))
    const json = (await response.json()) as { error: string }

    expect(response.status).toBe(503)
    expect(json.error).toMatch(/limiting requests.*few minutes/)
    expect(loggedError()).toMatch(/rate limited/)
  })

  it("502s when the network request to GitHub throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))

    const response = await POST(postRequest({ feedback: "hi" }))
    const json = (await response.json()) as { error: string }

    expect(response.status).toBe(502)
    expect(json.error).toBe("Couldn't reach GitHub. Please try again in a moment.")
    expect(loggedError()).toMatch(/Network error reaching GitHub/)
  })

  it("files against GITHUB_API_URL when it is set", async () => {
    process.env.GITHUB_API_URL = "http://127.0.0.1:9999/"
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ html_url: "https://x" }), { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)

    await POST(postRequest({ feedback: "hi" }))

    expect(fetchMock.mock.calls[0][0]).toBe(`http://127.0.0.1:9999/repos/${GITHUB_REPO}/issues`)
  })
})

function githubError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ message }), { status, headers })
}

/** Assigning `undefined` to `process.env` stores the string "undefined". */
function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
