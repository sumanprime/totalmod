// totalmod adapter for the demo: who is asking, and where requests are stored.
import { RequestRecord } from "@totalmod/core";
import type { Requester, RequestStore } from "@totalmod/server";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import { getDb } from "./db";
import { totalmodRequests } from "./db/schema";

export async function getRequester(): Promise<Requester | null> {
  const user = await getCurrentUser();
  return user ? { id: user.id, plan: user.plan, role: user.role } : null;
}

/** Keeps each request as one JSON row in the app's own Postgres (`totalmod_requests`). */
export const store: RequestStore = {
  async create(record) {
    const db = await getDb();
    await db.insert(totalmodRequests).values({
      id: record.id,
      userId: record.userId,
      status: record.status,
      data: record,
      createdAt: new Date(record.createdAt),
    });
  },

  async get(id) {
    const db = await getDb();
    const [row] = await db.select().from(totalmodRequests).where(eq(totalmodRequests.id, id));
    return row ? RequestRecord.parse(row.data) : null;
  },

  async update(id, patch) {
    const current = await this.get(id);
    if (!current) throw new Error(`No request ${id}`);
    const next = RequestRecord.parse({ ...current, ...patch });
    const db = await getDb();
    await db
      .update(totalmodRequests)
      .set({ status: next.status, data: next })
      .where(eq(totalmodRequests.id, id));
    return next;
  },

  async countSince(userId, since) {
    const db = await getDb();
    const [row] = await db
      .select({ n: count() })
      .from(totalmodRequests)
      .where(and(eq(totalmodRequests.userId, userId), gte(totalmodRequests.createdAt, since)));
    return row?.n ?? 0;
  },

  async latestByUser(userId, limit) {
    const db = await getDb();
    const rows = await db
      .select()
      .from(totalmodRequests)
      .where(eq(totalmodRequests.userId, userId))
      .orderBy(desc(totalmodRequests.createdAt))
      .limit(limit);
    return rows.map((row) => RequestRecord.parse(row.data));
  },
};
