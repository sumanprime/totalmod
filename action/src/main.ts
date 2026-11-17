// Entry point for the composite actions' steps:
//   build action:   policy | paths <base> | test | publish <default-branch> | spend <file>
//   release action: release <default-branch>
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "@totalmod/core";
import {
  emptyFlagsFile,
  type FlagsFile,
  parseFlagsFile,
  removeFlag,
  serializeFlagsFile,
} from "@totalmod/flags/file";
import { createGitHub } from "./github.ts";
import { checkPaths, type PathCheck, parseNumstatZ, pathFailureComment } from "./paths.ts";
import {
  type BuildRun,
  checkPolicy,
  cleanupBranch,
  type PolicyResult,
  planFlagRemoval,
  policyFailureComment,
} from "./policy.ts";
import { buildPrompt, prBody, prTitle } from "./prompt.ts";
import { planRelease } from "./release.ts";
import { renderRisk, type TestResult, withRisk } from "./risk.ts";
import { costFromExecutionFile, spendComment } from "./spend.ts";

const env = process.env;
const repo = need("GITHUB_REPOSITORY");
const workspace = env.GITHUB_WORKSPACE ?? process.cwd();
const runFile = join(env.RUNNER_TEMP ?? workspace, "totalmod-run.json");
const github = createGitHub({ token: need("GITHUB_TOKEN"), apiUrl: env.GITHUB_API_URL });

/** What earlier steps learned about this run, for the risk summary. */
interface SavedRun {
  run: BuildRun;
  check?: PathCheck & { paths: string[] };
  tests?: TestResult;
}

function need(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function output(name: string, value: string) {
  if (!env.GITHUB_OUTPUT) return console.log(`${name}=${value}`);
  const delimiter = `totalmod_${Math.random().toString(36).slice(2)}`;
  appendFileSync(env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

function summary(markdown: string) {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: workspace, encoding: "utf8" });
}

function commit(message: string) {
  git(
    "-c",
    "user.name=totalmod",
    "-c",
    "user.email=totalmod@users.noreply.github.com",
    "commit",
    "--allow-empty",
    "-m",
    message,
  );
}

async function comment(issue: number, body: string) {
  await github.post(`/repos/${repo}/issues/${issue}/comments`, { body });
}

const config = () => loadConfig(join(workspace, env.TOTALMOD_CONFIG_DIR ?? "."));

async function flagsPath() {
  return join(workspace, (await config()).flags.file);
}

async function readFlags(): Promise<FlagsFile> {
  const path = await flagsPath();
  return existsSync(path) ? parseFlagsFile(readFileSync(path, "utf8")) : emptyFlagsFile();
}

async function writeFlags(file: FlagsFile) {
  const path = await flagsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeFlagsFile(file));
}

function packageManager(): string {
  const lockfiles: [string, string][] = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ];
  return lockfiles.find(([file]) => existsSync(join(workspace, file)))?.[1] ?? "npm";
}

/** Tools the agent may use: edit files and run the project's own checks. No network, no git. */
function claudeArgs(model: string, maxTurns: string): string {
  const pm = packageManager();
  const bash = ["test", "run test", "lint", "run lint", "typecheck", "run typecheck"].map(
    (cmd) => `Bash(${pm} ${cmd}:*)`,
  );
  const allowed = [
    "Read",
    "Edit",
    "Write",
    "Glob",
    "Grep",
    ...bash,
    "Bash(git status:*)",
    "Bash(git diff:*)",
  ];
  return [
    `--model ${model}`,
    `--max-turns ${maxTurns}`,
    `--allowedTools "${allowed.join(",")}"`,
    `--disallowedTools "WebFetch,WebSearch"`,
  ].join(" ");
}

async function policy() {
  const cfg = await config();
  const trustedActors = (env.TOTALMOD_TRUSTED_ACTORS ?? "").split(",");
  const result: PolicyResult =
    env.TOTALMOD_TASK === "remove-flag"
      ? await planFlagRemoval({
          reqId: need("TOTALMOD_REQ_ID"),
          flags: await readFlags(),
          github,
          repo,
          config: cfg,
          now: new Date(),
          trustedActors,
        })
      : await checkPolicy({
          eventName: need("GITHUB_EVENT_NAME"),
          event: JSON.parse(readFileSync(need("GITHUB_EVENT_PATH"), "utf8")),
          repo,
          config: cfg,
          trustedActors,
          github,
          now: new Date(),
        });

  if (result.outcome === "skip") {
    console.log(`Skipping: ${result.reason}`);
    output("skip", "true");
    return;
  }
  if (result.outcome === "fail") {
    const body = policyFailureComment(result.reasons);
    summary(body);
    if (result.commentOn) await comment(result.commentOn, body);
    console.error(body);
    process.exitCode = 1;
    return;
  }

  const run = result.run;
  save({ run });
  output("skip", "false");
  output("branch", run.branch);
  output("iteration", String(run.iteration));
  output("prompt", buildPrompt(run, cfg));
  output(
    "claude_args",
    claudeArgs(env.TOTALMOD_MODEL || cfg.model, env.TOTALMOD_MAX_TURNS || "60"),
  );
  summary(`totalmod ${run.kind}: request \`${run.reqId}\`, iteration ${run.iteration}.`);
}

function saved(): SavedRun {
  return JSON.parse(readFileSync(runFile, "utf8"));
}

