import { useEffect, useRef, useState } from "react";
import { SHARE_URL, shareTicketfind } from "../share";
import { Share, X } from "../icons";

const HIDDEN_KEY = "tf.shareHidden";

/** One button: opens the share sheet, or copies the link and says so on the button itself. */
export function ShareButton({ label = "Share with friends", className = "btn btn-ghost btn-sm" }: { label?: string; className?: string }) {
  const [state, setState] = useState<"" | "copied" | "failed">("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function onClick() {
    const r = await shareTicketfind();
    if (r === "copied" || r === "failed") {
      setState(r);
      window.clearTimeout(timer.current);
      if (r === "copied") timer.current = window.setTimeout(() => setState(""), 2500);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={onClick}>
        <Share size={15} /> {state === "copied" ? "Link copied" : label}
      </button>
      <span className="sr-only" role="status">{state === "copied" ? "Link copied. Paste it to your friends." : ""}</span>
      {state === "failed" && <span className="hint share-fallback">Copy this link: <a href={SHARE_URL}>{SHARE_URL.replace("https://", "")}</a></span>}
    </>
  );
}

/** Quiet card under the watch list. Shows once something is being watched; can be hidden for good. */
export function ShareCard() {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(HIDDEN_KEY) === "1"; } catch { return false; }
  });
  if (hidden) return null;
  const hide = () => {
    setHidden(true);
    try { localStorage.setItem(HIDDEN_KEY, "1"); } catch { /* private window */ }
  };

  return (
    <aside className="card share-card" aria-label="Share ticketfind">
      <div className="share-art"><Share size={18} /></div>
      <div className="share-copy">
        <h3>Going with friends?</h3>
        <p>Send them ticketfind so they can watch shows too. Whoever gets pinged first books for the group.</p>
      </div>
      <div className="share-actions">
        <ShareButton className="btn btn-sm" />
        <button type="button" className="btn btn-ghost btn-sm share-close" onClick={hide} aria-label="Hide this">
          <X size={16} />
        </button>
      </div>
    </aside>
  );
}
