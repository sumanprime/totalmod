import { z } from "zod";

/** Request ids are short lowercase base36 strings; they appear in branch names and flag keys. */
export const ReqId = z.string().regex(/^[a-z0-9]{8,16}$/, "reqId must be 8-16 chars of a-z, 0-9");

/** The confirmed spec. This, and only this, is what reaches the GitHub issue and the build agent. */
export const Spec = z.object({
  title: z.string().trim().min(5).max(100),
  userStory: z.string().trim().min(10).max(600),
  acceptanceCriteria: z.array(z.string().trim().min(3).max(300)).min(1).max(10),
  uiLocation: z.string().trim().min(2).max(200),
  outOfScope: z.array(z.string().trim().min(2).max(300)).max(10),
});
export type Spec = z.infer<typeof Spec>;

export const SpecQuestion = z.object({
  id: z.string().min(1).max(40),
  text: z.string().trim().min(5).max(300),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(5),
  allowFreeText: z.boolean().default(true),
});
export type SpecQuestion = z.infer<typeof SpecQuestion>;

/**
 * Structured output of one interviewer turn: clarifying questions, a draft spec, or a decline
 * when the request can only be met in areas the agent may not touch (auth, billing, ...).
 */
export const SpecDraft = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("questions"), questions: z.array(SpecQuestion).min(1).max(4) }),
  z.object({ kind: z.literal("spec"), spec: Spec }),
  z.object({ kind: z.literal("declined"), reason: z.string().trim().min(5).max(300) }),
]);
export type SpecDraft = z.infer<typeof SpecDraft>;

/** One round of the interview: the questions asked and the requester's answers by question id. */
export const InterviewTurn = z.object({
  questions: z.array(SpecQuestion),
  answers: z.record(z.string(), z.string().max(300)),
});
export type InterviewTurn = z.infer<typeof InterviewTurn>;

/**
 * The interviewer's rewrite of a requester's "fix this" feedback: short, buildable changes to
 * the confirmed spec. This, not the raw feedback, is what goes to the pull request.
 */
export const SpecDelta = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("delta"),
    changes: z.array(z.string().trim().min(5).max(300)).min(1).max(5),
  }),
  z.object({ kind: z.literal("declined"), reason: z.string().trim().min(5).max(300) }),
]);
export type SpecDelta = z.infer<typeof SpecDelta>;

/** One fix round: the raw feedback (stays in the app) and the changes sent to the agent. */
export const FixRound = z.object({
  feedback: z.string().max(1000),
  changes: z.array(z.string()),
  at: z.iso.datetime(),
});
export type FixRound = z.infer<typeof FixRound>;

export const RequestStatus = z.enum([
  "interviewing",
  "declined",
  "confirmed",
  "building",
  "blocked",
  "preview_ready",
  "iterating",
  "ready",
  "merged",
  "ga",
  "rejected",
]);
export type RequestStatus = z.infer<typeof RequestStatus>;

/** A row in the host app's `totalmod_requests` table. Raw `text` never leaves the app. */
export const RequestRecord = z.object({
  id: ReqId,
  userId: z.string().min(1),
  plan: z.string().optional(),
  role: z.string().optional(),
  text: z.string().min(1).max(4000),
  route: z.string().max(500),
  appVersion: z.string().max(100),
  status: RequestStatus,
  screeningFlags: z.array(z.string()),
  interview: z.array(InterviewTurn).default([]),
  /** Latest spec the interviewer proposed, waiting for the requester to confirm or edit. */
  draftSpec: Spec.optional(),
  declineReason: z.string().optional(),
  /** The confirmed spec: the only request content that leaves the app. */
  spec: Spec.optional(),
  iteration: z.number().int().nonnegative(),
  issueNumber: z.number().int().positive().optional(),
  issueUrl: z.url().optional(),
  prNumber: z.number().int().positive().optional(),
  previewUrl: z.url().optional(),
  fixes: z.array(FixRound).default([]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type RequestRecord = z.infer<typeof RequestRecord>;
