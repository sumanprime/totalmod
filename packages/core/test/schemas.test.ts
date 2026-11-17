import { describe, expect, it } from "vitest";
import { ReqId, RequestRecord, SpecDraft } from "../src/index.ts";

const spec = {
  title: "Word counter under each note",
  userStory: "As a writer I want to see how many words a note has so I can keep posts short.",
  acceptanceCriteria: ["Each note shows its word count below the body"],
  uiLocation: "Notes list, below each note",
  outOfScope: ["Character counts"],
};

describe("SpecDraft", () => {
  it("parses a questions turn and defaults allowFreeText", () => {
    const draft = SpecDraft.parse({
      kind: "questions",
      questions: [{ id: "where", text: "Where should it appear?", options: ["List", "Editor"] }],
    });
    expect(draft.kind === "questions" && draft.questions[0]?.allowFreeText).toBe(true);
  });

  it("parses a spec turn", () => {
    expect(SpecDraft.parse({ kind: "spec", spec }).kind).toBe("spec");
  });

  it("rejects more than 4 questions and single-option questions", () => {
    const q = { id: "q", text: "Which one is it?", options: ["a", "b"] };
    expect(SpecDraft.safeParse({ kind: "questions", questions: [q, q, q, q, q] }).success).toBe(
      false,
    );
    expect(
      SpecDraft.safeParse({ kind: "questions", questions: [{ ...q, options: ["only"] }] }).success,
    ).toBe(false);
  });

  it("rejects a spec with no acceptance criteria", () => {
    expect(
      SpecDraft.safeParse({ kind: "spec", spec: { ...spec, acceptanceCriteria: [] } }).success,
    ).toBe(false);
  });
});

describe("RequestRecord", () => {
  it("accepts a fresh request and rejects bad ids", () => {
    const now = new Date().toISOString();
    const record = {
      id: "k3j9x2m1q8",
      userId: "user_1",
      text: "can I see word counts?",
      route: "/notes",
      appVersion: "1.4.0",
      status: "interviewing",
      screeningFlags: [],
      iteration: 0,
      createdAt: now,
      updatedAt: now,
    };
    expect(RequestRecord.parse(record).status).toBe("interviewing");
    expect(ReqId.safeParse("Has-Caps").success).toBe(false);
  });
});
