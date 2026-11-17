import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_BLOCKED_PATHS,
  defaultConfig,
  loadConfig,
  parseConfig,
} from "../src/index.ts";

function problems(text: string): string[] {
  try {
    parseConfig(text);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("parseConfig", () => {
  it("fills every default from an empty file", () => {
    expect(parseConfig("")).toEqual(defaultConfig());
    expect(defaultConfig()).toEqual({
      model: "claude-sonnet-5-5",
      requesters: "all",
      budget: { perRequestUsd: 3, monthlyUsd: 100 },
      iterations: { max: 3 },
      paths: {
        allowed: ["app/**", "components/**", "lib/**"],
        blocked: DEFAULT_BLOCKED_PATHS,
        maxChangedLines: 600,
      },
      flags: { file: "flags/totalmod.flags.json", removeAfterDays: 14 },
      telemetry: true,
    });
  });

  it("accepts the example totalmod.config.yaml", async () => {
    const text = await readFile(join(import.meta.dirname, "../../../totalmod.config.yaml"), "utf8");
    const config = parseConfig(text);
    expect(config.budget.monthlyUsd).toBe(100);
    expect(config.paths.blocked).toEqual(DEFAULT_BLOCKED_PATHS);
  });

  it("keeps partial sections and fills the rest", () => {
    const config = parseConfig("budget:\n  monthlyUsd: 40\niterations: {}\n");
    expect(config.budget).toEqual({ perRequestUsd: 3, monthlyUsd: 40 });
    expect(config.iterations.max).toBe(3);
  });

  it("always blocks the default paths, adding the user's own", () => {
    const config = parseConfig('paths:\n  blocked: ["lib/payments/**", ".github/**"]\n');
    expect(config.paths.blocked).toEqual([...DEFAULT_BLOCKED_PATHS, "lib/payments/**"]);
  });

  it("accepts a list of requester ids", () => {
    expect(parseConfig("requesters: [u_1, u_2]\n").requesters).toEqual(["u_1", "u_2"]);
  });

  it("explains wrong types with an example fix", () => {
    expect(problems("budget:\n  perRequestUsd: three\n")).toEqual([
      "`budget.perRequestUsd` expected number, received string. Example: `perRequestUsd: 3`",
    ]);
    expect(problems("requesters: everyone\n")[0]).toMatch(
      /^`requesters` .*Example: `requesters: all {3}# or paying, or a list of user ids`$/,
    );
  });

  it("suggests the closest key for typos and lists keys otherwise", () => {
    expect(problems("budgte: {}\n")).toEqual(["Unknown key `budgte`. Did you mean `budget`?"]);
    expect(problems("paths:\n  alowed: []\n")).toEqual([
      "Unknown key `paths.alowed`. Did you mean `allowed`?",
    ]);
    expect(problems("colour: blue\n")[0]).toBe(
      "Unknown key `colour`. Remove it. Allowed here: model, requesters, budget, iterations, paths, flags, telemetry, telemetryEndpoint.",
    );
  });

  it("rejects out-of-range numbers and inconsistent budgets", () => {
    expect(problems("iterations:\n  max: 50\n")[0]).toMatch(/^`iterations.max` .*<=10/);
    expect(problems("budget:\n  perRequestUsd: 20\n  monthlyUsd: 10\n")).toEqual([
      "`budget.perRequestUsd` must not be larger than budget.monthlyUsd. Example: `perRequestUsd: 3`",
    ]);
  });

  it("reports YAML syntax errors and non-mapping files", () => {
    expect(problems("budget: [1, 2\n")[0]).toMatch(/^YAML syntax error: .*Check indentation/);
    expect(problems("- a\n- b\n")).toEqual([
      "The file must be a YAML mapping of `key: value` lines.",
    ]);
  });
});

describe("loadConfig", () => {
  it("tells you to run init when the file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "totalmod-core-"));
    await expect(loadConfig(dir)).rejects.toThrow(/Run `npx totalmod init`/);
  });

  it("reads totalmod.config.yaml from the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "totalmod-core-"));
    await writeFile(join(dir, "totalmod.config.yaml"), "telemetry: false\n");
    expect((await loadConfig(dir)).telemetry).toBe(false);
  });
});
