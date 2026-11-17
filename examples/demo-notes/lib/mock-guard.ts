/** Env vars that point at a real database. Mock mode must never see them. */
const GUARDED = /^(DATABASE_URL|POSTGRES_\w+|PG(HOST|HOSTADDR|PORT|USER|PASSWORD|DATABASE))$/;

export class MockModeViolation extends Error {
  override name = "MockModeViolation";
}

const installed = Symbol.for("totalmod.mockGuard");

/**
 * Defence in depth for preview deployments. Their env scope should not contain DATABASE_URL at
 * all; if it does, this removes it and makes any later read throw, so mock-mode code can never
 * quietly connect to production.
 */
export function installMockGuard(): void {
  const env = process.env as NodeJS.ProcessEnv & { [installed]?: true };
  if (env[installed]) return;

  for (const key of Object.keys(env)) {
    if (GUARDED.test(key)) delete env[key];
  }

  process.env = new Proxy(env, {
    get(target, key, receiver) {
      if (key === installed) return true;
      if (typeof key === "string" && GUARDED.test(key)) {
        throw new MockModeViolation(
          `${key} was read in mock mode. Preview deployments must not have database credentials.`,
        );
      }
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value) {
      // Drop guarded values silently; reading them still throws.
      if (typeof key === "string" && GUARDED.test(key)) return true;
      return Reflect.set(target, key, value);
    },
  });
}
