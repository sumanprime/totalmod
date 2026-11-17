// Runs the demo locally with `pnpm local:up` from the repo root: the production app, its mock-data
// preview and the Claude and GitHub stand-in. Every secret here is a fake value for local use.
// Each app starts node directly, because pm2 can't run pnpm's .cmd shims on Windows.
const { join } = require("node:path");

const pgliteServer = join(
  __dirname,
  "node_modules/@electric-sql/pglite-socket/dist/scripts/server.js",
);
const next = require.resolve("next/dist/bin/next");

function app(name, args, env) {
  return {
    name,
    cwd: __dirname,
    script: process.execPath,
    interpreter: "none",
    args,
    env,
    // A crash should show as "errored" in `pm2 status`, not loop.
    autorestart: false,
  };
}

module.exports = {
  apps: [
    app("demo-mock-apis", ["e2e/mock-apis.ts"], { MOCK_APIS_PORT: "3300" }),
    app(
      "demo-production",
      [
        pgliteServer,
        "--db=memory://",
        "--port=54329",
        "--max-connections=10",
        "--include-database-url",
        "--run",
        "node scripts/serve.ts",
      ],
      {
        TOTALMOD_MODE: "production",
        PORT: "3200",
        DEMO_SESSION_SECRET: "dev-session",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:3300",
        ANTHROPIC_API_KEY: "fake",
        TOTALMOD_GITHUB_API_URL: "http://127.0.0.1:3300",
        TOTALMOD_GITHUB_REPO: "sumanprime/demo-notes",
        TOTALMOD_GITHUB_TOKEN: "fake",
        TOTALMOD_PREVIEW_SECRET: "dev-preview",
        TOTALMOD_WEBHOOK_SECRET: "dev-webhook",
        TOTALMOD_TELEMETRY_ENDPOINT: "http://127.0.0.1:3300/v1/events",
        // Optional: a real interviewer on Ollama or LM Studio instead of the scripted answers.
        TOTALMOD_LLM: process.env.TOTALMOD_LLM ?? "",
        TOTALMOD_MODEL: process.env.TOTALMOD_MODEL ?? "",
        TOTALMOD_LLM_URL: process.env.TOTALMOD_LLM_URL ?? "",
      },
    ),
    app("demo-preview", [next, "start"], {
      TOTALMOD_MODE: "mock",
      PORT: "3100",
      TOTALMOD_PREVIEW_SECRET: "dev-preview",
    }),
  ],
};
