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

## Scripted mode

With `DEMO_SCRIPTED=1` the app needs no Anthropic key, GitHub repo or build agent. It's what `npx totalmod demo` runs (see [packages/cli/src/demo.ts](../../packages/cli/src/demo.ts)). [`lib/scripted-demo.ts`](lib/scripted-demo.ts) answers as the interviewer from [`lib/scripted-answers.ts`](lib/scripted-answers.ts) (the same answers `e2e/mock-apis.ts` gives) and fakes GitHub in-process. A few seconds after a spec is confirmed, it sends the app the webhooks GitHub and Vercel would, so the whole loop runs: interview, private preview, a fix round, approval and the merge. Without `DATABASE_URL` the app uses an empty in-memory PGlite.

Every request becomes the same word-count feature. The simulated build writes no code: the feature is already in the app behind [`lib/demo-feature.ts`](lib/demo-feature.ts), on only in scripted mode. The preview (mock mode, also with `DEMO_SCRIPTED=1`) shows it from the first try-it link, in a smaller grey font after a fix round (the round is in the link's path, `/round/<n>/totalmod/preview`). In the app it turns on for a user once their own request is merged.

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

## Auth

`lib/auth.ts` is a demo adapter: sign in with any name, and the session is an HMAC-signed user id in a cookie. It is not real authentication. totalmod reads the signed-in user through this adapter.
