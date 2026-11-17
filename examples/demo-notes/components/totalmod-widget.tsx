"use client";

import { RequestFeatureButton } from "@totalmod/widget";

export function TotalmodWidget() {
  return <RequestFeatureButton endpoint="/api/totalmod" appVersion="0.1.0" />;
}
