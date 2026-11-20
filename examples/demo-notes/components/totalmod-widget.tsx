"use client";

import { RequestFeatureButton } from "@totalmod/widget";

/** `pollMs` is shorter in the hosted demo, where a simulated build takes seconds. */
export function TotalmodWidget({ pollMs }: { pollMs?: number }) {
  return (
    <RequestFeatureButton
      endpoint="/api/totalmod"
      appVersion="0.1.0"
      {...(pollMs ? { pollMs } : {})}
    />
  );
}
