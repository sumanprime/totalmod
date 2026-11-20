# demo-notes

A small Next.js notes app: the totalmod demo and the end-to-end test bed.

## Two modes

|             | Production (default)                        | Mock (`TOTALMOD_MODE=mock`)                                 |
| ----------- | ------------------------------------------- | ----------------------------------------------------------- |
| Database    | Postgres from `DATABASE_URL`                | In-memory PGlite, seeded from `seed/mock.ts`                |
| Used by     | The real deployment                         | Preview deployments of totalmod branches                    |
| Credentials | Needs `DATABASE_URL`, `DEMO_SESSION_SECRET` | None. Database env vars are removed, and reading one throws |

Mock mode boots PGlite with the same `migrations/` as production, then seeds four users, one per plan and role (free, pro, team admin), with 2 to 120 notes each. `lib/mock-guard.ts` deletes `DATABASE_URL`, `POSTGRES_*` and `PG*` from the environment and makes any later read throw. `createProductionDb` refuses to run in mock mode. Both are checked by `test/mock-guard.test.ts`. The e2e mock server is started with a fake leaked `DATABASE_URL` to prove it.

## Commands

```bash
pnpm dev                       # production mode; needs DATABASE_URL and DEMO_SESSION_SECRET
TOTALMOD_MODE=mock pnpm dev    # mock mode, no database needed
pnpm db:generate               # new migration after editing lib/db/schema.ts
pnpm db:migrate                # apply migrations to DATABASE_URL
pnpm test                      # unit tests, including the mock-mode guard
pnpm test:e2e                  # build, then Playwright against both modes
```

`test:e2e` needs Chromium once (`pnpm exec playwright install chromium`). It uses `E2E_DATABASE_URL` as the production database when set (CI uses a Postgres service). Without it, `pglite-server` serves an in-memory database over the Postgres protocol.

## Run everything locally

From the repo root, one command builds the demo and starts it under [pm2](https://pm2.keymetrics.io/):

```bash
pnpm local:up
```

| Service           | URL                     | What                                              |
| ----------------- | ----------------------- | ------------------------------------------------- |
| `demo-production` | <http://127.0.0.1:3200> | The app in production mode, on in-memory Postgres |
| `demo-preview`    | <http://127.0.0.1:3100> | The mock-data preview                             |
| `demo-mock-apis`  | <http://127.0.0.1:3300> | Stand-in for the Claude and GitHub APIs           |

Sign in on port 3200 to see **Request a feature**. Answers are scripted, and data is lost on restart. `pnpm local:logs` follows the logs and `pnpm local:down` stops everything. Run `pnpm local:up` again after a code change.

For a real interviewer without an API key, use a model on your machine. See [Try it without an API key](../../README.md#try-it-without-an-api-key).

```bash
TOTALMOD_LLM=ollama TOTALMOD_MODEL=qwen3.8 pnpm local:up
```

## Hosted demo on Vercel

A public demo that needs no Anthropic key, GitHub repo or build agent. With `DEMO_SCRIPTED=1`, [`lib/scripted-demo.ts`](lib/scripted-demo.ts) answers as the interviewer from [`lib/scripted-answers.ts`](lib/scripted-answers.ts), fakes GitHub in-process, and stands in for the build: a few seconds after a spec is confirmed, it sends the app the same webhooks GitHub and Vercel would. So visitors go through the whole loop: interview, private preview, a fix round, approval and the merge. Every request becomes the same word-count feature, and a banner says so.

Sign-in always creates a new account in this mode, because visitors share the database.

It takes two Vercel projects from this repository, both with **Root Directory** `examples/demo-notes`:

| Project | What                                          | Database                |
| ------- | --------------------------------------------- | ----------------------- |
| demo    | The app visitors sign in to                   | Neon                    |
| preview | The mock-data preview the "Try it" link opens | None (in-memory PGlite) |
1. **Create the preview project.** Import the repo, set the Root Directory, then add these environment variables and deploy:

   | Variable                       | Value                      |
   | ------------------------------ | -------------------------- |
   | `TOTALMOD_MODE`                | `mock`                     |
   | `TOTALMOD_PREVIEW_SECRET`      | a long random string       |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` (uses the pinned pnpm) |

   Give it no database variables: mock mode refuses to read them.

2. **Create the demo project** the same way, then add Neon under **Storage → Create Database → Neon**. That sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`, which the build uses to apply migrations. Add:

   | Variable                       | Value                                                         |
   | ------------------------------ | ------------------------------------------------------------- |
   | `DEMO_SCRIPTED`                | `1`                                                           |
   | `DEMO_PREVIEW_URL`             | the preview project's URL, e.g. `https://preview.example.com` |
   | `TOTALMOD_PREVIEW_SECRET`      | the same string as the preview project                        |
   | `DEMO_SESSION_SECRET`          | another long random string                                    |
   | `DO_NOT_TRACK`                 | `1`, so the demo sends no telemetry                           |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1`                                                           |

   Deploy. `pnpm vercel-build` migrates the database, then builds. No `ANTHROPIC_API_KEY` or GitHub variables are needed.

3. **Domains (optional).** Add a subdomain to each project under **Settings → Domains**, such as `demo.example.com` and `preview.example.com`, then update `DEMO_PREVIEW_URL` and redeploy the demo project.

The preview's in-memory database belongs to one server instance, so notes added there can disappear between visits. Visitors' notes and requests on the demo project stay in Neon until you clear them.

## Auth

`lib/auth.ts` is a demo adapter: sign in with any name, and the session is an HMAC-signed user id in a cookie. It is not real authentication. totalmod reads the signed-in user through this adapter.
