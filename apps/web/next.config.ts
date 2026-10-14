import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // @sequence/core is consumed as TypeScript source from the workspace rather than
  // a built artifact, so Next has to compile it alongside the app.
  transpilePackages: ["@sequence/core"],
  env: {
    // Always defined, so it's inlined and an ordinary build drops the
    // verifier hook in use-fabric-canvas.ts as dead code. Only
    // `npm run verify:text-selection` builds with SEQUENCE_TEST_HOOKS=1.
    SEQUENCE_TEST_HOOKS: process.env.SEQUENCE_TEST_HOOKS === "1" ? "1" : "0",
  },
}

export default nextConfig
