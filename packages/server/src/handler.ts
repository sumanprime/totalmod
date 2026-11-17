import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type Config,
  checkChanges,
  checkSpec,
  createPreviewToken,
  type InterviewTurn,
  loadConfig,
  type RequestRecord,
  Spec,
  type SpecDraft,
  type SpecQuestion,
  screenText,
} from "@totalmod/core";
import {
  createTelemetry,
  installIdFrom,
  noTelemetry,
  type Telemetry,
  type TelemetryEvent,
  telemetryDisabled,
} from "@totalmod/telemetry";
import { z } from "zod";
import {
  commentOnIssue,
  createIssue,
  type GithubTarget,
  hashRequester,
  markReadyForReview,
  renderIssue,
  renderIterateComment,
} from "./github.ts";
import { createInterviewer, type Interviewer, InterviewerError } from "./interviewer.ts";
import { localBackendFromEnv } from "./local-model.ts";
import type { RequestStore } from "./store.ts";
import { patchFromEvent, verifyGithubSignature } from "./webhooks.ts";

export interface Requester {
  id: string;
  plan?: string;
  role?: string;
}

export interface TotalmodOptions {
  /** Who is asking. Return null for signed-out users. */
  getRequester(request: Request): Promise<Requester | null>;
  store: RequestStore;
  /** Defaults to totalmod.config.yaml in the working directory. */
  config?: Config;
  /** Defaults to Claude via ANTHROPIC_API_KEY, model from TOTALMOD_MODEL or the config. */
  interviewer?: Interviewer;
  /** Defaults to TOTALMOD_GITHUB_REPO, TOTALMOD_GITHUB_TOKEN and TOTALMOD_GITHUB_API_URL. */
  github?: GithubTarget;
  /** Defaults to TOTALMOD_PREVIEW_SECRET. Hashes requester ids before they leave the app. */
  hashSecret?: string;
  /** New requests per user per 24 hours. Default 5. */
  requestsPerDay?: number;
  /** Defaults to TOTALMOD_WEBHOOK_SECRET. Verifies GitHub webhooks (PRs, preview deployments). */
  webhookSecret?: string;
  /** Path on the preview deployment that turns a signed token into a mock session. */
  previewPath?: string;
  /** Anonymous counts. Defaults to the config's `telemetry` and DO_NOT_TRACK. */
  telemetry?: Telemetry;
  basePath?: string;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

/** What the widget sees. Never includes the raw request text. */
export interface RequestView {
  id: string;
  status: RequestRecord["status"];
  draft?: SpecDraft;
  spec?: Spec;
  issueNumber?: number;
  issueUrl?: string;
  prNumber?: number;
  /** Fix rounds used so far, and how many are allowed. */
  iteration: number;
  maxIterations: number;
  /** Signed, 24-hour link that opens the preview as this requester. Only while it's ready. */
  previewLink?: string;
}

export const MAX_REQUEST_CHARS = 2000;
/** The interview asks at most this many questions, over at most two rounds. */
export const MAX_QUESTIONS = 4;
const MAX_QUESTION_ROUNDS = 2;

const CreateBody = z.object({
  text: z.string(),
  route: z.string().max(500).default(""),
  appVersion: z.string().max(100).default(""),
});
const AnswersBody = z.object({ answers: z.record(z.string(), z.string().trim().min(1).max(300)) });
const ConfirmBody = z.object({ spec: Spec.optional() });
const FeedbackBody = z.discriminatedUnion("verdict", [
  z.object({ verdict: z.literal("up") }),
  z.object({ verdict: z.literal("fix"), text: z.string().trim().min(3).max(1000) }),
]);
/** Requests shown in the widget's status view. */
const LATEST_REQUESTS = 5;

const VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

/** Status changes from webhooks that are worth counting. */
const STATUS_EVENTS: Partial<Record<RequestRecord["status"], TelemetryEvent>> = {
  preview_ready: "preview_ready",
  merged: "merged",
  rejected: "rejected",
  ga: "ga",
};

class HttpError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function createTotalmodHandler(options: TotalmodOptions) {
  const env = options.env ?? process.env;
  const basePath = (options.basePath ?? "/api/totalmod").replace(/\/$/, "");
  const now = options.now ?? (() => new Date());
  let configPromise: Promise<Config> | undefined;
  let interviewer = options.interviewer;