function save(state: SavedRun) {
  writeFileSync(runFile, JSON.stringify(state));
}

async function paths(base: string) {
  const state = saved();
  const run = state.run;
  git("add", "-A");
  const changes = parseNumstatZ(git("diff", "--cached", "--numstat", "-z", "-M", base));
  const check = checkPaths(changes, await config(), run.reqId);
  save({ ...state, check: { ...check, paths: changes.map((c) => c.path) } });
  summary(`Path check: ${check.files} files, ${check.changedLines} changed lines.`);
  if (check.ok) return;

  const body = pathFailureComment(check);
  summary(body);
  await comment(run.prNumber ?? run.issueNumber, body);
  await github.post(`/repos/${repo}/issues/${run.prNumber ?? run.issueNumber}/labels`, {
    labels: ["totalmod:blocked"],
  });
  console.error(body);
  process.exitCode = 1;
}

/** Runs the project's tests once more, outside the agent, for the risk summary. Never fails the step. */
async function test() {
  const state = saved();
  const command = env.TOTALMOD_TEST_COMMAND || `${packageManager()} test`;
  const result = spawnSync(command, { cwd: workspace, shell: true, stdio: "inherit" });
  const tests: TestResult = { command, status: result.status === 0 ? "passed" : "failed" };
  save({ ...state, tests });
  summary(`Tests (\`${command}\`): ${tests.status}.`);
}

async function publish(defaultBranch: string) {
  const state = saved();
  const run = state.run;
  const cfg = await config();

  if (run.kind === "remove-flag") {
    // The agent may not touch flags/**; the workflow removes the entry after the path check.
    await writeFlags(removeFlag(await readFlags(), run.reqId));
    git("add", "-A");
    commit(`totalmod: remove the req-${run.reqId} flag`);
  } else {
    git("add", "-A");
    commit(`totalmod: req-${run.reqId} iteration ${run.iteration}`);
  }
  git("push", "origin", `HEAD:refs/heads/${run.branch}`);

  const risk = state.check
    ? renderRisk(run, cfg, state.check, state.tests ?? { command: "-", status: "not run" })
    : "";
  if (run.prNumber) {
    const pr = await github.get<{ body?: string | null }>(`/repos/${repo}/pulls/${run.prNumber}`);
    await github.patch(`/repos/${repo}/pulls/${run.prNumber}`, {
      body: withRisk(pr.body ?? "", risk),
    });
    return;
  }

  const pr = await github.post<{ number: number }>(`/repos/${repo}/pulls`, {
    title: prTitle(run),
    head: run.branch,
    base: defaultBranch,
    body: withRisk(prBody(run), risk),
    draft: run.kind !== "remove-flag",
  });
  await comment(
    run.issueNumber,
    run.kind === "remove-flag"
      ? `Flag-removal PR opened: #${pr.number}.`
      : `Draft PR opened: #${pr.number}.`,
  );
  summary(`Opened PR #${pr.number}.`);
}

async function spend(executionFile: string) {
  const { run } = saved();
  const usd = existsSync(executionFile)
    ? costFromExecutionFile(readFileSync(executionFile, "utf8"))
    : 0;
  await comment(run.issueNumber, spendComment(usd, new Date(), run.iteration));
}

async function release(defaultBranch: string) {
  const plan = planRelease({
    eventName: need("GITHUB_EVENT_NAME"),
    event: JSON.parse(readFileSync(need("GITHUB_EVENT_PATH"), "utf8")),
    flags: await readFlags(),
    config: await config(),
    now: new Date(),
  });

  if (plan.kind === "skip") {
    console.log(`Nothing to do: ${plan.reason}`);
    return;
  }

  if (plan.kind === "cleanup") {
    // One removal per run keeps cost and review load small; the next run picks up the rest.
    for (const reqId of plan.reqIds) {
      const open = await github.list(
        `/repos/${repo}/pulls?state=open&head=${repo.split("/")[0]}:${cleanupBranch(reqId)}`,
        1,
      );
      if (open.length === 0) {
        output("cleanup_req", reqId);
        summary(`req-${reqId} has been GA long enough: starting the flag-removal PR.`);
        return;
      }
    }
    summary("No flags are due for removal.");
    return;
  }

  if (plan.flags) {
    await writeFlags(plan.flags);
    git("add", "-A");
    commit(plan.commitMessage ?? "totalmod: update flags");
    git("pull", "--rebase", "origin", defaultBranch);
    git("push", "origin", `HEAD:refs/heads/${defaultBranch}`);
  }
  if (plan.deleteBranch) {
    await github.delete(`/repos/${repo}/git/refs/heads/${plan.deleteBranch}`).catch(() => {});
  }
  for (const c of plan.comments) await comment(c.number, c.body);
  if (plan.closeIssue) {
    await github.patch(`/repos/${repo}/issues/${plan.closeIssue.number}`, {
      state: "closed",
      state_reason: plan.closeIssue.reason,
    });
  }
}

const [command, arg = ""] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
  policy,
  paths: () => paths(arg || "HEAD"),
  test,
  publish: () => publish(arg || "main"),
  spend: () => spend(arg),
  release: () => release(arg || "main"),
};
const handler = command ? commands[command] : undefined;
if (!handler) {
  console.error(`Usage: main.ts <${Object.keys(commands).join("|")}> [arg]`);
  process.exit(2);
}
await handler();
