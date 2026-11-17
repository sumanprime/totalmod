import { defineConfig, devices } from "@playwright/test";

// Two servers from one build: mock mode (PGlite + seed) and production mode (Postgres).
// CI passes a real Postgres as E2E_DATABASE_URL. Locally, pglite-server stands in for it.
const prodDb = process.env.E2E_DATABASE_URL;
// pglite-server runs its --run command without a shell, so migrate-then-start is one node script.
const startProd = "node scripts/serve.ts";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  // pglite-server multiplexes one connection and can fail concurrent queries; real Postgres can't.
  ...(prodDb ? {} : { workers: 1 }),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  projects: [
    { name: "mock", use: { baseURL: "http://127.0.0.1:3100" } },
    { name: "production", use: { baseURL: "http://127.0.0.1:3200" } },
  ],
  webServer: [
    {
      // Stand-in for the Anthropic and GitHub APIs; see e2e/mock-apis.ts.
      command: "node e2e/mock-apis.ts",
      url: "http://127.0.0.1:3300/__health",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm start",
      url: "http://127.0.0.1:3100/signin",
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        TOTALMOD_MODE: "mock",
        PORT: "3100",
        // A misconfigured preview: the guard must drop this and the app must still run on PGlite.
        DATABASE_URL: "postgres://leaked:leaked@prod.invalid:5432/app",
        // Previews may hold the preview secret (to verify signed links) and nothing else secret.
        TOTALMOD_PREVIEW_SECRET: "e2e-preview-secret",
      } as Record<string, string>,
    },
    {
      command: prodDb
        ? startProd
        : `pnpm exec pglite-server --db=memory:// --port=54329 --max-connections=10 --include-database-url --run "${startProd}"`,
      url: "http://127.0.0.1:3200/signin",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        TOTALMOD_MODE: "production",
        PORT: "3200",
        DEMO_SESSION_SECRET: "e2e-session-secret",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:3300",
        ANTHROPIC_API_KEY: "e2e-anthropic-key",
        TOTALMOD_GITHUB_API_URL: "http://127.0.0.1:3300",
        TOTALMOD_GITHUB_REPO: "sumanprime/demo-notes",
        TOTALMOD_GITHUB_TOKEN: "e2e-github-token",
        TOTALMOD_PREVIEW_SECRET: "e2e-preview-secret",
        TOTALMOD_WEBHOOK_SECRET: "e2e-webhook-secret",
        TOTALMOD_TELEMETRY_ENDPOINT: "http://127.0.0.1:3300/v1/events",
        ...(prodDb ? { DATABASE_URL: prodDb } : {}),
      } as Record<string, string>,
    },
  ],
});
