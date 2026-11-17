import { createTotalmodHandlers } from "@totalmod/server/next";
import { getMode } from "@/lib/mode";
import { getRequester, store } from "@/lib/totalmod";

const handlers = createTotalmodHandlers({ getRequester, store });

// Previews run on mock data with no GitHub or Anthropic credentials, so requests are off there.
function productionOnly(handle: (request: Request) => Promise<Response>) {
  return (request: Request) =>
    getMode() === "mock"
      ? Response.json({ error: "Not found." }, { status: 404 })
      : handle(request);
}

export const GET = productionOnly(handlers.GET);
export const POST = productionOnly(handlers.POST);
