// Starts the production web app (`next start`) on a free port for a verifier,
// or reuses one that is already running when LOUPE_URL is set.
//
// Verifiers run against the production build rather than `next dev` so what
// they check is what ships. The npm scripts that call them build first; a
// stale or missing `.next` is the one thing this refuses to paper over.

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const webDir = path.join(repoRoot, "apps/web")

export async function startApp() {
  if (process.env.LOUPE_URL) {
    return { url: process.env.LOUPE_URL, stop: async () => {} }
  }

  if (!existsSync(path.join(webDir, ".next/BUILD_ID"))) {
    throw new Error("No production build in apps/web/.next — run `npm run build` first.")
  }

  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const child = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: webDir,
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group, so stop() takes down npx *and* the next server it spawned.
    detached: true,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  })

  let output = ""
  child.stdout.on("data", (chunk) => (output += chunk))
  child.stderr.on("data", (chunk) => (output += chunk))

  const stop = async () => {
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch {
      // Already gone.
    }
  }

  try {
    await waitForHttp(url, child)
  } catch (error) {
    await stop()
    throw new Error(`${error.message}\n--- next start output ---\n${output}`)
  }
  return { url, stop }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitForHttp(url, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with code ${child.exitCode}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`next start did not answer at ${url} within ${timeoutMs / 1000}s`)
}
