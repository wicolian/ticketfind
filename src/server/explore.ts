// Explore: browse what's showing in a city, see show times by cinema, and check real seats for one show.
// Data comes from PVR INOX's public website API (it lists PVR and INOX cinemas). Answers are cached briefly
// so browsing never hammers a site that may already be under load.
import { distanceKm, pickSeats, type Row } from "./rules.js";
import { BROWSER_UA } from "./adapters/types.js";

const API = "https://api3.inoxmovies.com/api/v1/booking/";
const cache = new Map<string, { at: number; value: unknown }>();

async function post<T = any>(path: string, city: string, body: unknown, ttlSec: number): Promise<T> {
  const key = `${path}|${city}|${JSON.stringify(body)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlSec * 1000) return hit.value as T;
  const res = await fetch(API + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer",
      chain: "INOX",
      city,
      country: "INDIA",
      platform: "WEBSITE",
      appVersion: "1.0",
      Origin: "https://www.inoxmovies.com",
      Referer: "https://www.inoxmovies.com/",
      "User-Agent": BROWSER_UA,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const value = JSON.parse((await res.text()).replace(/[\u0000-\u001f]+/g, " "));
  cache.set(key, { at: Date.now(), value });
  return value as T;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export interface City {
  name: string;
  lat: number;
  lng: number;
  cinemas: number;
}

export async function cities(): Promise<City[]> {
  const res = await post("content/city", "Chennai", {}, 24 * 3600);
  const o = res?.output ?? {};
  const all = [...(o.pc ?? []), ...(o.ot ?? []), ...(o.cc ? [o.cc] : [])];
  const seen = new Set<string>();
  return all
    .filter((c: any) => c?.name && !seen.has(c.name) && seen.add(c.name))
    .map((c: any) => ({ name: c.name, lat: Number(c.lat), lng: Number(c.lng), cinemas: Number(c.cinemaCount ?? 0) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function nearestCity(list: City[], at: { lat: number; lng: number }): City | undefined {
  return [...list]
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
    .sort((a, b) => distanceKm(at, a) - distanceKm(at, b))[0];
}

/** "Dec 17, 2026" or an ISO date in the future means tickets are on sale before release. */
function isFuture(release: unknown): boolean {
  const t = Date.parse(String(release ?? ""));
  if (!Number.isFinite(t)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return t > today.getTime();
}

export interface Movie {
  id: string; // PVR INOX common movie id, e.g. "35312"
  title: string;
  poster: string;
  backdrop: string;
  certificate: string;
  languages: string[];
  genres: string[];
  minutes: number;
  release: string;
  advance: boolean; // tickets on sale before release
  link: string; // the show-time list page on inoxmovies.com
}

export async function movies(city: string): Promise<Movie[]> {
  const res = await post("content/nowshowing", city, { city }, 300);
  return (res?.output?.mv ?? []).map((m: any) => {
    const langs = new Set<string>();
    for (const f of m.films ?? []) if (f.language) langs.add(f.language);
    const name = m.films?.[0]?.filmCommonName ?? m.n ?? m.filmName ?? "";
    const id = String(m.films?.[0]?.filmCommonCode ?? m.id);
    return {
      id,
      title: titleCase(name),
      poster: m.miv ?? "",
      backdrop: m.mih ?? m.backdropImage ?? "",
      certificate: m.ce ?? m.certificateLk ?? "",
      languages: [...langs],
      genres: String(m.grs ?? m.othergenres ?? "").split(",").map((g: string) => g.trim()).filter(Boolean).slice(0, 3),
      minutes: Number(m.mlength ?? 0),
      release: m.releaseDate ?? "",
      advance: isFuture(m.films?.[0]?.releaseDate ?? m.releaseDate),
      link: `https://www.inoxmovies.com/moviesessions/${encodeURIComponent(city)}/${name.replace(/[^A-Za-z0-9]+/g, "-").toUpperCase()}/${id}`,
    } satisfies Movie;
  });
}

export interface Show {
  time: string; // "04:55 PM"
  hhmm: string; // "16:55"
  language: string;
  format: string;
  screen: string;
  status: "open" | "filling" | "full" | "closed";
  statusText: string;
  ref: string; // the site's encrypted show id, used for seats and booking
  bookUrl: string;
}

