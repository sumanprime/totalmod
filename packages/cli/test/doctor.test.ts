import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { doctor } from "../src/doctor.ts";
import { init } from "../src/init.ts";
import { fixtureApp } from "./helpers.ts";

const vercelEnv = { VERCEL_TOKEN: "test-token", VERCEL_PROJECT_ID: "prj_123" };

function vercelReturning(envs: object[], seen: string[] = []) {
  return (async (url: URL) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ envs }), { status: 200 });
  }) as unknown as typeof fetch;
}

const okPreview = [
  { key: "TOTALMOD_MODE", target: ["preview"], type: "plain", value: "mock" },
  { key: "TOTALMOD_PREVIEW_SECRET", target: ["preview"], type: "encrypted" },
  { key: "NEXT_PUBLIC_APP_NAME", target: ["preview", "production"], type: "plain" },
  { key: "DATABASE_URL", target: ["production"], type: "encrypted" },
];

async function initializedApp() {
  const dir = await fixtureApp();
  await init(dir);
  return dir;
}

const byName = (checks: Awaited<ReturnType<typeof doctor>>, name: string) =>
  checks.find((c) => c.name === name);

describe("doctor", () => {
  it("passes on a freshly initialized app and skips Vercel without a token", async () => {
    const checks = await doctor(await initializedApp(), { env: {} });
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(byName(checks, "Vercel preview env")?.status).toBe("skip");
    expect(byName(checks, "Secrets to set")?.details.join(" ")).toContain("ANTHROPIC_API_KEY");
  });

  it("reports config problems with a fix", async () => {
    const dir = await initializedApp();
    await writeFile(join(dir, "totalmod.config.yaml"), "budgte:\n  monthlyUsd: 10\n");
    const config = byName(await doctor(dir, { env: {} }), "totalmod.config.yaml");
    expect(config?.status).toBe("fail");
    expect(config?.details).toEqual(["Unknown key `budgte`. Did you mean `budget`?"]);
  });

  it("fails when the build workflow or flags file is missing", async () => {
    const checks = await doctor(await fixtureApp(), { env: {} });
    expect(byName(checks, "totalmod.config.yaml")?.status).toBe("fail");
    expect(byName(checks, "Build workflow")?.status).toBe("fail");
  });

  it("passes a clean Vercel preview scope and ignores production-only vars", async () => {
    const seen: string[] = [];
    const checks = await doctor(await initializedApp(), {
      env: { ...vercelEnv, VERCEL_TEAM_ID: "team_9" },
      fetch: vercelReturning(okPreview, seen),
    });
    expect(byName(checks, "Vercel preview env")?.status).toBe("pass");
    expect(seen).toEqual(["https://api.vercel.com/v10/projects/prj_123/env?teamId=team_9"]);
  });

  it("fails when production-looking vars reach Preview", async () => {
    const leaked = [
      ...okPreview,
      { key: "DATABASE_URL", target: ["preview"], type: "encrypted" },
      { key: "STRIPE_SECRET_KEY", target: "preview", type: "encrypted" },
      { key: "TOTALMOD_GITHUB_TOKEN", target: ["preview"], type: "encrypted" },
    ];
    const check = byName(
      await doctor(await initializedApp(), { env: vercelEnv, fetch: vercelReturning(leaked) }),
      "Vercel preview env",
    );
    expect(check?.status).toBe("fail");
    expect(check?.details).toEqual([
      "DATABASE_URL looks like a production credential. Remove it from the Preview scope.",
      "STRIPE_SECRET_KEY looks like a production credential. Remove it from the Preview scope.",
      "TOTALMOD_GITHUB_TOKEN looks like a production credential. Remove it from the Preview scope.",
    ]);
  });

  it("fails without mock mode and warns on unknown vars", async () => {
    const dir = await initializedApp();
    const wrongMode = [
      { key: "TOTALMOD_MODE", target: ["preview"], type: "plain", value: "production" },
    ];
    const failed = byName(
      await doctor(dir, { env: vercelEnv, fetch: vercelReturning(wrongMode) }),
      "Vercel preview env",
    );
    expect(failed?.details).toEqual([
      "TOTALMOD_PREVIEW_SECRET is missing from Preview.",
      'TOTALMOD_MODE is "production" in Preview; it must be "mock".',
    ]);

    const extra = [...okPreview, { key: "FEATURE_COLOR", target: ["preview"], type: "plain" }];
    const warned = byName(
      await doctor(dir, { env: vercelEnv, fetch: vercelReturning(extra) }),
      "Vercel preview env",
    );
    expect(warned?.status).toBe("warn");
  });

  it("fails when the webhook secret or GitHub token reaches Preview", async () => {
    const leaked = [
      ...okPreview,
      { key: "TOTALMOD_WEBHOOK_SECRET", target: ["preview", "production"], type: "encrypted" },
    ];
    const check = byName(
      await doctor(await initializedApp(), { env: vercelEnv, fetch: vercelReturning(leaked) }),
      "Vercel preview env",
    );
    expect(check?.details).toEqual([
      "TOTALMOD_WEBHOOK_SECRET looks like a production credential. Remove it from the Preview scope.",
    ]);
  });
});
