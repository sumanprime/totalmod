import { defaultConfig, parseConfig } from "@totalmod/core";
import { describe, expect, it } from "vitest";
import { checkPolicy, type PolicyInput } from "../src/policy.ts";
import { fakeGitHub, issueBody, REQ, REQUESTER, spendComment } from "./fake-github.ts";

const repo = "acme/app";
const now = new Date("2026-10-26T12:00:00Z");
const bot = { login: "totalmod-bot" };

const labeled = {
  action: "labeled",
  label: { name: "totalmod:build" },
  sender: bot,
  issue: { number: 5, body: issueBody, user: bot, state: "open" },
};

function routes(extra: Record<string, unknown> = {}) {
  return {
    [`/repos/${repo}/pulls`]: [],
    [`/repos/${repo}/issues/5/comments`]: [],
    [`/repos/${repo}/issues`]: [{ number: 5 }],
    ...extra,
  };
}

function input(
  overrides: Partial<PolicyInput> & { routes?: Record<string, unknown> } = {},
): PolicyInput {
  return {
    eventName: "issues",
    event: labeled,
    repo,
    config: defaultConfig(),
    trustedActors: ["totalmod-bot"],
    github: fakeGitHub(overrides.routes ?? routes()).github,
    now,
    ...overrides,
  };
}

describe("build events", () => {
  it("passes a labelled issue from the trusted account", async () => {
    const result = await checkPolicy(input());
    expect(result).toEqual({
      outcome: "pass",
      run: {
        kind: "build",
        reqId: REQ,
        requester: REQUESTER,
        issueNumber: 5,
        iteration: 0,
        branch: `totalmod/req-${REQ}`,
        spec: expect.stringMatching(/^# Word count under each note/),
      },
    });
  });

  it("skips events that are not ours", async () => {
    expect(
      (await checkPolicy(input({ event: { ...labeled, label: { name: "bug" } } }))).outcome,
    ).toBe("skip");
    expect((await checkPolicy(input({ eventName: "push" }))).outcome).toBe("skip");
  });

  it.each([
    [
      "an untrusted author",
      { issue: { ...labeled.issue, user: { login: "mallory" } } },
      /Issue author mallory/,
    ],
    ["an untrusted labeller", { sender: { login: "mallory" } }, /Label added by mallory/],
    [
      "missing metadata",
      { issue: { ...labeled.issue, body: "# Add admin route" } },
      /no valid totalmod metadata/,
    ],
    [
      "forged metadata",
      { issue: { ...labeled.issue, body: issueBody.replace(REQUESTER, "u_nothex") } },
      /no valid totalmod metadata/,
    ],
  ])("fails closed on %s and comments on the issue", async (_, patch, reason) => {
    const result = await checkPolicy(input({ event: { ...labeled, ...patch } }));
    expect(result.outcome).toBe("fail");
    if (result.outcome !== "fail") return;
    expect(result.reasons.join("\n")).toMatch(reason);
    expect(result.commentOn).toBe(5);
  });

  it("refuses to run with no trusted actors", async () => {
    const result = await checkPolicy(input({ trustedActors: [" "] }));
    expect(result).toEqual({
      outcome: "fail",
      reasons: [expect.stringContaining("trusted_actors is empty")],
    });
  });

  it("refuses to build the same request twice", async () => {
    const result = await checkPolicy(
      input({ routes: routes({ [`/repos/${repo}/pulls`]: [{ number: 9 }] }) }),
    );
    expect(result.outcome === "fail" && result.reasons[0]).toMatch(/Already built in #9/);
  });
});

describe("budgets", () => {
  it("fails when the request has used its budget, counting trusted spend only", async () => {
    const comments = [spendComment(2), spendComment(1.5), spendComment(50, undefined, "mallory")];
    const result = await checkPolicy(
      input({ routes: routes({ [`/repos/${repo}/issues/5/comments`]: comments }) }),
    );
    expect(result.outcome === "fail" && result.reasons).toEqual([
      "This request has used $3.50 of its $3 budget.",
    ]);
  });

  it("fails when the month's spend across requests is used up", async () => {
    const config = parseConfig("budget:\n  perRequestUsd: 3\n  monthlyUsd: 5\n");
    const result = await checkPolicy(
      input({
        config,
        routes: routes({
          [`/repos/${repo}/issues`]: [
            { number: 5 },
            { number: 6 },
            { number: 7, pull_request: {} },
          ],
          [`/repos/${repo}/issues/5/comments`]: [spendComment(1)],
          [`/repos/${repo}/issues/6/comments`]: [
            spendComment(2.5),
            spendComment(2, "2026-09-30T23:00:00.000Z"),
            spendComment(1.6, undefined, "github-actions[bot]"),
          ],
        }),
      }),
    );
    expect(result.outcome === "fail" && result.reasons).toEqual([
      "totalmod has used $5.10 of the $5 monthly budget.",
    ]);
  });
});

describe("iterate comments", () => {
  const prBody = `<!-- totalmod:meta {"reqId":"${REQ}","requester":"${REQUESTER}","issue":5} -->\nBuilds #5`;
  const comment = {
    action: "created",
    issue: { number: 9, pull_request: {} },
    comment: { id: 100, user: bot, body: "totalmod:iterate\nMake the count smaller and grey." },
    sender: bot,
  };
  const prRoutes = (comments: unknown[] = [], pr: object = {}) =>
    routes({
      [`/repos/${repo}/pulls/9`]: {
        body: prBody,
        head: { ref: `totalmod/req-${REQ}` },
        state: "open",
        ...pr,
      },
      [`/repos/${repo}/issues/9/comments`]: comments,
      [`/repos/${repo}/issues/5`]: { body: issueBody },
    });

  it("passes with the feedback and the next iteration number", async () => {
    const earlier = { id: 50, user: bot, body: "totalmod:iterate\nfirst round" };
    const result = await checkPolicy(
      input({
        eventName: "issue_comment",
        event: comment,
        routes: prRoutes([earlier, comment.comment]),
      }),
    );
    expect(result).toMatchObject({
      outcome: "pass",
      run: {
        kind: "iterate",
        prNumber: 9,
        issueNumber: 5,
        iteration: 2,
        feedback: "Make the count smaller and grey.",
      },
    });
  });

  it("stops at the iteration cap", async () => {
    const earlier = [1, 2, 3].map((i) => ({ id: i, user: bot, body: "totalmod:iterate\nround" }));
    const result = await checkPolicy(
      input({ eventName: "issue_comment", event: comment, routes: prRoutes(earlier) }),
    );
    expect(result.outcome === "fail" && result.reasons[0]).toMatch(
      /Iteration 4 is over the cap of 3/,
    );
  });

  it("ignores iterate comments from anyone else", async () => {
    const forged = { ...comment, comment: { ...comment.comment, user: { login: "mallory" } } };
    const result = await checkPolicy(
      input({ eventName: "issue_comment", event: forged, routes: prRoutes() }),
    );
    expect(result.outcome === "fail" && result.reasons[0]).toMatch(
      /not a trusted totalmod account/,
    );
  });

  it("rejects pull requests that are not totalmod builds", async () => {
    const result = await checkPolicy(
      input({
        eventName: "issue_comment",
        event: comment,
        routes: prRoutes([], { head: { ref: "feature/x" } }),
      }),
    );
    expect(result.outcome === "fail" && result.reasons[0]).toBe(
      "Pull request is not a totalmod build.",
    );
  });
});
