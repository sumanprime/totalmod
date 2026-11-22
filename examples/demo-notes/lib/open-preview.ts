// Opens a preview deployment as the requester: verifies the signed link from the widget and
// starts a mock session shaped like them (same plan and role). No real user record is involved:
// in mock mode the database is in-memory PGlite.
import { verifyPreviewToken } from "@totalmod/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { startSession } from "./auth";
import { getDb } from "./db";
import { notes, users } from "./db/schema";
import { ROUND_COOKIE, sampleNotes } from "./demo-feature";
import { getMode, isScriptedDemo } from "./mode";

const MESSAGES = {
  expired: "This preview link has expired. Open the latest one from the request panel in the app.",
  "bad-signature": "This preview link is not valid.",
  malformed: "This preview link is not valid.",
};

/** `round` is the fix round the link was built for (the scripted demo puts it in the path). */
export async function openPreview(request: Request, round: number): Promise<Response> {
  if (getMode() !== "mock") return new Response("Not found.", { status: 404 });

  const token = new URL(request.url).searchParams.get("token") ?? "";
  const result = verifyPreviewToken(token, process.env.TOTALMOD_PREVIEW_SECRET ?? "");
  if (!result.ok) {
    return new Response(MESSAGES[result.error], {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const { requester, plan = "free", role = "member" } = result.payload;
  const id = `preview-${requester}`;
  const db = await getDb();
  const created = await db
    .insert(users)
    .values({ id, name: `You (preview ${requester.slice(-6)})`, plan, role })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (created.length > 0 && isScriptedDemo()) await db.insert(notes).values(sampleNotes(id));
  await startSession(id);
  (await cookies()).set(ROUND_COOKIE, String(round), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/notes");
}
