import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.ts";
import { copyDemoApp, DEMO_NAME, prepareDemo, serverEnvs } from "../src/demo.ts";
import { fileTree } from "./helpers.ts";

const demoNotes = join(import.meta.dirname, "../../../examples/demo-notes");
const temp = () => mkdtemp(join(tmpdir(), "totalmod-demo-"));

describe("copyDemoApp", () => {
  it("copies the app without tests or tooling, pinned to this release", async () => {
    const dir = await temp();
    await copyDemoApp(demoNotes, dir, "9.9.9");
    const files = await fileTree(dir);
    expect(files).toContain("lib/scripted-demo.ts");
    expect(files).toContain("app/api/totalmod/[...totalmod]/route.ts");
    expect(files).toContain("totalmod.config.yaml");
    expect(files.some((f) => f.startsWith("migrations/"))).toBe(true);
    for (const skipped of ["e2e/", "test/", "node_modules/", ".next/", "scripts/"]) {
      expect(files.some((f) => f.startsWith(skipped))).toBe(false);
    }
    expect(files).not.toContain("ecosystem.config.cjs");

    const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(manifest.name).toBe(DEMO_NAME);
    expect(manifest.dependencies["@totalmod/server"]).toBe("9.9.9");
    expect(JSON.stringify(manifest)).not.toContain("workspace:");
    expect(Object.keys(manifest.devDependencies).sort()).toEqual([
      "@types/node",
      "@types/react",
      "@types/react-dom",
      "typescript",
    ]);
  });
});

describe("prepareDemo", () => {
  it("creates the app once, then reuses it", async () => {
    const dir = join(await temp(), "totalmod-demo");
    expect(await prepareDemo(dir, "9.9.9")).toBe("created");
    expect(await prepareDemo(dir, "9.9.9")).toBe("reused");
  });

  it("refuses a folder that holds something else", async () => {
    const other = await temp();
    await writeFile(join(other, "package.json"), '{"name":"my-app"}');
    await expect(prepareDemo(other, "9.9.9")).rejects.toThrow("isn't a totalmod demo");

    const busy = await temp();
    await mkdir(join(busy, "src"));
    await expect(prepareDemo(busy, "9.9.9")).rejects.toThrow("is not empty");
  });
});

describe("serverEnvs", () => {
  it("passes none of the caller's credentials and shares one preview secret", () => {
    const envs = serverEnvs(
      {
        PATH: "/bin",
        HOME: "/home/me",
        DATABASE_URL: "postgres://prod",
        ANTHROPIC_API_KEY: "sk-real",
        TOTALMOD_GITHUB_TOKEN: "ghp_real",
      },
      { app: 3000, preview: 3001 },
    );
    for (const env of [envs.app, envs.preview]) {
      expect(env.PATH).toBe("/bin");
      expect(env).not.toHaveProperty("DATABASE_URL");
      expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
      expect(env).not.toHaveProperty("TOTALMOD_GITHUB_TOKEN");
      expect(env.DO_NOT_TRACK).toBe("1");
      expect(env.DEMO_SCRIPTED).toBe("1");
    }
    expect(envs.app.TOTALMOD_MODE).toBe("production");
    expect(envs.preview.TOTALMOD_MODE).toBe("mock");
    expect(envs.app.TOTALMOD_PREVIEW_SECRET).toBe(envs.preview.TOTALMOD_PREVIEW_SECRET);
    expect(envs.app.TOTALMOD_PREVIEW_SECRET).toHaveLength(64);
    expect(envs.app.DEMO_PREVIEW_URL).toBe("http://127.0.0.1:3001");
    expect(envs.preview).not.toHaveProperty("DEMO_SESSION_SECRET");
  });
});

describe("totalmod demo", () => {
  it("runs in ./totalmod-demo by default and checks --port", async () => {
    const lines: string[] = [];
    const calls: { dir: string; port: number }[] = [];
    const ctx = {
      cwd: "/work",
      env: { DO_NOT_TRACK: "1" },
      print: (line: string) => lines.push(line),
      runDemo: async (dir: string, options: { port: number }) => {
        calls.push({ dir, port: options.port });
        return 0;
      },
    };
    expect(await main(["demo"], ctx)).toBe(0);
    expect(await main(["demo", "--dir", "trial", "--port", "4000"], ctx)).toBe(0);
    expect(calls).toEqual([
      { dir: join("/work", "totalmod-demo"), port: 3000 },
      { dir: join("/work", "trial"), port: 4000 },
    ]);
    expect(await main(["demo", "--port", "web"], ctx)).toBe(1);
    expect(lines.at(-1)).toContain("--port must be a number");
  });
});
