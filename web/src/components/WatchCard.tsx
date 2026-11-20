import { useState } from "react";
import { ago, api, describeWant, type Watch } from "../api";
import { Chevron, External } from "../icons";

function Status({ w }: { w: Watch }) {
  if (w.status === "paused") return <span className="pill pill-paused"><span className="dot" />Paused</span>;
  if (w.status === "found") return <span className="pill pill-found"><span className="dot" />Seats open</span>;
  if (w.lastError) return <span className="pill pill-trouble"><span className="dot" />Site trouble</span>;
  return <span className="pill pill-watching"><span className="dot" />Watching</span>;
}

export function WatchCard({ w, onToast }: { w: Watch; onToast: (t: string) => void }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [checking, setChecking] = useState(false);
  const matches = w.status === "found" ? (w.last?.matches ?? []) : [];

  const rules = w.platform.depth === "page"
    ? w.page?.closedText
      ? `Pings when "${w.page.closedText}" disappears`
      : `Pings when "${w.page?.openText}" appears`
    : describeWant(w.want);

  return (
    <article className={`card watch ${w.status === "found" ? "found" : ""}`} aria-live="polite">
      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <h3>{w.platform.title}</h3>
          <p className="rules">{rules}</p>
        </div>
        <Status w={w} />
      </div>

      {matches.length > 0 ? (
        <div className="matches">
          {matches.slice(0, 4).map((m, i) => (
            <div className="match" key={m.bookUrl}>
              <div>
                <strong>{m.when}</strong>
                <div className="muted" style={{ fontSize: 14 }}>
                  {m.venue}{m.km !== undefined ? `, ${m.km} km` : ""}
                  {m.seats.length ? <> {" "}{m.seats.map((s) => <span className="seat" key={s}>{s}</span>)}</> : m.free ? `, ${m.free} free` : ""}
                </div>
              </div>
              <a className={`btn btn-sm ${i === 0 ? "btn-primary" : ""}`} href={m.bookUrl} target="_blank" rel="noreferrer">
                Book now <External size={14} />
              </a>
            </div>
          ))}
          {matches.length > 4 && <p className="hint">{matches.length - 4} more shows also fit.</p>}
        </div>
      ) : (
        <p className="summary muted">{w.lastError ? `The site is struggling: ${w.lastError}` : (w.last?.summary ?? "First check is running...")}</p>
      )}

      <div className="watch-foot">
        <span className="faint" style={{ fontSize: 13 }}>{ago(w.lastCheckAt)}, every {w.everySec < 60 ? `${w.everySec}s` : `${w.everySec / 60} min`}</span>
        <div className="row">
          <button
            className="btn btn-ghost btn-sm"
            disabled={checking || w.status === "paused"}
            onClick={async () => { setChecking(true); try { await api.checkNow(w.id); } finally { setChecking(false); } }}
          >
            {checking ? "Checking..." : "Check now"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => api.update(w.id, { status: w.status === "paused" ? "watching" : "paused" })}>
            {w.status === "paused" ? "Resume" : "Pause"}
          </button>
          {confirmRemove ? (
            <button className="btn btn-sm btn-danger" onClick={async () => { await api.remove(w.id); onToast("Stopped watching."); }} onBlur={() => setConfirmRemove(false)} autoFocus>
              Stop and remove
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(true)}>Remove</button>
          )}
        </div>
      </div>

      <details className="fold" style={{ marginTop: 4 }}>
        <summary><Chevron size={16} /> Activity</summary>
        <ul className="log">
          {w.log.map((l, i) => (
            <li key={i}>
              <time dateTime={l.at}>{new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
              <span style={{ color: l.kind === "found" ? "var(--ok)" : l.kind === "error" ? "var(--warn)" : undefined }}>{l.text}</span>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
