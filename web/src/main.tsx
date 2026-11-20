import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, describeWant, type City, type Movie, type PublicSettings, type Want, type Watch } from "./api";
import { ExplorePage } from "./explore/ExplorePage";
import { MoviePage } from "./explore/MoviePage";
import { NewWatch } from "./components/NewWatch";
import { SettingsSheet } from "./components/SettingsSheet";
import { WatchCard } from "./components/WatchCard";
import { BulkActions, WatchingMenu, serverActions, type WatchActions } from "./components/WatchingMenu";
import { asWatch, useBrowserWatches } from "./browserWatch";
import { movieFromUrl, readShared } from "./share";
import { Bell, Pin, Settings as Gear, Ticket } from "./icons";
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

const REPO = "https://github.com/wicolian/ticketfind";

type Route = { page: "explore" } | { page: "movie"; id: string } | { page: "watching" } | { page: "join"; code: string };
function readRoute(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  if (h.startsWith("movie/")) return { page: "movie", id: h.slice(6) };
  if (h === "watching") return { page: "watching" };
  if (h.startsWith("join/")) return { page: "join", code: h.slice(5) };
  return { page: "explore" };
}
function store<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function keep(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ }
}

function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [city, setCity] = useState<string>(() => store("tf.city", "Chennai"));
  const [cities, setCities] = useState<City[]>([]);
  const [where, setWhere] = useState<{ lat: number; lng: number } | undefined>(() => store("tf.where", undefined));
  const [movie, setMovie] = useState<Movie | null>(null);
  const [locating, setLocating] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const isPublicRef = useRef(false);
  useEffect(() => { isPublicRef.current = isPublic; }, [isPublic]);
  const browser = useBrowserWatches(isPublic, (w) => { chime(); say(`Seats open: ${w.matches[0]?.when}, ${w.matches[0]?.venue}`); });
  const browserActions: WatchActions = { remove: browser.remove, bulk: browser.bulk, checkNow: browser.checkNow, setStatus: browser.setStatus };
  const actions = isPublic ? browserActions : serverActions;
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
    const on = () => setRoute(readRoute());
    addEventListener("hashchange", on);
    api.cities().then((r) => setCities(r.cities)).catch(() => {});
    api.meta().then((m) => { setIsPublic(m.public); setAiOn(m.ai); }).catch(() => {});
    // Tell the local app the tab is closing (it decides, after 15 s, whether that was a refresh).
    const bye = () => { if (!isPublicRef.current) navigator.sendBeacon?.("/api/tab-closed"); };
    addEventListener("pagehide", bye);
    return () => { removeEventListener("hashchange", on); removeEventListener("pagehide", bye); };
  }, []);
  const go = (h: string) => { location.hash = h; window.scrollTo(0, 0); };

  // A deep link to a movie: find it in the city's list.
  useEffect(() => {
    if (route.page !== "movie" || movie?.id === route.id) return;
    api.movies(city).then((r) => setMovie(r.movies.find((m) => m.id === route.id) ?? null)).catch(() => {});
  }, [route, city]);

  function locate() {
    if (!("geolocation" in navigator)) return say("This browser can't share a location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const at = { lat: Math.round(pos.coords.latitude * 1e4) / 1e4, lng: Math.round(pos.coords.longitude * 1e4) / 1e4 };
        setWhere(at); keep("tf.where", at); setLocating(false);
        const r = await api.cities(at).catch(() => null);
        if (r?.nearest) { setCity(r.nearest); keep("tf.city", r.nearest); say(`Showing ${r.nearest}, nearest cinemas first.`); }
      },
      () => { setLocating(false); say("Location was blocked. Pick your city instead."); },
      { timeout: 10_000, maximumAge: 600_000 },
    );
  }

  async function joinShared(code: string) {
    const x = readShared(code);
    if (!x) return say("That share link is broken or not for a cinema.");
    if (isPublic) {
      const m = movieFromUrl(x.url);
      if (!m) return say("That share link points to a page ticketfind can't watch.");
      if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission().catch(() => {});
      browser.add({ title: `${x.title} in ${m.city}`, label: x.label, city: m.city, movieId: m.movieId, districtUrl: m.districtUrl, link: x.url, want: x.want });
    } else {
      const { platform } = await api.inspect(x.url);
      await api.create({ url: x.url, platform, want: x.want, everySec: 15 });
    }
    say(`Watching ${x.title}, ${x.label}. We'll ping you when seats open.`);
    go("/watching");
  }

  async function watchShow(url: string, want: Want, label: string): Promise<string> {
    if (isPublic) {
      if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission().catch(() => {});
      const blocked = "Notification" in window && Notification.permission === "denied";
      const id = browser.add({ title: `${movie?.title ?? "Movie"} in ${city}`, label, city, movieId: movie?.id ?? "", districtUrl: movie?.districtUrl, link: url, want });
      say(blocked ? `Watching ${label}. Notifications are blocked in this browser, so keep this tab in view.` : `Watching ${label}. Keep this tab open: we'll notify you here.`);
      return id;
    }
    const { platform } = await api.inspect(url);
    const w = await api.create({ url, platform, want, everySec: 15 });
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    say(`Watching ${label}. We'll ping you when seats open.`);
    return w.id;
  }

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

  const shown: Watch[] | null = isPublic ? browser.list.map(asWatch) : watches;
  const found = (shown ?? []).filter((w) => w.status === "found").length;
  useEffect(() => {
    document.title = found ? `(${found}) Seats open, ticketfind` : "ticketfind";
  }, [found]);

  const noChannels = settings && !settings.channels.ntfyTopic && !settings.channels.discordWebhook && !settings.channels.slackWebhook && !settings.channels.telegramChatId;

  return (
    <main className="page">
      <header className="top">
        <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); go("/"); }}><span className="brand-mark"><Ticket size={16} /></span>ticketfind</a>
        <nav className="tabs-nav" aria-label="Main">
          <a href="#/" aria-current={route.page !== "watching" ? "page" : undefined} onClick={(e) => { e.preventDefault(); go("/"); }}>Explore</a>
          <WatchingMenu watches={shown} current={route.page === "watching"} onOpenPage={() => go("/watching")} onToast={say} actions={actions} />
        </nav>
        <div className="top-right">
          <select className="select city" aria-label="City" value={city} onChange={(e) => { setCity(e.target.value); keep("tf.city", e.target.value); }}>
            {(cities.length ? cities.map((c) => c.name) : [city]).map((n) => <option key={n}>{n}</option>)}
          </select>
          <button
            className="btn btn-ghost btn-sm near-toggle"
            aria-pressed={!!where}
            disabled={locating}
            title={where ? "Cinemas are sorted by distance from you. Click to turn off." : "Sort cinemas by distance from you"}
            onClick={() => { if (where) { setWhere(undefined); keep("tf.where", undefined); say("Location off. Cinemas in the site's order."); } else locate(); }}
          >
            <Pin size={15} /> {locating ? "Finding you..." : where ? "Near you" : "Near me"}
          </button>
          {isPublic ? (
            <a className="btn btn-ghost btn-sm" href={`${REPO}#start`} target="_blank" rel="noreferrer" title="Optional: alerts with the browser closed, and on your phone">Desktop app</a>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)} disabled={!settings} aria-label="Alerts"><Gear size={16} /></button>
          )}
        </div>
      </header>

      {route.page === "join" ? (
        (() => {
          const x = readShared(route.code);
          return (
            <section className="card hero" style={{ maxWidth: 560 }}>
              {x ? (
                <>
                  <p className="eyebrow-note">A friend shared a watch</p>
                  <h1 className="page-title">{x.title}</h1>
                  <p className="muted">{x.label}. {describeWant(x.want)}.</p>
                  <p className="hint">ticketfind checks it for you and notifies you the moment seats open. Nothing is booked or paid.</p>
                  <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn btn-primary" onClick={() => joinShared(route.code)}>Watch this too</button>
                    <button className="btn btn-ghost" onClick={() => go("/")}>Browse movies instead</button>
                  </div>
                </>
              ) : (
                <>
                  <h1 className="page-title">This share link doesn't work</h1>
                  <p className="muted">It may have been cut off when it was copied. Ask your friend to send it again.</p>
                  <button className="btn" style={{ marginTop: 12 }} onClick={() => go("/")}>Browse movies</button>
                </>
              )}
            </section>
          );
        })()
      ) : route.page === "explore" ? (
        <ExplorePage city={city} onOpen={(m) => { setMovie(m); go(`/movie/${m.id}`); }} />
      ) : route.page === "movie" ? (
        movie ? (
          <MoviePage city={city} movie={movie} where={where} onBack={() => go("/")} onLocate={locate} onWatch={watchShow} onStop={(id) => actions.remove(id)} aiOn={aiOn || !!settings?.aiReady} />
        ) : (
          <div className="card empty"><p className="muted">Loading the movie...</p></div>
        )
      ) : isPublic ? (
        <>
          <div className="explore-head">
            <h1 className="page-title">Watching</h1>
            <p className="muted" style={{ margin: 0 }}>Shows this browser checks for you every minute. Keep this tab open, even in the background, and you'll get a notification here when seats open.</p>
          </div>
          {"Notification" in window && Notification.permission !== "granted" && (
            <div className="callout callout-warn" style={{ marginBottom: 16 }}>
              <Bell />
              <div className="spread" style={{ flex: 1, flexWrap: "wrap" }}>
                <span style={{ flex: "1 1 280px" }}>{Notification.permission === "denied" ? "Notifications are blocked for this site. Allow them in the browser's site settings, or keep this tab in view." : "Allow notifications so you hear about seats while you're in another tab."}</span>
                {Notification.permission === "default" && <button className="btn btn-sm" onClick={() => Notification.requestPermission().then(() => tick((n) => n + 1))}>Allow notifications</button>}
              </div>
            </div>
          )}
          <div className="section-title">
            <h2>{browser.list.length ? `${browser.list.length} watching` : "Watching"}</h2>
            {browser.list.length > 0 && <BulkActions watches={shown ?? []} onToast={say} actions={actions} />}
          </div>
          {browser.list.length === 0 ? (
            <div className="card empty">
              <div className="empty-art"><Bell size={22} /></div>
              <h3>Nothing watched yet</h3>
              <p>Open a movie, tap a show time, then "Ping me if seats open". Or use "Ping me for any show that fits" to cover every show at once.</p>
              <button className="btn" style={{ marginTop: 12 }} onClick={() => go("/")}>Browse movies</button>
            </div>
          ) : (
            [...(shown ?? [])]
              .sort((a, b) => Number(b.status === "found") - Number(a.status === "found"))
              .map((w) => <WatchCard key={w.id} w={w} onToast={say} actions={actions} />)
          )}
          <p className="hint" style={{ marginTop: 16 }}>Want alerts with the browser closed, or on your phone? Install the optional <a href={`${REPO}#start`} target="_blank" rel="noreferrer">ticketfind app</a>.</p>
        </>
      ) : loadError ? (
        <div className="callout callout-danger" role="alert">{loadError}</div>
      ) : (
        <>
          <div className="explore-head"><h1 className="page-title">Watching</h1><p className="muted" style={{ margin: 0 }}>Shows ticketfind checks for you. Start one from Explore, or paste any booking link.</p></div>
          <NewWatch aiReady={!!settings?.aiReady} jevReady={!!settings?.jevReady} onCreated={(t) => say(`Watching ${t}. We'll ping you when seats open.`)} onOpenSettings={() => setShowSettings(true)} />

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
            {watches && watches.length > 0 && <BulkActions watches={watches} onToast={say} />}
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

      <footer className="footer">
        <p>{isPublic ? "Live seats from PVR INOX. Booking happens on their site. Get alerts with the free app." : "Runs on your computer. Never books or pays for you."}</p>
        <p className="footer-links">
          <a href={REPO} target="_blank" rel="noreferrer">Open source on GitHub</a>
          <a href="https://www.linkedin.com/in/kelashik" target="_blank" rel="noreferrer">Made by Koushik</a>
        </p>
      </footer>

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