  const config = () => {
    configPromise ??= options.config ? Promise.resolve(options.config) : loadConfig(process.cwd());
    return configPromise;
  };
  const getInterviewer = async () => {
    if (!interviewer) {
      const backend = localBackendFromEnv(env);
      interviewer = createInterviewer(
        backend ? { backend } : { model: env.TOTALMOD_MODEL || (await config()).model },
      );
    }
    return interviewer;
  };

  const github = () => options.github ?? githubFromEnv(env);

  let telemetry = options.telemetry;
  /** Never throws and never delays the response. */
  const track = (event: TelemetryEvent, props?: Record<string, number>) => {
    void (async () => {
      try {
        if (!telemetry) {
          const cfg = await config();
          const secret = options.hashSecret ?? env.TOTALMOD_PREVIEW_SECRET;
          telemetry =
            telemetryDisabled(env, cfg.telemetry) || !secret
              ? noTelemetry
              : createTelemetry({
                  enabled: true,
                  installId: installIdFrom(github().repo, secret),
                  source: "server",
                  version: VERSION,
                  endpoint: env.TOTALMOD_TELEMETRY_ENDPOINT ?? cfg.telemetryEndpoint,
                });
        }
        await telemetry.track(event, props);
      } catch {
        // Telemetry must never break the product.
      }
    })();
  };
  const previewSecret = () => {
    const secret = options.hashSecret ?? env.TOTALMOD_PREVIEW_SECRET;
    if (!secret) {
      throw new HttpError(500, "Server misconfigured: TOTALMOD_PREVIEW_SECRET is not set.");
    }
    return secret;
  };

  async function toView(record: RequestRecord): Promise<RequestView> {
    const maxIterations = (await config()).iterations.max;
    let previewLink: string | undefined;
    if (record.status === "preview_ready" && record.previewUrl) {
      const token = createPreviewToken(
        {
          reqId: record.id,
          requester: hashRequester(record.userId, previewSecret()),
          ...(record.plan ? { plan: record.plan } : {}),
          ...(record.role ? { role: record.role } : {}),
        },
        previewSecret(),
        now(),
      );
      const link = new URL(options.previewPath ?? "/totalmod/preview", record.previewUrl);
      link.searchParams.set("token", token);
      previewLink = link.toString();
    }
    return view(record, { maxIterations, ...(previewLink ? { previewLink } : {}) });
  }

  async function requireRequester(request: Request): Promise<Requester> {
    const requester = await options.getRequester(request);
    if (!requester) throw new HttpError(401, "Sign in to request a feature.");
    if (!isAllowed(requester, await config())) {
      throw new HttpError(403, "Feature requests are not open to your account.");
    }
    return requester;
  }

  async function ownRecord(id: string, requester: Requester): Promise<RequestRecord> {
    const record = await options.store.get(id);
    if (!record || record.userId !== requester.id) throw new HttpError(404, "Request not found.");
    return record;
  }

  /** One interviewer turn plus the deterministic policy check on any spec it drafts. */
  async function interview(record: RequestRecord, turns: InterviewTurn[]): Promise<SpecDraft> {
    const asked = turns.reduce((n, t) => n + t.questions.length, 0);
    const questionsLeft = turns.length >= MAX_QUESTION_ROUNDS ? 0 : MAX_QUESTIONS - asked;
    const input = {
      text: record.text,
      route: record.route,
      appVersion: record.appVersion,
      turns,
      questionsLeft,
    };
    const ai = await getInterviewer();
    let draft = await ai.next(input);
    if (draft.kind !== "spec") return draft;

    const problems = checkSpec(draft.spec);
    if (problems.length === 0) return draft;
    draft = await ai.next({
      ...input,
      questionsLeft: 0,
      policyFeedback: problems.map((p) => `${p.field} ${p.problem}`),
    });
    if (draft.kind === "spec" && checkSpec(draft.spec).length > 0) {
      return {
        kind: "declined",
        reason:
          "This one touches parts of the app that only the team can change, so we've passed it to them directly.",
      };
    }
    return draft;
  }

