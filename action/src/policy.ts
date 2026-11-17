import type { Config } from "@totalmod/core";
import { type FlagsFile, getFlag } from "@totalmod/flags/file";
import type { GitHub } from "./github.ts";
import { branchFor, IssueMeta, ITERATE_MARKER, PrMeta, readMeta, specFromIssue } from "./meta.ts";
import { issueSpend, monthSpend } from "./spend.ts";

export const BUILD_LABEL = "totalmod:build";

/** What one build run works on, once the policy check has passed. */
export interface BuildRun {
  kind: "build" | "iterate" | "remove-flag";
  reqId: string;
  requester: string;
  issueNumber: number;
  prNumber?: number;
  iteration: number;
  branch: string;
  spec: string;
  /** Iterate only: the spec delta the server posted after the marker line. */
  feedback?: string;
}

export type PolicyResult =
  | { outcome: "skip"; reason: string }
  | { outcome: "fail"; reasons: string[]; commentOn?: number }
  | { outcome: "pass"; run: BuildRun };

interface User {
  login: string;
}
interface IssueEvent {
  action?: string;
  label?: { name: string };
  sender?: User;
  issue?: {
    number: number;
    body?: string | null;
    user?: User;
    pull_request?: unknown;
    state?: string;
  };
  comment?: { id: number; body?: string | null; user?: User };
}

export interface PolicyInput {
  eventName: string;
  event: IssueEvent;
  repo: string;
  config: Config;
  /** Accounts allowed to file build issues and post iterate comments (the totalmod server's). */
  trustedActors: string[];
  github: GitHub;
  now: Date;
}

/**
 * Job A: deterministic, no model. Decides whether this event may start a build, and fails
 * closed on anything unexpected. Requester eligibility (`requesters`) was enforced by the
 * server when the request was made; here we check the issue really came from that server.
 */
export async function checkPolicy(input: PolicyInput): Promise<PolicyResult> {
  const { event, repo, config, github } = input;
  const trusted = new Set(input.trustedActors.map((a) => a.trim()).filter(Boolean));
  if (trusted.size === 0) {
    return { outcome: "fail", reasons: ["trusted_actors is empty: refusing to build anything."] };
  }

  let run: BuildRun;
  const reasons: string[] = [];

  if (input.eventName === "issues") {
    if (event.action !== "labeled" || event.label?.name !== BUILD_LABEL || !event.issue) {
      return { outcome: "skip", reason: "Not a totalmod:build label event." };
    }
    const issue = event.issue;
    if (!trusted.has(issue.user?.login ?? "")) {
      reasons.push(
        `Issue author ${issue.user?.login ?? "unknown"} is not a trusted totalmod account.`,
      );
    }
    if (!trusted.has(event.sender?.login ?? "")) {
      reasons.push(
        `Label added by ${event.sender?.login ?? "unknown"}, who is not a trusted totalmod account.`,
      );
    }
    const meta = readMeta(issue.body, IssueMeta);
    if (!meta) reasons.push("Issue has no valid totalmod metadata line.");
    if (reasons.length || !meta) return { outcome: "fail", reasons, commentOn: issue.number };

    const branch = branchFor(meta.reqId);
    const open = await github.list<{ number: number }>(
      `/repos/${repo}/pulls?state=all&head=${repo.split("/")[0]}:${branch}`,
      1,
    );
    if (open.length > 0) {
      return {
        outcome: "fail",
        reasons: [
          `Already built in #${open[0]?.number}. Changes go through ${ITERATE_MARKER} comments.`,
        ],
        commentOn: issue.number,
      };
    }
    run = {
      kind: "build",
      reqId: meta.reqId,
      requester: meta.requester,
      issueNumber: issue.number,
      iteration: 0,
      branch,
      spec: specFromIssue(issue.body ?? ""),
    };
  } else if (input.eventName === "issue_comment") {
    const body = event.comment?.body ?? "";
    if (
      event.action !== "created" ||
      !event.issue?.pull_request ||
      !body.startsWith(ITERATE_MARKER)
    ) {
      return { outcome: "skip", reason: "Not a totalmod:iterate comment on a pull request." };
    }
    const prNumber = event.issue.number;
    if (!trusted.has(event.comment?.user?.login ?? "")) {
      return {
        outcome: "fail",
        reasons: [
          `Iterate comment by ${event.comment?.user?.login ?? "unknown"}, who is not a trusted totalmod account.`,
        ],
        commentOn: prNumber,
      };
    }
    const pr = await github.get<{ body?: string | null; head: { ref: string }; state: string }>(
      `/repos/${repo}/pulls/${prNumber}`,
    );
    const meta = readMeta(pr.body, PrMeta);
    if (!meta || pr.head.ref !== branchFor(meta.reqId)) {
      return {
        outcome: "fail",
        reasons: ["Pull request is not a totalmod build."],
        commentOn: prNumber,
      };
    }
    if (pr.state !== "open") {
      return { outcome: "fail", reasons: ["Pull request is closed."], commentOn: prNumber };
    }
    const comments = await github.list<{ id: number; body?: string | null; user?: User }>(
      `/repos/${repo}/issues/${prNumber}/comments?per_page=100`,
    );
    const earlier = comments.filter(
      (c) =>
        c.id !== event.comment?.id &&
        trusted.has(c.user?.login ?? "") &&
        (c.body ?? "").startsWith(ITERATE_MARKER),
    ).length;
    const iteration = earlier + 1;
    if (iteration > config.iterations.max) {
      return {
        outcome: "fail",
        reasons: [
          `Iteration ${iteration} is over the cap of ${config.iterations.max}. The founder takes it from here.`,
        ],
        commentOn: prNumber,
      };
    }
    const issue = await github.get<{ body?: string | null }>(`/repos/${repo}/issues/${meta.issue}`);
    run = {
      kind: "iterate",
      reqId: meta.reqId,
      requester: meta.requester,
      issueNumber: meta.issue,
      prNumber,
      iteration,
      branch: pr.head.ref,
      spec: specFromIssue(issue.body ?? ""),
      feedback: body.slice(ITERATE_MARKER.length).trim(),
    };
  } else {
    return { outcome: "skip", reason: `Event ${input.eventName} is not handled.` };
  }

  reasons.push(...(await budgetProblems(input, trusted, run.issueNumber, true)));
  if (reasons.length)
    return { outcome: "fail", reasons, commentOn: run.prNumber ?? run.issueNumber };

  return { outcome: "pass", run };
}

