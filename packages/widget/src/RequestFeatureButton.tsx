"use client";

import type { Spec, SpecQuestion } from "@totalmod/core";
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { createApi, type Feedback, type RequestView } from "./api.ts";
import { PENDING, Status, TRACKED } from "./Status.tsx";
import { STYLES } from "./styles.ts";

export interface RequestFeatureButtonProps {
  /** Where the totalmod route handlers are mounted. */
  endpoint?: string;
  /** Sent with each request so the team knows which version it came from. */
  appVersion?: string;
  label?: string;
  /** How often to check a request that is being built, in milliseconds. */
  pollMs?: number;
}

type Phase = "compose" | "questions" | "review" | "edit" | "track" | "declined";

const OTHER = "__other__";

/** Floating "Request a feature" button with the interview, spec review and confirmation. */
export function RequestFeatureButton({
  endpoint = "/api/totalmod",
  appVersion = "",
  label = "Request a feature",
  pollMs = 20_000,
}: RequestFeatureButtonProps) {
  const api = useMemo(() => createApi(endpoint), [endpoint]);
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("compose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [request, setRequest] = useState<RequestView | null>(null);
  const [edited, setEdited] = useState<Spec | null>(null);
  const titleId = useId();
  const composeRef = useRef<HTMLTextAreaElement>(null);
  /** The user's latest confirmed request, kept fresh by polling while it is being built. */
  const [tracked, setTracked] = useState<RequestView | null>(null);

  useEffect(() => {
    let live = true;
    api.me().then(
      async (me) => {
        if (!live) return;
        setEnabled(me.enabled);
        if (!me.enabled) return;
        const requests = await api.list().then(
          (r) => r.requests,
          () => [],
        );
        const latest = requests.find((r) => TRACKED.has(r.status)) ?? null;
        if (!live || !latest) return;
        setTracked(latest);
        setRequest((current) => current ?? latest);
        setPhase((current) => (current === "compose" ? "track" : current));
      },
      () => live && setEnabled(false),
    );
    return () => {
      live = false;
    };
  }, [api]);

  // Poll while the build runs, so the try-it link appears without a reload.
  useEffect(() => {
    if (!tracked || !PENDING.has(tracked.status)) return;
    const timer = setInterval(() => {
      api.list().then(
        ({ requests }) => {
          const fresh = requests.find((r) => r.id === tracked.id);
          if (!fresh) return;
          setTracked(fresh);
          setRequest((current) => (current?.id === fresh.id ? fresh : current));
        },
        () => {},
      );
    }, pollMs);
    return () => clearInterval(timer);
  }, [api, tracked, pollMs]);

  // Move focus into the panel when it opens on the first step.
  useEffect(() => {
    if (open && phase === "compose") composeRef.current?.focus();
  }, [open, phase]);

  if (!enabled) return null;

  function show(view: RequestView) {
    setRequest(view);
    if (TRACKED.has(view.status)) {
      setTracked(view);
      setPhase("track");
    } else if (view.draft?.kind === "questions") setPhase("questions");
    else if (view.draft?.kind === "spec") setPhase("review");
    else if (view.draft?.kind === "declined") setPhase("declined");
  }

  async function run(action: () => Promise<RequestView>) {
    setBusy(true);
    setError(null);
    try {
      show(await action());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPhase("compose");
    setText("");
    setRequest(null);
    setEdited(null);
    setError(null);
  }

  const spec = edited ?? (request?.draft?.kind === "spec" ? request.draft.spec : null);
  const ready = tracked?.status === "preview_ready";

  return (
    <div className="tms-root">
      <style>{STYLES}</style>
      {open ? (
        <section className="tms-panel" role="dialog" aria-labelledby={titleId}>
          <header className="tms-head">
            <h2 id={titleId}>{label}</h2>
            <button
              type="button"
              className="tms-icon"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>

          {error && (
            <p className="tms-error" role="alert">
              {error}
            </p>
          )}

          {phase === "compose" && (
            <form
              className="tms-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => api.create(text, window.location.pathname, appVersion));
              }}
            >
              <label htmlFor={`${titleId}-text`}>What would make this app better for you?</label>
              <textarea
                id={`${titleId}-text`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                maxLength={2000}
                required
                ref={composeRef}
              />
              <button type="submit" disabled={busy || !text.trim()}>
                {busy ? "Thinking…" : "Continue"}
              </button>
            </form>
          )}

          {phase === "questions" && request?.draft?.kind === "questions" && (
            <Questions
              key={request.draft.questions.map((q) => q.id).join()}
              questions={request.draft.questions}
              busy={busy}
              onSubmit={(answers) => void run(() => api.answer(request.id, answers))}
            />
          )}

          {phase === "review" && spec && request && (
            <div className="tms-stack">
              <p>Here's what we'd build. Does this match what you meant?</p>
              <SpecView spec={spec} />
              <div className="tms-row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => api.confirm(request.id, edited ?? undefined))}
                >
                  {busy ? "Sending…" : "Looks right, build it"}
                </button>
                {!edited && (
                  <button type="button" className="tms-secondary" onClick={() => setPhase("edit")}>
                    Edit
                  </button>
                )}
              </div>
            </div>
          )}

          {phase === "edit" && spec && (
            <SpecEditor
              spec={spec}
              onCancel={() => setPhase("review")}
              onSave={(next) => {
                setEdited(next);
                setPhase("review");
              }}
            />
          )}

          {phase === "track" && request && (
            <Status
              key={`${request.id}:${request.status}:${request.iteration}`}
              view={request}
              busy={busy}
              onFeedback={(feedback: Feedback) =>
                void run(() => api.feedback(request.id, feedback))
              }
              onNew={reset}
            />
          )}

          {phase === "declined" && request?.draft?.kind === "declined" && (
            <div className="tms-stack" role="status">
              <p>{request.draft.reason}</p>
              <button type="button" className="tms-secondary" onClick={reset}>
                Request something else
              </button>
            </div>
          )}
        </section>
      ) : (
        <button
          type="button"
          className={ready ? "tms-launch tms-ready" : "tms-launch"}
          onClick={() => setOpen(true)}
        >
          {ready ? "Your feature is ready" : label}
        </button>
      )}
    </div>
  );
}

function Questions({
  questions,
  busy,
  onSubmit,
}: {
  questions: SpecQuestion[];
  busy: boolean;
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const answers = Object.fromEntries(
    questions.map((q) => [
      q.id,
      choice[q.id] === OTHER ? (other[q.id] ?? "").trim() : (choice[q.id] ?? ""),
    ]),
  );
  const complete = questions.every((q) => answers[q.id]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (complete) onSubmit(answers);
  }

  return (
    <form className="tms-stack" onSubmit={submit}>
      <p>A couple of quick questions so we build the right thing:</p>
      {questions.map((q) => (
        <fieldset key={q.id} className="tms-question">
          <legend>{q.text}</legend>
          {q.options.map((option) => (
            <label key={option} className="tms-option">
              <input
                type="radio"
                name={q.id}
                value={option}
                checked={choice[q.id] === option}
                onChange={() => setChoice({ ...choice, [q.id]: option })}
              />
              {option}
            </label>
          ))}
          {q.allowFreeText && (
            <label className="tms-option">
              <input
                type="radio"
                name={q.id}
                value={OTHER}
                checked={choice[q.id] === OTHER}
                onChange={() => setChoice({ ...choice, [q.id]: OTHER })}
              />
              Something else
            </label>
          )}
          {choice[q.id] === OTHER && (
            <input
              aria-label={`Your answer: ${q.text}`}
              value={other[q.id] ?? ""}
              maxLength={300}
              onChange={(e) => setOther({ ...other, [q.id]: e.target.value })}
            />
          )}
        </fieldset>
      ))}
      <button type="submit" disabled={busy || !complete}>
        {busy ? "Thinking…" : "Continue"}
      </button>
    </form>
  );
}

function SpecView({ spec }: { spec: Spec }) {
  return (
    <dl className="tms-spec">
      <dt>Feature</dt>
      <dd>{spec.title}</dd>
      <dt>Why</dt>
      <dd>{spec.userStory}</dd>
      <dt>You'll be able to</dt>
      <dd>
        <ul>
          {spec.acceptanceCriteria.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </dd>
      <dt>Where</dt>
      <dd>{spec.uiLocation}</dd>
      {spec.outOfScope.length > 0 && (
        <>
          <dt>Not included</dt>
          <dd>
            <ul>
              {spec.outOfScope.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </dd>
        </>
      )}
    </dl>
  );
}

const lines = (value: string) =>
  value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function SpecEditor({
  spec,
  onSave,
  onCancel,
}: {
  spec: Spec;
  onSave: (spec: Spec) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [title, setTitle] = useState(spec.title);
  const [userStory, setUserStory] = useState(spec.userStory);
  const [criteria, setCriteria] = useState(spec.acceptanceCriteria.join("\n"));
  const [uiLocation, setUiLocation] = useState(spec.uiLocation);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => first.current?.focus(), []);

  return (
    <form
      className="tms-stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...spec,
          title: title.trim(),
          userStory: userStory.trim(),
          acceptanceCriteria: lines(criteria),
          uiLocation: uiLocation.trim(),
        });
      }}
    >
      <p>You can edit this once. Keep it to one feature.</p>
      <label htmlFor={`${id}-title`}>Feature</label>
      <input
        id={`${id}-title`}
        ref={first}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={100}
        required
      />
      <label htmlFor={`${id}-story`}>Why</label>
      <textarea
        id={`${id}-story`}
        value={userStory}
        onChange={(e) => setUserStory(e.target.value)}
        rows={3}
        maxLength={600}
        required
      />
      <label htmlFor={`${id}-criteria`}>You'll be able to (one per line)</label>
      <textarea
        id={`${id}-criteria`}
        value={criteria}
        onChange={(e) => setCriteria(e.target.value)}
        rows={4}
        required
      />
      <label htmlFor={`${id}-where`}>Where</label>
      <input
        id={`${id}-where`}
        value={uiLocation}
        onChange={(e) => setUiLocation(e.target.value)}
        maxLength={200}
        required
      />
      <div className="tms-row">
        <button type="submit">Save changes</button>
        <button type="button" className="tms-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
