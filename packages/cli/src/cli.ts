import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "@totalmod/core";
import { DemoError, runDemo } from "./demo.ts";
import { InitError } from "./detect.ts";
import { type CheckStatus, doctor } from "./doctor.ts";
import { init } from "./init.ts";
import { showTelemetryNoticeOnce } from "./telemetry-notice.ts";

export interface CliContext {
  cwd: string;
  env: Record<string, string | undefined>;
  print: (line: string) => void;
  fetch?: typeof fetch;
  /** Runs `totalmod demo`; tests replace it so nothing is installed or started. */
  runDemo?: typeof runDemo;
}

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const USAGE = `Usage: npx totalmod <command> [options]

Commands:
  demo      Try the whole loop locally in a scripted demo app: no API key or accounts
  init      Add totalmod to a Next.js App Router app
  doctor    Check config, flags, workflows and the Vercel preview env

Options:
  --dir <path>   Project directory (default: current directory; demo: ./totalmod-demo)
  --port <n>     demo: the app's port; the preview uses the next one (default: 3000)
  --force        init: overwrite files that already exist
  -h, --help     Show this help`;

const ICONS: Record<CheckStatus, string> = {
  pass: "ok  ",
  warn: "warn",
  fail: "FAIL",
  skip: "skip",
  info: "info",
};

/** Runs the CLI and returns the process exit code. */
export async function main(argv: string[], ctx: CliContext): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    ctx.print(`${(error as Error).message}\n\n${USAGE}`);
    return 1;
  }
  const { values, positionals } = parsed;
  const command = positionals[0];
  if (values.help || !command) {
    ctx.print(USAGE);
    return command || values.help ? 0 : 1;
  }

  if (command === "demo") {
    const port = Number(values.port ?? 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65534) {
      ctx.print(`--port must be a number from 1 to 65534, got "${values.port}".`);
      return 1;
    }
    await showTelemetryNoticeOnce(
      ctx.env,
      undefined,
      ctx.print,
      ctx.fetch ? { fetch: ctx.fetch } : {},
    );
    try {
      return await (ctx.runDemo ?? runDemo)(resolve(ctx.cwd, values.dir ?? "totalmod-demo"), {
        version,
        port,
        env: ctx.env,
        print: ctx.print,
      });
    } catch (error) {
      if (error instanceof DemoError) {
        ctx.print(`totalmod demo: ${error.message}`);
        return 1;
      }
      throw error;
    }
  }

  const dir = resolve(ctx.cwd, values.dir ?? ".");
  const config = await loadConfig(dir).catch(() => undefined);
  await showTelemetryNoticeOnce(ctx.env, config?.telemetry, ctx.print, {
    endpoint: config?.telemetryEndpoint,
    ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
  });

  if (command === "init") {
    try {
      const result = await init(dir, { force: values.force ?? false });
      for (const file of result.created) ctx.print(`  created  ${file}`);
      for (const file of result.skipped)
        ctx.print(`  kept     ${file} (exists; --force to overwrite)`);
      ctx.print("");
      ctx.print("Next steps:");
      result.nextSteps.forEach((step, i) => {
        ctx.print(`  ${i + 1}. ${step}`);
      });
      return 0;
    } catch (error) {
      if (error instanceof InitError) {
        ctx.print(`totalmod init: ${error.message}`);
        return 1;
      }
      throw error;
    }
  }

  if (command === "doctor") {
    const checks = await doctor(dir, { env: ctx.env, ...(ctx.fetch ? { fetch: ctx.fetch } : {}) });
    for (const check of checks) {
      ctx.print(`[${ICONS[check.status]}] ${check.name}`);
      for (const detail of check.details) ctx.print(`       ${detail}`);
    }
    return checks.some((c) => c.status === "fail") ? 1 : 0;
  }

  ctx.print(`Unknown command: ${command}\n\n${USAGE}`);
  return 1;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      port: { type: "string" },
      force: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}
