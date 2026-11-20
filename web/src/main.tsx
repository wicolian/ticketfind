import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type PublicSettings, type Watch } from "./api";
import { NewWatch } from "./components/NewWatch";
import { SettingsSheet } from "./components/SettingsSheet";
import { WatchCard } from "./components/WatchCard";
import { Bell, Settings as Gear, Ticket } from "./icons";
import "./styles.css";

function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.4);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
  } catch {
    /* sound is a bonus */
  }
}

function App() {
  const [watches, setWatches] = useState<Watch[] | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState("");
  const [loadError, setLoadError] = useState("");
  const [, tick] = useState(0);
  const prevStatus = useRef(new Map<string, string>());

  const say = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  useEffect(() => {
    api
      .state()
      .then((s) => {
        setWatches(s.watches);
        setSettings(s.settings);
        s.watches.forEach((w) => prevStatus.current.set(w.id, w.status));
      })
      .catch(() => setLoadError("Can't reach ticketfind. Is it still running in your terminal?"));

    const es = new EventSource("/api/events");
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === "removed") return setWatches((list) => (list ?? []).filter((w) => w.id !== e.id));
      const w: Watch = e.watch;
      setWatches((list) => {
        const l = list ?? [];
        return l.some((x) => x.id === w.id) ? l.map((x) => (x.id === w.id ? w : x)) : [w, ...l];
      });
      if (w.status === "found" && prevStatus.current.get(w.id) !== "found") {
        chime();
        const m0 = w.last?.matches[0];
        if (m0 && "Notification" in window && Notification.permission === "granted") {
          const n = new Notification(`Seats open: ${m0.when}`, { body: `${m0.venue} ${m0.seats.join(" + ")}`.trim() });
          n.onclick = () => window.open(m0.bookUrl, "_blank");
        }
      }
      prevStatus.current.set(w.id, w.status);
    };
    const t = window.setInterval(() => tick((n) => n + 1), 5000); // keep "checked 12s ago" fresh
    return () => { es.close(); window.clearInterval(t); };
  }, []);

  const found = (watches ?? []).filter((w) => w.status === "found").length;
  useEffect(() => {
    document.title = found ? `(${found}) Seats open, ticketfind` : "ticketfind";
  }, [found]);

  const noChannels = settings && !settings.channels.ntfyTopic && !settings.channels.discordWebhook && !settings.channels.slackWebhook && !settings.channels.telegramChatId;

  return (
    <main className="page">
      <header className="top">
        <div className="brand"><span className="brand-mark"><Ticket size={16} /></span>ticketfind</div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)} disabled={!settings}>
          <Gear size={16} /> Alerts
        </button>
      </header>

      {loadError ? (
        <div className="callout callout-danger" role="alert">{loadError}</div>
      ) : (
        <>
          <NewWatch aiReady={!!settings?.aiReady} onCreated={(t) => say(`Watching ${t}. We'll ping you when seats open.`)} onOpenSettings={() => setShowSettings(true)} />

          {watches && watches.length > 0 && noChannels && (
            <div className="callout callout-warn" style={{ marginTop: 16 }}>
              <Bell />
              <div className="spread" style={{ flex: 1, flexWrap: "wrap" }}>
                <span style={{ flex: "1 1 280px" }}>Alerts only reach this computer. Add your phone so you hear about seats when you're away.</span>
                <button className="btn btn-sm" onClick={() => setShowSettings(true)}>Add my phone</button>
              </div>
            </div>
          )}

          <div className="section-title">
            <h2>Watching</h2>
            {watches && watches.length > 0 && <span className="faint" style={{ fontSize: 13 }}>{watches.length} {watches.length === 1 ? "link" : "links"}</span>}
          </div>

          {watches === null ? (
            <div className="card empty"><p className="muted">Loading...</p></div>
          ) : watches.length === 0 ? (
            <div className="card empty">
              <div className="empty-art"><Bell size={22} /></div>
              <h3>Nothing watched yet</h3>
              <p>Paste a booking link above. ticketfind checks it every few seconds and pings you the moment seats you'd take open up.</p>
            </div>
          ) : (
            [...watches]
              .sort((a, b) => Number(b.status === "found") - Number(a.status === "found"))
              .map((w) => <WatchCard key={w.id} w={w} onToast={say} />)
          )}
        </>
      )}

      <p className="footer">Runs on your computer. Never books or pays for you. Open source.</p>

      {showSettings && settings && (
        <SettingsSheet settings={settings} onClose={() => setShowSettings(false)} onSaved={(s, msg) => { setSettings(s); say(msg); }} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
