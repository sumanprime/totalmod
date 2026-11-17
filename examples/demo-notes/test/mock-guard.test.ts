// The M2 guard: in mock mode, reading DATABASE_URL or connecting to a non-PGlite DB throws.
import { count } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createProductionDb, getDb } from "../lib/db";
import { notes, users } from "../lib/db/schema";
import { MockModeViolation } from "../lib/mock-guard";
import { mockUsers } from "../seed/mock";

beforeAll(() => {
  // Simulate a misconfigured preview: mock mode, but production credentials leaked in.
  process.env.TOTALMOD_MODE = "mock";
  process.env.DATABASE_URL = "postgres://prod-user:prod-pass@prod.example.com:5432/app";
  process.env.POSTGRES_URL_NON_POOLING = "postgres://prod.example.com/app";
  process.env.PGPASSWORD = "prod-pass";
});

describe("mock mode", () => {
  it("boots PGlite with the real migrations and the mock seed", async () => {
    const db = await getDb();
    const [userCount] = await db.select({ n: count() }).from(users);
    const [noteCount] = await db.select({ n: count() }).from(notes);
    expect(userCount?.n).toBe(mockUsers.length);
    expect(noteCount?.n).toBe(mockUsers.reduce((sum, u) => sum + u.noteCount, 0));
  });

  it("throws on any read of database credentials", () => {
    expect(() => process.env.DATABASE_URL).toThrow(MockModeViolation);
    expect(() => process.env.POSTGRES_URL_NON_POOLING).toThrow(/read in mock mode/);
    expect(() => process.env.PGPASSWORD).toThrow(MockModeViolation);
    expect("DATABASE_URL" in process.env).toBe(false);
    expect(JSON.stringify(process.env)).not.toContain("prod-pass");
  });

  it("still throws after something tries to set DATABASE_URL again", () => {
    process.env.DATABASE_URL = "postgres://prod.example.com/app";
    expect(() => process.env.DATABASE_URL).toThrow(MockModeViolation);
  });

  it("leaves other env vars alone", () => {
    process.env.FEATURE_COLOR = "blue";
    expect(process.env.FEATURE_COLOR).toBe("blue");
    expect(process.env.TOTALMOD_MODE).toBe("mock");
  });

  it("refuses to create a Postgres connection", async () => {
    await expect(createProductionDb()).rejects.toThrow(
      "Refusing to connect to a non-PGlite database in mock mode.",
    );
  });
});
