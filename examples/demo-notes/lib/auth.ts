// Demo auth adapter: sign in by name, session is an HMAC-signed user id in a cookie.
// Good enough for a demo, not for production. Real apps plug their own auth into totalmod.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "./db";
import { type User, users } from "./db/schema";
import { getMode } from "./mode";

const COOKIE = "demo_session";

function secret(): string {
  const value = process.env.DEMO_SESSION_SECRET;
  if (value) return value;
  if (getMode() === "mock") return "mock-mode-session-secret";
  throw new Error("DEMO_SESSION_SECRET is not set.");
}

function sign(userId: string): string {
  return createHmac("sha256", secret()).update(userId).digest("base64url");
}

export function sessionValue(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

/** Returns the user id from a cookie value, or null if it was tampered with. */
export function verifySession(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(userId));
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}

export async function getCurrentUser(): Promise<User | null> {
  const userId = verifySession((await cookies()).get(COOKIE)?.value);
  if (!userId) return null;
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  return user ?? null;
}

/** Finds the user with this name, or creates a free member, and starts a session. */
export async function signInByName(name: string): Promise<User> {
  const db = await getDb();
  const [existing] = await db.select().from(users).where(eq(users.name, name));
  const user =
    existing ?? (await db.insert(users).values({ id: randomUUID(), name }).returning())[0];
  if (!user) throw new Error("Could not create the user.");
  await startSession(user.id);
  return user;
}

export async function startSession(userId: string): Promise<void> {
  (await cookies()).set(COOKIE, sessionValue(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
