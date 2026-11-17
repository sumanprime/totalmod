# @totalmod/server

Route handlers for the request flow: request → interview → confirmed spec → GitHub issue.

```ts
// app/api/totalmod/[...totalmod]/route.ts
import { createTotalmodHandlers } from "@totalmod/server/next";
import { getRequester, store } from "@/lib/totalmod";

export const { GET, POST } = createTotalmodHandlers({ getRequester, store });
```

| Route                                      | Does                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `GET /api/totalmod/me`                     | `{ enabled }`: whether this user may send requests (`requesters` in the config).              |
| `POST /api/totalmod/requests`              | `{ text, route, appVersion }`: stores the request, screens it, runs the first interview turn. |
| `POST /api/totalmod/requests/:id/answers`  | `{ answers: { [questionId]: string } }`: next turn (4 questions at most, over 2 rounds).      |
| `POST /api/totalmod/requests/:id/confirm`  | `{ spec? }`: confirms the draft, or an edited spec, and files the GitHub issue.               |
| `GET /api/totalmod/requests/:id`           | Current status for the requester, with the signed try-it link while a preview is ready.       |
| `GET /api/totalmod/requests`               | The requester's 5 latest requests (the widget's status view).                                 |
| `POST /api/totalmod/requests/:id/feedback` | `{ verdict: "up" }` or `{ verdict: "fix", text }`: thumbs-up or a fix round.                  |
| `POST /api/totalmod/webhooks/github`       | GitHub webhook (signed): pull request and deployment status events.                           |

Responses never include the raw request text. The issue contains only the confirmed spec, a hashed requester id and the request id.

## What runs where

- **Screening:** text over 2000 characters is rejected, and each user can send 5 requests per 24 hours (`requestsPerDay`). Injection heuristics are only logged (`screeningFlags`), not used to block.
- **Interviewer** (`prompts/interviewer.md`): Claude with structured output, validated against the core `SpecDraft` schema and retried up to 3 times. The model comes from `TOTALMOD_MODEL`, else `model` in `totalmod.config.yaml`. Server-side fallback (`fallbacks: "default"`) is on. A refusal becomes a polite decline.
- **Preview:** a `pull_request` webhook records the draft PR. A successful non-production `deployment_status` for the `totalmod/req-<id>` branch stores the preview URL. The requester then gets a link to `<preview>/totalmod/preview?token=…`, a token (request id, hashed requester, plan, role) signed with `TOTALMOD_PREVIEW_SECRET` that expires in 24 hours. The preview app turns it into a mock session.
- **Fix rounds:** "fix this" text goes through the reviser (`prompts/reviser.md`), which rewrites it into 1–5 concrete changes. Those pass `checkChanges` (one retry, then a polite decline) before they're posted on the PR as a `totalmod:iterate` comment, which starts the build action. The raw text stays in the app. There are at most `iterations.max` rounds.
- **Thumbs-up:** marks the draft PR ready for review (GraphQL) and labels it `totalmod:ready`.
- **Policy:** every draft spec, and every edit the requester makes, goes through `checkSpec` from `@totalmod/core`, which flags blocked areas and injection markers. If a draft fails, the interviewer gets one retry with the problems listed, and the request is declined if it still fails. An edit that fails returns 422.

## Environment

| Variable                  | Used for                                                           |
| ------------------------- | ------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`       | The interviewer.                                                   |
| `TOTALMOD_MODEL`          | Optional model override. Required with `TOTALMOD_LLM`.             |
| `TOTALMOD_LLM`            | For local testing: `ollama` or `lmstudio` instead of Anthropic.    |
| `TOTALMOD_LLM_URL`        | Optional local server URL. Must point at this machine.             |
| `TOTALMOD_GITHUB_REPO`    | `owner/name` the issues go to.                                     |
| `TOTALMOD_GITHUB_TOKEN`   | Token for creating issues (see below).                             |
| `TOTALMOD_GITHUB_API_URL` | Optional, for GitHub Enterprise.                                   |
| `TOTALMOD_PREVIEW_SECRET` | HMAC key for hashing requester ids and signing preview links.      |
| `TOTALMOD_WEBHOOK_SECRET` | Secret of the GitHub webhook (Pull requests, Deployment statuses). |

Of these, only `TOTALMOD_PREVIEW_SECRET` goes into the preview deployment, to verify links. See [docs/vercel.md](../../docs/vercel.md).

## GitHub access: two options

**Fine-grained personal access token** (simplest; the demo uses this). Create it for the one repository, with **Issues: read and write** and nothing else, and set it as `TOTALMOD_GITHUB_TOKEN`. Issues are created as you.

**GitHub App** (better for teams). Create an app with **Issues: read and write**, install it on the repository, and pass `getToken` so each issue uses a short-lived installation token. Issues are created as the app.

```ts
import { createAppAuth } from "@octokit/auth-app";

const auth = createAppAuth({
  appId: process.env.GITHUB_APP_ID!,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
  installationId: Number(process.env.GITHUB_APP_INSTALLATION_ID),
});

export const { GET, POST } = createTotalmodHandlers({
  getRequester,
  store,
  github: {
    repo: "acme/app",
    getToken: async () => (await auth({ type: "installation" })).token,
  },
});
```

## Storage

Implement `RequestStore` (`create`, `get`, `update`, `countSince`, `latestByUser`) against a `totalmod_requests` table in your database. `memoryRequestStore()` works for trying things out but loses requests on restart. `examples/demo-notes/lib/totalmod.ts` has a Drizzle version.

License: AGPL-3.0-only, or commercial ([details](https://github.com/sumanprime/totalmod/blob/main/COMMERCIAL-LICENSE.md)).