  async function applyDraft(record: RequestRecord, turns: InterviewTurn[], draft: SpecDraft) {
    const updatedAt = now().toISOString();
    if (draft.kind === "questions") {
      return options.store.update(record.id, {
        interview: [...turns, { questions: draft.questions, answers: {} }],
        updatedAt,
      });
    }
    if (draft.kind === "spec") {
      return options.store.update(record.id, {
        interview: turns,
        draftSpec: draft.spec,
        updatedAt,
      });
    }
    return options.store.update(record.id, {
      interview: turns,
      status: "declined",
      declineReason: draft.reason,
      updatedAt,
    });
  }

  async function route(request: Request): Promise<unknown> {
    const path = new URL(request.url).pathname;
    if (!path.startsWith(basePath)) throw new HttpError(404, "Not found.");
    const parts = path.slice(basePath.length).split("/").filter(Boolean);
    const method = request.method.toUpperCase();

    if (
      method === "POST" &&
      parts[0] === "webhooks" &&
      parts[1] === "github" &&
      parts.length === 2
    ) {
      return handleWebhook(request);
    }

    if (method === "GET" && parts[0] === "me" && parts.length === 1) {
      const requester = await options.getRequester(request);
      return { enabled: requester !== null && isAllowed(requester, await config()) };
    }

    if (parts[0] !== "requests") throw new HttpError(404, "Not found.");
    const requester = await requireRequester(request);

    if (method === "GET" && parts.length === 1) {
      const records = await options.store.latestByUser(requester.id, LATEST_REQUESTS);
      return { requests: await Promise.all(records.map(toView)) };
    }

    if (method === "POST" && parts.length === 1) {
      const body = await parseBody(request, CreateBody);
      const text = body.text.trim();
      if (!text) throw new HttpError(400, "Describe the feature you'd like.");
      if (text.length > MAX_REQUEST_CHARS) {
        throw new HttpError(400, `Keep it under ${MAX_REQUEST_CHARS} characters.`);
      }
      const since = new Date(now().getTime() - 24 * 60 * 60 * 1000);
      if ((await options.store.countSince(requester.id, since)) >= (options.requestsPerDay ?? 5)) {
        throw new HttpError(429, "You've sent a lot of requests today. Try again tomorrow.");
      }

      const createdAt = now().toISOString();
      const record: RequestRecord = {
        id: newReqId(),
        userId: requester.id,
        ...(requester.plan ? { plan: requester.plan } : {}),
        ...(requester.role ? { role: requester.role } : {}),
        text,
        route: body.route,
        appVersion: body.appVersion,
        status: "interviewing",
        screeningFlags: screenText(text),
        interview: [],
        fixes: [],
        iteration: 0,
        createdAt,
        updatedAt: createdAt,
      };
      if (record.screeningFlags.length) {
        console.warn(
          `[totalmod] request ${record.id} flagged: ${record.screeningFlags.join(", ")}`,
        );
      }
      await options.store.create(record);
      return toView(await applyDraft(record, [], await interview(record, [])));
    }

    const id = parts[1] ?? "";
    if (method === "GET" && parts.length === 2) return toView(await ownRecord(id, requester));

    if (method === "POST" && parts[2] === "answers" && parts.length === 3) {
      const record = await ownRecord(id, requester);
      const pending = pendingQuestions(record);
      if (!pending) throw new HttpError(409, "There are no open questions on this request.");
      const { answers } = await parseBody(request, AnswersBody);
      const missing = pending.questions.filter((q) => !answers[q.id]).map((q) => q.id);
      if (missing.length) throw new HttpError(400, "Answer every question.", { missing });
      const turns = [
        ...record.interview.slice(0, -1),
        { questions: pending.questions, answers: pick(answers, pending.questions) },
      ];
      return toView(await applyDraft(record, turns, await interview(record, turns)));
    }

    if (method === "POST" && parts[2] === "confirm" && parts.length === 3) {
      const record = await ownRecord(id, requester);
      if (record.status !== "interviewing" && record.spec) return toView(record);
      if (record.status !== "interviewing" || !record.draftSpec) {
        throw new HttpError(409, "There is no spec to confirm yet.");
      }
      const body = await parseBody(request, ConfirmBody);
      const spec = body.spec ?? record.draftSpec;
      const problems = checkSpec(spec);
      if (problems.length) {
        throw new HttpError(422, "The edited spec touches areas we can't build here.", {
          problems,
        });
      }

      const issue = await createIssue(
        github(),
        renderIssue(spec, {
          reqId: record.id,
          requester: hashRequester(record.userId, previewSecret()),
          iteration: 0,
        }),
      );
      track("request_submitted", {
        questions: record.interview.reduce((n, t) => n + t.questions.length, 0),
      });
      return toView(
        await options.store.update(record.id, {
          status: "confirmed",
          spec,
          issueNumber: issue.number,
          issueUrl: issue.url,
          updatedAt: now().toISOString(),
        }),
      );
    }

    if (method === "POST" && parts[2] === "feedback" && parts.length === 3) {
      const record = await ownRecord(id, requester);
      if (record.status !== "preview_ready" || !record.prNumber || !record.spec) {
        throw new HttpError(409, "There's no preview to review right now.");
      }
      const body = await parseBody(request, FeedbackBody);

      if (body.verdict === "up") {
        await markReadyForReview(github(), record.prNumber, record.iteration);
        return toView(
          await options.store.update(record.id, {
            status: "ready",
            updatedAt: now().toISOString(),
          }),
        );
      }

      const max = (await config()).iterations.max;
      if (record.iteration >= max) {
        throw new HttpError(
          409,
          `You've used all ${max} fix rounds. The team will take it from here.`,
        );
      }
      const delta = await revise(record, body.text);
      if (delta.kind === "declined") throw new HttpError(422, delta.reason);
      const iteration = record.iteration + 1;
      track("iteration", { iteration });
      await commentOnIssue(
        github(),
        record.prNumber,
        renderIterateComment(delta.changes, iteration),
      );
      const at = now().toISOString();
      return toView(
        await options.store.update(record.id, {
          status: "iterating",
          iteration,
          previewUrl: undefined,
          fixes: [...record.fixes, { feedback: body.text, changes: delta.changes, at }],
          updatedAt: at,
        }),
      );
    }

    throw new HttpError(404, "Not found.");
  }

