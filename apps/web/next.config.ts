import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Required for the Docker image: Next traces the exact files the server needs
  // and emits a self-contained bundle. This is what sidesteps pnpm's symlinked
  // node_modules entirely -- no pnpm deploy, no hoisting, no copying a symlink
  // farm across a build stage.
  output: "standalone",
  // Mandatory in a workspace. Without it Next traces only apps/web and the
  // standalone bundle is missing every hoisted dependency.
  //
  // Note also the explicit @swc/helpers dependency in package.json: under pnpm
  // the tracer does not follow that symlink, and the standalone server dies at
  // startup with MODULE_NOT_FOUND. Declaring it directly is the documented fix.
  outputFileTracingRoot: path.join(process.cwd(), "../../"),

  // Next's tracer does not follow pnpm's symlink to @swc/helpers, which the
  // compiled output requires, so the standalone server dies at startup with
  // MODULE_NOT_FOUND. Forcing it into the trace is the fix; the alternative is
  // node-linker=hoisted, which trades one small include for phantom
  // dependencies across the whole workspace.
  outputFileTracingIncludes: {
    "/**/*": ["../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**/*"],
    // The OG route reads these at runtime with fs, which the tracer cannot
    // see through; left untraced they exist in the image only by luck.
    "/opengraph-image": ["./assets/fonts/**/*"],
  },

  async rewrites() {
    // BUILD TIME, not run time. Next evaluates rewrites() during `next build`
    // and serialises the result into the routes manifest, so setting
    // API_INTERNAL_URL on the running container has no effect -- the value has
    // to be present when the image is built. The web Dockerfile therefore sets
    // it in the build stage, defaulting to the compose service name.
    //
    // `next dev` re-evaluates this file on every start, so the localhost
    // fallback is what local development uses.
    const target = process.env.API_INTERNAL_URL ?? "http://localhost:3001";
    return {
      // beforeFiles, not the plain array form (which is afterFiles): /api
      // belongs to the API, full stop, and this must win over Next's own
      // filesystem routing so a stray src/app/api/ cannot shadow it.
      //
      // No prefix stripping on either side. The path is byte-identical from
      // the browser through to Nest, which is why the Bright Data webhook URL
      // did not change.
      beforeFiles: [{ source: "/api/:path*", destination: `${target}/api/:path*` }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
