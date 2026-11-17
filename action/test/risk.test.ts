import { defaultConfig } from "@totalmod/core";
import { describe, expect, it } from "vitest";
import type { BuildRun } from "../src/policy.ts";
import { buildPrompt, prBody, prTitle } from "../src/prompt.ts";
import {
  filesByArea,
  RISK_END,
  RISK_START,
  renderRisk,
  VERDICT_MARKER,
  withRisk,
} from "../src/risk.ts";
import { REQ, REQUESTER } from "./fake-github.ts";

const run: BuildRun = {
  kind: "iterate",
  reqId: REQ,
  requester: REQUESTER,
  issueNumber: 5,
  prNumber: 9,
  iteration: 1,
  branch: `totalmod/req-${REQ}`,
  spec: "# Word count",
};
const paths = [
  "app/notes/page.tsx",
  "app/notes/[id]/page.tsx",
  "lib/words.ts",
  "lib/words.test.ts",
  `.totalmod/requests/${REQ}/PLAN.md`,
];
const check = { ok: true, violations: [], changedLines: 42, files: 5, paths };

describe("risk summary", () => {
  it("groups files by area", () => {
    expect(filesByArea(paths, REQ)).toBe("`app/notes` (2), `lib` (1), tests (1), agent notes (1)");
  });

  it("renders the checks, tests, rounds and a verdict row the server can rewrite", () => {
    const risk = renderRisk(run, defaultConfig(), check, {
      command: "pnpm test",
      status: "passed",
    });
    expect(risk.startsWith(RISK_START)).toBe(true);
    expect(risk.endsWith(RISK_END)).toBe(true);
    expect(risk).toContain(
      "| Path check | passed: 5 files, 42 changed lines (cap 600), no blocked paths |",
    );
    expect(risk).toContain("| Tests (`pnpm test`) | passed |");
    expect(risk).toContain("| Fix rounds | 1 of 3 |");
    expect(risk).toContain(`| Requester verdict | waiting for the requester ${VERDICT_MARKER} |`);
  });

  it("replaces an earlier summary instead of stacking them", () => {
    const first = withRisk(
      prBody(run),
      renderRisk(run, defaultConfig(), check, { command: "t", status: "failed" }),
    );
    const second = withRisk(
      first,
      renderRisk(run, defaultConfig(), check, { command: "t", status: "passed" }),
    );
    expect(second.match(/### Risk summary/g)).toHaveLength(1);
    expect(second).toContain("| Tests (`t`) | passed |");
    expect(second.startsWith("<!-- totalmod:meta")).toBe(true);
  });
});

describe("remove-flag task text", () => {
  const removal: BuildRun = {
    ...run,
    kind: "remove-flag",
    branch: `totalmod/cleanup-${REQ}`,
    spec: "",
  };

  it("asks only for the flag removal and drops the requester rows", () => {
    const prompt = buildPrompt(removal, defaultConfig());
    expect(prompt).toContain(`Task: remove the flag for \`${REQ}\``);
    expect(prompt).not.toContain("<spec>");
    expect(prTitle(removal)).toBe(`[totalmod] Remove the req-${REQ} flag`);
    const risk = renderRisk(removal, defaultConfig(), check, { command: "t", status: "passed" });
    expect(risk).not.toContain("Requester verdict");
  });
});
