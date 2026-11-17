import { ReqId } from "@totalmod/core";
import { z } from "zod";

/** First line of issues the server files, and of PRs this action opens. */
const META_LINE = /^<!-- totalmod:meta (\{.*\}) -->/;

export const IssueMeta = z.object({
  reqId: ReqId,
  requester: z.string().regex(/^u_[0-9a-f]{24}$/),
  iteration: z.number().int().nonnegative(),
});
export type IssueMeta = z.infer<typeof IssueMeta>;

export const PrMeta = z.object({
  reqId: ReqId,
  requester: z.string().regex(/^u_[0-9a-f]{24}$/),
  issue: z.number().int().positive(),
});
export type PrMeta = z.infer<typeof PrMeta>;

export function readMeta<T extends z.ZodType>(
  body: string | null | undefined,
  schema: T,
): z.output<T> | null {
  const match = (body ?? "").match(META_LINE);
  if (!match?.[1]) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(match[1]));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function metaLine(meta: Record<string, unknown>): string {
  return `<!-- totalmod:meta ${JSON.stringify(meta)} -->`;
}

/** The spec part of an issue body: everything after the first `---` line. */
export function specFromIssue(body: string): string {
  const at = body.indexOf("\n---\n");
  return (at === -1 ? body : body.slice(at + 5)).trim();
}

export function branchFor(reqId: string): string {
  return `totalmod/req-${reqId}`;
}

export const ITERATE_MARKER = "totalmod:iterate";
