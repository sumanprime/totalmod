import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "@totalmod/core";
import { describe, expect, it } from "vitest";
import { init } from "../src/init.ts";
import { fileTree, fixtureApp } from "./helpers.ts";

describe("init", () => {
  it("adds totalmod to a Next.js App Router app", async () => {
    const dir = await fixtureApp();
    const result = await init(dir);

    expect(await fileTree(dir)).toMatchSnapshot();
    expect(result.skipped).toEqual([]);
    expect(result.nextSteps[0]).toContain("npm install @totalmod/server @totalmod/widget");

    // What init writes must pass the same validation doctor and CI use.
    const config = await loadConfig(dir);
    expect(config.paths.allowed).toEqual(["app/**", "components/**", "lib/**"]);
    const flags = JSON.parse(await readFile(join(dir, "flags/totalmod.flags.json"), "utf8"));
    expect(flags.flags).toEqual({});
  });

  it("puts app files under src/ when the app uses src/app", async () => {
    const dir = await fixtureApp({ src: true });
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const result = await init(dir);

    expect(await fileTree(dir)).toMatchSnapshot();
    expect((await loadConfig(dir)).paths.allowed).toEqual([
      "src/app/**",
      "src/components/**",
      "src/lib/**",
    ]);
    expect(result.nextSteps[0]).toContain("pnpm add");
  });

  it("keeps existing files unless --force", async () => {
    const dir = await fixtureApp();
    await writeFile(join(dir, "totalmod.config.yaml"), "telemetry: false\n");

    const first = await init(dir);
    expect(first.skipped).toEqual(["totalmod.config.yaml"]);
    expect(await readFile(join(dir, "totalmod.config.yaml"), "utf8")).toBe("telemetry: false\n");

    const again = await init(dir);
    expect(again.created).toEqual([]);

    const forced = await init(dir, { force: true });
    expect(forced.skipped).toEqual([]);
    expect(await readFile(join(dir, "totalmod.config.yaml"), "utf8")).toContain("model:");
  });

  it("rejects apps that are not Next.js App Router", async () => {
    const pagesOnly = await fixtureApp();
    await rm(join(pagesOnly, "app"), { recursive: true });
    await mkdir(join(pagesOnly, "pages"));
    await expect(init(pagesOnly)).rejects.toThrow(/Pages Router/);

    const notNext = await fixtureApp();
    await writeFile(join(notNext, "package.json"), JSON.stringify({ dependencies: { vite: "8" } }));
    await expect(init(notNext)).rejects.toThrow(/`next` is not a dependency/);

    const noPackage = await fixtureApp();
    await rm(join(noPackage, "package.json"));
    await expect(init(noPackage)).rejects.toThrow(/No package.json/);
  });
});
