import { useState } from "react";
import { api, describeWant, type PageMarkers, type Platform, type Want } from "../api";
import { Ban, Chevron, Sparkles } from "../icons";

const DEPTH: Record<Platform["depth"], string> = {
  seats: "Picks exact seats",
  counts: "Watches free-seat counts",
  page: "Watches the page for words",
  none: "Cannot be watched",
};

const BEFORE = [["", "Any time"], ["12:00", "Before 12 PM"], ["15:00", "Before 3 PM"], ["17:00", "Before 5 PM"], ["19:00", "Before 7 PM"], ["21:00", "Before 9 PM"]];
const AFTER = [["", "Any time"], ["10:00", "From 10 AM"], ["12:00", "From 12 PM"], ["15:00", "From 3 PM"], ["18:00", "From 6 PM"], ["21:00", "From 9 PM"]];

/** Keep a value the AI set even if it is not one of the presets. */
function timeOptions(presets: string[][], current?: string): string[][] {
  if (!current || presets.some(([v]) => v === current)) return presets;
  const [h, m] = current.split(":").map(Number);
  const label = `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h >= 12 ? "PM" : "AM"}`;
  return [...presets, [current, presets === BEFORE ? `Before ${label}` : `From ${label}`]];
}

const EVERY = [
  { v: 15, l: "15 seconds" },
  { v: 30, l: "30 seconds" },
  { v: 60, l: "1 minute" },
  { v: 300, l: "5 minutes" },
];

interface Props {
  aiReady: boolean;
  onCreated: (title: string) => void;
  onOpenSettings: () => void;
}

