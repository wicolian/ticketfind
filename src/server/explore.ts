// Explore: browse what's showing in a city, see show times by cinema, and check real seats for one show.
// Data comes from PVR INOX's public website API (it lists PVR and INOX cinemas). Answers are cached briefly
// so browsing never hammers a site that may already be under load.
import { distanceKm, pickSeats, type Row } from "./rules.js";
import { BROWSER_UA } from "./adapters/types.js";
import { districtSeatMap, keyOf, refOf } from "./districtSeats.js";
import { chainCinemas, chainSeats, isChainRef } from "./chains/index.js";

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
  shows?: number; // how many shows PVR INOX runs in the city (popularity)
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
      shows: Number(m.showCount ?? 0),
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

/** Movies whose booking has not opened in the city yet, soonest first. */
export async function comingSoon(city: string): Promise<Movie[]> {
  const [res, now] = await Promise.all([post("content/comingsoon", city, { city }, 900), post("content/nowshowing", city, { city }, 300)]);
  const showing = new Set((now?.output?.mv ?? []).map((m: any) => String(m.films?.[0]?.filmCommonCode ?? m.id)));
  const list: Movie[] = [];
  for (const m of res?.output?.movies ?? []) {
    const id = String(m.films?.[0]?.filmCommonCode ?? m.id ?? "");
    if (!id || showing.has(id)) continue;
    const name = String(m.films?.[0]?.filmCommonName ?? m.filmName ?? "").replace(/\s*\(.*$/, "");
    const langs = new Set<string>();
    for (const f of m.films ?? []) if (f.language) langs.add(f.language);
    list.push({
      id,
      title: titleCase(name),
      poster: m.miv ?? "",
      backdrop: m.mih ?? m.backdropImage ?? "",
      certificate: m.certificateLk ?? "",
      languages: [...langs],
      genres: [],
      minutes: 0,
      release: m.releaseDate ?? "",
      advance: true,
      link: `https://www.inoxmovies.com/moviesessions/${encodeURIComponent(city)}/${name.replace(/[^A-Za-z0-9]+/g, "-").toUpperCase()}/${id}`,
      shows: 0,
    });
  }
  return list.sort((a, b) => (Date.parse(a.release) || Infinity) - (Date.parse(b.release) || Infinity)).slice(0, 18);
}

const BIG_CITIES = ["Chennai", "Mumbai", "Delhi-NCR", "Bengaluru", "Hyderabad", "Kolkata", "Pune"];

/** What's biggest across India right now: total PVR INOX shows in the big cities. */
export async function trending(): Promise<{ id: string; title: string; poster: string; shows: number; cities: number }[]> {
  return cached("trending", 600, async () => {
    const lists = await Promise.all(BIG_CITIES.map((c) => post("content/nowshowing", c, { city: c }, 300).catch(() => null)));
    const total = new Map<string, { id: string; title: string; poster: string; shows: number; cities: number }>();
    for (const res of lists)
      for (const m of res?.output?.mv ?? []) {
        const id = String(m.films?.[0]?.filmCommonCode ?? m.id);
        const t = total.get(id) ?? { id, title: titleCase(String(m.films?.[0]?.filmCommonName ?? m.n ?? "")), poster: m.miv ?? "", shows: 0, cities: 0 };
        t.shows += Number(m.showCount ?? 0);
        t.cities += 1;
        total.set(id, t);
      }
    return [...total.values()].sort((a, b) => b.shows - a.shows).slice(0, 8);
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
  source: "pvrinox" | "district" | "chain";
  free?: number; // District only: its free-seat count
  total?: number;
  /** District only: each seat class with its price and free seats. */
  classes?: { label: string; price: number; free: number }[];
  /** Cheapest seat class still on sale, in rupees. */
  priceFrom?: number;
}

export interface CinemaShows {
  name: string;
  address: string;
  km?: number;
  shows: Show[];
  source: "pvrinox" | "district" | "chain";
  /** For source "chain": the chain's name, e.g. "Miraj Cinemas". */
  chain?: string;
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
        const classes = (s.areas ?? []).map((a: any) => ({ label: String(a.label ?? "").replace(/\b\w+/g, (w: string) => w[0] + w.slice(1).toLowerCase()), price: Number(a.price ?? 0), free: Number(a.sAvail ?? 0) })).filter((c: any) => c.price > 0);
        const onSale = classes.filter((c: any) => c.free > 0).map((c: any) => c.price);
        const status: Show["status"] = free <= 0 ? "full" : total && free / total < 0.2 ? "filling" : "open";
        return {
          time: String(s.showTimeText ?? hhmm),
          hhmm,
          language: String(s.lang ?? ""),
          format: String(s.scrnFmt ?? ""),
          screen: "",
          status,
          statusText: free > 0 ? `${free} free` : "Sold out",
          ref: refOf({ cid: String(c.entityCode), sid: String(s.sid), pid: String(s.pid), mid: String(s.mid), fid: String(s.fid), fmt: String(s.scrnFmt || "2D"), contentId, date, city: String(ms?.meta?.city ?? "") || cityFromUrl(movieUrl) }),
          bookUrl: `${DISTRICT}/movies/seat-layout/${s.fid}?encsessionid=${c.entityCode}-${s.sid}-${String(s.mid).toLowerCase()}-${c.entityCode}&freeseating=false&fromsessions=&type=MOVIES&contentid=${contentId}&sessionid=${s.sid}`,
          source: "district" as const,
          free,
          total,
          classes,
          priceFrom: onSale.length ? Math.min(...onSale) : undefined,
        } satisfies Show;
      })
      .sort((x: Show, y: Show) => x.hhmm.localeCompare(y.hhmm));
    if (list.length) out.push({ name, address: String(c.data?.address ?? ""), km, shows: list, source: "district" });
  }
  return out;
}

