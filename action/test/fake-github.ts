import type { GitHub } from "../src/github.ts";

/**
 * In-memory GitHub: GET routes match by path prefix (query string ignored), POSTs are recorded.
 * Unknown GETs throw, so a test fails loudly if the code calls something unexpected.
 */
export function fakeGitHub(routes: Record<string, unknown>) {
  const posts: { path: string; body: unknown }[] = [];
  const lookup = (path: string) => {
    const key = path.split("?")[0] ?? path;
    if (!(key in routes)) throw new Error(`fake GitHub: no route for GET ${key}`);
    return structuredClone(routes[key]);
  };
  const github: GitHub = {
    async get<T>(path: string) {
      return lookup(path) as T;
    },
    async list<T>(path: string) {
      return lookup(path) as T[];
    },
    async post<T>(path: string, body: unknown) {
      posts.push({ path, body });
      return { number: 77, html_url: "https://github.com/acme/app/pull/77" } as T;
    },
    async patch<T>(path: string, body: unknown) {
      posts.push({ path: `PATCH ${path}`, body });
      return {} as T;
    },
    async delete(path: string) {
      posts.push({ path: `DELETE ${path}`, body: null });
    },
  };
  return { github, posts };
}

export const REQ = "k3j9x2m1q8";
export const REQUESTER = `u_${"a".repeat(24)}`;
export const META = `<!-- totalmod:meta {"reqId":"${REQ}","requester":"${REQUESTER}","iteration":0} -->`;

export const issueBody = [
  META,
  "> Requested by an app user through totalmod.",
  "",
  "---",
  "",
  "# Word count under each note",
  "",
  "## Acceptance criteria",
  "",
  "- Each note shows its word count",
].join("\n");

export function spendComment(usd: number, at = "2026-10-20T10:00:00.000Z", login = "totalmod-bot") {
  return {
    id: Math.floor(usd * 1000),
    user: { login },
    body: `<!-- totalmod:spend {"usd":${usd},"at":"${at}"} -->`,
  };
}
