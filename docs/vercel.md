# Preview deployments on Vercel

totalmod previews run a build branch on **mock data with no production credentials**. Isolation comes from the deployment's environment, not from code: a preview has no way to reach production data because it never gets the credentials.

## Environment scopes

In the Vercel project, under **Settings → Environment Variables**:

| Variable                                                                | Production            | Preview        | Why                                                                     |
| ----------------------------------------------------------------------- | --------------------- | -------------- | ----------------------------------------------------------------------- |
| `DATABASE_URL` and any other data access                                | ✓                     | **never**      | Previews boot an in-memory database seeded from `seed/mock.ts`.         |
| `TOTALMOD_MODE`                                                         | unset or `production` | `mock`         | Switches the app to mock data and the mock session.                     |
| `TOTALMOD_PREVIEW_SECRET`                                               | ✓                     | ✓ (same value) | Production signs the requester's preview link; the preview verifies it. |
| `ANTHROPIC_API_KEY`, `TOTALMOD_GITHUB_TOKEN`, `TOTALMOD_WEBHOOK_SECRET` | ✓                     | **never**      | Only the production app talks to Claude and GitHub.                     |
| `NEXT_PUBLIC_*`                                                         | as needed             | as needed      | Public by definition.                                                   |

Uncheck **Preview** on every production variable. `npx totalmod doctor` checks this through the Vercel API (set `VERCEL_TOKEN` and `VERCEL_PROJECT_ID`, plus `VERCEL_TEAM_ID` for a team project). It fails if a variable that looks like a credential is in Preview, or if `TOTALMOD_MODE` or `TOTALMOD_PREVIEW_SECRET` is missing there.

## Getting the preview URL to the app

Vercel's GitHub integration creates a GitHub _deployment_ for each branch push, with a `deployment_status` event when it's ready. Add a webhook in the GitHub repository:

- **Payload URL:** `https://<your app>/api/totalmod/webhooks/github`
- **Content type:** `application/json`
- **Secret:** the value of `TOTALMOD_WEBHOOK_SECRET`
- **Events:** Pull requests, Deployment statuses

When the `totalmod/req-<id>` branch deploys successfully to a non-production environment, the requester's widget shows "only you can see it" with a signed link.

## The preview route

The preview app needs a route at `/totalmod/preview` that:

1. returns 404 unless `TOTALMOD_MODE=mock`,
2. verifies `?token=` with `verifyPreviewToken(token, process.env.TOTALMOD_PREVIEW_SECRET)` from `@totalmod/core` (401 on `expired`, `bad-signature` or `malformed`),
3. creates a mock user with the token's `plan` and `role` in the mock database, starts a session for it, and redirects into the app.

`examples/demo-notes/app/totalmod/preview/route.ts` is a complete example.
