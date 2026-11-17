import { describe, expect, it } from "vitest";
import { buildPayload, EVENTS } from "../../../packages/telemetry/src/index.ts";
import { BADGE_SVG, type Env, handle, validate } from "../src/index.ts";

function env() {
  const points: { dataset: string; point: AnalyticsEngineDataPoint }[] = [];
  const dataset = (name: string) =>
    ({
      writeDataPoint: (point: AnalyticsEngineDataPoint) => points.push({ dataset: name, point }),
    }) as AnalyticsEngineDataset;
  return { points, env: { EVENTS: dataset("events"), BADGES: dataset("badges") } satisfies Env };
}

const client = { installId: "a".repeat(32), source: "server" as const, version: "0.1.0" };
const post = (body: unknown) =>
  new Request("https://t.example/v1/events", { method: "POST", body: JSON.stringify(body) });

describe("events", () => {
  it("accepts exactly what @totalmod/telemetry sends, for every event", () => {
    for (const event of EVENTS) {
      expect(
        validate(buildPayload(client, event, { iteration: 1, iterations: 2, questions: 3 })),
      ).not.toBeNull();
    }
  });

  it("stores counts and props, nothing else", async () => {
    const t = env();
    const res = await handle(post(buildPayload(client, "iteration", { iteration: 2 })), t.env);
    expect(res.status).toBe(204);
    expect(t.points).toEqual([
      {
        dataset: "events",
        point: {
          indexes: [client.installId],
          blobs: ["iteration", "server", "0.1.0"],
          doubles: [1, 0, 2, 0],
        },
      },
    ]);
  });

  it.each([
    ["unknown event", { ...buildPayload(client, "ga"), event: "signup" }],
    ["extra field", { ...buildPayload(client, "ga"), email: "x@y.z" }],
    [
      "text in props",
      { ...buildPayload(client, "iteration"), props: { iteration: "make it grey" } },
    ],
    ["prop not allowed for the event", { ...buildPayload(client, "ga"), props: { iteration: 1 } }],
    ["bad install id", { ...buildPayload(client, "ga"), installId: "user@example.com" }],
    ["bad version", { ...buildPayload(client, "ga"), version: "<script>" }],
  ])("rejects %s and stores nothing", async (_, body) => {
    const t = env();
    expect((await handle(post(body), t.env)).status).toBe(400);
    expect(t.points).toEqual([]);
  });

  it("rejects oversized and non-JSON bodies", async () => {
    const t = env();
    const big = new Request("https://t.example/v1/events", {
      method: "POST",
      body: "x".repeat(3000),
    });
    expect((await handle(big, t.env)).status).toBe(413);
    const bad = new Request("https://t.example/v1/events", { method: "POST", body: "{" });
    expect((await handle(bad, t.env)).status).toBe(400);
  });
});

describe("badge", () => {
  it("serves an uncached SVG and counts the hit", async () => {
    const t = env();
    const res = await handle(new Request("https://t.example/badge/built-by-a-user.svg"), t.env);
    expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.text()).toBe(BADGE_SVG);
    expect(t.points).toEqual([
      {
        dataset: "badges",
        point: { indexes: ["built-by-a-user"], blobs: ["built-by-a-user"], doubles: [1] },
      },
    ]);
  });

  it("404s everything else", async () => {
    expect((await handle(new Request("https://t.example/"), env().env)).status).toBe(404);
  });
});