export interface CinemaShows {
  name: string;
  address: string;
  km?: number;
  shows: Show[];
}

function statusOf(txt: string): Show["status"] {
  const t = txt.toLowerCase();
  if (t.includes("lapsed")) return "closed";
  if (t.includes("housefull") || t.includes("sold")) return "full";
  if (t.includes("fast") || t.includes("almost")) return "filling";
  return "open";
}

export async function shows(city: string, movieId: string, date: string | undefined, at?: { lat: number; lng: number }) {
  const body = (dated: string) => ({
    city,
    mid: movieId,
    experience: "ALL",
    specialTag: "ALL",
    lat: "0.000",
    lng: "0.000",
    lang: "ALL",
    format: "ALL",
    dated,
    time: "00:00-24:00",
    cinetype: "ALL",
    hc: "ALL",
    adFree: false,
    bbt: false,
  });
  const first = await post("content/msessions", city, body("NA"), 60);
  const days: string[] = (first?.output?.days ?? []).filter((d: any) => d.enable !== false).map((d: any) => String(d.dt));
  const day = date && days.includes(date) ? date : days[0];
  const res = day ? await post("content/msessions", city, body(day), 30) : first;
  const cinemas: CinemaShows[] = (res?.output?.movieCinemaSessions ?? []).map((cs: any) => {
    const lat = Number(cs.cinema?.latitude), lng = Number(cs.cinema?.longitude);
    const km = at && Number.isFinite(lat) && lat !== 0 ? Math.round(distanceKm(at, { lat, lng }) * 10) / 10 : undefined;
    const list: Show[] = [];
    for (const e of cs.experienceSessions ?? [])
      for (const s of e.shows ?? []) {
        const [h, m, ap] = (/(\d+):(\d+)\s*([AP]M)/i.exec(s.showTime) ?? []).slice(1);
        const hh = ((Number(h) % 12) + (String(ap).toUpperCase() === "PM" ? 12 : 0)).toString().padStart(2, "0");
        list.push({
          time: s.showTime,
          hhmm: `${hh}:${m}`,
          language: s.language ?? "",
          format: s.movieFormat ?? s.filmFormat ?? "",
          screen: s.screenType ?? "",
          status: statusOf(String(s.statusTxt ?? "")),
          statusText: String(s.statusTxt ?? ""),
          ref: s.encrypted,
          bookUrl: `https://www.inoxmovies.com/seatlayout/${s.encrypted}`,
        });
      }
    list.sort((a, b) => a.hhmm.localeCompare(b.hhmm));
    return { name: String(cs.cinema?.name ?? "Cinema").replace(/,?\s*(Chennai)?\s*$/i, ""), address: cs.cinema?.address1 ?? "", km, shows: list };
  });
  cinemas.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
  return { days, date: day, cinemas };
}

/** Live seats for one show: free seats outside the front rows and the best block for the group. */
export async function seats(city: string, date: string, ref: string, group: number, skipFrontRows: number) {
  const res = await post("ticketing/seatlayout", city, { dated: date, encrypted: ref, onPage: false, layoutType: "NEW" }, 10);
  const out = res?.output;
  if (!out?.rows) return { ok: false as const, reason: String(res?.msg || "The cinema did not answer.") };
  const rows: Row[] = out.rows
    .filter((r: any) => r.t === "seats" && Array.isArray(r.s))
    .map((r: any) => ({
      name: String(r.n),
      seats: r.s
        .map((s: any, pos: number) => ({ label: String(s.displaynumber ?? ""), pos, st: s.s }))
        .filter((s: any) => s.st === 1 || s.st === 2)
        .map((s: any) => ({ label: s.label, pos: s.pos, free: s.st === 1 })),
    }));
  const total = rows.reduce((n, r) => n + r.seats.length, 0);
  const freeAll = rows.reduce((n, r) => n + r.seats.filter((s) => s.free).length, 0);
  const pick = pickSeats(rows, { seats: group, together: group > 1, skipFrontRows });
  return {
    ok: true as const,
    total,
    free: freeAll,
    freeGood: pick.free,
    best: [...pick.seats].sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    // A small map for the UI: screen-first rows, each seat free or taken.
    map: rows.map((r, i) => ({ row: r.name, front: i < skipFrontRows, seats: r.seats.map((s) => (s.free ? 1 : 0)) })),
  };
}

