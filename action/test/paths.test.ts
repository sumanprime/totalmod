// Fixture diffs come from a real git repository, so parseNumstatZ is tested against git's output.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defaultConfig, parseConfig } from "@totalmod/core";
import { beforeEach, describe, expect, it } from "vitest";
import { checkPaths, parseNumstatZ } from "../src/paths.ts";

const REQ = "k3j9x2m1q8";
let dir: string;

const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
function write(path: string, content: string | Buffer) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}
function diff() {
  git("add", "-A");
  return parseNumstatZ(git("diff", "--cached", "--numstat", "-z", "-M", "base"));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "totalmod-paths-"));
  git("init", "-q", "-b", "main");
  write("app/notes/page.tsx", "export default function Page() {\n  return null;\n}\n");
  write(
    "lib/words.ts",
    Array.from({ length: 40 }, (_, i) => `export const w${i} = ${i};`).join("\n"),
  );
  write("app/auth/login.ts", "export const login = 1;\n");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base");
  git("tag", "base");
});

describe("checkPaths on real diffs", () => {
  it("passes edits in allowed paths, tests anywhere, and the request's notes", () => {
    write("app/notes/page.tsx", "export default function Page() {\n  return <p>12 words</p>;\n}\n");
    write(
      "lib/count-words.ts",
      "export const countWords = (s: string) => s.split(/\\s+/).length;\n",
    );
    write("lib/count-words.test.ts", "test('x', () => {});\n");
    write(`.totalmod/requests/${REQ}/PLAN.md`, `${"note\n".repeat(900)}`);
    const check = checkPaths(diff(), defaultConfig(), REQ);
    expect(check).toEqual({ ok: true, violations: [], changedLines: 4, files: 4 });
  });

  it("blocks auth, CI, env files and other requests' notes", () => {
    write("app/auth/login.ts", "export const login = 2;\n");
    write(".github/workflows/x.yml", "on: push\n");
    write(".env.local", "SECRET=1\n");
    write(".totalmod/requests/otherreq01/PLAN.md", "hi\n");
    write("package.json", "{}\n");
    const check = checkPaths(diff(), defaultConfig(), REQ);
    expect(check.ok).toBe(false);
    expect(check.violations).toEqual([
      "`.env.local` is blocked (`.env*`).",
      "`.github/workflows/x.yml` is blocked (`.github/**`).",
      "`.totalmod/requests/otherreq01/PLAN.md` is outside the allowed paths.",
      "`app/auth/login.ts` is blocked (`**/auth/**`).",
      "`package.json` is outside the allowed paths.",
    ]);
  });

  it("checks both sides of a rename", () => {
    renameSync(join(dir, "app/auth/login.ts"), join(dir, "app/login.ts"));
    const changes = diff();
    expect(changes).toEqual([
      { path: "app/login.ts", oldPath: "app/auth/login.ts", added: 0, deleted: 0, binary: false },
    ]);
    expect(checkPaths(changes, defaultConfig(), REQ).violations).toEqual([
      "`app/auth/login.ts` is blocked (`**/auth/**`).",
    ]);
  });

  it("enforces the line cap and rejects binaries", () => {
    write(
      "lib/words.ts",
      Array.from({ length: 40 }, (_, i) => `export const w${i} = ${i + 1};`).join("\n"),
    );
    write("app/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
    const config = parseConfig("paths:\n  maxChangedLines: 50\n");
    const check = checkPaths(diff(), config, REQ);
    expect(check.changedLines).toBe(80);
    expect(check.violations).toEqual([
      "`app/logo.png` is a binary file.",
      "80 changed lines, over the cap of 50.",
    ]);
  });

  it("fails when the agent changed nothing", () => {
    expect(checkPaths(diff(), defaultConfig(), REQ).violations).toEqual([
      "The agent made no changes.",
    ]);
  });
});
