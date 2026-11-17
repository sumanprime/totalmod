import type { NextConfig } from "next";

const config: NextConfig = {
  // PGlite ships WASM and data files that must load from node_modules at runtime, not a bundle.
  // The totalmod server packages run as plain Node (they read prompts/ from disk at startup).
  serverExternalPackages: [
    "@electric-sql/pglite",
    "@totalmod/server",
    "@totalmod/core",
    "@totalmod/flags",
    "@totalmod/telemetry",
    "@openfeature/flagd-provider",
  ],
  // The widget ships TypeScript source; Next compiles it with the app.
  transpilePackages: ["@totalmod/widget"],
  // Typechecking runs as its own step (`pnpm typecheck`).
  typescript: { ignoreBuildErrors: true },
};

export default config;
