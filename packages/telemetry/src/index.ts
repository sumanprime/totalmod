// Anonymous usage counts. What is sent is exactly the Payload below: an event name from a fixed
// list, an install id that can't be traced back to anyone, where it came from, the version, and
// numeric properties from an allowlist. Never request text, code, prompts, file paths or user ids.
import { createHmac, randomUUID } from "node:crypto";

export const EVENTS = [
  "first_run",
  "request_submitted",
  "preview_ready",
  "iteration",
  "merged",
  "ga",
  "rejected",
] as const;
export type TelemetryEvent = (typeof EVENTS)[number];

/** Numeric properties allowed per event. Anything else is dropped before sending. */
export const ALLOWED_PROPS: Record<TelemetryEvent, readonly string[]> = {
  first_run: [],
  request_submitted: ["questions"],
  preview_ready: ["iteration"],
  iteration: ["iteration"],
  merged: ["iterations"],
  ga: [],
  rejected: ["iterations"],
};

export const DEFAULT_TELEMETRY_ENDPOINT = "https://telemetry.totalmod.dev/v1/events";

export interface Payload {
  event: TelemetryEvent;
  installId: string;
  source: "cli" | "server";
  version: string;
  props: Record<string, number>;
}

export interface Telemetry {
  readonly enabled: boolean;
  /** Fire and forget: never throws, gives up after the timeout. */
  track(event: TelemetryEvent, props?: Record<string, number>): Promise<void>;
}

export interface TelemetryOptions {
  enabled: boolean;
  installId: string;
  source: Payload["source"];
  version: string;
  endpoint?: string | undefined;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** DO_NOT_TRACK=1/true or `telemetry: false` in the config turns everything off. */
export function telemetryDisabled(
  env: Record<string, string | undefined>,
  configTelemetry?: boolean,
): boolean {
  const dnt = env.DO_NOT_TRACK?.toLowerCase();
  return configTelemetry === false || dnt === "1" || dnt === "true";
}

/** For servers: stable per installation, not reversible without the app's own secret. */
export function installIdFrom(seed: string, secret: string): string {
  return createHmac("sha256", secret).update(`totalmod-install:${seed}`).digest("hex").slice(0, 32);
}

/** For the CLI: random, stored on the machine. */
export function randomInstallId(): string {
  return randomUUID().replaceAll("-", "");
}

export function buildPayload(
  options: Pick<TelemetryOptions, "installId" | "source" | "version">,
  event: TelemetryEvent,
  props: Record<string, number> = {},
): Payload {
  const allowed = new Set(ALLOWED_PROPS[event]);
  const clean = Object.fromEntries(
    Object.entries(props).filter(
      ([key, value]) => allowed.has(key) && Number.isFinite(value) && value >= 0 && value < 1e6,
    ),
  );
  return {
    event,
    installId: options.installId,
    source: options.source,
    version: options.version,
    props: clean,
  };
}

export function createTelemetry(options: TelemetryOptions): Telemetry {
  const doFetch = options.fetch ?? fetch;
  return {
    enabled: options.enabled,
    async track(event, props) {
      if (!options.enabled || !EVENTS.includes(event)) return;
      try {
        await doFetch(options.endpoint ?? DEFAULT_TELEMETRY_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildPayload(options, event, props)),
          signal: AbortSignal.timeout(options.timeoutMs ?? 1500),
        });
      } catch {
        // Telemetry must never break the product.
      }
    },
  };
}

/** A no-op, for tests and for when telemetry is off. */
export const noTelemetry: Telemetry = { enabled: false, track: async () => {} };
