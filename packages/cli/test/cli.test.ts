import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.ts";
import { showTelemetryNoticeOnce, TELEMETRY_NOTICE } from "../src/telemetry-notice.ts";
import { fixtureApp } from "./helpers.ts";

function capture() {
  const lines: string[] = [];
  return { lines, print: (line: string) => lines.push(line) };
}

/** Records telemetry posts instead of sending them. */
function telemetrySink() {
  const sent: { event: string; source: string }[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(null, { status: 204 });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

const stateDir = () => mkdtemp(join(tmpdir(), "totalmod-state-"));

describe("main", () => {
  it("prints usage for --help and fails on no or unknown commands", async () => {
    const out = capture();
    expect(await main(["--help"], { cwd: ".", env: {}, ...out })).toBe(0);
    expect(out.lines[0]).toContain("Usage: npx totalmod");
    expect(await main([], { cwd: ".", env: {}, ...out })).toBe(1);
    expect(await main(["deploy"], { cwd: ".", env: { DO_NOT_TRACK: "1" }, ...out })).toBe(1);
  });

  it("runs init then doctor end to end", async () => {
    const dir = await fixtureApp();
    const env = { TOTALMOD_STATE_DIR: await stateDir() };
    const out = capture();
    const sink = telemetrySink();

    expect(await main(["init", "--dir", dir], { cwd: ".", env, fetch: sink.fetch, ...out })).toBe(
      0,
    );
    expect(out.lines[0]).toBe(`${TELEMETRY_NOTICE}\n`);
    expect(out.lines).toContain("  created  totalmod.config.yaml");
    expect(out.lines).toContain("Next steps:");

    const doctorOut = capture();
    expect(await main(["doctor"], { cwd: dir, env, fetch: sink.fetch, ...doctorOut })).toBe(0);
    // first_run goes out once, with the notice, and never again on this machine.
    expect(sink.sent).toMatchObject([{ event: "first_run", source: "cli", props: {} }]);
    expect(doctorOut.lines).toContain("[ok  ] totalmod.config.yaml");
    expect(doctorOut.lines.join("\n")).not.toContain("telemetry:");
  });

  it("exits 1 with a readable message when init cannot run", async () => {
    const out = capture();
    const dir = await mkdtemp(join(tmpdir(), "totalmod-empty-"));
    expect(await main(["init"], { cwd: dir, env: { DO_NOT_TRACK: "1" }, ...out })).toBe(1);
    expect(out.lines).toEqual([
      `totalmod init: No package.json in ${dir}. Run this from your Next.js app's root.`,
    ]);
  });
});

describe("telemetry notice", () => {
  it("shows once, then records that it was shown", async () => {
    const env = { TOTALMOD_STATE_DIR: await stateDir() };
    const out = capture();
    const sink = telemetrySink();
    expect(await showTelemetryNoticeOnce(env, undefined, out.print, { fetch: sink.fetch })).toBe(
      true,
    );
    expect(await showTelemetryNoticeOnce(env, undefined, out.print, { fetch: sink.fetch })).toBe(
      false,
    );
    expect(out.lines).toHaveLength(1);
    expect(sink.sent.map((e) => e.event)).toEqual(["first_run"]);
    const marker = JSON.parse(
      await readFile(join(env.TOTALMOD_STATE_DIR, "telemetry.json"), "utf8"),
    );
    expect(marker.noticeShownAt).toEqual(expect.any(String));
  });

  it.each([
    ["DO_NOT_TRACK=1", { DO_NOT_TRACK: "1" }, undefined],
    ["DO_NOT_TRACK=true", { DO_NOT_TRACK: "true" }, undefined],
    ["telemetry: false", {}, false],
  ])("stays silent and writes nothing with %s", async (_, extraEnv, configTelemetry) => {
    const dir = await stateDir();
    const out = capture();
    const env = { TOTALMOD_STATE_DIR: dir, ...extraEnv };
    const sink = telemetrySink();
    expect(
      await showTelemetryNoticeOnce(env, configTelemetry, out.print, { fetch: sink.fetch }),
    ).toBe(false);
    expect(out.lines).toEqual([]);
    expect(sink.sent).toEqual([]);
    await expect(readFile(join(dir, "telemetry.json"))).rejects.toThrow();
  });
});
