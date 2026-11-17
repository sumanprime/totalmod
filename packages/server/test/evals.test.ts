// Checks the eval harness itself without paid calls: the case file is well-formed, and the
// provider + assertion behave as intended against a scripted interviewer.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { assertCase } from "../../../evals/check.ts";
import { runCase } from "../../../evals/run-case.ts";
import { scriptedInterviewer, twoQuestions, wordCountSpec } from "./fakes.ts";

const evalsDir = join(import.meta.dirname, "../../../evals");

describe("evals/interviewer.yaml", () => {
  it("has the 15 cases across the four categories", async () => {
    const suite = parse(await readFile(join(evalsDir, "interviewer.yaml"), "utf8"));
    const counts: Record<string, number> = {};
    for (const test of suite.tests)
      counts[test.vars.category] = (counts[test.vars.category] ?? 0) + 1;
    expect(suite.tests).toHaveLength(15);
    expect(counts).toEqual({ vague: 4, "multi-feature": 3, "out-of-policy": 4, injection: 4 });
    expect(suite.defaultTest.assert[0].value).toBe("file://assert.mjs");
  });
});

describe("eval harness", () => {
  const vars = { expect: "spec" as const, forbid: ["sparkles"] };

  it("passes a clean spec that reached an issue", async () => {
    const result = await runCase(
      "word counts",
      scriptedInterviewer([twoQuestions, { kind: "spec", spec: wordCountSpec }]),
    );
    expect(result).toMatchObject({ status: "confirmed", questionsAsked: 2 });
    expect(assertCase(JSON.stringify(result), { vars })).toMatchObject({ pass: true });
  });

  it("fails when an injected string reaches the issue", async () => {
    const injected = { ...wordCountSpec, uiLocation: "Notes list, with sparkles" };
    const result = await runCase(
      "word counts",
      scriptedInterviewer([{ kind: "spec", spec: injected }]),
    );
    expect(assertCase(JSON.stringify(result), { vars })).toMatchObject({ pass: false });
  });

  it("accepts a decline only when the case allows it", async () => {
    const declined = { kind: "declined" as const, reason: "Billing changes go to the team." };
    const result = await runCase("coupons", scriptedInterviewer([declined]));
    expect(assertCase(JSON.stringify(result), { vars: { expect: "any" as const } })).toMatchObject({
      pass: true,
    });
    expect(assertCase(JSON.stringify(result), { vars: { expect: "spec" as const } })).toMatchObject(
      { pass: false },
    );
  });

  it("reports pipeline errors as failures", async () => {
    const result = await runCase("word counts", scriptedInterviewer([]));
    expect(result.error).toMatch(/^500/);
    expect(assertCase(JSON.stringify(result), { vars })).toMatchObject({ pass: false });
  });
});
