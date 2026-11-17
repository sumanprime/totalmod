import { createTotalmodHandler, type TotalmodOptions } from "./handler.ts";

/**
 * Route handlers for `app/api/totalmod/[...totalmod]/route.ts`:
 *   export const { GET, POST } = createTotalmodHandlers({ getRequester, store });
 */
export function createTotalmodHandlers(options: TotalmodOptions) {
  const handle = createTotalmodHandler(options);
  return { GET: handle, POST: handle };
}

export type { Requester, TotalmodOptions } from "./handler.ts";
