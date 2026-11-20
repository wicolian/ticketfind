import { useEffect, useRef, useState } from "react";
import { api, describeWant, type Watch } from "../api";
import { Chevron } from "../icons";

function statusOf(w: Watch): { label: string; cls: string } {
  if (w.status === "paused") return { label: "Paused", cls: "pill-paused" };
  if (w.status === "found") return { label: "Seats open", cls: "pill-found" };
  if (w.lastError) return { label: "Site trouble", cls: "pill-trouble" };
  return { label: "Watching", cls: "pill-watching" };
}

/** One line for a watch: the show it points at when it came from Explore, else its rules. */
function lineFor(w: Watch): string {
  const m = w.status === "found" ? w.last?.matches[0] : undefined;
  if (m) return `${m.when}, ${m.venue}${m.seats.length ? `, ${m.seats.join(" + ")}` : ""}`;
  return describeWant(w.want);
}

/** Pause all / Resume all / Stop all, with one confirm step before stopping. */
export function BulkActions({ watches, onToast, compact = false }: { watches: Watch[]; onToast: (t: string) => void; compact?: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const allPaused = watches.length > 0 && watches.every((w) => w.status === "paused");
  const n = watches.length;
  if (!n) return null;
  return (
    <div className={`bulk ${compact ? "bulk-compact" : ""}`}>
      <button
        className="btn btn-ghost btn-sm"
        onClick={async () => {
          await api.bulk(allPaused ? "resume" : "pause");
          onToast(allPaused ? `Watching all ${n} again.` : `Paused all ${n}.`);
        }}
      >
        {allPaused ? "Resume all" : "Pause all"}
      </button>
      {confirm ? (
        <button
          className="btn btn-sm btn-danger"
          autoFocus
          onBlur={() => setConfirm(false)}
          onClick={async () => {
            await api.bulk("stop");
            setConfirm(false);
            onToast(`Stopped all ${n}.`);
          }}
        >
          Yes, stop all {n}
        </button>
      ) : (
        <button className="btn btn-ghost btn-sm btn-danger" onClick={() => setConfirm(true)}>Stop all</button>
      )}
    </div>
  );
}

export function WatchingMenu({ watches, current, onOpenPage, onToast }: {
  watches: Watch[] | null; current: boolean; onOpenPage: () => void; onToast: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const list = [...(watches ?? [])].sort((a, b) => Number(b.status === "found") - Number(a.status === "found"));
  const found = list.filter((w) => w.status === "found").length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="wmenu" ref={box}>
      <button
        className="wmenu-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-current={current ? "page" : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        Watching
        {list.length > 0 && <span className={`nav-count ${found ? "hot" : ""}`}>{found || list.length}</span>}
        <Chevron size={14} />
      </button>
      {open && (
        <div className="wmenu-pop" role="dialog" aria-label="What you're watching">
          <div className="wmenu-head">
            <strong>{list.length ? `Watching ${list.length}` : "Nothing watched yet"}</strong>
            {found > 0 && <span className="pill pill-found"><span className="dot" />{found} with seats</span>}
          </div>
          {list.length === 0 ? (
            <p className="muted wmenu-empty">Open a movie and tap a show time, then "Ping me if seats open".</p>
          ) : (
            <ul className="wmenu-list">
              {list.map((w) => {
                const st = statusOf(w);
                const top = w.status === "found" ? w.last?.matches[0] : undefined;
                return (
                  <li key={w.id}>
                    <div className="wmenu-item">
                      <span className={`pill ${st.cls}`} title={st.label}><span className="dot" /></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="wmenu-title">{w.platform.title}</div>
                        <div className="wmenu-sub">{lineFor(w)}</div>
                      </div>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        {top && <a className="btn btn-primary btn-sm" href={top.bookUrl} target="_blank" rel="noreferrer">Book</a>}
                        {confirmId === w.id ? (
                          <button className="btn btn-sm btn-danger" autoFocus onBlur={() => setConfirmId("")} onClick={async () => { await api.remove(w.id); setConfirmId(""); onToast("Stopped watching."); }}>
                            Stop?
                          </button>
                        ) : (
                          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmId(w.id)} aria-label={`Stop watching ${w.platform.title}`}>Stop</button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="wmenu-foot">
            <BulkActions watches={list} onToast={onToast} compact />
            <button className="btn btn-sm" onClick={() => { setOpen(false); onOpenPage(); }}>See all</button>
          </div>
        </div>
      )}
    </div>
  );
}
