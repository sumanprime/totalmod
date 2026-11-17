import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ReqId } from "./schemas.ts";

/**
 * Signed, short-lived link token that opens a preview as the requester's mock session.
 * It carries no real user id: only the hashed requester, plus plan and role so the mock
 * session looks like them.
 */
export const PreviewTokenPayload = z.object({
  reqId: ReqId,
  requester: z.string().regex(/^u_[0-9a-f]{24}$/),
  plan: z.string().max(40).optional(),
  role: z.string().max(40).optional(),
  /** Expiry, seconds since epoch. */
  exp: z.number().int().positive(),
});
export type PreviewTokenPayload = z.infer<typeof PreviewTokenPayload>;

export const PREVIEW_TOKEN_TTL_SECONDS = 24 * 60 * 60;

export type PreviewTokenResult =
  | { ok: true; payload: PreviewTokenPayload }
  | { ok: false; error: "malformed" | "bad-signature" | "expired" };

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createPreviewToken(
  payload: Omit<PreviewTokenPayload, "exp">,
  secret: string,
  now = new Date(),
): string {
  if (!secret) throw new Error("A preview secret is required to sign preview links.");
  const full = PreviewTokenPayload.parse({
    ...payload,
    exp: Math.floor(now.getTime() / 1000) + PREVIEW_TOKEN_TTL_SECONDS,
  });
  const data = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${data}.${sign(data, secret)}`;
}

export function verifyPreviewToken(
  token: string,
  secret: string,
  now = new Date(),
): PreviewTokenResult {
  const [data, signature, extra] = token.split(".");
  if (!data || !signature || extra !== undefined || !secret)
    return { ok: false, error: "malformed" };

  const expected = Buffer.from(sign(data, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, error: "bad-signature" };
  }

  let payload: PreviewTokenPayload;
  try {
    const parsed = PreviewTokenPayload.safeParse(
      JSON.parse(Buffer.from(data, "base64url").toString("utf8")),
    );
    if (!parsed.success) return { ok: false, error: "malformed" };
    payload = parsed.data;
  } catch {
    return { ok: false, error: "malformed" };
  }
  if (payload.exp * 1000 <= now.getTime()) return { ok: false, error: "expired" };
  return { ok: true, payload };
}
