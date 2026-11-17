import { createHmac } from "node:crypto";

/**
 * Stable, non-reversible requester id: issues, branches, preview tokens and flag targeting use
 * this instead of the app's user id. Keyed by TOTALMOD_PREVIEW_SECRET.
 */
export function hashRequester(userId: string, secret: string): string {
  return `u_${createHmac("sha256", secret).update(userId).digest("hex").slice(0, 24)}`;
}

export const REQUESTER_HASH = /^u_[0-9a-f]{24}$/;
