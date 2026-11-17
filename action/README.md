# totalmod build action

Composite GitHub Action that builds a confirmed totalmod spec on a branch:

1. **Policy check (no model).** Is this a `totalmod:build` issue or a `totalmod:iterate` PR comment from a trusted account, with valid metadata? Are the request and monthly budgets left? Is the iteration under the cap? If not, it fails closed with a comment.
2. **Build.** `anthropics/claude-code-action@v1` runs with the build skill (`skill/SKILL.md`) and the spec, on `totalmod/req-<reqId>`. It can edit files and run the project's test, lint and typecheck commands, with no network tools and no git writes.
3. **Path check (no model).** The branch diff is checked against `paths.allowed`, `paths.blocked` and `paths.maxChangedLines` from `totalmod.config.yaml`. On a violation it fails, comments, labels `totalmod:blocked`, and pushes nothing.
4. **Publish.** Commits, pushes, and opens a draft PR linked to the issue (only for the first build).
5. **Record spend.** Posts the run's Claude cost on the issue; step 1 reads these.

Use it through the workflow `npx totalmod init` writes (`.github/workflows/totalmod-build.yml`). Setup:

| Where    | Name                      | What                                                                                                                                                  |
| -------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secret   | `ANTHROPIC_API_KEY`       | For the build agent. The only secret it sees.                                                                                                         |
| Secret   | `TOTALMOD_GITHUB_TOKEN`   | GitHub App token or fine-grained PAT with contents, issues and pull requests: write. The default `GITHUB_TOKEN` would not trigger CI on the draft PR. |
| Variable | `TOTALMOD_TRUSTED_ACTORS` | The GitHub login(s) your totalmod server files issues as.                                                                                             |

## Risk summary

After the path check, the action runs the project's tests itself (`test_command`, default `<package manager> test`). It writes a risk summary into the PR body covering the policy and path checks, files by area, the test result and fix rounds, plus a **requester verdict** row the server fills in on thumbs-up. Each fix round replaces the summary rather than adding another.

## Release action (`action/release`)

Used by `.github/workflows/totalmod-release.yml`; it only runs after a human acts:

| Trigger                                                                        | What happens                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PR merged                                                                      | `req-<id>` turns on for the requester (hashed id) in `flags/totalmod.flags.json`, committed to the default branch. The issue is closed.                                                                                              |
| Label `totalmod:rollout-<n>` / `totalmod:ga` / `totalmod:off` on the merged PR | The flag rolls out to n%, goes on for everyone, or switches off.                                                                                                                                                                     |
| PR closed without merging                                                      | The branch is deleted and the issue closed as not planned.                                                                                                                                                                           |
| Daily schedule                                                                 | The oldest flag that has been GA for `flags.removeAfterDays` is passed to the build action with `task: remove-flag`. That run removes the flag checks, removes the flags-file entry, and opens a normal (non-draft) PR. One per day. |

The release token must be allowed to push to the default branch. With branch protection, give the App or token a bypass for `flags/totalmod.flags.json` commits.
