// isRequestEnabled: the one check the build agent wraps around every new feature.
import { join } from "node:path";
import { FlagdProvider } from "@openfeature/flagd-provider";
import { type Client, OpenFeature } from "@openfeature/server-sdk";
import { hashRequester, loadConfig } from "@totalmod/core";
import { flagKey } from "./file.ts";

export * from "./file.ts";

export interface FlagEvaluatorOptions {
  /** Path to the flags file. Defaults to TOTALMOD_FLAGS_FILE, else `flags.file` from the config. */
  flagsFile?: string;
  /** Hashes user ids for targeting. Defaults to TOTALMOD_PREVIEW_SECRET. */
  secret?: string;
  /** "mock" turns every request flag on (previews). Defaults to TOTALMOD_MODE. */
  mode?: string;
  /** OpenFeature domain; separate evaluators (e.g. in tests) need separate domains. */
  domain?: string;
}

export type FlagEvaluator = (userId: string, reqId: string) => Promise<boolean>;

/**
 * Builds an evaluator backed by OpenFeature and the flagd provider reading the flags file
 * in-process (no flag service). Unknown flags, a missing secret or any provider error mean off.
 */
export function createFlagEvaluator(options: FlagEvaluatorOptions = {}): FlagEvaluator {
  const mode = options.mode ?? process.env.TOTALMOD_MODE;
  let client: Promise<Client> | undefined;

  const getClient = () => {
    client ??= (async () => {
      const domain = options.domain ?? "totalmod";
      const path =
        options.flagsFile ?? process.env.TOTALMOD_FLAGS_FILE ?? (await defaultFlagsFile());
      await OpenFeature.setProviderAndWait(
        domain,
        new FlagdProvider({ resolverType: "in-process", offlineFlagSourcePath: path }),
      );
      return OpenFeature.getClient(domain);
    })();
    return client;
  };

  return async (userId, reqId) => {
    // Previews run on mock data only, so every request's code is on there.
    if (mode === "mock") return true;
    const secret = options.secret ?? process.env.TOTALMOD_PREVIEW_SECRET;
    if (!secret) return false;
    try {
      return await (await getClient()).getBooleanValue(flagKey(reqId), false, {
        targetingKey: hashRequester(userId, secret),
      });
    } catch {
      return false;
    }
  };
}

async function defaultFlagsFile(): Promise<string> {
  const config = await loadConfig(process.cwd()).catch(() => null);
  return join(process.cwd(), config?.flags.file ?? "flags/totalmod.flags.json");
}

let shared: FlagEvaluator | undefined;

/** Is request `reqId`'s feature on for this user? Off unless the flags file says so. */
export function isRequestEnabled(userId: string, reqId: string): Promise<boolean> {
  shared ??= createFlagEvaluator();
  return shared(userId, reqId);
}

/** Stops the flags-file watcher (tests, scripts). */
export async function closeFlags(): Promise<void> {
  shared = undefined;
  await OpenFeature.close();
}
