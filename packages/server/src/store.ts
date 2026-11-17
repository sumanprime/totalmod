import type { RequestRecord } from "@totalmod/core";

/** A partial update; `undefined` clears an optional field (e.g. the preview URL on a new round). */
export type RequestPatch = { [K in keyof RequestRecord]?: RequestRecord[K] | undefined };

/**
 * Where requests live: the host app's own database (a `totalmod_requests` table). Raw request
 * text is stored here and nowhere else. Implement these methods for your database, or use
 * `memoryRequestStore` while trying things out.
 */
export interface RequestStore {
  create(record: RequestRecord): Promise<void>;
  get(id: string): Promise<RequestRecord | null>;
  update(id: string, patch: RequestPatch): Promise<RequestRecord>;
  /** Requests this user created at or after `since`, for rate limiting. */
  countSince(userId: string, since: Date): Promise<number>;
  /** This user's most recent requests, newest first, for the widget's status view. */
  latestByUser(userId: string, limit: number): Promise<RequestRecord[]>;
}

/** In-process store. Requests are lost on restart; fine for tests and a first try. */
export function memoryRequestStore(): RequestStore {
  const rows = new Map<string, RequestRecord>();
  return {
    async create(record) {
      rows.set(record.id, structuredClone(record));
    },
    async get(id) {
      const row = rows.get(id);
      return row ? structuredClone(row) : null;
    },
    async update(id, patch) {
      const row = rows.get(id);
      if (!row) throw new Error(`No request ${id}`);
      const next = JSON.parse(JSON.stringify({ ...row, ...patch })) as RequestRecord;
      rows.set(id, next);
      return structuredClone(next);
    },
    async countSince(userId, since) {
      return [...rows.values()].filter((r) => r.userId === userId && new Date(r.createdAt) >= since)
        .length;
    },
    async latestByUser(userId, limit) {
      return [...rows.values()]
        .filter((r) => r.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map((r) => structuredClone(r));
    },
  };
}
