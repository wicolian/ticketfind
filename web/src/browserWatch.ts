// Watching in the browser: no app, no server. Watches live in this browser's storage, the page checks them
// every minute through the website's cached explore API, and a browser notification fires when seats open.
// Browsers slow timers in background tabs to about once a minute, which is the pace we use anyway.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Show, type Want, type Watch } from "./api";

export interface BrowserWatch {
  id: string;
  title: string; // "Avengers: Doomsday in Chennai"
  label: string; // "the 4:55 PM show at Marina"
  city: string;
  movieId: string;
  districtUrl?: string;
  link: string;
  want: Want;
  status: "watching" | "found" | "paused";
  matches: { when: string; venue: string; seats: string[]; free: number; bookUrl: string }[];
  summary: string;
  state?: "open" | "waiting" | "soldout" | "down";
  soldOutSince?: string;
  ended?: string;
  lastCheckAt?: string;
  createdAt: string;
}

const GIVE_UP_AFTER_MS = 30 * 60_000;
const DOWN = /trouble|connect|facing|try again|timeout|went wrong|did not answer/i;

/** For a watch on one exact show: the moment it starts. */
function showStart(w: BrowserWatch): number | undefined {
  const { startAfter, startBefore, dates } = w.want;
  if (!startAfter || !startBefore || dates.length !== 1) return undefined;
  const [a, b] = [startAfter, startBefore].map((t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; });
  return b - a > 1 ? undefined : new Date(`${dates[0]}T${startAfter}:00`).getTime();
}

const KEY = "tf.bwatches";
const EVERY_MS = 60_000;
const MAX_SEAT_CHECKS = 4; // seat-map calls per watch per round, to stay kind to the cinema

function load(): BrowserWatch[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
function save(list: BrowserWatch[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private window: lives for this tab only */ }
}

const niceDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

function fits(show: Show, venue: string, w: Want): boolean {
  if (w.startAfter && show.hhmm < w.startAfter) return false;
  if (w.startBefore && show.hhmm >= w.startBefore) return false;
  if (w.languages.length && !w.languages.some((l) => show.language.toLowerCase().includes(l))) return false;
  if (w.venues.length && !w.venues.some((v) => venue.toLowerCase().includes(v.toLowerCase()))) return false;
  return show.status !== "closed" && show.status !== "full";
}

/** One round for one watch: what fits right now. */
async function check(w: BrowserWatch): Promise<Pick<BrowserWatch, "matches" | "summary" | "state">> {
  const matches: BrowserWatch["matches"] = [];
  let looked = 0, soldOut = 0, down = 0;
  for (const date of w.want.dates.length ? w.want.dates : [undefined]) {
    const at = w.want.near ? { lat: w.want.near.lat, lng: w.want.near.lng } : undefined;
    let r;
    try { r = await api.shows(w.city, w.movieId, date, at, w.districtUrl); } catch { down++; continue; }
    const day = r.date ?? date ?? "";
    let seatChecks = 0;
    for (const c of r.cinemas) {
      if (w.want.near && c.km !== undefined && c.km > w.want.near.km) continue;
      for (const s of c.shows) {
        if (w.want.startAfter && s.hhmm < w.want.startAfter) continue;
        if (w.want.startBefore && s.hhmm >= w.want.startBefore) continue;
        if (w.want.venues.length && !w.want.venues.some((v) => c.name.toLowerCase().includes(v.toLowerCase()))) continue;
        if (w.want.languages.length && !w.want.languages.some((l) => s.language.toLowerCase().includes(l))) continue;
        if (s.status === "full") { looked++; soldOut++; continue; }
        if (!fits(s, c.name, w.want)) continue;
        looked++;
        if (s.source === "district") {
          if ((s.free ?? 0) <= 0) soldOut++;
          if ((s.free ?? 0) >= w.want.seats) matches.push({ when: `${niceDay(day)}, ${s.time.replace(/^0/, "")}`, venue: c.name, seats: [], free: s.free ?? 0, bookUrl: s.bookUrl });
          continue;
        }
        if (seatChecks >= MAX_SEAT_CHECKS) continue;
        seatChecks++;
        const seats = await api.seats(w.city, day, s.ref, w.want.seats, w.want.skipFrontRows).catch((e) => ({ ok: false as const, reason: String((e as Error).message) }));
        if (!seats.ok) { if (DOWN.test(seats.reason)) down++; continue; }
        if (seats.free === 0) soldOut++;
        if (seats.best.length) matches.push({ when: `${niceDay(day)}, ${s.time.replace(/^0/, "")}`, venue: c.name, seats: seats.best, free: seats.freeGood, bookUrl: s.bookUrl });
      }
    }
  }
  const state = matches.length ? "open" : down ? "down" : looked > 0 && soldOut === looked ? "soldout" : "waiting";
  const summary =
    state === "down" ? "The cinema's site isn't answering. ticketfind keeps trying."
    : !looked ? "No shows fit right now."
    : matches.length ? `${matches.length} of ${looked} shows have seats for you.`
    : state === "soldout" ? `Sold out right now (${looked} ${looked === 1 ? "show" : "shows"}). Still watching: seats often come back.`
    : `Checked ${looked} shows. None have seats that fit yet.`;
  return { matches, summary, state };
}

function notify(w: BrowserWatch) {
  const m = w.matches[0];
  if (!m) return;
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(`Seats open: ${m.when}`, { body: `${m.venue}${m.seats.length ? `, ${m.seats.join(" + ")}` : `, ${m.free} free`}. ${w.title}`, tag: w.id, requireInteraction: true });
      n.onclick = () => { window.open(m.bookUrl, "_blank"); n.close(); };
    }
  } catch { /* some browsers only notify from a service worker; the in-page alert still shows */ }
}

