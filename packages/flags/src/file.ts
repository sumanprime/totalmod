// Pure edits to the flagd flags file (flags/totalmod.flags.json). The release workflow uses these;
// apps read the file through isRequestEnabled. Targeting uses hashed requester ids only.
import { REQUESTER_HASH, ReqId } from "@totalmod/core";

export const FLAGD_SCHEMA = "https://flagd.dev/schema/v0/flags.json";

export type Stage = "requester" | "rollout" | "ga" | "off";

interface FlagMetadata {
  totalmod: true;
  stage: Stage;
  requester: string;
  issue: number;
  pr: number;
  mergedAt: string;
  /** Rollout percentage while stage is "rollout". */
  percent?: number;
  gaAt?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface Flag {
  state: "ENABLED" | "DISABLED";
  variants: { on: true; off: false };
  defaultVariant: "on" | "off";
  targeting: Record<string, unknown>;
  metadata: FlagMetadata;
}

export interface FlagsFile {
  $schema?: string;
  flags: Record<string, Flag | Record<string, unknown>>;
}

export function flagKey(reqId: string): string {
  return `req-${ReqId.parse(reqId)}`;
}

export function emptyFlagsFile(): FlagsFile {
  return { $schema: FLAGD_SCHEMA, flags: {} };
}

export function parseFlagsFile(text: string): FlagsFile {
  const data = JSON.parse(text) as FlagsFile;
  if (typeof data?.flags !== "object" || data.flags === null || Array.isArray(data.flags)) {
    throw new Error('The flags file needs a top-level "flags" object.');
  }
  return data;
}

export function serializeFlagsFile(file: FlagsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** A totalmod-managed flag, or undefined (other flags in the file are left alone). */
export function getFlag(file: FlagsFile, reqId: string): Flag | undefined {
  const flag = file.flags[flagKey(reqId)] as Flag | undefined;
  return flag?.metadata?.totalmod ? flag : undefined;
}

const forRequester = (requester: string) => ({ in: [{ var: "targetingKey" }, [requester]] });

function update(file: FlagsFile, reqId: string, change: (flag: Flag) => Flag): FlagsFile {
  const flag = getFlag(file, reqId);
  if (!flag) throw new Error(`No totalmod flag for request ${reqId}.`);
  return { ...file, flags: { ...file.flags, [flagKey(reqId)]: change(flag) } };
}

/** On merge: the feature turns on for the person who asked for it, and nobody else. */
export function enableForRequester(
  file: FlagsFile,
  meta: { reqId: string; requester: string; issue: number; pr: number },
  now: Date,
): FlagsFile {
  if (!REQUESTER_HASH.test(meta.requester)) throw new Error("Requester must be a hashed id.");
  const flag: Flag = {
    state: "ENABLED",
    variants: { on: true, off: false },
    defaultVariant: "off",
    targeting: { if: [forRequester(meta.requester), "on", "off"] },
    metadata: {
      totalmod: true,
      stage: "requester",
      requester: meta.requester,
      issue: meta.issue,
      pr: meta.pr,
      mergedAt: now.toISOString(),
    },
  };
  return { ...file, flags: { ...file.flags, [flagKey(meta.reqId)]: flag } };
}

/** `totalmod:rollout-<n>`: the requester plus n% of everyone else, bucketed by hashed id. */
export function rollout(file: FlagsFile, reqId: string, percent: number): FlagsFile {
  if (!Number.isInteger(percent) || percent < 1 || percent > 99) {
    throw new Error("Rollout percent must be a whole number from 1 to 99.");
  }
  return update(file, reqId, (flag) => {
    const { gaAt: _, ...metadata } = flag.metadata;
    return {
      ...flag,
      state: "ENABLED",
      defaultVariant: "off",
      targeting: {
        if: [
          forRequester(flag.metadata.requester),
          "on",
          {
            fractional: [
              ["on", percent],
              ["off", 100 - percent],
            ],
          },
        ],
      },
      metadata: { ...metadata, stage: "rollout", percent },
    };
  });
}

/** `totalmod:ga`: on for everyone. Starts the clock for the flag-removal PR. */
export function enableForAll(file: FlagsFile, reqId: string, now: Date): FlagsFile {
  return update(file, reqId, (flag) => {
    const { percent: _, ...metadata } = flag.metadata;
    return {
      ...flag,
      state: "ENABLED",
      defaultVariant: "on",
      targeting: {},
      metadata: { ...metadata, stage: "ga", gaAt: now.toISOString() },
    };
  });
}

/** `totalmod:off`: kill switch, off for everyone including the requester. */
export function disable(file: FlagsFile, reqId: string): FlagsFile {
  return update(file, reqId, (flag) => {
    const { percent: _, gaAt: __, ...metadata } = flag.metadata;
    return {
      ...flag,
      defaultVariant: "off",
      targeting: {},
      metadata: { ...metadata, stage: "off" },
    };
  });
}

export function removeFlag(file: FlagsFile, reqId: string): FlagsFile {
  const { [flagKey(reqId)]: _, ...flags } = file.flags;
  return { ...file, flags };
}

/** Requests that have been GA for at least `days`, oldest first: time to remove the flag check. */
export function dueForRemoval(file: FlagsFile, days: number, now: Date): string[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return Object.entries(file.flags)
    .filter(([key, flag]) => {
      const meta = (flag as Flag).metadata;
      return key.startsWith("req-") && meta?.totalmod && meta.stage === "ga" && meta.gaAt;
    })
    .map(([key, flag]) => ({ reqId: key.slice(4), gaAt: (flag as Flag).metadata.gaAt as string }))
    .filter((f) => new Date(f.gaAt).getTime() <= cutoff)
    .sort((a, b) => a.gaAt.localeCompare(b.gaAt))
    .map((f) => f.reqId);
}