export function NewWatch({ aiReady, onCreated, onOpenSettings }: Props) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"" | "inspect" | "ai" | "create">("");
  const [error, setError] = useState("");
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [want, setWant] = useState<Want | null>(null);
  const [page, setPage] = useState<PageMarkers>({});
  const [wish, setWish] = useState("");
  const [aiNote, setAiNote] = useState("");
  const [everySec, setEverySec] = useState(30);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");

  function useMyLocation() {
    if (!("geolocation" in navigator)) return setLocError("This browser can't share a location. Use the Cinemas field instead.");
    setLocating(true);
    setLocError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        set("near", { lat: Math.round(pos.coords.latitude * 1e4) / 1e4, lng: Math.round(pos.coords.longitude * 1e4) / 1e4, km: want?.near?.km ?? 10 });
      },
      () => {
        setLocating(false);
        setLocError("Location was blocked. Allow it for this page in the browser, or type cinema names below.");
      },
      { timeout: 10_000, maximumAge: 600_000 },
    );
  }

  const reset = () => {
    setPlatform(null);
    setWant(null);
    setPage({});
    setWish("");
    setAiNote("");
    setError("");
  };

  async function inspect(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    reset();
    setBusy("inspect");
    try {
      const r = await api.inspect(url);
      setPlatform(r.platform);
      setWant(r.want);
      setEverySec(r.platform.depth === "page" ? 60 : r.platform.depth === "counts" ? 30 : 15);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function understand() {
    if (!platform || !wish.trim()) return;
    setBusy("ai");
    setError("");
    try {
      const r = await api.understand(url, wish, platform);
      if (r.want) {
        setWant(r.want);
        setAiNote(`Got it: ${describeWant(r.want)}. Change anything below.`);
      }
      if (r.page) {
        setPage({ openText: r.page.openText, closedText: r.page.closedText });
        setAiNote(r.page.explanation);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function create() {
    if (!platform || !want) return;
    setBusy("create");
    setError("");
    try {
      if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
      await api.create({ url, platform, want, page: platform.depth === "page" ? page : undefined, everySec });
      onCreated(platform.title);
      setUrl("");
      reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  const set = <K extends keyof Want>(k: K, v: Want[K]) => setWant((w) => (w ? { ...w, [k]: v } : w));
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const pageNeedsWords = platform?.depth === "page" && !page.openText && !page.closedText;

  return (
    <section className="card">
      <form className="hero" onSubmit={inspect}>
        <h1>Get pinged the second seats open</h1>
        <p className="lede">Paste a booking link. ticketfind keeps checking, even while the site is falling over, and tells you when seats you'd take show up.</p>
        <label className="label" htmlFor="link">Booking link</label>
        <div className="paste">
          <input
            id="link"
            className="input"
            placeholder="A movie, concert, event or bus booking page"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button className={`btn ${platform ? "" : "btn-primary"}`} disabled={!url.trim() || busy === "inspect"}>
            {busy === "inspect" ? "Reading link..." : "Watch this"}
          </button>
        </div>
        {error && !platform && <p className="hint" style={{ color: "var(--danger)" }} role="alert">{error}</p>}
        {!platform && (
          <div className="supported">
            <span className="badge">PVR INOX: exact seats</span>
            <span className="badge">District: free-seat counts</span>
            <span className="badge">Concerts, events, buses: watch the page</span>
          </div>
        )}
      </form>

      {platform && platform.id === "blocked" && (
        <div className="panel stack">
          <div className="callout callout-danger" role="alert">
            <Ban />
            <div>
              <strong>ticketfind can't watch {platform.name}.</strong>
              <div>{platform.blockedReason}</div>
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={() => { setUrl(""); reset(); }}>Try another link</button>
          </div>
        </div>
      )}

      {platform && want && platform.id !== "blocked" && (
        <div className="panel stack">
          <div className="platform">
            <div style={{ flex: 1 }}>
              <h3>{platform.title}</h3>
              <div className="row" style={{ marginTop: 6 }}>
                <span className="badge">{platform.name}</span>
                <span className="badge">{DEPTH[platform.depth]}</span>
              </div>
            </div>
          </div>

          <div className="ai-box">
            <label className="label" htmlFor="wish">
              {platform.depth === "page" ? "What should ticketfind wait for?" : "What do you need?"}
            </label>
            <textarea
              id="wish"
              className="textarea"
              placeholder={
                platform.depth === "page"
                  ? "Tell me when tickets go on sale"
                  : "2 seats side by side, not the front rows, English, before 7 pm on 17 or 18 Dec"
              }
              value={wish}
              onChange={(e) => setWish(e.target.value)}
            />
            <div className="row">
              {aiReady ? (
                <button type="button" className="btn btn-sm" onClick={understand} disabled={!wish.trim() || busy === "ai"}>
                  <Sparkles size={16} /> {busy === "ai" ? "Reading..." : "Fill in from my words"}
                </button>
              ) : (
                <span className="hint" style={{ margin: 0 }}>
                  Fill the fields below, or{" "}
                  <button type="button" className="btn-ghost" style={{ border: 0, padding: 0, textDecoration: "underline", cursor: "pointer", background: "none" }} onClick={onOpenSettings}>
                    add a Claude key
                  </button>{" "}
                  to type it in plain words.
                </span>
              )}
            </div>
            {aiNote && <p className="hint" style={{ marginBottom: 0 }}>{aiNote}</p>}
          </div>

          {platform.depth === "page" ? (
            <div className="grid">
              <div>
                <label className="label" htmlFor="closed">Text shown while you can't book</label>
                <input id="closed" className="input" placeholder="Sold out" value={page.closedText ?? ""} onChange={(e) => setPage({ ...page, closedText: e.target.value })} />
                <p className="hint">When this disappears, you get pinged.</p>
              </div>
              <div>
                <label className="label" htmlFor="open">Text shown when you can</label>
                <input id="open" className="input" placeholder="Book now" value={page.openText ?? ""} onChange={(e) => setPage({ ...page, openText: e.target.value })} />
                <p className="hint">When this appears, you get pinged.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid">
                <div>
                  <label className="label" htmlFor="seats">Seats</label>
                  <select id="seats" className="select" value={want.seats} onChange={(e) => set("seats", Number(e.target.value))}>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                {platform.depth === "seats" && (
                  <div>
                    <label className="label" htmlFor="front">Avoid front rows</label>
                    <select id="front" className="select" value={want.skipFrontRows} onChange={(e) => set("skipFrontRows", Number(e.target.value))}>
                      <option value={0}>Any row is fine</option>
                      {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>Skip front {n}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="label" htmlFor="before">Show starts</label>
                  <select id="before" className="select" value={want.startBefore ?? ""} onChange={(e) => set("startBefore", e.target.value || undefined)}>
                    {timeOptions(BEFORE, want.startBefore).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="lang">Language</label>
                  <input id="lang" className="input" placeholder="Any" value={want.languages.join(", ")} onChange={(e) => set("languages", list(e.target.value.toLowerCase()))} />
                </div>
              </div>
              <div className="near">
                <div>
                  <span className="label" style={{ marginBottom: 2 }}>Cinemas near you</span>
                  <span className="hint" style={{ margin: 0 }}>
                    {want.near ? "Only cinemas this close count, nearest first. Your location stays on this computer." : "Skip far-away cinemas and see the nearest seats first."}
                  </span>
                </div>
                {want.near ? (
                  <div className="row">
                    <select aria-label="How far" className="select" style={{ width: "auto" }} value={want.near.km} onChange={(e) => set("near", { ...want.near!, km: Number(e.target.value) })}>
                      {[3, 5, 10, 20, 40].map((k) => <option key={k} value={k}>Within {k} km</option>)}
                    </select>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => set("near", undefined)}>Anywhere</button>
                  </div>
                ) : (
                  <button type="button" className="btn btn-sm" onClick={useMyLocation} disabled={locating}>{locating ? "Finding you..." : "Use my location"}</button>
                )}
              </div>
              {locError && <p className="hint" style={{ color: "var(--warn)", marginTop: 0 }}>{locError}</p>}
              {platform.depth === "seats" && want.seats > 1 && (
                <label className="check">
                  <input type="checkbox" checked={want.together} onChange={(e) => set("together", e.target.checked)} />
                  Seats must be side by side
                </label>
              )}
              <details className="fold">
                <summary><Chevron size={16} /> Dates, cinemas, earliest show</summary>
                <div className="grid" style={{ marginTop: 12 }}>
                  <div>
                    <label className="label" htmlFor="dates">Dates</label>
                    <input id="dates" className="input" placeholder="2026-12-17, 2026-12-18" value={want.dates.join(", ")} onChange={(e) => set("dates", list(e.target.value))} />
                    <p className="hint">Empty means every day on sale.</p>
                  </div>
                  <div>
                    <label className="label" htmlFor="venues">Cinemas</label>
                    <input id="venues" className="input" placeholder="Marina, Sathyam" value={want.venues.join(", ")} onChange={(e) => set("venues", list(e.target.value))} />
                    <p className="hint">Words from the cinema name. Empty means all.</p>
                  </div>
                  <div>
                    <label className="label" htmlFor="after">Not earlier than</label>
                    <select id="after" className="select" value={want.startAfter ?? ""} onChange={(e) => set("startAfter", e.target.value || undefined)}>
                      {timeOptions(AFTER, want.startAfter).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                </div>
              </details>
            </>
          )}

          <div className="spread" style={{ flexWrap: "wrap" }}>
            <div className="row">
              <label className="label" htmlFor="every" style={{ margin: 0 }}>Check every</label>
              <select id="every" className="select" style={{ width: "auto" }} value={everySec} onChange={(e) => setEverySec(Number(e.target.value))}>
                {EVERY.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>
            <div className="row">
              <button type="button" className="btn btn-ghost" onClick={() => { setUrl(""); reset(); }}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={create} disabled={busy === "create" || pageNeedsWords}>
                {busy === "create" ? "Starting..." : "Start watching"}
              </button>
            </div>
          </div>
          {pageNeedsWords && <p className="hint" style={{ marginTop: 0 }}>Add the words to watch for, so ticketfind knows what "on sale" looks like.</p>}
          {error && <p className="hint" style={{ color: "var(--danger)", marginTop: 0 }} role="alert">{error}</p>}
        </div>
      )}
    </section>
  );
}
