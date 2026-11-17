// Receives totalmod's anonymous counts and serves the "built by a user" badge.
// Stores only what the payload carries after strict validation, in Workers Analytics Engine:
// no IP addresses, no user agents, no free text.

export interface Env {
  EVENTS: AnalyticsEngineDataset;
  BADGES: AnalyticsEngineDataset;
}

/** Keep in sync with EVENTS and ALLOWED_PROPS in @totalmod/telemetry. */
const ALLOWED_PROPS: Record<string, readonly string[]> = {
  first_run: [],
  request_submitted: ["questions"],
  preview_ready: ["iteration"],
  iteration: ["iteration"],
  merged: ["iterations"],
  ga: [],
  rejected: ["iterations"],
};
const PROP_ORDER = ["questions", "iteration", "iterations"] as const;
const MAX_BODY = 2048;

interface ValidEvent {
  event: string;
  installId: string;
  source: "cli" | "server";
  version: string;
  props: Record<string, number>;
}

/** Returns the event when every field is exactly what the client sends, otherwise null. */
export function validate(body: unknown): ValidEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const { event, installId, source, version, props, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) return null;
  if (typeof event !== "string" || !(event in ALLOWED_PROPS)) return null;
  if (typeof installId !== "string" || !/^[0-9a-f]{32}$/.test(installId)) return null;
  if (source !== "cli" && source !== "server") return null;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(-[0-9a-z.]+)?$/.test(version)) return null;
  if (typeof props !== "object" || props === null) return null;
  const allowed = ALLOWED_PROPS[event] ?? [];
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!allowed.includes(key) || typeof value !== "number" || !Number.isFinite(value)) return null;
    if (value < 0 || value >= 1e6) return null;
    clean[key] = value;
  }
  return { event, installId, source, version, props: clean };
}

export const BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="20" role="img" aria-label="built by: a user"><title>built by: a user</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="128" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="55" height="20" fill="#555"/><rect x="55" width="73" height="20" fill="#2f5bea"/><rect width="128" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="27.5" y="14">built by</text><text x="90.5" y="14">a user ✦</text></g></svg>`;

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/v1/events") {
    const text = await request.text();
    if (text.length > MAX_BODY) return new Response("Too large", { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }
    const event = validate(body);
    if (!event) return new Response("Invalid event", { status: 400 });
    env.EVENTS.writeDataPoint({
      indexes: [event.installId],
      blobs: [event.event, event.source, event.version],
      doubles: [1, ...PROP_ORDER.map((key) => event.props[key] ?? 0)],
    });
    return new Response(null, { status: 204 });
  }

  if (request.method === "GET" && url.pathname === "/badge/built-by-a-user.svg") {
    env.BADGES.writeDataPoint({
      indexes: ["built-by-a-user"],
      blobs: ["built-by-a-user"],
      doubles: [1],
    });
    return new Response(BADGE_SVG, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        // Every view is a hit: GitHub's image proxy and browsers must not cache it.
        "cache-control": "no-cache, no-store, must-revalidate",
      },
    });
  }

  return new Response("Not found", { status: 404 });
}

export default { fetch: handle } satisfies ExportedHandler<Env>;
