// Runs every watch on its own timer, remembers what it saw, and alerts only on news.
import { randomUUID } from "node:crypto";
import { adapterFor, minEverySec } from "./adapters/index.js";
import { sendAlert } from "./notify/index.js";
import { store } from "./store.js";
import type { LogEntry, Match, PageMarkers, Platform, Want, Watch } from "./types.js";

type Listener = (event: { type: "watch"; watch: Watch } | { type: "removed"; id: string }) => void;

const timers = new Map<string, NodeJS.Timeout>();
const running = new Set<string>();
const failures = new Map<string, number>();
const listeners = new Set<Listener>();
let watches: Watch[] = store.watches();

const LOG_CAP = 80;
/** A show must stay truly sold out this long, with the site answering, before ticketfind gives up. */
const GIVE_UP_AFTER_MS = 30 * 60_000;

/** For a watch on one exact show: the moment that show starts. */
function showStart(w: Watch): number | undefined {
  const { startAfter, startBefore, dates } = w.want;
  if (!startAfter || !startBefore || dates.length !== 1) return undefined;
  const [a, b] = [startAfter, startBefore].map((t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; });
  if (b - a > 1) return undefined;
  return new Date(`${dates[0]}T${startAfter}:00`).getTime();
}
let tabTimer: NodeJS.Timeout | undefined;

function now(): string {
  return new Date().toISOString();
}

function addLog(w: Watch, kind: LogEntry["kind"], text: string): void {
  w.log.unshift({ at: now(), kind, text });
  if (w.log.length > LOG_CAP) w.log.length = LOG_CAP;
}

function persist(w?: Watch): void {
  store.saveWatches(watches);
  if (w) for (const l of listeners) l({ type: "watch", watch: w });
}

function signature(ms: Match[]): string {
  return ms.map((m) => `${m.when}|${m.venue}|${m.seats.join("+")}`).sort().join(";");
}

function alertFor(w: Watch, ms: Match[]) {
  const top = ms[0];
  const seats = top.seats.length ? top.seats.join(" + ") : `${top.free} free`;
  const more = ms.length > 1 ? ` (+${ms.length - 1} more)` : "";
  return {
    title: `${w.want.seats} seat${w.want.seats > 1 ? "s" : ""} open: ${top.when}`,
    body: `${top.venue}, ${seats}${more}. ${w.platform.title}`,
    url: top.bookUrl,
  };
}

/** Every date the watch asked for is already in the past. */
function datesPassed(w: Watch): boolean {
  if (!w.want.dates.length) return false;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return w.want.dates.every((x) => x < today);
}

export async function checkNow(id: string): Promise<Watch | undefined> {
  const w = watches.find((x) => x.id === id);
  if (!w || running.has(id)) return w;
  const starts = showStart(w);
  if (starts && Date.now() > starts && w.status !== "paused") {
    w.status = "paused";
    w.ended = "The show has started, so ticketfind stopped watching it.";
    addLog(w, "check", w.ended);
    persist(w);
    return w;
  }
  if (datesPassed(w)) {
    if (w.status !== "paused") {
      w.status = "paused";
      addLog(w, "check", "Paused: the dates you picked have passed.");
      persist(w);
    }
    return w;
  }
  running.add(id);
  const before = signature(w.last?.matches ?? []);
  try {
    const result = await adapterFor(w.platform.id).check(w);
    failures.delete(id);
    w.last = result;
    w.lastError = result.state === "down" ? "The cinema's site isn't answering. ticketfind keeps trying." : undefined;
    w.lastCheckAt = now();
    if (result.state === "down" && w.log[0]?.kind !== "error") addLog(w, "error", "The cinema's site is down. ticketfind keeps trying.");
    if (result.state === "soldout") {
      w.soldOutSince ??= now();
      if (Date.now() - new Date(w.soldOutSince).getTime() >= GIVE_UP_AFTER_MS) {
        w.status = "paused";
        w.ended = "Gave up: every show you picked stayed truly sold out for 30 minutes, with the site answering.";
        addLog(w, "check", w.ended);
        const sent = await sendAlert(store.settings().channels, { title: "ticketfind gave up", body: `${w.platform.title}: truly sold out for 30 minutes. Resume it any time.`, url: w.url });
        if (sent.length) addLog(w, "notify", sent.join(", "));
        failures.delete(id);
        return w;
      }
    } else if (result.state !== "down") w.soldOutSince = undefined;
    const after = signature(result.matches);
    if (result.matches.length && after !== before) {
      w.status = "found";
      const a = alertFor(w, result.matches);
      addLog(w, "found", `${a.title}. ${a.body}`);
      const sent = await sendAlert(store.settings().channels, a);
      if (sent.length) addLog(w, "notify", sent.join(", "));
    } else if (!result.matches.length && before) {
      w.status = "watching";
      addLog(w, "gone", "Those seats are gone. Still watching.");
    } else if (!result.matches.length) {
      w.status = "watching";
      // Keep the log readable: only note a check when the summary changes.
      const note = result.state === "soldout" ? `${result.summary} Sold out right now. Still watching: seats often come back.` : result.summary;
      if (w.log[0]?.kind !== "check" || w.log[0].text !== note) addLog(w, "check", note);
    }
  } catch (e) {
    const n = (failures.get(id) ?? 0) + 1;
    failures.set(id, n);
    w.lastError = `The site isn't answering (${(e as Error).message}). ticketfind keeps trying.`;
    w.lastCheckAt = now();
    if (n === 1 || n % 10 === 0) addLog(w, "error", w.lastError);
  } finally {
    running.delete(id);
    persist(w);
  }
  return w;
}

