import { matchesGlob } from "node:path/posix";
import type { Config } from "@totalmod/core";
import { type PathCheck, requestDir, TEST_GLOBS } from "./paths.ts";
import type { BuildRun } from "./policy.ts";

export const RISK_START = "<!-- totalmod:risk:start -->";
export const RISK_END = "<!-- totalmod:risk:end -->";
/** Marks the verdict row; the server rewrites that row when the requester gives a thumbs-up. */
export const VERDICT_MARKER = "<!-- totalmod:verdict -->";

export type TestResult = { status: "passed" | "failed" | "not run"; command: string };

/** Groups changed files for the founder: notes, tests, then app areas by their first folders. */
export function filesByArea(paths: string[], reqId: string): string {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const area = path.startsWith(requestDir(reqId))
      ? "agent notes"
      : TEST_GLOBS.some((glob) => matchesGlob(path, glob))
        ? "tests"
        : `\`${path.split("/").slice(0, -1).slice(0, 2).join("/") || "(root)"}\``;
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return [...counts].map(([area, n]) => `${area} (${n})`).join(", ") || "none";
}

export function renderRisk(
  run: BuildRun,
  config: Config,
  check: PathCheck & { paths: string[] },
  tests: TestResult,
): string {
  const rows: [string, string][] = [
    ["Policy check", "passed: trusted request, budget left, iteration within the cap"],
    [
      "Path check",
      `passed: ${check.files} files, ${check.changedLines} changed lines (cap ${config.paths.maxChangedLines}), no blocked paths`,
    ],
    ["Files by area", filesByArea(check.paths, run.reqId)],
    [`Tests (\`${tests.command}\`)`, tests.status],
  ];
  if (run.kind !== "remove-flag") {
    rows.push(
      ["Fix rounds", `${run.iteration} of ${config.iterations.max}`],
      ["Requester verdict", `waiting for the requester ${VERDICT_MARKER}`],
    );
  }
  return [
    RISK_START,
    "### Risk summary",
    "",
    "| Check | Result |",
    "| --- | --- |",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    RISK_END,
  ].join("\n");
}

/** Puts the risk summary into a PR body, replacing the previous one if there is one. */
export function withRisk(body: string, risk: string): string {
  const start = body.indexOf(RISK_START);
  const end = body.indexOf(RISK_END);
  if (start !== -1 && end > start) {
    return `${body.slice(0, start)}${risk}${body.slice(end + RISK_END.length)}`;
  }
  return `${body.trimEnd()}\n\n${risk}\n`;
}
