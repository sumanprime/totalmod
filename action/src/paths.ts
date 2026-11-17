import { matchesGlob } from "node:path/posix";
import type { Config } from "@totalmod/core";

export interface FileChange {
  path: string;
  /** Set for renames: the old path must be allowed too. */
  oldPath?: string;
  added: number;
  deleted: number;
  binary: boolean;
}

export interface PathCheck {
  ok: boolean;
  violations: string[];
  changedLines: number;
  files: number;
}

/** The agent must add tests, so test files are allowed wherever they live (blocked still wins). */
export const TEST_GLOBS = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "test/**",
  "tests/**",
  "e2e/**",
];

/** The agent's own notes for this request. Always allowed, never counted toward the line cap. */
export function requestDir(reqId: string): string {
  return `.totalmod/requests/${reqId}/`;
}

/**
 * Job C: deterministic check of the branch's changes against the config. Blocked globs win over
 * allowed ones; anything not explicitly allowed is a violation.
 */
export function checkPaths(changes: FileChange[], config: Config, reqId: string): PathCheck {
  const own = requestDir(reqId);
  const violations: string[] = [];
  let changedLines = 0;

  if (changes.length === 0) violations.push("The agent made no changes.");

  for (const change of changes) {
    for (const path of change.oldPath ? [change.oldPath, change.path] : [change.path]) {
      const blocked = config.paths.blocked.find((glob) => matchesGlob(path, glob));
      if (blocked) {
        violations.push(`\`${path}\` is blocked (\`${blocked}\`).`);
        continue;
      }
      if (path.startsWith(own)) continue;
      if (![...config.paths.allowed, ...TEST_GLOBS].some((glob) => matchesGlob(path, glob))) {
        violations.push(`\`${path}\` is outside the allowed paths.`);
      }
    }
    if (change.binary) violations.push(`\`${change.path}\` is a binary file.`);
    if (!change.path.startsWith(own)) changedLines += change.added + change.deleted;
  }

  if (changedLines > config.paths.maxChangedLines) {
    violations.push(
      `${changedLines} changed lines, over the cap of ${config.paths.maxChangedLines}.`,
    );
  }
  return { ok: violations.length === 0, violations, changedLines, files: changes.length };
}

/**
 * Parses `git diff --cached --numstat -z -M <base>` output. With -z, renames come as
 * "added\tdeleted\t\0old\0new\0" and binary files as "-\t-\tpath".
 */
export function parseNumstatZ(output: string): FileChange[] {
  const fields = output.split("\0");
  const changes: FileChange[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (!entry) continue;
    const [added = "", deleted = "", path = ""] = entry.split("\t");
    const binary = added === "-" || deleted === "-";
    const counts = {
      added: binary ? 0 : Number(added),
      deleted: binary ? 0 : Number(deleted),
      binary,
    };
    if (path === "") {
      const oldPath = fields[++i] ?? "";
      const newPath = fields[++i] ?? "";
      changes.push({ path: newPath, oldPath, ...counts });
    } else {
      changes.push({ path, ...counts });
    }
  }
  return changes;
}

export function pathFailureComment(check: PathCheck): string {
  return [
    "**totalmod blocked this build.** The path check found changes outside the policy in `totalmod.config.yaml`, so nothing was pushed:",
    "",
    ...check.violations.map((v) => `- ${v}`),
  ].join("\n");
}
