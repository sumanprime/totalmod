# @totalmod/widget

The "Request a feature" button for [totalmod](https://github.com/sumanprime/totalmod): the request box, the interview questions, the spec review (one edit), and afterwards the private "try it" link with "Looks good" / "Fix this".

```tsx
"use client";
import { RequestFeatureButton } from "@totalmod/widget";

export function TotalmodWidget() {
  return <RequestFeatureButton endpoint="/api/totalmod" appVersion="1.4.0" />;
}
```

It renders nothing for users who can't send requests. It ships its own CSS, prefixed `tms-`; theme it by setting the `--tms-*` custom properties (`--tms-accent`, `--tms-bg`, `--tms-text`, ...) on `.tms-root`.

License: AGPL-3.0-only, or commercial ([details](https://github.com/sumanprime/totalmod/blob/main/COMMERCIAL-LICENSE.md)).
