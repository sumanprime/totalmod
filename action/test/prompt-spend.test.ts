import { defaultConfig } from "@totalmod/core";
import { describe, expect, it } from "vitest";
import { IssueMeta, PrMeta, readMeta } from "../src/meta.ts";
import type { BuildRun } from "../src/policy.ts";
import { buildPrompt, prBody, prTitle } from "../src/prompt.ts";
import { costFromExecutionFile, readSpend, spendComment } from "../src/spend.ts";
import { issueBody, REQ, REQUESTER } from "./fake-github.ts";

const run: BuildRun = {
  kind: "iterate",
  reqId: REQ,
  requester: REQUESTER,
  issueNumber: 5,
  prNumber: 9,
  iteration: 2,
  branch: `totalmod/req-${REQ}`,
  spec: "# Word count under each note\n\n- Each note shows its word count",
  feedback: "Make it grey.",
};

describe("buildPrompt", () => {
  it("combines the skill, this run's limits, the spec and the feedback", () => {
    const prompt = buildPrompt(run, defaultConfig());
    expect(prompt).toContain("# Building a totalmod request");
    expect(prompt).not.toMatch(/^---/);
    expect(prompt).toContain(`Flag key: \`req-${REQ}\``);
    expect(prompt).toContain("Fix round 2 of 3");
    expect(prompt).toContain("`**/auth/**`");
    expect(prompt).toContain("under 600 changed lines");
    expect(prompt).toContain("<spec>\n# Word count under each note");
    expect(prompt).toContain("<feedback>\nMake it grey.\n</feedback>");
  });
});

describe("PR text and metadata", () => {
  it("round-trips the PR metadata the iterate check reads", () => {
    const body = prBody(run);
    expect(readMeta(body, PrMeta)).toEqual({ reqId: REQ, requester: REQUESTER, issue: 5 });
    expect(body).toContain("Builds #5");
    expect(prTitle(run)).toBe("[totalmod] Word count under each note");
    expect(readMeta(issueBody, IssueMeta)?.reqId).toBe(REQ);
    expect(readMeta(`text first\n${issueBody}`, IssueMeta)).toBeNull();
  });
});

describe("spend", () => {
  it("reads the cost from the execution file and round-trips the comment", () => {
    const execution = JSON.stringify([
      { type: "system" },
      { type: "assistant" },
      { type: "result", total_cost_usd: 1.234567 },
    ]);
    const usd = costFromExecutionFile(execution);
    const comment = spendComment(usd, new Date("2026-10-26T12:00:00Z"), 1);
    expect(comment).toContain("about $1.23");
    expect(readSpend(comment)).toEqual({ usd: 1.2346, at: "2026-10-26T12:00:00.000Z" });
    expect(readSpend('<!-- totalmod:spend {"usd":-5,"at":"x"} -->')).toBeNull();
  });
});
