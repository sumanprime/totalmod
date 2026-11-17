import { describe, expect, it } from "vitest";
import { sessionValue, verifySession } from "../lib/auth";
import { createProductionDb } from "../lib/db";
import { getMode } from "../lib/mode";

describe("production mode", () => {
  it("is the default and rejects unknown modes", () => {
    delete process.env.TOTALMOD_MODE;
    expect(getMode()).toBe("production");
    process.env.TOTALMOD_MODE = "staging";
    expect(() => getMode()).toThrow(/must be "mock" or "production"/);
    process.env.TOTALMOD_MODE = "production";
  });

  it("needs DATABASE_URL and says how to fix it", async () => {
    delete process.env.DATABASE_URL;
    await expect(createProductionDb()).rejects.toThrow(/DATABASE_URL is not set/);
  });

  it("accepts its own session cookie and rejects tampered ones", () => {
    process.env.DEMO_SESSION_SECRET = "test-secret";
    const value = sessionValue("user-1");
    expect(verifySession(value)).toBe("user-1");
    expect(verifySession(value.replace("user-1", "user-2"))).toBeNull();
    expect(verifySession("user-1.forged")).toBeNull();
    expect(verifySession(undefined)).toBeNull();
  });
});
