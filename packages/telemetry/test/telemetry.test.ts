import { describe, expect, it } from "vitest";
import {
  buildPayload,
  createTelemetry,
  DEFAULT_TELEMETRY_ENDPOINT,
  installIdFrom,
  randomInstallId,
  telemetryDisabled,
} from "../src/index.ts";

function recorder() {
  const sent: { url: string; body: unknown }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 204 });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

const base = { installId: "abc", source: "server" as const, version: "0.1.0" };

describe("disabled paths", () => {
  it.each([
    [{ DO_NOT_TRACK: "1" }, undefined, true],
    [{ DO_NOT_TRACK: "TRUE" }, undefined, true],
    [{}, false, true],
    [{ DO_NOT_TRACK: "0" }, true, false],
    [{}, undefined, false],
  ])("env %o, config %o -> disabled %o", (env, config, disabled) => {
    expect(telemetryDisabled(env, config)).toBe(disabled);
  });

  it("sends nothing when disabled", async () => {
    const r = recorder();
    const telemetry = createTelemetry({ ...base, enabled: false, fetch: r.fetch });
    await telemetry.track("request_submitted");
    expect(r.sent).toEqual([]);
  });
});

describe("what is sent", () => {
  it("sends only the event, ids and allowlisted numeric props", async () => {
    const r = recorder();
    const telemetry = createTelemetry({ ...base, enabled: true, fetch: r.fetch });
    await telemetry.track("iteration", {
      iteration: 2,
      text: "make it grey" as unknown as number,
      path: 3,
      negative: -1,
    });
    expect(r.sent).toEqual([
      {
        url: DEFAULT_TELEMETRY_ENDPOINT,
        body: {
          event: "iteration",
          installId: "abc",
          source: "server",
          version: "0.1.0",
          props: { iteration: 2 },
        },
      },
    ]);
  });

  it("drops unknown events and keeps working when the endpoint is down", async () => {
    const r = recorder();
    await createTelemetry({ ...base, enabled: true, fetch: r.fetch }).track(
      "password_reset" as never,
    );
    expect(r.sent).toEqual([]);
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(
      createTelemetry({ ...base, enabled: true, fetch: down }).track("ga"),
    ).resolves.toBeUndefined();
  });

  it("uses the configured endpoint", async () => {
    const r = recorder();
    await createTelemetry({
      ...base,
      enabled: true,
      fetch: r.fetch,
      endpoint: "https://t.example/e",
    }).track("ga");
    expect(r.sent[0]?.url).toBe("https://t.example/e");
  });

  it("filters props per event", () => {
    expect(buildPayload(base, "ga", { iteration: 1 }).props).toEqual({});
  });
});

describe("install ids", () => {
  it("are stable per secret, unlinkable without it, and random for the CLI", () => {
    expect(installIdFrom("acme/app", "s1")).toBe(installIdFrom("acme/app", "s1"));
    expect(installIdFrom("acme/app", "s1")).not.toBe(installIdFrom("acme/app", "s2"));
    expect(installIdFrom("acme/app", "s1")).toMatch(/^[0-9a-f]{32}$/);
    expect(randomInstallId()).toMatch(/^[0-9a-f]{32}$/);
    expect(randomInstallId()).not.toBe(randomInstallId());
  });
});
