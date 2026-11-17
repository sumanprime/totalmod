/**
 * Self-contained styles, prefixed `tms-` so they don't collide with the host app. Theme it by
 * setting the custom properties on `.tms-root` (or any ancestor) in your own CSS.
 */
export const STYLES = `
.tms-root {
  --tms-accent: #2f5bea;
  --tms-accent-text: #ffffff;
  --tms-bg: #ffffff;
  --tms-text: #1c1c1a;
  --tms-muted: #6b6b66;
  --tms-border: #e3e3de;
  --tms-danger: #c2341b;
  --tms-radius: 12px;
  --tms-font: inherit;
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483000;
  font-family: var(--tms-font);
  color: var(--tms-text);
}
@media (prefers-color-scheme: dark) {
  .tms-root {
    --tms-accent: #7c9bff;
    --tms-accent-text: #0b0b0a;
    --tms-bg: #1e1e1c;
    --tms-text: #ececea;
    --tms-muted: #a0a09a;
    --tms-border: #33332f;
    --tms-danger: #ff8a73;
  }
}
.tms-root * { box-sizing: border-box; }
.tms-root button {
  font: inherit;
  cursor: pointer;
  border: 1px solid var(--tms-accent);
  border-radius: 8px;
  padding: 8px 14px;
  background: var(--tms-accent);
  color: var(--tms-accent-text);
}
.tms-root button:disabled { opacity: 0.6; cursor: default; }
.tms-root button.tms-secondary { background: transparent; color: var(--tms-text); border-color: var(--tms-border); }
.tms-root button.tms-icon { background: none; border: none; color: var(--tms-muted); font-size: 22px; line-height: 1; padding: 0 4px; }
.tms-launch { border-radius: 999px !important; box-shadow: 0 4px 16px rgb(0 0 0 / 0.18); }
.tms-panel {
  width: min(380px, calc(100vw - 32px));
  max-height: min(640px, calc(100vh - 32px));
  overflow-y: auto;
  background: var(--tms-bg);
  border: 1px solid var(--tms-border);
  border-radius: var(--tms-radius);
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.2);
  padding: 16px;
  font-size: 15px;
  line-height: 1.45;
}
.tms-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.tms-head h2 { margin: 0; font-size: 1.05rem; }
.tms-stack { display: flex; flex-direction: column; gap: 10px; }
.tms-stack p { margin: 0; }
.tms-row { display: flex; gap: 8px; flex-wrap: wrap; }
.tms-root label { font-weight: 600; font-size: 0.9rem; }
.tms-root textarea, .tms-root input:not([type]) {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--tms-border);
  border-radius: 8px;
  padding: 8px 10px;
  width: 100%;
}
.tms-question { border: 1px solid var(--tms-border); border-radius: 8px; padding: 8px 12px 12px; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.tms-question legend { font-weight: 600; padding: 0 4px; }
.tms-root label.tms-option { font-weight: 400; display: flex; gap: 8px; align-items: center; }
.tms-spec { margin: 0; display: grid; gap: 4px; }
.tms-spec dt { color: var(--tms-muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 6px; }
.tms-spec dd { margin: 0; }
.tms-spec ul { margin: 0; padding-left: 18px; }
.tms-error { color: var(--tms-danger); margin: 0 0 8px; }
.tms-root a.tms-button {
  align-self: flex-start;
  border-radius: 8px;
  padding: 8px 14px;
  background: var(--tms-accent);
  color: var(--tms-accent-text);
  text-decoration: none;
  font-weight: 600;
}
.tms-root .tms-launch.tms-ready { outline: 3px solid color-mix(in srgb, var(--tms-accent) 35%, transparent); }
.tms-muted { color: var(--tms-muted); font-size: 0.9rem; margin: 0; }
`;