function schedule(w: Watch): void {
  clearTimeout(timers.get(w.id));
  if (w.status === "paused") return;
  const base = Math.max(w.everySec, minEverySec(w));
  // Back off while the site keeps failing, up to 4x, and add jitter so we never hit it in lockstep.
  const backoff = Math.min(4, 1 + (failures.get(w.id) ?? 0) * 0.5);
  const delay = (base * backoff + Math.random() * base * 0.3) * 1000;
  timers.set(
    w.id,
    setTimeout(async () => {
      await checkNow(w.id);
      const fresh = watches.find((x) => x.id === w.id);
      if (fresh) schedule(fresh);
    }, delay),
  );
}

export const engine = {
  start(): void {
    for (const w of watches) schedule(w);
  },
  list(): Watch[] {
    return watches;
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    clearTimeout(tabTimer); // a tab is open again (or was only refreshed)
    return () => {
      listeners.delete(l);
      // The last tab went away, even if the browser never said goodbye (crash, lid closed, killed).
      if (listeners.size === 0) this.tabClosed();
    };
  },
  /**
   * The last tab was closed. Wait 15 seconds so a refresh does not count, then either keep watching
   * and say so, or stop everything, as the person chose in Alerts.
   */
  tabClosed(): void {
    clearTimeout(tabTimer);
    tabTimer = setTimeout(async () => {
      if (listeners.size > 0) return;
      const active = watches.filter((w) => w.status !== "paused");
      if (!active.length) return;
      const s = store.settings();
      if (s.onTabClose === "stop") {
        for (const w of [...watches]) this.remove(w.id);
        await sendAlert(s.channels, { title: "ticketfind stopped", body: `You closed ticketfind, so it stopped all ${active.length} watches.`, url: "http://127.0.0.1:4848" });
      } else {
        await sendAlert(s.channels, { title: `Still watching ${active.length}`, body: "ticketfind keeps checking after you close the tab. Open it to stop, or press Ctrl+C in its terminal.", url: "http://127.0.0.1:4848" });
      }
    }, 15_000);
  },
  async create(input: { url: string; platform: Platform; want: Want; page?: PageMarkers; everySec?: number }): Promise<Watch> {
    // The same link with the same rules is already being watched: hand that one back instead of a twin.
    const same = watches.find((x) => x.url === input.url && JSON.stringify(x.want) === JSON.stringify(input.want) && JSON.stringify(x.page ?? {}) === JSON.stringify(input.page ?? {}));
    if (same) {
      if (same.status === "paused") this.update(same.id, { status: "watching" });
      return same;
    }
    const w: Watch = {
      id: randomUUID().slice(0, 8),
      url: input.url,
      platform: input.platform,
      want: input.want,
      page: input.page,
      everySec: input.everySec ?? 20,
      status: "watching",
      createdAt: now(),
      log: [],
    };
    addLog(w, "check", "Started watching.");
    watches.unshift(w);
    persist(w);
    void checkNow(w.id).then(() => schedule(w));
    return w;
  },
  update(id: string, patch: Partial<Pick<Watch, "want" | "page" | "everySec" | "status">>): Watch | undefined {
    const w = watches.find((x) => x.id === id);
    if (!w) return undefined;
    Object.assign(w, patch);
    if (patch.status === "watching") { w.ended = undefined; w.soldOutSince = undefined; }
    if (patch.status) addLog(w, "check", patch.status === "paused" ? "Paused." : "Watching again.");
    persist(w);
    schedule(w);
    return w;
  },
  remove(id: string): void {
    clearTimeout(timers.get(id));
    timers.delete(id);
    watches = watches.filter((x) => x.id !== id);
    store.saveWatches(watches);
    for (const l of listeners) l({ type: "removed", id });
  },
};
