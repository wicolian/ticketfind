// Wemonde-built cinema sites: MovieTime Cinemas (movietimecinemas.in) and Rajhans Cinemas (rajhanscinemas.com).
// Both run the same Wemonde API (Vista under it). We read the same public calls the sites make for a signed-out
// visitor. The seat map has the PVR INOX shape: rows[].n is the row, t "area" is a price header, seat s is
// 0 = gap, 1 = free, 2 = taken. The gaps are sent as seats, so a seat's index in the row is its grid column.
// Row order differs per site: MovieTime draws the screen above the first row (already screen-first), Rajhans draws
// it below the last row (back row first, so we reverse).
import type { ChainCinema, ChainRow, ChainSeatMap, ChainShow, ChainSource } from "./types.js";
import { BROWSER_UA } from "../adapters/types.js";

interface Site {
  id: string;
  name: string;
  api: string; // ends with "/"
  site: string; // the website, no trailing "/"
  /** True when the site draws the screen below the seats: the API then sends the back row first. */
  screenAtBottom: boolean;
  bookUrl(s: { cinemaName: string; cinemaId: string; city: string; film: string; filmName: string; sessionId: string; screenId: string; date: string; hhmm: string }): string;
}

const MOVIETIME: Site = {
  id: "movietime",
  name: "MovieTime Cinemas",
  api: "https://cinema-mt-cms.wemonde.co/api/",
  site: "https://www.movietimecinemas.in",
  screenAtBottom: false,
  // Same link the MovieTime movie page builds when you tap a show time.
  bookUrl: (s) =>
    `https://www.movietimecinemas.in/seatlayout/${encodeURIComponent(s.cinemaName)}/${encodeURIComponent(s.filmName)}` +
    `?moviecode=${encodeURIComponent(s.film)}&sessionId=${s.sessionId}&cinemacode=${encodeURIComponent(s.cinemaId)}` +
    `&screenId=${s.screenId}&bundleAllowed=false&membersDay=false`,
};

const RAJHANS: Site = {
  id: "rajhans",
  name: "Rajhans Cinemas",
  api: "https://console.rajhanscinemas.com/api/",
  site: "https://rajhanscinemas.com",
  screenAtBottom: true,
  // Same link the Rajhans site opens for a show (the cinema name is encoded twice there, so we do the same).
  bookUrl: (s) => {
    const q = new URLSearchParams({
      city: s.city,
      cinemaName: encodeURIComponent(s.cinemaName),
      moviecode: s.film,
      screenId: s.screenId,
      showTime: twelveHour(s.hhmm).replace(/^0/, ""),
      showDate: s.date,
      sessionId: s.sessionId,
      cinemaId: s.cinemaId,
    });
    return `https://rajhanscinemas.com/seatlayout?${q}`;
  },
};

const cache = new Map<string, { at: number; value: unknown }>();

