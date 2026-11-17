# AGENTS.md

Human-curated. Never auto-generate or rewrite this file.

## Non-negotiable rules

1. **Mock data until release.** Flagged/preview code never sees production data. Isolation is enforced by infrastructure (separate preview deployment, no production env vars, no network path to the production DB), never by a code branch inside the production process.
2. **Raw user text never reaches the coding agent.** Only the interviewer's confirmed spec goes into the GitHub issue. Raw request text stays in the app's own storage.
3. **Policy lives in config and CI, not prompts.** `totalmod.config.yaml` is enforced by a deterministic check job. Prompt instructions are a convenience, not a control.
4. **Secrets never in agent context.** The agent job gets only `ANTHROPIC_API_KEY` and a scoped `GITHUB_TOKEN`. No production env vars in any preview or agent job.
5. **Telemetry is opt-in or announced on first run**, anonymous, counts only, disabled by `DO_NOT_TRACK=1` or `telemetry: false`. Never send request text, code, prompts or file paths.
6. **Scope discipline.** Keep each change to the issue or PR it belongs to. Raise anything else as its own issue.

## Commands

Requires Node 24+ and pnpm (`corepack enable`, version pinned in `package.json`).

| Task                     | Command                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| Install                  | `pnpm i`                                                                                            |
| Lint + format check      | `pnpm lint`                                                                                         |
| Auto-fix lint/format     | `pnpm format`                                                                                       |
| Typecheck                | `pnpm typecheck`                                                                                    |
| Test                     | `pnpm test`                                                                                         |
| Run the CLI from source  | `node packages/cli/src/bin.ts init --dir <next-app>`                                                |
| e2e (demo, both modes)   | `pnpm test:e2e` (first time: `pnpm --filter @totalmod/demo-notes exec playwright install chromium`) |
| Interviewer evals (paid) | `ANTHROPIC_API_KEY=... pnpm evals` (pass bar 14/15)                                                 |
| Build npm packages       | `pnpm build`, then `pnpm pack:smoke` (installs the tarballs into a fresh project)                   |
| Release notes            | `pnpm changeset` (publishing happens when the "Version packages" PR merges)                         |
| README GIF               | `pnpm --filter @totalmod/demo-notes demo:gif`                                                       |

All four of lint, typecheck and test must pass before a commit; CI runs the same.

## Paths

- **Allowed:** `packages/**`, `examples/**`, `scripts/**`, `action/**`, `skill/**`, `templates/**`, docs at the root.
- **Restricted (human review required):** `.github/**`, `AGENTS.md`, `totalmod.config.yaml`, `flags/**`.
- **Forbidden:** `.env*`, any file holding secrets.

## Conventions

- TypeScript strict, ESM, Node runs `.ts` directly (erasable syntax only, `.ts` import extensions).
- Biome for lint and format; Vitest for unit tests; Turborepo runs per-package `typecheck` and `test`.
- Explain non-obvious decisions in the PR description.