const titleFromDistrictUrl = (u: string) => (/movies\/(.+)-movie-tickets-in-/.exec(u)?.[1] ?? "").replace(/-/g, " ");

/** The same cinema can be on District and on its own site: keep the first one found. */
const cinemaKey = (n: string) => n.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !/^(cinemas?|theatres?|the|a\/c|4k|dolby|atmos|laser|rgb)$/.test(w)).slice(0, 2).join(" ");
function dedupe(have: CinemaShows[], more: CinemaShows[]): CinemaShows[] {
  const seen = new Set(have.map((c) => cinemaKey(c.name)));
  return more.filter((c) => !seen.has(cinemaKey(c.name)));
}

async function chainShows(city: string, title: string, date: string, at?: { lat: number; lng: number }, on?: OnProgress): Promise<CinemaShows[]> {
  const list = await chainCinemas(city, title, date, at, on).catch(() => []);
  return list.map(({ chain, cinema, km }) => ({
    name: cinema.name,
    address: cinema.address,
    km,
    source: "chain" as const,
    chain: chain.name,
    shows: cinema.shows.map((s) => ({
      time: s.time,
      hhmm: s.hhmm,
      language: s.language,
      format: s.format,
      screen: "",
      status: s.status,
      statusText: s.free !== undefined ? (s.free > 0 ? `${s.free} free` : "Sold out") : s.status === "full" ? "Sold out" : "",
      ref: s.ref,
      bookUrl: s.bookUrl,
      source: "chain" as const,
      free: s.free,
      total: s.total,
      priceFrom: s.priceFrom,
    })),
  }));
}

const cityFromUrl = (u: string) => /-movie-tickets-in-([a-z-]+)-MV/.exec(u)?.[1] ?? "";

