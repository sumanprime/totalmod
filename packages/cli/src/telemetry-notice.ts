import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createTelemetry, randomInstallId, telemetryDisabled } from "@totalmod/telemetry";
import { exists } from "./detect.ts";

export { telemetryDisabled };

export const TELEMETRY_NOTICE = [
  "totalmod telemetry: anonymous counts only (first_run, request_submitted, preview_ready,",
  "iteration, merged, ga, rejected), never request text, code, prompts or file paths.",
  "Turn it off with DO_NOT_TRACK=1 or `telemetry: false` in totalmod.config.yaml.",
].join("\n");

const version: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

export function stateDir(env: Record<string, string | undefined>): string {
  if (env.TOTALMOD_STATE_DIR) return env.TOTALMOD_STATE_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "totalmod");
  if (process.platform === "win32" && env.APPDATA) return join(env.APPDATA, "totalmod");
  return join(homedir(), ".config", "totalmod");
}

/**
 * On the first run on this machine: prints the notice, stores a random install id, and sends
 * `first_run`. Nothing happens when telemetry is disabled.
 */
export async function showTelemetryNoticeOnce(
  env: Record<string, string | undefined>,
  configTelemetry: boolean | undefined,
  print: (line: string) => void,
  options: { endpoint?: string | undefined; fetch?: typeof fetch } = {},
): Promise<boolean> {
  if (telemetryDisabled(env, configTelemetry)) return false;
  const dir = stateDir(env);
  const marker = join(dir, "telemetry.json");
  if (await exists(marker)) return false;

  print(`${TELEMETRY_NOTICE}\n`);
  const installId = randomInstallId();
  await mkdir(dir, { recursive: true });
  await writeFile(
    marker,
    `${JSON.stringify({ noticeShownAt: new Date().toISOString(), installId })}\n`,
  );
  await createTelemetry({
    enabled: true,
    installId,
    source: "cli",
    version,
    endpoint: options.endpoint ?? env.TOTALMOD_TELEMETRY_ENDPOINT,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  }).track("first_run");
  return true;
}
