import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Config, ConfigError, loadConfig } from "@totalmod/core";
import { detectNextApp, exists } from "./detect.ts";

export type CheckStatus = "pass" | "warn" | "fail" | "skip" | "info";

export interface Check {
  name: string;
  status: CheckStatus;
  details: string[];
}

export interface DoctorOptions {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

/** Variables a preview deployment is meant to have. Everything else needs a reason. */
const PREVIEW_REQUIRED = ["TOTALMOD_MODE", "TOTALMOD_PREVIEW_SECRET"];

/** Names that look like production credentials or data access. Fail if present in Preview. */
const PRODUCTION_LOOKING =
  /DATABASE|POSTGRES|^PG[A-Z]|MYSQL|MONGO|REDIS|SUPABASE|SECRET|PRIVATE|PASSWORD|TOKEN|API_?KEY|_KEY$|STRIPE|^AWS_|DSN|WEBHOOK/;

export async function doctor(dir: string, options: DoctorOptions): Promise<Check[]> {
  const checks: Check[] = [];

  try {
    const app = await detectNextApp(dir);
    checks.push({ name: "Next.js App Router", status: "pass", details: [`${app.src}app/`] });
  } catch (error) {
    checks.push({
      name: "Next.js App Router",
      status: "fail",
      details: [(error as Error).message],
    });
  }

  let config: Config | undefined;
  try {
    config = await loadConfig(dir);
    checks.push({ name: "totalmod.config.yaml", status: "pass", details: [] });
  } catch (error) {
    const details = error instanceof ConfigError ? error.problems : [(error as Error).message];
    checks.push({ name: "totalmod.config.yaml", status: "fail", details });
  }

  if (config) checks.push(await checkFlagsFile(dir, config.flags.file));

  const workflow = ".github/workflows/totalmod-build.yml";
  checks.push(
    (await exists(join(dir, workflow)))
      ? { name: "Build workflow", status: "pass", details: [workflow] }
      : {
          name: "Build workflow",
          status: "fail",
          details: [`${workflow} is missing. Run \`npx totalmod init\`.`],
        },
  );

  checks.push({
    name: "Secrets to set",
    status: "info",
    details: [
      "GitHub Actions secrets: ANTHROPIC_API_KEY, TOTALMOD_GITHUB_TOKEN; variable: TOTALMOD_TRUSTED_ACTORS",
      "App server (production): TOTALMOD_GITHUB_REPO, TOTALMOD_GITHUB_TOKEN, TOTALMOD_PREVIEW_SECRET, TOTALMOD_WEBHOOK_SECRET",
      "GitHub webhook: <your app>/api/totalmod/webhooks/github, events Pull requests + Deployment statuses, secret TOTALMOD_WEBHOOK_SECRET",
      "Vercel Preview: TOTALMOD_MODE=mock, TOTALMOD_PREVIEW_SECRET",
    ],
  });

  checks.push(await checkVercelPreviewEnv(options));
  return checks;
}

async function checkFlagsFile(dir: string, file: string): Promise<Check> {
  const name = "Flags file";
  try {
    const data = JSON.parse(await readFile(join(dir, file), "utf8"));
    if (typeof data?.flags !== "object" || data.flags === null || Array.isArray(data.flags)) {
      return { name, status: "fail", details: [`${file} needs a top-level "flags" object.`] };
    }
    return { name, status: "pass", details: [file] };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      name,
      status: "fail",
      details: [
        missing ? `${file} is missing. Run \`npx totalmod init\`.` : `${file} is not valid JSON.`,
      ],
    };
  }
}

interface VercelEnv {
  key: string;
  target?: string[] | string;
  type?: string;
  value?: string;
}

/**
 * Lists the project's env vars through the Vercel API and checks the Preview scope holds only
 * the totalmod mock-mode vars and public values. Needs VERCEL_TOKEN and VERCEL_PROJECT_ID.
 */
async function checkVercelPreviewEnv(options: DoctorOptions): Promise<Check> {
  const name = "Vercel preview env";
  const { VERCEL_TOKEN: token, VERCEL_PROJECT_ID: project, VERCEL_TEAM_ID: team } = options.env;
  if (!token || !project) {
    return {
      name,
      status: "skip",
      details: ["Set VERCEL_TOKEN and VERCEL_PROJECT_ID (and VERCEL_TEAM_ID for a team) to check."],
    };
  }

  const url = new URL(`https://api.vercel.com/v10/projects/${encodeURIComponent(project)}/env`);
  if (team) url.searchParams.set("teamId", team);
  const res = await (options.fetch ?? fetch)(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    return {
      name,
      status: "fail",
      details: [`Vercel API returned ${res.status}. Check the token and project id.`],
    };
  }

  const { envs } = (await res.json()) as { envs: VercelEnv[] };
  const preview = envs.filter((e) => [e.target ?? []].flat().includes("preview"));
  const keys = new Set(preview.map((e) => e.key));

  const failures: string[] = [];
  const warnings: string[] = [];
  for (const key of PREVIEW_REQUIRED) {
    if (!keys.has(key)) failures.push(`${key} is missing from Preview.`);
  }
  const mode = preview.find((e) => e.key === "TOTALMOD_MODE");
  if (mode?.type === "plain" && mode.value !== undefined && mode.value !== "mock") {
    failures.push(`TOTALMOD_MODE is "${mode.value}" in Preview; it must be "mock".`);
  }
  for (const key of [...keys].sort()) {
    if (PREVIEW_REQUIRED.includes(key) || key.startsWith("NEXT_PUBLIC_")) continue;
    if (PRODUCTION_LOOKING.test(key)) {
      failures.push(`${key} looks like a production credential. Remove it from the Preview scope.`);
    } else {
      warnings.push(
        `${key} is not on the preview allowlist. Keep it only if it is public and non-secret.`,
      );
    }
  }

  if (failures.length > 0) return { name, status: "fail", details: [...failures, ...warnings] };
  if (warnings.length > 0) return { name, status: "warn", details: warnings };
  return { name, status: "pass", details: ["Preview has only mock-mode and public vars."] };
}
