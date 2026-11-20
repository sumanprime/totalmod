// Opens a preview deployment as the requester: verifies the signed link from the widget and
// starts a mock session shaped like them (same plan and role). No real user record is involved:
// in mock mode the database is in-memory PGlite.
import { verifyPreviewToken } from "@totalmod/core";
import { redirect } from "next/navigation";
import { ensurePreviewUser, previewUserId, startSession } from "@/lib/auth";
import { getMode } from "@/lib/mode";

const MESSAGES = {
  expired: "This preview link has expired. Open the latest one from the request panel in the app.",
  "bad-signature": "This preview link is not valid.",
  malformed: "This preview link is not valid.",
};

export async function GET(request: Request) {
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
  const user = await ensurePreviewUser(previewUserId(requester, plan, role));
  await startSession(user.id);
  redirect("/notes");
}
