import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashRequester } from "@totalmod/core";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFlags,
  createFlagEvaluator,
  disable,
  dueForRemoval,
  emptyFlagsFile,
  enableForAll,
  enableForRequester,
  type FlagsFile,
  getFlag,
  parseFlagsFile,
  removeFlag,
  rollout,
  serializeFlagsFile,
} from "../src/index.ts";

const SECRET = "preview-secret";
const REQ = "k3j9x2m1q8";
const requesterId = "user-42";
const meta = { reqId: REQ, requester: hashRequester(requesterId, SECRET), issue: 5, pr: 9 };
const merged = new Date("2026-10-01T12:00:00Z");

describe("flags file writer", () => {
  it("enables for the requester only, keeping other flags", () => {
    const start = { ...emptyFlagsFile(), flags: { "dark-mode": { state: "ENABLED" } } };
    const file = enableForRequester(start, meta, merged);
    expect(file.flags["dark-mode"]).toEqual({ state: "ENABLED" });
    expect(getFlag(file, REQ)).toEqual({
      state: "ENABLED",
      variants: { on: true, off: false },
      defaultVariant: "off",
      targeting: { if: [{ in: [{ var: "targetingKey" }, [meta.requester]] }, "on", "off"] },
      metadata: {
        totalmod: true,
        stage: "requester",
        requester: meta.requester,
        issue: 5,
        pr: 9,
        mergedAt: merged.toISOString(),
      },
    });
    expect(() => enableForRequester(start, { ...meta, requester: requesterId }, merged)).toThrow(
      /hashed/,
    );
  });

  it("moves through rollout, GA and off, and round-trips through JSON", () => {
    let file = enableForRequester(emptyFlagsFile(), meta, merged);
    file = rollout(file, REQ, 25);
    expect(getFlag(file, REQ)?.metadata).toMatchObject({ stage: "rollout", percent: 25 });
    file = enableForAll(file, REQ, new Date("2026-10-02T00:00:00Z"));
    expect(getFlag(file, REQ)).toMatchObject({ defaultVariant: "on", targeting: {} });
    expect(getFlag(file, REQ)?.metadata).not.toHaveProperty("percent");
    file = disable(file, REQ);
    expect(getFlag(file, REQ)?.metadata).toMatchObject({ stage: "off" });
    expect(getFlag(file, REQ)?.metadata).not.toHaveProperty("gaAt");
    expect(parseFlagsFile(serializeFlagsFile(file))).toEqual(file);
    expect(removeFlag(file, REQ).flags).toEqual({});
  });

  it("validates inputs", () => {
    const file = enableForRequester(emptyFlagsFile(), meta, merged);
    expect(() => rollout(file, REQ, 100)).toThrow(/1 to 99/);
    expect(() => enableForAll(file, "unknownreq1", merged)).toThrow(/No totalmod flag/);
    expect(() => parseFlagsFile('{"flags": []}')).toThrow(/"flags" object/);
  });

  it("lists GA flags due for removal, oldest first", () => {
    const now = new Date("2026-10-30T00:00:00Z");
    let file: FlagsFile = emptyFlagsFile();
    file = enableForAll(
      enableForRequester(file, { ...meta, reqId: "aaaaaaaa11" }, merged),
      "aaaaaaaa11",
      new Date("2026-10-15T00:00:00Z"),
    );
    file = enableForAll(
      enableForRequester(file, { ...meta, reqId: "bbbbbbbb22" }, merged),
      "bbbbbbbb22",
      new Date("2026-10-10T00:00:00Z"),
    );
    file = enableForAll(
      enableForRequester(file, { ...meta, reqId: "cccccccc33" }, merged),
      "cccccccc33",
      new Date("2026-10-25T00:00:00Z"),
    );
    file = enableForRequester(file, { ...meta, reqId: "dddddddd44" }, merged);
    expect(dueForRemoval(file, 14, now)).toEqual(["bbbbbbbb22", "aaaaaaaa11"]);
  });
});

/** Writes a flags file and evaluates it through the real OpenFeature + flagd provider. */
let domains = 0;
function evaluatorFor(file: FlagsFile, mode?: string) {
  const dir = mkdtempSync(join(tmpdir(), "totalmod-flags-"));
  const path = join(dir, "flags.json");
  writeFileSync(path, serializeFlagsFile(file));
  return createFlagEvaluator({
    flagsFile: path,
    secret: SECRET,
    mode: mode ?? "production",
    domain: `test-${domains++}`,
  });
}

describe("isRequestEnabled targeting (OpenFeature + flagd, file provider)", () => {
  afterAll(() => closeFlags());
  const users = Array.from({ length: 400 }, (_, i) => `user-${i}`);
  const count = async (enabled: (u: string, r: string) => Promise<boolean>) =>
    (await Promise.all(users.map((u) => enabled(u, REQ)))).filter(Boolean).length;

  it("is on only for the requester after merge", async () => {
    const enabled = evaluatorFor(enableForRequester(emptyFlagsFile(), meta, merged));
    expect(await enabled(requesterId, REQ)).toBe(true);
    expect(await count(enabled)).toBe(1); // user-42 is in the list
    expect(await enabled(requesterId, "unknownreq1")).toBe(false);
  });

  it("adds roughly the rollout share, always including the requester", async () => {
    const enabled = evaluatorFor(
      rollout(enableForRequester(emptyFlagsFile(), meta, merged), REQ, 25),
    );
    expect(await enabled(requesterId, REQ)).toBe(true);
    const on = await count(enabled);
    expect(on).toBeGreaterThan(400 * 0.15);
    expect(on).toBeLessThan(400 * 0.35);
  });

  it("is on for everyone at GA and off for everyone when switched off", async () => {
    const ga = enableForAll(enableForRequester(emptyFlagsFile(), meta, merged), REQ, merged);
    expect(await count(evaluatorFor(ga))).toBe(400);
    expect(await count(evaluatorFor(disable(ga, REQ)))).toBe(0);
  });

  it("is on in mock mode and off without a secret", async () => {
    expect(await evaluatorFor(emptyFlagsFile(), "mock")(requesterId, REQ)).toBe(true);
    const noSecret = createFlagEvaluator({
      flagsFile: "/nope.json",
      secret: "",
      mode: "production",
    });
    expect(await noSecret(requesterId, REQ)).toBe(false);
  });
});
