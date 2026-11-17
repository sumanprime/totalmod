import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestRecord } from "@totalmod/core";
import type { RequestPatch } from "./store.ts";

/** Checks GitHub's `X-Hub-Signature-256` header against the raw body. */
export function verifyGithubSignature(
  body: string,
  header: string | null,
  secret: string,
): boolean {
  if (!header?.startsWith("sha256=") || !secret) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const BRANCH = /^(?:refs\/heads\/)?totalmod\/req-([a-z0-9]{8,16})$/;

/** The request id a branch name belongs to, if it is a totalmod build branch. */
export function reqIdFromRef(ref: string | undefined): string | null {
  return ref?.match(BRANCH)?.[1] ?? null;
}

interface PullRequestEvent {
  action: string;
  label?: { name: string };
  pull_request: { number: number; merged?: boolean; head: { ref: string } };
}

interface DeploymentStatusEvent {
  deployment: { ref: string; environment?: string };
  deployment_status: {
    state: string;
    environment?: string;
    environment_url?: string;
    target_url?: string;
  };
}

/** States from which a successful preview deployment makes the request "preview_ready". */
const AWAITING_PREVIEW = new Set<RequestRecord["status"]>([
  "confirmed",
  "building",
  "iterating",
  "preview_ready",
]);

/**
 * Turns a GitHub webhook into a request update: `pull_request` events track the PR, and a
 * successful *preview* `deployment_status` (Vercel's GitHub integration sends these) stores the
 * preview URL. Returns the request id and patch, or null when the event is not ours.
 */
export function patchFromEvent(
  eventName: string,
  payload: unknown,
  current: (reqId: string) => Promise<RequestRecord | null>,
): Promise<{ reqId: string; patch: RequestPatch } | null> {
  return (async () => {
    if (eventName === "pull_request") {
      const event = payload as PullRequestEvent;
      const reqId = reqIdFromRef(event.pull_request?.head?.ref);
      const record = reqId ? await current(reqId) : null;
      if (!reqId || !record) return null;
      if (event.action === "opened" || event.action === "reopened") {
        return {
          reqId,
          patch: {
            prNumber: event.pull_request.number,
            ...(record.status === "confirmed" ? { status: "building" as const } : {}),
          },
        };
      }
      if (event.action === "labeled" && event.label?.name === "totalmod:ga") {
        return record.status === "merged" ? { reqId, patch: { status: "ga" as const } } : null;
      }
      if (event.action === "closed") {
        return {
          reqId,
          patch: {
            status: event.pull_request.merged ? ("merged" as const) : ("rejected" as const),
            previewUrl: undefined,
          },
        };
      }
      return null;
    }

    if (eventName === "deployment_status") {
      const event = payload as DeploymentStatusEvent;
      const environment =
        event.deployment_status?.environment ?? event.deployment?.environment ?? "";
      if (event.deployment_status?.state !== "success" || /production/i.test(environment))
        return null;
      const reqId = reqIdFromRef(event.deployment?.ref);
      const record = reqId ? await current(reqId) : null;
      const url = event.deployment_status.environment_url || event.deployment_status.target_url;
      if (!reqId || !record || !url || !AWAITING_PREVIEW.has(record.status)) return null;
      return { reqId, patch: { status: "preview_ready", previewUrl: url } };
    }

    return null;
  })();
}
