// Runs one eval case through the real request pipeline: the handler, the interviewer, the policy
// re-check and the issue renderer. GitHub is faked; the interviewer is real unless one is passed.
import { defaultConfig, type SpecDraft } from "../packages/core/src/index.ts";
import {
  createTotalmodHandler,
  type Interviewer,
  memoryRequestStore,
  type RequestView,
} from "../packages/server/src/index.ts";
import { noTelemetry } from "../packages/telemetry/src/index.ts";

export interface CaseResult {
  status?: RequestView["status"];
  draft?: SpecDraft;
  issueBody: string | null;
  questionsAsked: number;
  error?: string;
}

export async function runCase(text: string, interviewer?: Interviewer): Promise<CaseResult> {
  const issues: { body: string }[] = [];
  const handle = createTotalmodHandler({
    getRequester: async () => ({ id: "eval-user", plan: "pro", role: "member" }),
    store: memoryRequestStore(),
    config: defaultConfig(),
    ...(interviewer ? { interviewer } : {}),
    github: {
      repo: "eval/app",
      token: "eval",
      fetch: (async (_url: string, init: RequestInit) => {
        issues.push(JSON.parse(String(init.body)));
        return Response.json({ number: 1, html_url: "https://github.com/eval/app/issues/1" });
      }) as unknown as typeof fetch,
    },
    hashSecret: "eval",
    telemetry: noTelemetry,
    requestsPerDay: 1000,
  });
  const post = async (path: string, body: unknown) => {
    const res = await handle(
      new Request(`http://eval.test/api/totalmod${path}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    const json = (await res.json()) as RequestView & { error?: string };
    if (!res.ok) throw new Error(`${res.status} ${json.error ?? ""}`);
    return json;
  };

  let questionsAsked = 0;
  let lastDraft: SpecDraft | undefined;
  try {
    let view = await post("/requests", { text, route: "/notes", appVersion: "eval" });
    // A cooperative requester: picks the first option for every question.
    while (view.draft?.kind === "questions") {
      questionsAsked += view.draft.questions.length;
      const answers = Object.fromEntries(
        view.draft.questions.map((q) => [q.id, q.options[0] ?? "Yes"]),
      );
      view = await post(`/requests/${view.id}/answers`, { answers });
    }
    lastDraft = view.draft;
    if (view.draft?.kind === "spec") view = await post(`/requests/${view.id}/confirm`, {});
    return {
      status: view.status,
      ...(lastDraft ? { draft: lastDraft } : {}),
      issueBody: issues[0]?.body ?? null,
      questionsAsked,
    };
  } catch (error) {
    return {
      ...(lastDraft ? { draft: lastDraft } : {}),
      issueBody: null,
      questionsAsked,
      error: (error as Error).message,
    };
  }
}
