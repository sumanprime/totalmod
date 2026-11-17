// Packs every public package as npm would publish it, installs the tarballs into a fresh project,
// and checks they work from node_modules (plain JS, no TypeScript, templates and prompts included).
// Run after `pnpm build`: `pnpm pack:smoke`. Set TOTALMOD_KEEP_PACK=1 to keep the temp project for inspection.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "../..");
const packages = ["core", "telemetry", "flags", "server", "widget", "cli"];
const work = mkdtempSync(join(tmpdir(), "totalmod-pack-"));
const tarballs = join(work, "tarballs");
const app = join(work, "app");

function run(command: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  // npm and pnpm are .cmd shims on Windows and need a shell; node does not.
  const shell = process.platform === "win32" && command !== "node";
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    shell,
    env: { ...process.env, ...env },
  });
}

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

for (const name of packages) {
  const dir = join(root, "packages", name);
  const built = existsSync(join(dir, "dist"));
  check(`${name} is built`, built, built ? "" : "run `pnpm build` first");
  run("pnpm", ["pack", "--pack-destination", tarballs], dir);
}

cpSync(join(root, "packages/cli/test/fixtures/next-app"), app, { recursive: true });
const files = readdirSync(tarballs).map((f) => join(tarballs, f));
run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", ...files], app);

const imports: [string, string][] = [
  [
    "@totalmod/core",
    "typeof m.hashRequester === 'function' && typeof m.verifyPreviewToken === 'function'",
  ],
  ["@totalmod/telemetry", "m.EVENTS.length === 7"],
  ["@totalmod/flags", "typeof m.isRequestEnabled === 'function'"],
  ["@totalmod/flags/file", "typeof m.enableForRequester === 'function'"],
  [
    "@totalmod/server",
    "m.systemPrompt('interviewer').includes('off limits') && m.systemPrompt('reviser').length > 100",
  ],
  ["@totalmod/server/next", "typeof m.createTotalmodHandlers === 'function'"],
  ["@totalmod/widget", "typeof m.RequestFeatureButton === 'function'"],
];
for (const [specifier, test] of imports) {
  const script = `const m = await import(${JSON.stringify(specifier)}); if (!(${test})) process.exit(1);`;
  try {
    run("node", ["--input-type=module", "-e", script], app);
    check(`import ${specifier}`, true);
  } catch (error) {
    check(`import ${specifier}`, false, String((error as Error).message).split("\n")[0]);
  }
}

const bin = join(app, "node_modules", "totalmod", "dist", "bin.js");
check("totalmod --help", run("node", [bin, "--help"], app).includes("Usage: npx totalmod"));
const init = run("node", [bin, "init"], app, { DO_NOT_TRACK: "1" });
check(
  "totalmod init",
  init.includes("created  totalmod.config.yaml") && existsSync(join(app, "lib/totalmod.ts")),
);
check(
  "no TypeScript sources shipped",
  packages.every(
    (name) =>
      !existsSync(
        join(app, "node_modules", name === "cli" ? "totalmod" : `@totalmod/${name}`, "src"),
      ),
  ),
);

// biome-ignore lint/suspicious/noUndeclaredEnvVars: a local debugging switch, not build input
if (process.env.TOTALMOD_KEEP_PACK) console.log(`kept ${work}`);
else rmSync(work, { recursive: true, force: true });
