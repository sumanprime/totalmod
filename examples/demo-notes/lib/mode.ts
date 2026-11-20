export type Mode = "mock" | "production";

/**
 * `TOTALMOD_MODE=mock` on preview deployments; anything else unset or "production".
 * Mock mode never touches production data: see lib/mock-guard.ts.
 */
export function getMode(): Mode {
  const mode = process.env.TOTALMOD_MODE;
  if (mode === undefined || mode === "" || mode === "production") return "production";
  if (mode === "mock") return "mock";
  throw new Error(`TOTALMOD_MODE must be "mock" or "production", got "${mode}".`);
}

/** The hosted demo: Claude, GitHub and the build are simulated (see lib/scripted-demo.ts). */
export function isScriptedDemo(): boolean {
  return process.env.DEMO_SCRIPTED === "1";
}
