import { hashRequester, type Spec } from "@totalmod/core";

export { hashRequester };

export const BUILD_LABEL = "totalmod:build";

/** Where issues go. `getToken` lets a GitHub App mint a short-lived installation token. */
export interface GithubTarget {
  /** "owner/name" */
  repo: string;
  token?: string;
  getToken?: () => Promise<string>;
  /** Defaults to https://api.github.com (GitHub Enterprise or a test double otherwise). */
  apiUrl?: string;
  fetch?: typeof fetch;
}

export interface IssueMeta {
  reqId: string;
  /** Hashed; the issue never carries the raw user id. */
  requester: string;
  iteration: number;
}

/**
 * Neutralises text that could forge the metadata comment, ping people, or inject markup.
 * Spec strings already passed `checkSpec`; this is the last line before GitHub.
 */
export function sanitize(text: string): string {
  // Escaping every < and > also neutralises comment markers (<!--, -->, --!>) in any form.
  return text
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@(?=\w)/g, "@​")
    .replace(/\r?\n+/g, " ")
    .trim();
}

/** The content the build agent saves as `.totalmod/requests/<reqId>/SPEC.md`. */
export function renderSpecMarkdown(spec: Spec): string {
  const list = (items: string[]) =>
    items.length ? items.map((item) => `- ${sanitize(item)}`).join("\n") : "- (none)";
  return [
    `# ${sanitize(spec.title)}`,
    "",
    "## User story",
    "",
    sanitize(spec.userStory),
    "",
    "## Acceptance criteria",
    "",
    list(spec.acceptanceCriteria),
    "",
    "## Where in the app",
    "",
    sanitize(spec.uiLocation),
    "",
    "## Out of scope",
    "",
    list(spec.outOfScope),
  ].join("\n");
}

export function renderIssue(spec: Spec, meta: IssueMeta) {
  const metaJson = JSON.stringify({
    reqId: meta.reqId,
    requester: meta.requester,
    iteration: meta.iteration,
  });
  return {
    title: `[totalmod] ${sanitize(spec.title)}`,
    labels: [BUILD_LABEL],
    body: [
      `<!-- totalmod:meta ${metaJson} -->`,
      "> Requested by an app user through totalmod. This issue holds only the spec they confirmed; their own words stay in the app.",
      "",
      `Save the spec below as \`.totalmod/requests/${meta.reqId}/SPEC.md\`.`,
      "",
      "---",
      "",
      renderSpecMarkdown(spec),
    ].join("\n"),
  };
}

/** One authenticated GitHub API call. `path` starting with "/" is relative to the REST API. */
async function githubCall<T>(
  target: GithubTarget,
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const token = target.token ?? (await target.getToken?.());
  if (!token) throw new Error("No GitHub token: set TOTALMOD_GITHUB_TOKEN or pass getToken.");
  const res = await (target.fetch ?? fetch)(
    url.startsWith("http") ? url : `${restApi(target)}${url}`,
    {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "totalmod",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  if (!res.ok) throw new Error(`GitHub ${method} ${url} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function restApi(target: GithubTarget): string {
  return (target.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
}

/** api.github.com/graphql, or <host>/api/graphql for GitHub Enterprise (<host>/api/v3). */
function graphqlApi(target: GithubTarget): string {
  const rest = restApi(target);
  return rest.endsWith("/api/v3") ? `${rest.slice(0, -3)}/graphql` : `${rest}/graphql`;
}

export async function createIssue(
  target: GithubTarget,
  issue: ReturnType<typeof renderIssue>,
): Promise<{ number: number; url: string }> {
  const data = await githubCall<{ number: number; html_url: string }>(
    target,
    "POST",
    `/repos/${target.repo}/issues`,
    issue,
  );
  return { number: data.number, url: data.html_url };
}

export const ITERATE_MARKER = "totalmod:iterate";
export const READY_LABEL = "totalmod:ready";

/** The PR comment that starts a fix round. Only the rewritten changes, never raw feedback. */
export function renderIterateComment(changes: string[], iteration: number): string {
  return [
    ITERATE_MARKER,
    `Fix round ${iteration}, requested by the app user after trying the preview:`,
    "",
    ...changes.map((change) => `- ${sanitize(change)}`),
  ].join("\n");
}

export async function commentOnIssue(target: GithubTarget, number: number, body: string) {
  await githubCall(target, "POST", `/repos/${target.repo}/issues/${number}/comments`, { body });
}

const VERDICT_MARKER = "<!-- totalmod:verdict -->";

/**
 * Rewrites the verdict row of the risk summary the build action put in the PR body.
 * A plain line scan, not a regex: the body comes from GitHub and a regex here can backtrack.
 */
export function withVerdict(body: string, verdict: string): string {
  const lines = body.split("\n");
  const row = lines.findIndex((line) => line.includes(VERDICT_MARKER));
  if (row === -1) return body;
  lines[row] = `| Requester verdict | ${verdict} ${VERDICT_MARKER} |`;
  return lines.join("\n");
}

/** Thumbs-up: the draft PR becomes ready for the founder's review, with the verdict recorded. */
export async function markReadyForReview(
  target: GithubTarget,
  prNumber: number,
  iteration: number,
) {
  const pr = await githubCall<{ node_id: string; draft: boolean; body?: string | null }>(
    target,
    "GET",
    `/repos/${target.repo}/pulls/${prNumber}`,
  );
  if (pr.draft) {
    // REST cannot undraft a pull request; GraphQL can.
    await githubCall(target, "POST", graphqlApi(target), {
      query:
        "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }",
      variables: { id: pr.node_id },
    });
  }
  await githubCall(target, "POST", `/repos/${target.repo}/issues/${prNumber}/labels`, {
    labels: [READY_LABEL],
  });
  const verdict = `approved on the preview${iteration ? ` after ${iteration} fix ${iteration === 1 ? "round" : "rounds"}` : ""}`;
  const body = withVerdict(pr.body ?? "", verdict);
  if (body !== (pr.body ?? "")) {
    await githubCall(target, "PATCH", `/repos/${target.repo}/pulls/${prNumber}`, { body });
  }
}
