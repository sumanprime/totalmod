import { createTotalmodHandlers } from "@totalmod/server/next";
import { getMode, isScriptedDemo } from "@/lib/mode";
import { scriptedDemo } from "@/lib/scripted-demo";
import { getRequester, store } from "@/lib/totalmod";

function demoPreviewUrl(): string {
  const url = process.env.DEMO_PREVIEW_URL;
  if (!url) throw new Error("DEMO_SCRIPTED=1 needs DEMO_PREVIEW_URL, the mock-mode deployment.");
  return url;
}

// The hosted demo fakes Claude, GitHub and the build in-process: see lib/scripted-demo.ts.
const demo = isScriptedDemo() && getMode() === "production" ? scriptedDemo(demoPreviewUrl()) : null;
const handlers = createTotalmodHandlers({ getRequester, store, ...demo?.options });
demo?.connect(handlers.POST);

// Previews run on mock data with no GitHub or Anthropic credentials, so requests are off there.
function productionOnly(handle: (request: Request) => Promise<Response>) {
  return (request: Request) =>
    getMode() === "mock"
      ? Response.json({ error: "Not found." }, { status: 404 })
      : handle(request);
}

export const GET = productionOnly(handlers.GET);
export const POST = productionOnly(handlers.POST);
