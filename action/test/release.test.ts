// Dry runs of the release workflow: each event against a flags file, checking the plan.
import { defaultConfig, hashRequester } from "@totalmod/core";
import { emptyFlagsFile, enableForAll, enableForRequester, getFlag } from "@totalmod/flags/file";
import { describe, expect, it } from "vitest";
import { planFlagRemoval } from "../src/policy.ts";
import { planRelease } from "../src/release.ts";
import { fakeGitHub, REQ } from "./fake-github.ts";

const requester = hashRequester("user-1", "secret");
const prBody = `<!-- totalmod:meta {"reqId":"${REQ}","requester":"${requester}","issue":5} -->\nBuilds #5`;
const pr = (patch: object = {}) => ({
  number: 9,
  merged: true,
  body: prBody,
  head: { ref: `totalmod/req-${REQ}` },
  ...patch,
});
const now = new Date("2026-10-26T12:00:00Z");
const config = defaultConfig();
const merged = enableForRequester(
  emptyFlagsFile(),
  { reqId: REQ, requester, issue: 5, pr: 9 },
  now,
);

const plan = (eventName: string, event: object, flags = emptyFlagsFile()) =>
  planRelease({ eventName, event, flags, config, now });

describe("merge", () => {
  it("turns the flag on for the requester only and closes the issue", () => {
    const result = plan("pull_request", { action: "closed", pull_request: pr() });
    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") return;
    expect(getFlag(result.flags ?? emptyFlagsFile(), REQ)?.metadata).toMatchObject({
      stage: "requester",
      requester,
      issue: 5,
      pr: 9,
    });
    expect(result.commitMessage).toBe(`totalmod: turn on req-${REQ} for its requester`);
    expect(result.comments.map((c) => c.number)).toEqual([9, 5]);
    expect(result.closeIssue).toEqual({ number: 5, reason: "completed" });
  });

  it("ignores PRs that are not totalmod builds or have forged branches", () => {
    expect(
      plan("pull_request", { action: "closed", pull_request: pr({ body: "hello" }) }).kind,
    ).toBe("skip");
    expect(
      plan("pull_request", { action: "closed", pull_request: pr({ head: { ref: "feature/x" } }) })
        .kind,
    ).toBe("skip");
  });
});

describe("reject", () => {
  it("deletes the branch and closes the issue as not planned, without touching flags", () => {
    const result = plan("pull_request", { action: "closed", pull_request: pr({ merged: false }) });
    expect(result).toEqual({
      kind: "apply",
      comments: [{ number: 5, body: "Closed without merging (#9). The branch was deleted." }],
      deleteBranch: `totalmod/req-${REQ}`,
      closeIssue: { number: 5, reason: "not_planned" },
    });
  });
});

describe("rollout labels", () => {
  const labeled = (name: string, flags = merged, prPatch = {}) =>
    plan("pull_request", { action: "labeled", label: { name }, pull_request: pr(prPatch) }, flags);

  it.each([
    ["totalmod:rollout-25", "rollout", "on for the requester and 25% of users"],
    ["totalmod:ga", "ga", "on for everyone"],
    ["totalmod:off", "off", "off for everyone"],
  ])("%s moves the flag to %s", (label, stage, message) => {
    const result = labeled(label);
    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") return;
    expect(getFlag(result.flags ?? emptyFlagsFile(), REQ)?.metadata.stage).toBe(stage);
    expect(result.comments[0]?.body).toContain(message);
  });

  it("does nothing before merge, for other labels, or without a flag", () => {
    expect(labeled("totalmod:ga", merged, { merged: false }).kind).toBe("skip");
    expect(labeled("bug").kind).toBe("skip");
    expect(labeled("totalmod:ga", emptyFlagsFile()).kind).toBe("skip");
  });
});

describe("scheduled flag removal", () => {
  it("lists GA flags past removeAfterDays", () => {
    const ga = enableForAll(merged, REQ, new Date("2026-10-01T00:00:00Z"));
    expect(plan("schedule", {}, ga)).toEqual({ kind: "cleanup", reqIds: [REQ] });
    expect(plan("schedule", {}, merged)).toEqual({ kind: "cleanup", reqIds: [] });
  });

  it("plans the remove-flag build only for GA flags without an open removal PR", async () => {
    const ga = enableForAll(merged, REQ, new Date("2026-10-01T00:00:00Z"));
    const routes = (open: unknown[]) => ({
      "/repos/acme/app/pulls": open,
      "/repos/acme/app/issues": [],
    });
    const base = { repo: "acme/app", config, now, trustedActors: ["totalmod-bot"], reqId: REQ };

    const ok = await planFlagRemoval({ ...base, flags: ga, github: fakeGitHub(routes([])).github });
    expect(ok).toEqual({
      outcome: "pass",
      run: {
        kind: "remove-flag",
        reqId: REQ,
        requester,
        issueNumber: 5,
        iteration: 0,
        branch: `totalmod/cleanup-${REQ}`,
        spec: "",
      },
    });
    const open = await planFlagRemoval({
      ...base,
      flags: ga,
      github: fakeGitHub(routes([{ number: 3 }])).github,
    });
    expect(open).toEqual({ outcome: "skip", reason: "Removal PR #3 is already open." });
    const notGa = await planFlagRemoval({
      ...base,
      flags: merged,
      github: fakeGitHub(routes([])).github,
    });
    expect(notGa.outcome).toBe("fail");
  });
});
