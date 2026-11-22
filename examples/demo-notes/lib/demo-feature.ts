// The scripted demo's "built" feature: a word count under each note. Every scripted request
// becomes this spec (lib/scripted-answers.ts), and the simulated build writes no code, so the
// feature is already in the app behind this switch. Off unless DEMO_SCRIPTED=1:
//   - Mock mode (the preview the "Try it" link opens): on, styled for the latest fix round.
//   - Production: on for a user once their own request is merged, read from totalmod_requests.
import { and, desc, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "./db";
import { totalmodRequests, type User } from "./db/schema";
import { getMode, isScriptedDemo } from "./mode";

/** Set by the preview route from the fix-round number in the try-it link's path. */
export const ROUND_COOKIE = "demo_round";

export interface WordCountFeature {
  /** Fix rounds behind this build. From round 1 on, the count is smaller and grey. */
  round: number;
}

export function parseRound(value: string | undefined): number {
  const round = Number(value);
  return Number.isInteger(round) && round >= 0 && round <= 100 ? round : 0;
}

export async function wordCountFeature(user: User): Promise<WordCountFeature | null> {
  // Outside the scripted demo a built request is real code, not this feature.
  if (!isScriptedDemo()) return null;
  if (getMode() === "mock") {
    return { round: parseRound((await cookies()).get(ROUND_COOKIE)?.value) };
  }
  // Turns on for the requester first: only after their own request reached the merge.
  const db = await getDb();
  const [row] = await db
    .select({ data: totalmodRequests.data })
    .from(totalmodRequests)
    .where(
      and(eq(totalmodRequests.userId, user.id), inArray(totalmodRequests.status, ["merged", "ga"])),
    )
    .orderBy(desc(totalmodRequests.createdAt))
    .limit(1);
  return row ? { round: row.data.iteration } : null;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** A few notes so the word count has something to show, one of them empty. Newest last. */
export function sampleNotes(userId: string) {
  return [
    { userId, title: "Empty note", body: "" },
    { userId, title: "Groceries", body: "Milk, eggs, bread and coffee." },
    {
      userId,
      title: "Welcome to the demo",
      body: "Ask for any feature here. In this demo, every request becomes a word count.",
    },
  ];
}