/** Cache any async answer for ttl seconds. */
async function cached<T>(key: string, ttlSec: number, get: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlSec * 1000) return hit.value as T;
  const value = await get();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function get<T = any>(site: Site, path: string, cityId: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(site.api + path, {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer",
        appVersion: "1.0",
        platform: "WEBSITE",
        city: String(cityId),
        Origin: site.site,
        Referer: site.site + "/",
        "User-Agent": BROWSER_UA,
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error(`${site.name} did not answer. Try again in a minute.`);
  }
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${site.name} sent a page we cannot read (HTTP ${res.status}).`);
  }
  if (!res.ok || json?.result === false) throw new Error(String(json?.msg || `${site.name} said no (HTTP ${res.status}).`));
  return json;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
/** "3D SILVER" -> "3D Silver": words with a digit stay in capitals. */
const titleCase = (s: string) =>
  s.replace(/[A-Za-z0-9]+/g, (w) => (/\d/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()));

/**
 * Same movie? Titles match word for word after dropping "(3D)", "(Hindi)" and the like. A chain title may also
 * carry extra words in front, such as a studio credit: "Namit Malhotras Ramayana" matches "Ramayana".
 */
function sameMovie(chainTitle: string, wanted: string): boolean {
  const a = words(chainTitle), b = words(wanted);
  if (!a.length || !b.length) return false;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  if (short.join("").length < 6) return long.join(" ") === short.join(" ");
  return long.slice(long.length - short.length).join(" ") === short.join(" ");
}

/** Site city name -> the name PVR INOX uses. Rajhans spells some cities in capitals or its own way. */
const CITY_NAMES: Record<string, string> = { ahemdabad: "Ahmedabad", delhincr: "Delhi-NCR" };
const pvrName = (name: string) => CITY_NAMES[norm(name)] ?? (name === name.toUpperCase() ? titleCase(name) : name);
const cityKey = (s: string) => {
  const k = norm(s);
  return k === "delhi" ? "delhincr" : k;
};

/** "RAJHANS SITANAGAR " -> "Rajhans Sitanagar". Mixed-case names stay as the site wrote them. */
const cleanName = (n: string) => {
  const t = n.trim().replace(/\s+/g, " ");
  return t === t.toUpperCase() ? titleCase(t) : t;
};

interface City { id: number; name: string; siteName: string }

function cityList(site: Site): Promise<City[]> {
  return cached(`${site.id}|cities`, 3600, async () => {
    const res = await get(site, "content/city?latitude=&longitude=", 1);
    return (res?.data ?? [])
      .filter((c: any) => c?.active !== false)
      .map((c: any) => ({ id: Number(c.id), name: pvrName(String(c.name)), siteName: String(c.name) }));
  });
}

/** "(3D) RAMAYANA (HINDI) WITH ENG SUB TITLE" -> ["ramayana"]. */
const words = (t: string) =>
  t.replace(/\([^)]*\)/g, " ").replace(/\bwith\b.*$/i, "").replace(/['’]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function twelveHour(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${String(h % 12 || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function statusOf(s: any, free: number, total: number): ChainShow["status"] {
  if (s.lapsed === true) return "closed";
  if (free <= 0) return "full";
  if (total > 0 && free / total < 0.2) return "filling";
  return "open";
}

function source(site: Site): ChainSource {
  return {
    id: site.id,
    name: site.name,

    async cities() {
      return [...new Set((await cityList(site)).map((c) => c.name))].sort((a, b) => a.localeCompare(b));
    },

    async shows(city, movieTitle, date) {
      const c = (await cityList(site)).find((x) => cityKey(x.name) === cityKey(city));
      if (!c) return [];
      const films = await cached(`${site.id}|films|${c.id}`, 300, async () => (await get(site, "content/nowshowing", c.id))?.data ?? []);
      const codes = [
        ...new Set(
          (films as any[])
            .filter((f) => sameMovie(String(f.filmCommonName ?? ""), movieTitle) || sameMovie(String(f.filmName ?? ""), movieTitle))
            .map((f) => String(f.filmCommonCode)),
        ),
      ];
      const byCinema = new Map<string, ChainCinema>();
      for (const code of codes) {
        const res = await cached(`${site.id}|msessions|${c.id}|${code}|${date}`, 30, () =>
          get(site, `content/msessions?filmId=${encodeURIComponent(code)}&date=${date}`, c.id),
        );
        const filmName = String(res?.data?.film?.filmCommonName ?? movieTitle);
        for (const block of res?.data?.sessions ?? []) {
          const cin = block.cinema ?? {};
          if (cin.cityId !== undefined && Number(cin.cityId) !== c.id) continue;
          const cinemaId = String(cin.theaterId ?? cin.id ?? "");
          let cinema = byCinema.get(cinemaId);
          if (!cinema) {
            const lat = Number(cin.latitude), lng = Number(cin.longitude);
            const ok = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
            cinema = { name: cleanName(String(cin.name ?? site.name)), address: String(cin.address ?? ""), ...(ok ? { lat, lng } : {}), shows: [] };
            byCinema.set(cinemaId, cinema);
          }
          for (const s of block.filmSessions ?? []) {
            if (String(s.showDate) !== date) continue;
            const hhmm = String(s.showTime ?? "").slice(0, 5);
            const free = Number(s.availableSeats ?? 0);
            const total = Number(s.totalSeats ?? 0);
            cinema.shows.push({
              ref: `${site.id}:${cinemaId}:${s.sessionId}`,
              date,
              hhmm,
              time: twelveHour(hhmm),
              language: titleCase(String(s.language ?? "")),
              format: String(s.filmFormat || "2D"),
              status: statusOf(s, free, total),
              free,
              total,
              bookUrl: site.bookUrl({
                cinemaName: String(cin.name ?? ""),
                cinemaId,
                city: String(cin.cityName ?? c.siteName),
                film: code,
                filmName,
                sessionId: String(s.sessionId),
                screenId: String(s.screenId ?? ""),
                date,
                hhmm,
              }),
            });
          }
        }
      }
      const out = [...byCinema.values()].filter((x) => x.shows.length);
      for (const x of out) x.shows.sort((a, b) => a.hhmm.localeCompare(b.hhmm));
      return out;
    },

    async seatMap(ref) {
      const m = new RegExp(`^${site.id}:([A-Za-z0-9]+):(\\d+)$`).exec(ref);
      if (!m) throw new Error(`This is not a ${site.name} show.`);
      const res = await get(site, `trans/seatlayout?cinemaId=${m[1]}&sessionId=${m[2]}`, 1);
      const data = res?.data ?? {};
      const prices: Record<string, { description?: string; price?: string }> = data.priceList ?? {};
      const classes = Object.values(prices).map((p) => ({ label: titleCase(String(p.description ?? "")), price: Number(p.price ?? 0) }));
      const classOf: Record<string, string> = {};
      const rows: ChainRow[] = [];
      for (const r of data.rows ?? []) {
        if (r.t === "area" || !Array.isArray(r.s)) continue;
        const name = String(r.n ?? "");
        const seats = (r.s as any[])
          .map((s, pos) => ({ s, pos }))
          .filter(({ s }) => s.s !== 0 && String(s.sn ?? "") !== "")
          .map(({ s, pos }) => {
            const label = String(s.displaynumber ?? String(s.sn).replace(name, ""));
            const cls = prices[String(s.c)]?.description;
            if (cls) classOf[name + label] = titleCase(String(cls));
            return { label, pos, free: s.s === 1 };
          });
        if (seats.length) rows.push({ name, seats });
      }
      if (!rows.length) throw new Error(`${site.name} did not send a seat map for this show.`);
      if (site.screenAtBottom) rows.reverse();
      return { rows, classes, classOf } satisfies ChainSeatMap;
    },
  };
}

export const movietime = source(MOVIETIME);
export const rajhans = source(RAJHANS);
