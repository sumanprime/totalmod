# Contributing to totalmod

Thanks for helping. A few things first:

1. **Sign the CLA.** totalmod is dual-licensed (AGPL-3.0 and a commercial license, see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)). Before your first pull request can be merged, the CLA bot asks you to sign the [Contributor License Agreement](CLA.md) by posting a comment. You keep the copyright in your work.
2. **Read [AGENTS.md](AGENTS.md).** It holds the project's non-negotiable rules (mock data until release, raw user text never reaches the agent, policy lives in code and CI) and the commands.
3. **One change per PR.** Open an issue first for anything larger than a fix, so we can agree on the approach.
4. **Before you push:** `pnpm lint && pnpm typecheck && pnpm test`, plus `pnpm test:e2e` if you touched the demo, the server or the widget.