  /** Feedback -> spec delta, with the same policy check and one retry as the interview. */
  async function revise(record: RequestRecord, feedback: string) {
    const ai = await getInterviewer();
    const input = {
      spec: record.spec as Spec,
      feedback,
      previousChanges: record.fixes.map((f) => f.changes),
    };
    let delta = await ai.revise(input);
    if (delta.kind === "declined") return delta;
    const problems = checkChanges(delta.changes);
    if (problems.length === 0) return delta;
    delta = await ai.revise({ ...input, policyFeedback: problems });
    if (delta.kind === "delta" && checkChanges(delta.changes).length > 0) {
      return {
        kind: "declined" as const,
        reason:
          "That change touches parts of the app only the team can change. Try describing it differently, or send it as a new request.",
      };
    }
    return delta;
  }

  async function handleWebhook(request: Request) {
    const raw = await request.text();
    const secret = options.webhookSecret ?? env.TOTALMOD_WEBHOOK_SECRET ?? "";
    if (!verifyGithubSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
      throw new HttpError(401, "Bad signature.");
    }
    const payload = JSON.parse(raw) as { repository?: { full_name?: string } };
    if (payload.repository?.full_name !== github().repo) return { ignored: "other repository" };
    const result = await patchFromEvent(
      request.headers.get("x-github-event") ?? "",
      payload,
      (reqId) => options.store.get(reqId),
    );
    if (!result) return { ignored: "not a totalmod event" };
    const before = await options.store.get(result.reqId);
    const after = await options.store.update(result.reqId, {
      ...result.patch,
      updatedAt: now().toISOString(),
    });
    const event = STATUS_EVENTS[after.status];
    if (event && before?.status !== after.status) {
      track(
        event,
        event === "preview_ready"
          ? { iteration: after.iteration }
          : { iterations: after.iteration },
      );
    }
    return { updated: result.reqId };
  }

