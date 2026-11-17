# @totalmod/flags

The flag check every totalmod-built feature sits behind, and the flags-file edits the release workflow makes.

```ts
import { isRequestEnabled } from "@totalmod/flags";

if (await isRequestEnabled(user.id, "k3j9x2m1q8")) {
  // the requested feature
}
```

- **Previews (`TOTALMOD_MODE=mock`):** always `true`. Previews run on mock data only.
- **Production:** OpenFeature with the flagd provider, reading `flags/totalmod.flags.json` in-process (no flag service; the file is polled every 5 s). Users are matched by `hashRequester(user.id, TOTALMOD_PREVIEW_SECRET)`, so the file never holds real user ids. An unknown flag, a missing secret or any provider error means `false`.
- The flags file path comes from `TOTALMOD_FLAGS_FILE`, else `flags.file` in `totalmod.config.yaml`.

In Next.js, list `@totalmod/flags` and `@openfeature/flagd-provider` in `serverExternalPackages`; the provider uses gRPC and file watching, which must not be bundled.

## Lifecycle (written by the release workflow)

| Event                          | Flag `req-<id>`                                                   |
| ------------------------------ | ----------------------------------------------------------------- |
| PR merged                      | On for the requester only (`stage: requester`)                    |
| Label `totalmod:rollout-<n>`   | Requester + n% of users, bucketed by hashed id (`stage: rollout`) |
| Label `totalmod:ga`            | On for everyone (`stage: ga`, `gaAt`)                             |
| Label `totalmod:off`           | Off for everyone (`stage: off`)                                   |
| GA for `flags.removeAfterDays` | A PR removes the check and the entry                              |

`@totalmod/flags/file` exports these edits as pure functions (`enableForRequester`, `rollout`, `enableForAll`, `disable`, `removeFlag`, `dueForRemoval`) without loading OpenFeature.

License: AGPL-3.0-only, or commercial ([details](https://github.com/sumanprime/totalmod/blob/main/COMMERCIAL-LICENSE.md)).
