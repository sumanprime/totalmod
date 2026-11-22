---
"@totalmod/core": patch
"@totalmod/server": patch
---

Fix code scanning alerts: the spec check also catches `--!>` comment endings, issue text is escaped instead of having comment markers stripped, and the PR verdict row is rewritten without a regex that could backtrack on long bodies.
