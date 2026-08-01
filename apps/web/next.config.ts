import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // @loupe/core is consumed as TypeScript source from the workspace rather than
  // a built artifact, so Next has to compile it alongside the app.
  transpilePackages: ["@loupe/core"],
}

export default nextConfig
