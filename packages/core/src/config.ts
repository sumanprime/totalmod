import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import type { z } from "zod";
import { Config } from "./config-schema.ts";

export const CONFIG_FILENAME = "totalmod.config.yaml";

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(file: string, problems: string[]) {
    super(`${file} is invalid:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export function defaultConfig(): Config {
  return Config.parse({});
}

/** Parses config YAML text. Throws ConfigError with one fix-it line per problem. */
export function parseConfig(text: string, file = CONFIG_FILENAME): Config {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new ConfigError(
      file,
      doc.errors.map(
        (e) => `YAML syntax error: ${e.message.split("\n")[0]}. Check indentation and quoting.`,
      ),
    );
  }
  const raw: unknown = doc.toJS() ?? {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError(file, ["The file must be a YAML mapping of `key: value` lines."]);
  }
  const result = Config.safeParse(raw);
  if (!result.success) throw new ConfigError(file, result.error.issues.flatMap(describeIssue));
  return result.data;
}

/** Loads `totalmod.config.yaml` from `dir`. */
export async function loadConfig(dir: string): Promise<Config> {
  let text: string;
  try {
    text = await readFile(join(dir, CONFIG_FILENAME), "utf8");
  } catch {
    throw new ConfigError(CONFIG_FILENAME, [
      `Not found in ${dir}. Run \`npx totalmod init\` to create it.`,
    ]);
  }
  return parseConfig(text);
}

const examples: Record<string, string> = {
  model: "model: claude-sonnet-5-5",
  requesters: "requesters: all   # or paying, or a list of user ids",
  "budget.perRequestUsd": "perRequestUsd: 3",
  "budget.monthlyUsd": "monthlyUsd: 100",
  "iterations.max": "max: 3   # 1 to 10",
  "paths.allowed": 'allowed: ["app/**", "components/**"]',
  "paths.blocked": 'blocked: ["lib/payments/**"]',
  "paths.maxChangedLines": "maxChangedLines: 600",
  "flags.file": "file: flags/totalmod.flags.json",
  "flags.removeAfterDays": "removeAfterDays: 14",
  telemetry: "telemetry: false",
  telemetryEndpoint: "telemetryEndpoint: https://telemetry.example.com/v1/events",
};

const knownKeys: Record<string, string[]> = {
  "": [
    "model",
    "requesters",
    "budget",
    "iterations",
    "paths",
    "flags",
    "telemetry",
    "telemetryEndpoint",
  ],
  budget: ["perRequestUsd", "monthlyUsd"],
  iterations: ["max"],
  paths: ["allowed", "blocked", "maxChangedLines"],
  flags: ["file", "removeAfterDays"],
};

function describeIssue(issue: z.core.$ZodIssue): string[] {
  const path = issue.path.filter((p) => typeof p === "string").join(".");

  if (issue.code === "unrecognized_keys") {
    const allowed = knownKeys[path] ?? [];
    return issue.keys.map((key) => {
      const where = path ? `${path}.${key}` : key;
      const guess = closest(key, allowed);
      return guess
        ? `Unknown key \`${where}\`. Did you mean \`${guess}\`?`
        : `Unknown key \`${where}\`. Remove it. Allowed here: ${allowed.join(", ")}.`;
    });
  }

  const example = examples[path];
  const fix = example ? ` Example: \`${example}\`` : "";
  return [`\`${path || "(root)"}\` ${issue.message.replace(/^Invalid input: /, "")}.${fix}`];
}

/** Closest candidate within an edit distance of 2, for "did you mean" hints. */
function closest(word: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const d = editDistance(word.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}