/** Spend recorded by earlier runs, from trusted accounts only. */
async function budgetProblems(
  input: Pick<PolicyInput, "github" | "repo" | "config" | "now">,
  trusted: Set<string>,
  issueNumber: number,
  perRequest: boolean,
): Promise<string[]> {
  const { github, repo, config } = input;
  const reasons: string[] = [];
  const spendTrusted = new Set([...trusted, "github-actions[bot]"]);
  if (perRequest) {
    const spent = await issueSpend(github, repo, issueNumber, spendTrusted);
    if (spent >= config.budget.perRequestUsd) {
      reasons.push(
        `This request has used $${spent.toFixed(2)} of its $${config.budget.perRequestUsd} budget.`,
      );
    }
  }
  const month = await monthSpend(github, repo, spendTrusted, input.now);
  if (month >= config.budget.monthlyUsd) {
    reasons.push(
      `totalmod has used $${month.toFixed(2)} of the $${config.budget.monthlyUsd} monthly budget.`,
    );
  }
  return reasons;
}

export function cleanupBranch(reqId: string): string {
  return `totalmod/cleanup-${reqId}`;
}

/**
 * The flag-removal task the release workflow starts once a feature has been GA long enough.
 * The founder's merge and GA label already happened; this only checks the flag, that no removal
 * PR is open, and the monthly budget (removal is not charged to the original request).
 */
export async function planFlagRemoval(
  input: Pick<PolicyInput, "github" | "repo" | "config" | "now" | "trustedActors"> & {
    reqId: string;
    flags: FlagsFile;
  },
): Promise<PolicyResult> {
  const flag = getFlag(input.flags, input.reqId);
  const notGa = {
    outcome: "fail" as const,
    reasons: [`req-${input.reqId} is not a GA totalmod flag.`],
  };
  if (!flag) return notGa;
  if (flag.metadata.stage !== "ga") return notGa;
  const branch = cleanupBranch(input.reqId);
  const open = await input.github.list<{ number: number }>(
    `/repos/${input.repo}/pulls?state=open&head=${input.repo.split("/")[0]}:${branch}`,
    1,
  );
  if (open.length > 0)
    return { outcome: "skip", reason: `Removal PR #${open[0]?.number} is already open.` };
  const trusted = new Set(input.trustedActors.map((a) => a.trim()).filter(Boolean));
  const reasons = await budgetProblems(input, trusted, flag.metadata.issue, false);
  if (reasons.length) return { outcome: "fail", reasons, commentOn: flag.metadata.pr };
  return {
    outcome: "pass",
    run: {
      kind: "remove-flag",
      reqId: input.reqId,
      requester: flag.metadata.requester,
      issueNumber: flag.metadata.issue,
      iteration: 0,
      branch,
      spec: "",
    },
  };
}

export function policyFailureComment(reasons: string[]): string {
  return [
    "**totalmod did not start a build.** The policy check failed closed:",
    "",
    ...reasons.map((r) => `- ${r}`),
  ].join("\n");
}