/** Browser watches as the same shape the Watching menu and cards already draw. */
export function asWatch(b: BrowserWatch): Watch {
  return {
    id: b.id,
    url: b.link,
    platform: { id: b.districtUrl && b.movieId.startsWith("d") ? "district" : "pvr-inox", name: "ticketfind", depth: "seats", meta: {}, title: b.title },
    lastError: b.state === "down" ? b.summary : undefined,
    ended: b.ended,
    soldOutSince: b.soldOutSince,
    want: b.want,
    everySec: EVERY_MS / 1000,
    status: b.status,
    createdAt: b.createdAt,
    lastCheckAt: b.lastCheckAt,
    last: { matches: b.matches, summary: b.summary, troubled: 0, state: b.state },
    log: [],
  };
}

export function useBrowserWatches(enabled: boolean, onFound: (w: BrowserWatch) => void) {
  const [list, setList] = useState<BrowserWatch[]>(() => (enabled ? load() : []));
  const ref = useRef(list);
  ref.current = list;
  const foundRef = useRef(onFound);
  foundRef.current = onFound;

  const write = useCallback((next: BrowserWatch[]) => { setList(next); save(next); }, []);

  const runOne = useCallback(async (id: string) => {
    const w = ref.current.find((x) => x.id === id);
    if (!w || w.status === "paused") return;
    const starts = showStart(w);
    if (starts && Date.now() > starts) {
      write(ref.current.map((x) => (x.id === id ? { ...x, status: "paused", ended: "The show has started, so ticketfind stopped watching it." } : x)));
      return;
    }
    try {
      const r = await check(w);
      const fresh = ref.current.find((x) => x.id === id);
      if (!fresh) return;
      if (r.state === "soldout") {
        const since = fresh.soldOutSince ?? new Date().toISOString();
        if (Date.now() - new Date(since).getTime() >= GIVE_UP_AFTER_MS) {
          const ended = "Gave up: every show you picked stayed truly sold out for 30 minutes, with the site answering.";
          write(ref.current.map((x) => (x.id === id ? { ...x, ...r, status: "paused", ended, soldOutSince: since, lastCheckAt: new Date().toISOString() } : x)));
          try { if (Notification.permission === "granted") new Notification("ticketfind gave up", { body: `${fresh.title}: truly sold out for 30 minutes. Resume it any time.`, tag: fresh.id }); } catch { /* fine */ }
          return;
        }
        fresh.soldOutSince = since;
      } else if (r.state !== "down") fresh.soldOutSince = undefined;
      const before = fresh.matches.map((m) => m.bookUrl + m.seats.join()).join("|");
      const after = r.matches.map((m) => m.bookUrl + m.seats.join()).join("|");
      const updated: BrowserWatch = { ...fresh, ...r, status: r.matches.length ? "found" : "watching", lastCheckAt: new Date().toISOString() };
      write(ref.current.map((x) => (x.id === id ? updated : x)));
      if (r.matches.length && after !== before) { notify(updated); foundRef.current(updated); }
    } catch {
      /* the site is struggling: try again next round */
    }
  }, [write]);

  useEffect(() => {
    if (!enabled) return;
    setList(load());
    const tick = () => { for (const w of ref.current) void runOne(w.id); };
    tick();
    const t = window.setInterval(tick, EVERY_MS);
    return () => window.clearInterval(t);
  }, [enabled, runOne]);

  return {
    list,
    add(w: Omit<BrowserWatch, "id" | "status" | "matches" | "summary" | "createdAt">): string {
      const same = ref.current.find((x) => x.movieId === w.movieId && JSON.stringify(x.want) === JSON.stringify(w.want));
      if (same) return same.id;
      const nw: BrowserWatch = { ...w, id: Math.random().toString(36).slice(2, 10), status: "watching", matches: [], summary: "First check is running...", createdAt: new Date().toISOString() };
      write([nw, ...ref.current]);
      setTimeout(() => void runOne(nw.id), 50);
      return nw.id;
    },
    remove(id: string) { write(ref.current.filter((x) => x.id !== id)); },
    bulk(action: "stop" | "pause" | "resume") {
      if (action === "stop") return write([]);
      write(ref.current.map((x) => ({ ...x, status: action === "pause" ? "paused" : "watching", ...(action === "resume" ? { ended: undefined, soldOutSince: undefined } : {}) })));
      if (action === "resume") for (const w of ref.current) void runOne(w.id);
    },
    checkNow: runOne,
    setStatus(id: string, status: "watching" | "paused") {
      write(ref.current.map((x) => (x.id === id ? { ...x, status, ...(status === "watching" ? { ended: undefined, soldOutSince: undefined } : {}) } : x)));
      if (status === "watching") void runOne(id);
    },
  };
}
