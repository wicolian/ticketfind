import type { PageMarkers, Platform, Want, Watch } from "../../src/server/types";

export type { PageMarkers, Platform, Want, Watch };

export interface PublicSettings {
  channels: {
    desktop: boolean;
    ntfyTopic: string;
    ntfyServer: string;
    discordWebhook: string;
    slackWebhook: string;
    telegramBotToken: string;
    telegramChatId: string;
  };
  aiReady: boolean;
  aiKey: string;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface City { name: string; lat: number; lng: number; cinemas: number }
export interface Movie { id: string; title: string; poster: string; backdrop: string; certificate: string; languages: string[]; genres: string[]; minutes: number; release: string; advance: boolean; link: string }
export interface Show { time: string; hhmm: string; language: string; format: string; screen: string; status: "open" | "filling" | "full" | "closed"; statusText: string; ref: string; bookUrl: string }
export interface CinemaShows { name: string; address: string; km?: number; shows: Show[] }
export type Seats =
  | { ok: true; total: number; free: number; freeGood: number; best: string[]; map: { row: string; front: boolean; seats: number[] }[] }
  | { ok: false; reason: string };

const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

export const api = {
  cities: (at?: { lat: number; lng: number }) => call<{ cities: City[]; nearest?: string }>("GET", `/api/explore/cities?${qs({ lat: at?.lat, lng: at?.lng })}`),
  movies: (city: string) => call<{ movies: Movie[] }>("GET", `/api/explore/movies?${qs({ city })}`),
  shows: (city: string, movie: string, date?: string, at?: { lat: number; lng: number }) =>
    call<{ days: string[]; date?: string; cinemas: CinemaShows[] }>("GET", `/api/explore/shows?${qs({ city, movie, date, lat: at?.lat, lng: at?.lng })}`),
  seats: (city: string, date: string, ref: string, group: number, skip: number) =>
    call<Seats>("GET", `/api/explore/seats?${qs({ city, date, ref, group, skip })}`),
  state: () => call<{ watches: Watch[]; settings: PublicSettings }>("GET", "/api/state"),
  inspect: (url: string) => call<{ platform: Platform; want: Want }>("POST", "/api/inspect", { url }),
  understand: (url: string, text: string, platform: Platform) =>
    call<{ want?: Want; page?: PageMarkers & { explanation: string } }>("POST", "/api/understand", { url, text, platform }),
  create: (input: { url: string; platform: Platform; want: Want; page?: PageMarkers; everySec: number }) =>
    call<Watch>("POST", "/api/watches", input),
  update: (id: string, patch: Partial<Watch>) => call<Watch>("PATCH", `/api/watches/${id}`, patch),
  checkNow: (id: string) => call<Watch>("POST", `/api/watches/${id}/check`),
  remove: (id: string) => call<{ ok: true }>("DELETE", `/api/watches/${id}`),
  saveSettings: (s: { channels: PublicSettings["channels"]; aiKey?: string }) => call<PublicSettings>("PUT", "/api/settings", s),
  testPing: () => call<{ sent: string[] }>("POST", "/api/test-ping"),
};

/** "2 side by side, not the 4 front rows, before 7 PM, English, 17 Dec to 18 Dec" */
export function describeWant(w: Want): string {
  const parts: string[] = [];
  parts.push(`${w.seats} seat${w.seats > 1 ? "s" : ""}${w.seats > 1 && w.together ? " side by side" : ""}`);
  if (w.skipFrontRows) parts.push(`not the ${w.skipFrontRows} front rows`);
  const fmt = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h >= 12 ? "PM" : "AM"}`;
  };
  if (w.startAfter && w.startBefore) parts.push(`starts ${fmt(w.startAfter)} to ${fmt(w.startBefore)}`);
  else if (w.startBefore) parts.push(`starts before ${fmt(w.startBefore)}`);
  else if (w.startAfter) parts.push(`starts after ${fmt(w.startAfter)}`);
  if (w.languages.length) parts.push(w.languages.map((l) => l[0].toUpperCase() + l.slice(1)).join(" or "));
  if (w.dates.length) {
    const d = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    parts.push(w.dates.length === 1 ? d(w.dates[0]) : w.dates.map(d).join(", "));
  }
  if (w.venues.length) parts.push(`at ${w.venues.join(" or ")}`);
  if (w.near) parts.push(`within ${w.near.km} km`);
  return parts.join(", ");
}

export function ago(iso?: string): string {
  if (!iso) return "not checked yet";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 5) return "checked just now";
  if (s < 60) return `checked ${s}s ago`;
  if (s < 3600) return `checked ${Math.round(s / 60)} min ago`;
  return `checked ${Math.round(s / 3600)} h ago`;
}
