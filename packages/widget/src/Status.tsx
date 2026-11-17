import { useId, useState } from "react";
import type { Feedback, RequestView } from "./api.ts";

/** Statuses where the requester is waiting on the build or on their own verdict. */
export const TRACKED = new Set<RequestView["status"]>([
  "confirmed",
  "building",
  "iterating",
  "preview_ready",
  "ready",
  "merged",
  "ga",
  "rejected",
]);

/** Statuses that change without the user doing anything, so the widget polls for them. */
export const PENDING = new Set<RequestView["status"]>(["confirmed", "building", "iterating"]);

/** Where a confirmed request stands, the try-it link, and the requester's verdict. */
export function Status({
  view,
  busy,
  onFeedback,
  onNew,
}: {
  view: RequestView;
  busy: boolean;
  onFeedback: (feedback: Feedback) => void;
  onNew: () => void;
}) {
  const id = useId();
  const [fixing, setFixing] = useState(false);
  const [text, setText] = useState("");
  const title = <strong>{view.spec?.title ?? "your feature"}</strong>;
  const roundsLeft = view.maxIterations - view.iteration;

  return (
    <div className="tms-stack">
      {(view.status === "confirmed" || view.status === "building") && (
        <p role="status">
          We're building {title}. You'll be the first to try it: the link shows up here when it's
          ready.
        </p>
      )}

      {view.status === "iterating" && (
        <p role="status">
          We're making your changes to {title} (round {view.iteration} of {view.maxIterations}). The
          new link shows up here when it's ready.
        </p>
      )}

      {view.status === "preview_ready" && view.previewLink && (
        <>
          <p role="status">
            {title} is ready. Only you can see it. It runs on sample data, so nothing you do there
            touches your account.
          </p>
          <a
            className="tms-button"
            href={view.previewLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Try it
          </a>
          {fixing ? (
            <form
              className="tms-stack"
              onSubmit={(e) => {
                e.preventDefault();
                onFeedback({ verdict: "fix", text });
              }}
            >
              <label htmlFor={`${id}-fix`}>What should change?</label>
              <textarea
                id={`${id}-fix`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                maxLength={1000}
                required
              />
              <div className="tms-row">
                <button type="submit" disabled={busy || text.trim().length < 3}>
                  {busy ? "Sending…" : "Send changes"}
                </button>
                <button type="button" className="tms-secondary" onClick={() => setFixing(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="tms-row">
              <button type="button" disabled={busy} onClick={() => onFeedback({ verdict: "up" })}>
                Looks good
              </button>
              {roundsLeft > 0 ? (
                <button type="button" className="tms-secondary" onClick={() => setFixing(true)}>
                  Fix this ({roundsLeft} {roundsLeft === 1 ? "round" : "rounds"} left)
                </button>
              ) : (
                <p className="tms-muted">
                  You've used all your fix rounds. The team will take it from here.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {view.status === "ready" && (
        <p role="status">Thanks! The team will review {title} and roll it out.</p>
      )}
      {(view.status === "merged" || view.status === "ga") && (
        <p role="status">The team accepted {title}. It's rolling out.</p>
      )}
      {view.status === "rejected" && (
        <p role="status">The team decided not to ship {title} this time. Thanks for the idea.</p>
      )}

      {view.status !== "preview_ready" && (
        <button type="button" className="tms-secondary" onClick={onNew}>
          Request something else
        </button>
      )}
    </div>
  );
}
