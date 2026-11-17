/** Just enough of the GitHub REST API for the action. `fetch` is injectable for tests. */
export interface GitHub {
  get<T>(path: string): Promise<T>;
  /** Follows `Link: rel="next"` up to `maxPages`. */
  list<T>(path: string, maxPages?: number): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete(path: string): Promise<void>;
}

export function createGitHub(options: {
  token: string;
  apiUrl?: string | undefined;
  fetch?: typeof fetch;
}): GitHub {
  const api = (options.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch;

  async function request(method: string, url: string, body?: unknown): Promise<Response> {
    const res = await doFetch(url.startsWith("http") ? url : `${api}${url}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${options.token}`,
        "User-Agent": "totalmod-action",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok)
      throw new Error(`GitHub ${method} ${url} failed: ${res.status} ${await res.text()}`);
    return res;
  }

  return {
    async get(path) {
      return (await request("GET", path)).json();
    },
    async list(path, maxPages = 10) {
      const items = [];
      let next: string | undefined = path;
      for (let page = 0; next && page < maxPages; page++) {
        const res = await request("GET", next);
        items.push(...(await res.json()));
        next = res.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      }
      return items;
    },
    async post(path, body) {
      return (await request("POST", path, body)).json();
    },
    async patch(path, body) {
      return (await request("PATCH", path, body)).json();
    },
    async delete(path) {
      await request("DELETE", path);
    },
  };
}
