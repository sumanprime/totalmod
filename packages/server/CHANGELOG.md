# @totalmod/server

## 0.3.0

### Patch Changes

- [#8](https://github.com/sumanprime/totalmod/pull/8) [`9b61e1b`](https://github.com/sumanprime/totalmod/commit/9b61e1bcb80d71defa7ccd48059d5e7990a6738a) Thanks [@sumanprime](https://github.com/sumanprime)! - Fix code scanning alerts: the spec check also catches `--!>` comment endings, issue text is escaped instead of having comment markers stripped, and the PR verdict row is rewritten without a regex that could backtrack on long bodies.
- Updated dependencies [[`9b61e1b`](https://github.com/sumanprime/totalmod/commit/9b61e1bcb80d71defa7ccd48059d5e7990a6738a)]:
  - @totalmod/core@0.3.0
  - @totalmod/telemetry@0.3.0

## 0.2.0

### Minor Changes

- [#3](https://github.com/sumanprime/totalmod/pull/3) [`988c3f5`](https://github.com/sumanprime/totalmod/commit/988c3f546ab243a8939ab5f2e1efb89acc565927) Thanks [@sumanprime](https://github.com/sumanprime)! - Run the interviewer on Ollama or LM Studio for local testing, with `TOTALMOD_LLM` and `TOTALMOD_MODEL`.

### Patch Changes

- Updated dependencies []:
  - @totalmod/core@0.2.0
  - @totalmod/telemetry@0.2.0

## 0.1.0

### Minor Changes

- First public release (v0.1): request widget, interviewer, build action, mock-data previews, signed preview links, fix rounds, release gate and rollout flags.

### Patch Changes

- Updated dependencies [[`11ecd24`](https://github.com/sumanprime/totalmod/commit/11ecd244a7ae989672f62fa988f891794bcc87f4)]:
  - @totalmod/core@0.1.0
  - @totalmod/telemetry@0.1.0
