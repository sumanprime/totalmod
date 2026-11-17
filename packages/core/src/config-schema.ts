import { z } from "zod";

/** Always blocked, whatever the config says: the agent never edits these. */
export const DEFAULT_BLOCKED_PATHS = [
  "**/auth/**",
  "**/billing/**",
  "**/migrations/**",
  ".env*",
  ".github/**",
];

const DEFAULT_ALLOWED_PATHS = ["app/**", "components/**", "lib/**"];

const usd = z.number().positive().max(10_000);

export const Config = z
  .strictObject({
    model: z.string().min(1).default("claude-sonnet-5-5"),
    requesters: z
      .union([z.enum(["all", "paying"]), z.array(z.string().min(1)).min(1)])
      .default("all"),
    budget: z
      .strictObject({
        perRequestUsd: usd.default(3),
        monthlyUsd: usd.default(100),
      })
      .prefault({}),
    iterations: z.strictObject({ max: z.number().int().min(1).max(10).default(3) }).prefault({}),
    paths: z
      .strictObject({
        allowed: z.array(z.string().min(1)).min(1).default(DEFAULT_ALLOWED_PATHS),
        blocked: z.array(z.string().min(1)).default([]),
        maxChangedLines: z.number().int().positive().default(600),
      })
      .prefault({}),
    flags: z
      .strictObject({
        file: z.string().min(1).default("flags/totalmod.flags.json"),
        removeAfterDays: z.number().int().positive().default(14),
      })
      .prefault({}),
    telemetry: z.boolean().default(true),
    /** Where anonymous counts go. Defaults to the totalmod project's receiver. */
    telemetryEndpoint: z.url().optional(),
  })
  .refine((c) => c.budget.perRequestUsd <= c.budget.monthlyUsd, {
    path: ["budget", "perRequestUsd"],
    message: "must not be larger than budget.monthlyUsd",
  })
  .transform((c) => ({
    ...c,
    paths: { ...c.paths, blocked: [...new Set([...DEFAULT_BLOCKED_PATHS, ...c.paths.blocked])] },
  }));

export type Config = z.output<typeof Config>;
export type ConfigInput = z.input<typeof Config>;
