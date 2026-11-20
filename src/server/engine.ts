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
    w.lastError = undefined;
    w.lastCheckAt = now();
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
      if (w.log[0]?.kind !== "check" || w.log[0].text !== result.summary) addLog(w, "check", result.summary);
    }
  } catch (e) {
    const n = (failures.get(id) ?? 0) + 1;
    failures.set(id, n);
    w.lastError = (e as Error).message;
    w.lastCheckAt = now();
    if (n === 1 || n % 10 === 0) addLog(w, "error", `The site did not answer: ${w.lastError}. Trying again.`);
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
    return () => listeners.delete(l);
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
