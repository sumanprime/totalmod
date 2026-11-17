import type { GitHub } from "./github.ts";

/** Each build run posts one of these on the request's issue; the policy check sums them. */
const SPEND = /<!-- totalmod:spend (\{.*?\}) -->/;

export interface Spend {
  usd: number;
  at: string;
}

export function spendComment(usd: number, at: Date, iteration: number): string {
  const rounded = Math.round(usd * 10_000) / 10_000;
  return [
    `<!-- totalmod:spend ${JSON.stringify({ usd: rounded, at: at.toISOString() })} -->`,
    `totalmod build (iteration ${iteration}) used about $${rounded.toFixed(2)} of Claude.`,
  ].join("\n");
}

export function readSpend(body: string): Spend | null {
  const match = body.match(SPEND);
  if (!match?.[1]) return null;
  try {
    const data = JSON.parse(match[1]);
    return typeof data.usd === "number" && data.usd >= 0 && typeof data.at === "string"
      ? data
      : null;
  } catch {
    return null;
  }
}

/** Total cost from a Claude Code execution file (the SDK message log the action writes). */
export function costFromExecutionFile(json: string): number {
  const messages = JSON.parse(json) as { type?: string; total_cost_usd?: number }[];
  const result = [...messages].reverse().find((m) => m.type === "result");
  return result?.total_cost_usd ?? 0;
}

interface Comment {
  body?: string | null;
  user?: { login: string } | null;
}

/** Spend recorded on one issue, counting only comments from trusted accounts. */
export async function issueSpend(
  github: GitHub,
  repo: string,
  issue: number,
  trusted: Set<string>,
  since?: Date,
): Promise<number> {
  const query = since ? `?per_page=100&since=${since.toISOString()}` : "?per_page=100";
  const comments = await github.list<Comment>(`/repos/${repo}/issues/${issue}/comments${query}`);
  let total = 0;
  for (const comment of comments) {
    if (!trusted.has(comment.user?.login ?? "")) continue;
    const spend = readSpend(comment.body ?? "");
    if (spend && (!since || new Date(spend.at) >= since)) total += spend.usd;
  }
  return total;
}

/** Spend across every totalmod issue touched this calendar month (UTC). */
export async function monthSpend(
  github: GitHub,
  repo: string,
  trusted: Set<string>,
  now: Date,
): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const issues = await github.list<{ number: number; pull_request?: unknown }>(
    `/repos/${repo}/issues?labels=totalmod:build&state=all&per_page=100&since=${monthStart.toISOString()}`,
  );
  let total = 0;
  for (const issue of issues) {
    if (issue.pull_request) continue;
    total += await issueSpend(github, repo, issue.number, trusted, monthStart);
  }
  return total;
}