  return async function handle(request: Request): Promise<Response> {
    try {
      return Response.json(await route(request));
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json(
          { error: error.message, details: error.details },
          { status: error.status },
        );
      }
      if (error instanceof InterviewerError) {
        console.error(`[totalmod] ${error.message}`);
        return Response.json(
          { error: "The interviewer had trouble. Please try again." },
          { status: 502 },
        );
      }
      console.error("[totalmod]", error);
      return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}

export function isAllowed(requester: Requester, config: Config): boolean {
  if (config.requesters === "all") return true;
  if (config.requesters === "paying") return !!requester.plan && requester.plan !== "free";
  return config.requesters.includes(requester.id);
}

function pendingQuestions(record: RequestRecord): { questions: SpecQuestion[] } | null {
  const last = record.interview.at(-1);
  if (record.status !== "interviewing" || record.draftSpec || !last) return null;
  return Object.keys(last.answers).length === 0 ? { questions: last.questions } : null;
}

export function view(
  record: RequestRecord,
  extras: { maxIterations: number; previewLink?: string },
): RequestView {
  const base = {
    id: record.id,
    status: record.status,
    iteration: record.iteration,
    ...extras,
    ...(record.prNumber ? { prNumber: record.prNumber } : {}),
    ...(record.spec ? { spec: record.spec } : {}),
    ...(record.issueNumber ? { issueNumber: record.issueNumber } : {}),
    ...(record.issueUrl ? { issueUrl: record.issueUrl } : {}),
  };
  if (record.status === "declined") {
    return { ...base, draft: { kind: "declined", reason: record.declineReason ?? "" } };
  }
  if (record.status === "interviewing") {
    if (record.draftSpec) return { ...base, draft: { kind: "spec", spec: record.draftSpec } };
    const pending = pendingQuestions(record);
    if (pending) return { ...base, draft: { kind: "questions", questions: pending.questions } };
  }
  return base;
}

function githubFromEnv(env: Record<string, string | undefined>): GithubTarget {
  const repo = env.TOTALMOD_GITHUB_REPO;
  if (!repo) throw new HttpError(500, "Server misconfigured: TOTALMOD_GITHUB_REPO is not set.");
  return {
    repo,
    ...(env.TOTALMOD_GITHUB_TOKEN ? { token: env.TOTALMOD_GITHUB_TOKEN } : {}),
    ...(env.TOTALMOD_GITHUB_API_URL ? { apiUrl: env.TOTALMOD_GITHUB_API_URL } : {}),
  };
}

async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, "Send a JSON body.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new HttpError(400, "Invalid request body.", result.error.issues);
  return result.data;
}

function pick(answers: Record<string, string>, questions: SpecQuestion[]): Record<string, string> {
  return Object.fromEntries(questions.map((q) => [q.id, answers[q.id] ?? ""]));
}

function newReqId(): string {
  return Array.from(randomBytes(10), (b) => (b % 36).toString(36)).join("");
}
