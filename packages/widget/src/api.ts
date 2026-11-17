import type { RequestStatus, Spec, SpecDraft } from "@totalmod/core";

/** Mirrors the server's RequestView; the widget never sees the raw request text. */
export interface RequestView {
  id: string;
  status: RequestStatus;
  draft?: SpecDraft;
  spec?: Spec;
  issueNumber?: number;
  prNumber?: number;
  iteration: number;
  maxIterations: number;
  /** Signed link that opens the preview as this user. Only while a preview is ready. */
  previewLink?: string;
}

export type Feedback = { verdict: "up" } | { verdict: "fix"; text: string };

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createApi(endpoint: string) {
  const base = endpoint.replace(/\/$/, "");
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok)
      throw new ApiError(res.status, data.error ?? "Something went wrong. Please try again.");
    return data;
  }

  return {
    me: () => call<{ enabled: boolean }>("GET", "/me"),
    list: () => call<{ requests: RequestView[] }>("GET", "/requests"),
    create: (text: string, route: string, appVersion: string) =>
      call<RequestView>("POST", "/requests", { text, route, appVersion }),
    answer: (id: string, answers: Record<string, string>) =>
      call<RequestView>("POST", `/requests/${id}/answers`, { answers }),
    confirm: (id: string, spec?: Spec) =>
      call<RequestView>("POST", `/requests/${id}/confirm`, spec ? { spec } : {}),
    feedback: (id: string, feedback: Feedback) =>
      call<RequestView>("POST", `/requests/${id}/feedback`, feedback),
  };
}