/** The next n days starting from a date (YYYY-MM-DD). */
function daysFrom(first: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(`${first}T00:00:00`);
    d.setDate(d.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
}

/** One site's answer while show times load, for the "who is slow" list on the movie page. */
export interface SourceProgress { name: string; state: "asking" | "done" | "failed"; ms?: number; cinemas?: number; note?: string }
export type OnProgress = (p: SourceProgress) => void;

/** Time one site's call and report it. A failure reports and returns the fallback. */
export async function timed<T>(name: string, on: OnProgress | undefined, fn: () => Promise<T>, count: (r: T) => number | undefined, fallback?: T): Promise<T> {
  const t = Date.now();
  on?.({ name, state: "asking" });
  try {
    const r = await fn();
    on?.({ name, state: "done", ms: Date.now() - t, cinemas: count(r) });
    return r;
  } catch (e) {
    on?.({ name, state: "failed", ms: Date.now() - t, note: (e as Error).message });
    if (fallback !== undefined) return fallback;
    throw e;
  }
}

export async function shows(city: string, movieId: string, date: string | undefined, at?: { lat: number; lng: number }, districtUrl?: string, on?: OnProgress) {
  // District-only movie: every cinema comes from District.
  if (movieId.startsWith("d") && districtUrl) {
    const first = await timed("District", on, async () => nextData(await districtHtml(districtUrl.replace(DISTRICT, ""))), () => undefined);
    const ms = first ? (Object.values(first.props?.pageProps?.data?.serverState?.movieSessions ?? {})[0] as any) : null;
    const firstDay: string | undefined = ms?.arrangedSessions?.[0]?.sessions?.[0]?.showDate;
    const days = firstDay ? daysFrom(firstDay, 4) : [];
    const day = date && days.includes(date) ? date : days[0];
    const [cinemas, chains] = day
      ? await Promise.all([districtShows(districtUrl, day, at, true), chainShows(city, ms?.movieDetails?.name ?? ms?.meta?.movieName ?? titleFromDistrictUrl(districtUrl), day, at, on)])
      : [[], []];
    cinemas.push(...dedupe(cinemas, chains));
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
  const res = await timed("PVR INOX", on, async () => {
    const first = await post("content/msessions", city, body("NA"), 60);
    const days: string[] = (first?.output?.days ?? []).filter((d: any) => d.enable !== false).map((d: any) => String(d.dt));
    const day = date && days.includes(date) ? date : days[0];
    return { days, day, res: day ? await post("content/msessions", city, body(day), 30) : first };
  }, (r) => r.res?.output?.movieCinemaSessions?.length ?? 0, { days: [] as string[], day: undefined as string | undefined, res: null as any });
  const { days, day } = res;
  const cinemas: CinemaShows[] = (res.res?.output?.movieCinemaSessions ?? []).map((cs: any) => {
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
  // Every other cinema for the same movie and date: District, and chains read from their own websites
  // (Miraj, MovieTime, Mukta A2, Mayajaal ...), all at the same time. A cinema already listed is not repeated.
  if (day) {
    const [more, chains] = await Promise.all([
      districtUrl ? timed("District", on, () => districtShows(districtUrl, day, at), (r) => r.length, [] as CinemaShows[]) : Promise.resolve([] as CinemaShows[]),
      // The chains match by title, so look it up first; District does not wait for this.
      movies(city).catch(() => []).then((list) => chainShows(city, list.find((m) => m.id === movieId)?.title ?? "", day, at, on)),
    ]);
    cinemas.push(...more);
    cinemas.push(...dedupe(cinemas, chains));
  }
  cinemas.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
  return { days, date: day, cinemas };
}

/** Live seats for one show: free seats outside the front rows and the best block for the group. */
async function districtSeats(ref: string, group: number, skipFrontRows: number) {
  const k = keyOf(ref)!;
  let rows;
  try {
    rows = await districtSeatMap(k);
  } catch (e) {
    return { ok: false as const, reason: (e as Error).message };
  }
  const total = rows.reduce((n, r) => n + r.seats.length, 0);
  const freeAll = rows.reduce((n, r) => n + r.seats.filter((s) => s.free).length, 0);
  const pick = pickSeats(rows, { seats: group, together: group > 1, skipFrontRows });
  return {
    ok: true as const,
    total,
    free: freeAll,
    freeGood: pick.free,
    best: [...pick.seats].sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    price: undefined as number | undefined,
    area: pick.seats[0] ? rows.find((r) => pick.seats[0].startsWith(r.name))?.area : undefined,
    classes: undefined as { label: string; price: number }[] | undefined,
    map: rows.map((r, i) => ({ row: r.name, front: i < skipFrontRows, seats: [...r.seats].sort((a, b) => a.pos - b.pos).map((s) => (s.free ? 1 : 0)) })),
  };
}

export async function seats(city: string, date: string, ref: string, group: number, skipFrontRows: number) {
  if (ref.startsWith("district|")) return districtSeats(ref, group, skipFrontRows);
  if (isChainRef(ref)) return chainSeats(ref, group, skipFrontRows);
  const res = await post("ticketing/seatlayout", city, { dated: date, encrypted: ref, onPage: false, layoutType: "NEW" }, 10);
  const out = res?.output;
  if (!out?.rows) return { ok: false as const, reason: String(res?.msg || "The cinema did not answer.") };
  const classOf = new Map<string, string>(); // "H12" -> "PE-PRIME"
  const rows: Row[] = out.rows
    .filter((r: any) => r.t === "seats" && Array.isArray(r.s))
    .map((r: any) => ({
      name: String(r.n),
      seats: r.s
        .map((s: any, pos: number) => ({ label: String(s.displaynumber ?? ""), pos, st: s.s, c: s.c }))
        .filter((s: any) => s.st === 1 || s.st === 2)
        .map((s: any) => {
          classOf.set(String(r.n) + s.label, String(s.c ?? ""));
          return { label: s.label, pos: s.pos, free: s.st === 1 };
        }),
    }));
  const priceList: Record<string, any> = out.priceList ?? {};
  const total = rows.reduce((n, r) => n + r.seats.length, 0);
  const freeAll = rows.reduce((n, r) => n + r.seats.filter((s) => s.free).length, 0);
  const pick = pickSeats(rows, { seats: group, together: group > 1, skipFrontRows });
  const bestClass = pick.seats[0] ? priceList[classOf.get(pick.seats[0]) ?? ""] : undefined;
  return {
    ok: true as const,
    /** Price of one of the picked seats (what PVR INOX shows, taxes and fee included). */
    price: bestClass ? Number(bestClass.price) : undefined,
    classes: Object.values(priceList).map((p: any) => ({ label: String(p.description ?? p.priceCode).replace(/\b\w+/g, (w: string) => w[0] + w.slice(1).toLowerCase()), price: Number(p.price) })).sort((a, b) => a.price - b.price),
    total,
    free: freeAll,
    freeGood: pick.free,
    best: [...pick.seats].sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    // A small map for the UI: screen-first rows, each seat free or taken.
    map: rows.map((r, i) => ({ row: r.name, front: i < skipFrontRows, seats: r.seats.map((s) => (s.free ? 1 : 0)) })),
  };
}

