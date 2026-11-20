// Explore: browse what's showing in a city, see show times by cinema, and check real seats for one show.
// Data comes from PVR INOX's public website API (it lists PVR and INOX cinemas). Answers are cached briefly
// so browsing never hammers a site that may already be under load.
import { distanceKm, pickSeats, type Row } from "./rules.js";
import { BROWSER_UA } from "./adapters/types.js";

const API = "https://api3.inoxmovies.com/api/v1/booking/";
const cache = new Map<string, { at: number; value: unknown }>();

/** Cache any async answer for ttl seconds. */
async function cached<T>(key: string, ttlSec: number, get: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlSec * 1000) return hit.value as T;
  const value = await get();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ---- District: every other cinema (AGS, Cinepolis, Kasi, Sangam, single screens...) ----

const DISTRICT = "https://www.district.in";
const PVR_INOX = /^(PVR|INOX|HDFC Millennia PVR)\b/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

async function districtHtml(path: string): Promise<string> {
  const res = await fetch(DISTRICT + path, { headers: { "User-Agent": BROWSER_UA }, signal: AbortSignal.timeout(20_000) });
  return res.text();
}

function nextData(html: string): any {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  return m ? JSON.parse(m[1]) : null;
}

export const districtCityKey = (city: string) => city.toLowerCase().replace(/\s+/g, "-");

interface DistrictMovie { id: string; title: string; url: string }

/** Every movie District sells in a city (now showing and coming soon). */
export function districtMovies(city: string): Promise<DistrictMovie[]> {
  const key = districtCityKey(city);
  return cached(`district-movies|${key}`, 600, async () => {
    const seo = await districtHtml("/movies/");
    const seed = new RegExp(`/movies/[a-z0-9-]+-movie-tickets-in-${key}-MV\\d+`).exec(seo)?.[0];
    if (!seed) return [];
    const d = nextData(await districtHtml(seed));
    const out = new Map<string, DistrictMovie>();
    for (const it of d?.props?.pageProps?.data?.footerSeoData?.items ?? [])
      for (const v of Object.values(it?.configs ?? {}) as any[])
        for (const m of v?.place_holder_data ?? [])
          if (m?.type === "movies" && m.url) out.set(String(m.id), { id: String(m.id), title: String(m.title), url: String(m.url) });
    return [...out.values()];
  });
}

/** Poster and languages for a District-only movie, from its own page. */
function districtMovieInfo(url: string): Promise<{ poster: string; languages: string[]; certificate: string; genres: string[] }> {
  return cached(`district-info|${url}`, 3600, async () => {
    const html = await districtHtml(url);
    const poster = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1] ?? "";
    const d = nextData(html);
    const ms = d ? (Object.values(d.props?.pageProps?.data?.serverState?.movieSessions ?? {})[0] as any) : null;
    const meta = ms?.meta?.movie ?? {};
    const langs = new Set<string>();
    for (const c of ms?.arrangedSessions ?? []) for (const s of c.sessions ?? []) if (s.lang) langs.add(String(s.lang));
    return { poster, languages: [...langs], certificate: String(meta.cert ?? meta.censor ?? ""), genres: [] };
  });
}


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
  link: string; // where ticketfind watches it: inoxmovies.com, or district.in for District-only movies
  districtUrl?: string; // the District page for the same movie, when District sells it
}

export async function movies(city: string): Promise<Movie[]> {
  const [res, dist] = await Promise.all([post("content/nowshowing", city, { city }, 300), districtMovies(city).catch(() => [])]);
  const byTitle = new Map(dist.map((d) => [norm(d.title), d]));
  const pvr: Movie[] = (res?.output?.mv ?? []).map((m: any) => {
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
      districtUrl: byTitle.get(norm(name)) ? DISTRICT + byTitle.get(norm(name))!.url : undefined,
    } satisfies Movie;
  });
  // Movies only District sells (often regional films at single screens).
  const known = new Set(pvr.map((m) => norm(m.title)));
  const extra = dist.filter((d) => !known.has(norm(d.title))).slice(0, 24);
  const infos = await Promise.all(extra.map((d) => districtMovieInfo(d.url).catch(() => null)));
  const districtOnly: Movie[] = extra.map((d, i) => ({
    id: `d${d.id}`,
    title: d.title,
    poster: infos[i]?.poster ?? "",
    backdrop: "",
    certificate: infos[i]?.certificate ?? "",
    languages: infos[i]?.languages ?? [],
    genres: [],
    minutes: 0,
    release: "",
    advance: false,
    link: DISTRICT + d.url,
    districtUrl: DISTRICT + d.url,
  }));
  return [...pvr, ...districtOnly];
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
  source: "pvrinox" | "district";
  free?: number; // District only: its free-seat count
  total?: number;
}

