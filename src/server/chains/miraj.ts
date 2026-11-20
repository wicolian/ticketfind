// Miraj Cinemas (mirajcinemas.com). Reads the same public calls the Miraj website makes for a signed-out visitor.
// Seat map: the site always draws the screen BELOW the seat table, so the API's first row is the back row. We reverse it to get screen-first rows. Seat status "0" is free; "1", "3", "5" are taken; a seat with no
// number is a gap. strGridSeatNum is the grid column, so an aisle is a jump in pos.
import type { ChainCinema, ChainRow, ChainSeatMap, ChainShow, ChainSource } from "./types.js";
import { BROWSER_UA } from "../adapters/types.js";

const API = "https://mirajcinemas.com/api/v1.0/webapp/";
const SITE = "https://www.mirajcinemas.com";

const cache = new Map<string, { at: number; value: unknown }>();

/** Cache any async answer for ttl seconds. */
async function cached<T>(key: string, ttlSec: number, get: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlSec * 1000) return hit.value as T;
  const value = await get();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function call<T = any>(path: string, cityId?: number, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Origin: SITE,
    Referer: SITE + "/",
    "User-Agent": BROWSER_UA,
  };
  if (cityId !== undefined) headers["city-id"] = String(cityId);
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(API + path, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Miraj Cinemas did not answer. Try again in a minute.");
  }
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Miraj Cinemas sent a page we cannot read (HTTP ${res.status}).`);
  }
  if (!res.ok || json?.status === false) throw new Error(String(json?.message || `Miraj Cinemas said no (HTTP ${res.status}).`));
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

/** Miraj city name -> the name PVR INOX uses for the same city. */
const CITY_NAMES: Record<string, string> = {
  delhincr: "Delhi-NCR",
  vizagvisakhapatnam: "Vizag",
  kalaburagigulbarga: "Gulbarga",
};
const pvrName = (miraj: string) => CITY_NAMES[norm(miraj)] ?? miraj;
/** Same city? "Delhi" and "Delhi-NCR" count as one. */
const cityKey = (s: string) => {
  const k = norm(s);
  return k === "delhi" ? "delhincr" : k;
};

interface City { id: number; name: string }

function cityList(): Promise<City[]> {
  return cached("cities", 3600, async () => {
    const res = await call("locations/cities");
    return (res?.data ?? [])
      .filter((c: any) => c?.city_is_active !== "N")
      .map((c: any) => ({ id: Number(c.city_id), name: pvrName(String(c.city_name)) }));
  });
}

async function cityId(city: string): Promise<number | undefined> {
  const list = await cityList();
  return list.find((c) => cityKey(c.name) === cityKey(city))?.id;
}

/** Only the cinema fields we need. The raw answer also carries payment and server secrets: never keep or log it. */
interface CinemaInfo { id: string; name: string; address: string; lat?: number; lng?: number }

function cinemaList(): Promise<Map<string, CinemaInfo>> {
  return cached("cinemas", 3600, async () => {
    const res = await call("cinemas");
    const out = new Map<string, CinemaInfo>();
    for (const c of res?.data ?? []) {
      const lat = Number(c.cinema_latitude), lng = Number(c.cinema_longitude);
      const ok = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
      out.set(String(c.Cinema_strID), {
        id: String(c.Cinema_strID),
        name: String(c.Cinema_strName ?? ""),
        address: String(c.cinema_address ?? ""),
        ...(ok ? { lat, lng } : {}),
      });
    }
    return out;
  });
}

interface Film { code: string; title: string; language: string }

/** "(3D) Ramayana (Tamil)" -> ["ramayana"]. */
const words = (t: string) => t.replace(/\([^)]*\)/g, " ").replace(/['’]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function nowShowing(id: number): Promise<Film[]> {
  return cached(`films|${id}`, 300, async () => {
    const res = await call("now-showing", id, { user_id: null });
    return (res?.data ?? []).map((f: any) => ({
      code: String(f.Film_strCode),
      title: String(f.Film_strTitle ?? ""),
      language: String(f.language_name ?? ""),
    }));
  });
}

function formatOf(title: string): string {
  const m = /\b(2D|3D|4DX|IMAX|ICE|MX4D)\b/i.exec(title);
  return m ? m[1].toUpperCase() : "2D";
}

/** "2026-11-20 19:40:00.000" -> date, 24 h and 12 h times. */
function when(s: string): { date: string; hhmm: string; time: string } {
  const date = s.slice(0, 10);
  const hhmm = s.slice(11, 16);
  const [h, m] = hhmm.split(":").map(Number);
  const time = `${String(h % 12 || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  return { date, hhmm, time };
}

function statusOf(free: number, total: number, startsAt: string): ChainShow["status"] {
  const t = Date.parse(startsAt.replace(" ", "T") + "+05:30");
  if (Number.isFinite(t) && t < Date.now()) return "closed";
  if (free <= 0) return "full";
  if (total > 0 && free / total < 0.2) return "filling";
  return "open";
}

export const miraj: ChainSource = {
  id: "miraj",
  name: "Miraj Cinemas",

  async cities() {
    return [...new Set((await cityList()).map((c) => c.name))].sort((a, b) => a.localeCompare(b));
  },

  async shows(city, movieTitle, date) {
    const id = await cityId(city);
    if (id === undefined) return [];
    const films = (await nowShowing(id)).filter((f) => sameMovie(f.title, movieTitle));
    if (!films.length) return [];
    const [info, answers] = await Promise.all([
      cinemaList().catch(() => new Map<string, CinemaInfo>()),
      Promise.all(films.map((f) => cached(`sessions|${id}|${f.code}|${date}`, 30, () => call(`session/${f.code}/${date}`, id)).then((r) => ({ f, r })))),
    ]);
    const byCinema = new Map<string, ChainCinema>();
    for (const { f, r } of answers)
      for (const block of r?.data?.sessionsArr ?? [])
        for (const c of block.sessionDetails ?? []) {
          const cid = String(c.id);
          const known = info.get(cid);
          let cinema = byCinema.get(cid);
          if (!cinema) {
            cinema = {
              name: String(c.name ?? known?.name ?? "Miraj Cinemas"),
              address: String(c.address ?? known?.address ?? ""),
              ...(known?.lat !== undefined ? { lat: known.lat, lng: known.lng } : {}),
              shows: [],
            };
            byCinema.set(cid, cinema);
          }
          for (const t of c.timing ?? []) {
            const at = when(String(t.time ?? ""));
            if (at.date !== date) continue;
            const free = Number(t.seats_available_for_sale ?? 0);
            const total = Number(t.total_seats_available ?? 0);
            cinema.shows.push({
              ref: `miraj:${t.id}:${cid}`,
              ...at,
              language: f.language || (/\(([^)]+)\)\s*$/.exec(f.title)?.[1] ?? ""),
              format: formatOf(f.title),
              status: statusOf(free, total, String(t.time)),
              free,
              total,
              bookUrl: `${SITE}/seat-layout/${t.id}/${cid}`,
            });
          }
        }
    const out = [...byCinema.values()].filter((c) => c.shows.length);
    for (const c of out) c.shows.sort((a, b) => a.hhmm.localeCompare(b.hhmm));
    return out;
  },

  async seatMap(ref) {
    const m = /^miraj:(\d+):([A-Za-z0-9]+)$/.exec(ref);
    if (!m) throw new Error("This is not a Miraj show.");
    const res = await call(`seat_layout/${m[1]}/${m[2]}`);
    const result = res?.data?.seatLayout?.result;
    const areas: any[] = result?.seats?.area ?? [];
    if (!areas.length) throw new Error(String(res?.data?.seatLayout?.error || "Miraj did not send a seat map for this show."));
    const rows: ChainRow[] = [];
    const classes: { label: string; price: number }[] = [];
    const classOf: Record<string, string> = {};
    for (const a of areas) {
      const label = titleCase(String(a.strAreaDesc ?? "Seats"));
      classes.push({ label, price: Number(a.Price_curPrice ?? 0) });
      for (const r of a.rows ?? []) {
        const name = String(r.strRowPhyID ?? "");
        const seats = (r.seats ?? [])
          .filter((s: any) => String(s.strSeatNumber ?? "") !== "")
          .map((s: any) => ({ label: String(s.strSeatNumber), pos: Number(s.strGridSeatNum), free: String(s.strSeatStatus) === "0" }))
          .filter((s: { pos: number }) => Number.isFinite(s.pos))
          .sort((x: { pos: number }, y: { pos: number }) => x.pos - y.pos);
        if (!seats.length) continue;
        for (const s of seats) classOf[name + s.label] = label;
        rows.push({ name, seats });
      }
    }
    // The Miraj seat page always draws the screen below the last row of the answer. It ignores ScreenOnTop and
    // sessionDetails.reversed (seen true and false). So the first row in the answer is the back row: reverse.
    rows.reverse();
    return { rows, classes, classOf } satisfies ChainSeatMap;
  },
};
