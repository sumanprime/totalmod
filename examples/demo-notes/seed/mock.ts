// Mock data for preview deployments (TOTALMOD_MODE=mock). Shaped like real users: one per plan
// and role, with note counts from a new free user up to a heavy team admin.
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../lib/db/schema";

export const mockUsers = [
  { id: "mock-free-new", name: "Sam Okafor", plan: "free", role: "member", noteCount: 2 },
  { id: "mock-free-member", name: "Linh Tran", plan: "free", role: "member", noteCount: 14 },
  { id: "mock-pro-member", name: "Ada Lovelace", plan: "pro", role: "member", noteCount: 48 },
  { id: "mock-team-admin", name: "Grace Hopper", plan: "team", role: "admin", noteCount: 120 },
] as const;

const topics = [
  "Standup notes",
  "Groceries",
  "Book ideas",
  "Release checklist",
  "Interview questions",
  "Trip packing list",
  "Quarterly goals",
  "Bug triage",
  "Recipe: dal",
  "Reading list",
];

const sentences = [
  "Follow up with the design team before Friday.",
  "Remember to compare the two pricing options.",
  "The draft is ready for a second pass.",
  "Ask about the deadline on the next call.",
  "Move the unfinished items to next week.",
  "Keep this short; nobody reads long notes.",
  "Check the numbers against last month.",
  "Write the summary in plain words.",
];

/** Small deterministic PRNG so every preview gets the same data. */
function random(seedValue: number) {
  let s = seedValue;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seed(db: PgDatabase<PgQueryResultHKT, typeof schema>): Promise<void> {
  const next = random(42);
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)] as T;
  const day = 24 * 60 * 60 * 1000;
  const start = Date.UTC(2026, 0, 1);

  await db.insert(schema.users).values(mockUsers.map(({ noteCount: _, ...user }) => user));

  const rows = mockUsers.flatMap((user) =>
    Array.from({ length: user.noteCount }, (_, i) => {
      const createdAt = new Date(start + Math.floor(next() * 280) * day);
      return {
        userId: user.id,
        title: `${pick(topics)} #${i + 1}`,
        body: Array.from({ length: 1 + Math.floor(next() * 4) }, () => pick(sentences)).join(" "),
        createdAt,
        updatedAt: new Date(createdAt.getTime() + Math.floor(next() * 5) * day),
      };
    }),
  );
  await db.insert(schema.notes).values(rows);
}