export interface CinemaShows {
  name: string;
  address: string;
  km?: number;
  shows: Show[];
  source: "pvrinox" | "district";
}

function statusOf(txt: string): Show["status"] {
  const t = txt.toLowerCase();
  if (t.includes("lapsed")) return "closed";
  if (t.includes("housefull") || t.includes("sold")) return "full";
  if (t.includes("fast") || t.includes("almost")) return "filling";
  return "open";
}

/** District show times for one movie and date, for cinemas that are not PVR INOX (those come with seat maps). */
async function districtShows(movieUrl: string, date: string, at?: { lat: number; lng: number }, includePvrInox = false): Promise<CinemaShows[]> {
  const path = movieUrl.replace(DISTRICT, "");
  const d = await cached(`district-shows|${path}|${date}`, 30, async () => nextData(await districtHtml(`${path}?fromdate=${date}`)));
  const ms = d ? (Object.values(d.props?.pageProps?.data?.serverState?.movieSessions ?? {})[0] as any) : null;
  const contentId = /MV(\d+)/.exec(path)?.[1] ?? "";
  const out: CinemaShows[] = [];
  for (const c of ms?.arrangedSessions ?? []) {
    const name = String(c.entityName ?? "Cinema").replace(/,?\s*Chennai\s*$/i, "");
    if (!includePvrInox && PVR_INOX.test(name)) continue;
    const lat = Number(c.data?.lat), lng = Number(c.data?.lon);
    const km = at && Number.isFinite(lat) && lat !== 0 ? Math.round(distanceKm(at, { lat, lng }) * 10) / 10 : undefined;
    const list: Show[] = (c.sessions ?? [])
      .filter((s: any) => s.showDate === date)
      .map((s: any) => {
        const hhmm = String(s.showTimeLocal ?? "").slice(11, 16);
        const total = (s.areas ?? []).reduce((n: number, a: any) => n + Number(a.sTotal ?? 0), 0);
        const free = Number(s.avail ?? 0);
        const status: Show["status"] = free <= 0 ? "full" : total && free / total < 0.2 ? "filling" : "open";
        return {
          time: String(s.showTimeText ?? hhmm),
          hhmm,
          language: String(s.lang ?? ""),
          format: String(s.scrnFmt ?? ""),
          screen: "",
          status,
          statusText: free > 0 ? `${free} free` : "Sold out",
          ref: `district:${c.entityCode}:${s.sid}`,
          bookUrl: `${DISTRICT}/movies/seat-layout/${s.fid}?encsessionid=${c.entityCode}-${s.sid}-${String(s.mid).toLowerCase()}-${c.entityCode}&freeseating=false&fromsessions=&type=MOVIES&contentid=${contentId}&sessionid=${s.sid}`,
          source: "district" as const,
          free,
          total,
        } satisfies Show;
      })
      .sort((x: Show, y: Show) => x.hhmm.localeCompare(y.hhmm));
    if (list.length) out.push({ name, address: String(c.data?.address ?? ""), km, shows: list, source: "district" });
  }
  return out;
}

/** The next n days starting from a date (YYYY-MM-DD). */
function daysFrom(first: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(`${first}T00:00:00`);
    d.setDate(d.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
}

export async function shows(city: string, movieId: string, date: string | undefined, at?: { lat: number; lng: number }, districtUrl?: string) {
  // District-only movie: every cinema comes from District.
  if (movieId.startsWith("d") && districtUrl) {
    const first = nextData(await districtHtml(districtUrl.replace(DISTRICT, "")));
    const ms = first ? (Object.values(first.props?.pageProps?.data?.serverState?.movieSessions ?? {})[0] as any) : null;
    const firstDay: string | undefined = ms?.arrangedSessions?.[0]?.sessions?.[0]?.showDate;
    const days = firstDay ? daysFrom(firstDay, 4) : [];
    const day = date && days.includes(date) ? date : days[0];
    const cinemas = day ? await districtShows(districtUrl, day, at, true) : [];
    cinemas.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
    return { days, date: day, cinemas };
  }
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
          source: "pvrinox",
        });
      }
    list.sort((a, b) => a.hhmm.localeCompare(b.hhmm));
    return { name: String(cs.cinema?.name ?? "Cinema").replace(/,?\s*(Chennai)?\s*$/i, ""), address: cs.cinema?.address1 ?? "", km, shows: list, source: "pvrinox" as const };
  });
  // Every other cinema for the same movie and date, from District.
  if (districtUrl && day) {
    const more = await districtShows(districtUrl, day, at).catch(() => []);
    cinemas.push(...more);
  }
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

