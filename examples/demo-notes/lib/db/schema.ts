import type { RequestRecord } from "@totalmod/core";
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text().primaryKey(),
  name: text().notNull().unique(),
  plan: text().notNull().default("free"),
  role: text().notNull().default("member"),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const notes = pgTable("notes", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text().notNull(),
  body: text().notNull().default(""),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** Feature requests, raw text included. This is the only place the requester's words live. */
export const totalmodRequests = pgTable(
  "totalmod_requests",
  {
    id: text().primaryKey(),
    userId: text().notNull(),
    status: text().notNull(),
    data: jsonb().$type<RequestRecord>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index("totalmod_requests_user_created").on(t.userId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Note = typeof notes.$inferSelect;
