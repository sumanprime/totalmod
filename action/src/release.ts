// The release workflow: everything here runs only after a human acts (merge, label, close).
import type { Config } from "@totalmod/core";
import {
  disable,
  dueForRemoval,
  enableForAll,
  enableForRequester,
  type FlagsFile,
  getFlag,
  rollout,
} from "@totalmod/flags/file";
import { branchFor, PrMeta, readMeta } from "./meta.ts";

export const ROLLOUT_LABEL = /^totalmod:rollout-(\d{1,2})$/;
export const GA_LABEL = "totalmod:ga";
export const OFF_LABEL = "totalmod:off";

export type ReleasePlan =
  | { kind: "skip"; reason: string }
  | {
      kind: "apply";
      flags?: FlagsFile;
      commitMessage?: string;
      comments: { number: number; body: string }[];
      deleteBranch?: string;
      closeIssue?: { number: number; reason: "completed" | "not_planned" };
    }
  | { kind: "cleanup"; reqIds: string[] };

interface PullRequestEvent {
  action?: string;
  label?: { name: string };
  pull_request?: { number: number; merged?: boolean; body?: string | null; head: { ref: string } };
}

export function planRelease(input: {
  eventName: string;
  event: PullRequestEvent;
  flags: FlagsFile;
  config: Config;
  now: Date;
}): ReleasePlan {
  const { eventName, event, flags, config, now } = input;

  if (eventName === "schedule" || eventName === "workflow_dispatch") {
    return { kind: "cleanup", reqIds: dueForRemoval(flags, config.flags.removeAfterDays, now) };
  }
  if (eventName !== "pull_request" || !event.pull_request) {
    return { kind: "skip", reason: `Event ${eventName} is not handled.` };
  }

  const pr = event.pull_request;
  const meta = readMeta(pr.body, PrMeta);
  if (!meta || pr.head.ref !== branchFor(meta.reqId)) {
    return { kind: "skip", reason: "Not a totalmod build pull request." };
  }
  const key = `req-${meta.reqId}`;

  if (event.action === "closed" && pr.merged) {
    return {
      kind: "apply",
      flags: enableForRequester(flags, { ...meta, pr: pr.number }, now),
      commitMessage: `totalmod: turn on ${key} for its requester`,
      comments: [
        {
          number: pr.number,
          body: [
            `Merged. \`${key}\` is now on for the requester only, on real data.`,
            "",
            `Roll out with a label on this PR: \`totalmod:rollout-25\` (any 1-99), \`${GA_LABEL}\` for everyone, or \`${OFF_LABEL}\` to switch it off.`,
          ].join("\n"),
        },
        { number: meta.issue, body: `Shipped in #${pr.number}, on for the requester first.` },
      ],
      closeIssue: { number: meta.issue, reason: "completed" },
    };
  }

  if (event.action === "closed") {
    return {
      kind: "apply",
      comments: [
        {
          number: meta.issue,
          body: `Closed without merging (#${pr.number}). The branch was deleted.`,
        },
      ],
      deleteBranch: pr.head.ref,
      closeIssue: { number: meta.issue, reason: "not_planned" },
    };
  }

  if (event.action === "labeled" && event.label) {
    if (!pr.merged || !getFlag(flags, meta.reqId)) {
      return { kind: "skip", reason: "Rollout labels apply to merged totalmod PRs only." };
    }
    const label = event.label.name;
    const percent = label.match(ROLLOUT_LABEL)?.[1];
    let next: FlagsFile | undefined;
    let what = "";
    if (percent) {
      next = rollout(flags, meta.reqId, Number(percent));
      what = `on for the requester and ${Number(percent)}% of users`;
    } else if (label === GA_LABEL) {
      next = enableForAll(flags, meta.reqId, now);
      what = `on for everyone. A PR removing the flag check opens after ${config.flags.removeAfterDays} days`;
    } else if (label === OFF_LABEL) {
      next = disable(flags, meta.reqId);
      what = "off for everyone";
    } else {
      return { kind: "skip", reason: `Label ${label} is not a totalmod rollout label.` };
    }
    return {
      kind: "apply",
      flags: next,
      commitMessage: `totalmod: ${key} ${label.replace("totalmod:", "")}`,
      comments: [{ number: pr.number, body: `\`${key}\` is now ${what}.` }],
    };
  }

  return { kind: "skip", reason: `pull_request ${event.action} needs nothing.` };
}
