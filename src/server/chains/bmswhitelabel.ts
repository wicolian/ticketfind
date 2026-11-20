// BookMyShow cinema-website platform: the branded booking sites BookMyShow runs for cinema chains
// (muktaa2cinemas.in, the goldcinema.co booking iframe, mayajaal.com, ...). They are one Next.js app whose /api/*
// routes answer a signed-out visitor with plain JSON, no login and no token. This file reads only those routes on
// the chain's own domain, or on cinemas.bookmyshow.com with the chain's `config` cookie, the same way the site does.
// It never touches in.bookmyshow.com (that main site sits behind a Cloudflare captcha) and never starts a booking:
// the seat call is GETSEATLAYOUT, which only reads.
//
// Seat map format (`strData` of doTrans GETSEATLAYOUT): "areas||rows".
//   area: "<description>:<areaId>:<areaCode>:<areaNumber>:..."
//   row:  "<rowId>:<rowLabel>:<seat>:<seat>:..."   (blank rowLabel = a walkway row)
//   seat: "<areaId><status><seatNumber>[+<number printed on the seat>[+<ranking>]]"
//   status (from the site's own code): 0 gangway, 1 available, 2 booked or held, 3 other category, 4 best seat,
//   7 wheelchair, 8 companion, 9 social distancing.
// Rows come back-row first: the site draws the screen at the bottom. We reverse them to get screen-first.
import type { ChainCinema, ChainRow, ChainSeatMap, ChainShow, ChainSource } from "./types.js";
import { BROWSER_UA } from "../adapters/types.js";

const SHARED_HOST = "https://cinemas.bookmyshow.com";

export interface BmsChain {
  id: string; // "muktaa2"
  name: string; // "Mukta A2 Cinemas"
  companyCode: string; // "MUAR"
  /** The chain's domain as the platform knows it ("muktaa2cinemas.in"). Picks the chain on the shared host. */
  domain: string;
  /** True when the chain's own domain serves the platform. False: use cinemas.bookmyshow.com with a cookie. */
  ownHost: boolean;
}

// ---- small helpers ----

const cache = new Map<string, { at: number; value: unknown }>();

/** Cache any async answer for ttl seconds. Failed answers are not cached. */
async function cached<T>(key: string, ttlSec: number, get: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlSec * 1000) return hit.value as T;
  const value = await get();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Movie names as a key: "Ramayana (3D)(Hindi) - Hindi" and "Namit Malhotra's Ramayana" both keep "ramayana". */
function titleKey(s: string): string {
  return norm(
    s
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s-\s.*$/, " ")
      .replace(/\b(2d|3d|4dx|imax|screenx|dolby|atmos|hindi|tamil|telugu|english|marathi|malayalam|kannada|bengali|gujarati|punjabi)\b/gi, " "),
  );
}

function sameMovie(a: string, b: string): boolean {
  const x = titleKey(a), y = titleKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 5 && long.includes(short);
}

/** "Vizag (Visakhapatnam)" -> "Vizag". "Mumbai: Western" -> "Mumbai". */
const cleanCity = (s: string) => s.replace(/\(.*?\)/g, "").split(":")[0].trim();

const ymd = (dateCode: string) => `${dateCode.slice(0, 4)}-${dateCode.slice(4, 6)}-${dateCode.slice(6, 8)}`;

/** Run jobs a few at a time, so one city never fires a burst of calls at the site. */
async function inBatches<T, R>(items: T[], size: number, job: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(job))));
  return out;
}

// ---- the factory ----

export function bmsWhiteLabel(chain: BmsChain): ChainSource {
  const host = chain.ownHost ? `https://${chain.domain}` : SHARED_HOST;
  const cookie = chain.ownHost ? undefined : `config=${encodeURIComponent(JSON.stringify({ hostName: chain.domain }))}`;
  const failed = `${chain.name} did not answer. Try again in a minute.`;

  async function call<T = any>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(host + path, {
        method: init.method ?? "GET",
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "application/json",
          Referer: `${host}/`,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error(failed);
    }
    if (res.status === 403 || res.status === 429 || res.status === 503) {
      // A bot wall or a rate limit. We stop here; we never try to get around it.
      throw new Error(`${chain.name} is refusing automated requests right now (HTTP ${res.status}).`);
    }
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`${chain.name} sent something that is not show data (HTTP ${res.status}).`);
    }
  }

  interface Venue {
    code: string;
    region: string;
    regionName: string;
    subRegionName: string;
    name: string;
    address: string;
    lat?: number;
    lng?: number;
  }

  const regions = () =>
    cached(`bms|${chain.id}|regions`, 3600, async () => {
      const d = await call("/api/getRegionsData", { headers: { companycode: chain.companyCode } });
      const list: any[] = d?.regionsData ?? [];
      if (!Array.isArray(list)) throw new Error(failed);
      const region = new Map<string, string>(), sub = new Map<string, string>();
      for (const r of list) {
        region.set(String(r.RegionCode), String(r.RegionName ?? ""));
        sub.set(String(r.SubRegionCode), String(r.SubRegionName ?? ""));
      }
      return { region, sub };
    });

  const venues = () =>
    cached(`bms|${chain.id}|venues`, 3600, async (): Promise<Venue[]> => {
      const [d, r] = await Promise.all([
        call("/api/getCinemaList?cinemaListCall=true", { headers: { companycode: chain.companyCode } }),
        regions(),
      ]);
      const list: any[] = d?.venues ?? [];
      if (!Array.isArray(list)) throw new Error(failed);
      return list
        .filter((v) => v?.VenueCode && !v.isDown)
        .map((v) => {
          const lat = Number(v.VenueLatitude), lng = Number(v.VenueLongitude);
          return {
            code: String(v.VenueCode),
            region: String(v.RegionCode),
            regionName: r.region.get(String(v.RegionCode)) || String(v.RegionCode),
            subRegionName: r.sub.get(String(v.SubRegionCode)) || "",
            name: String(v.VenueName ?? v.VenueCode).replace(/\s+/g, " ").trim(),
            address: String(v.VenueAddress ?? ""),
            ...(Number.isFinite(lat) && lat !== 0 && Number.isFinite(lng) ? { lat, lng } : {}),
          };
        });
    });

  /** Does this cinema belong to the city a person picked? Region name, sub-region name ("Thane", "Kalyan") or both. */
  function inCity(v: Venue, city: string): boolean {
    const c = norm(cleanCity(city));
    return [v.regionName, v.subRegionName].some((n) => n && norm(cleanCity(n)) === c);
  }

  function statusOf(s: any, cutOffPassed: boolean): ChainShow["status"] {
    if (cutOffPassed) return "closed";
    switch (String(s.AvailStatus)) {
      case "1":
        return "full";
      case "2":
        return "filling";
      case "0":
        return "closed";
      default:
        return "open";
    }
  }

  /** "202611211100" in India time, compared with now. */
  function passed(stamp: unknown): boolean {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(stamp ?? ""));
    if (!m) return false;
    return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+05:30`) <= Date.now();
  }

  function bookUrl(event: string, venue: string, session: string, dateCode: string): string {
    // The platform's own seat page for the show. On the shared host the chain is picked by a cookie that the
    // iframe page sets, so there we send people to the chain's iframe start page instead.
    return chain.ownHost
      ? `${host}/seat-layout/${event}/${venue}/${session}/${dateCode}`
      : `${SHARED_HOST}/iframe?domain=${encodeURIComponent(chain.domain)}`;
  }

  async function venueShows(v: Venue, movieTitle: string, date: string): Promise<ChainCinema | null> {
    const dateCode = date.replace(/-/g, "");
    const d = await cached(`bms|${chain.id}|shows|${v.code}|${dateCode}`, 60, () =>
      call(`/api/getShowtimesByVenue?venueCode=${v.code}&companyCode=${chain.companyCode}&regionCode=${v.region}&dateCode=${dateCode}`),
    );
    const day = (d?.ShowDetails ?? []).find((x: any) => String(x?.Date) === dateCode);
    if (!day) return null;
    const shows: ChainShow[] = [];
    for (const ev of day.Event ?? []) {
      for (const ce of ev.ChildEvents ?? []) {
        if (!sameMovie(String(ev.EventTitle ?? ""), movieTitle) && !sameMovie(String(ce.EventName ?? ""), movieTitle)) continue;
        const format = /imax/i.test(ce.EventName) ? "IMAX" : /4dx/i.test(ce.EventName) ? "4DX" : String(ce.EventDimension || "2D");
        for (const s of ce.ShowTimes ?? []) {
          if (String(s.ShowDateCode) !== dateCode) continue;
          const code = String(s.ShowTimeCode ?? "").padStart(4, "0");
          const price = Number(s.MinPrice);
          shows.push({
            ref: [chain.id, v.code, ce.EventCode, s.SessionId, dateCode, v.region, s.CoupleSeats === "Y" ? "Y" : "N"].join(":"),
            date,
            hhmm: `${code.slice(0, 2)}:${code.slice(2, 4)}`,
            time: String(s.ShowTime ?? ""),
            language: String(ce.EventLanguage ?? ""),
            format,
            status: statusOf(s, passed(s.CutOffDateTime)),
            ...(Number.isFinite(price) && price > 0 ? { priceFrom: price } : {}),
            bookUrl: bookUrl(String(ce.EventCode), v.code, String(s.SessionId), dateCode),
          });
        }
      }
    }
    if (!shows.length) return null;
    shows.sort((a, b) => a.hhmm.localeCompare(b.hhmm));
    return { name: v.name, address: v.address, ...(v.lat !== undefined ? { lat: v.lat, lng: v.lng } : {}), shows };
  }

  return {
    id: chain.id,
    name: chain.name,

    async cities() {
      const list = await venues();
      const names = new Set<string>();
      for (const v of list) {
        names.add(cleanCity(v.regionName));
        // Sub-regions that are towns of their own ("Thane", "Kalyan"), not "Mumbai: Western".
        if (v.subRegionName && !v.subRegionName.includes(":")) names.add(cleanCity(v.subRegionName));
      }
      return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b));
    },

    async shows(city, movieTitle, date) {
      const list = (await venues()).filter((v) => inCity(v, city));
      const out = await inBatches(list, 4, (v) => venueShows(v, movieTitle, date).catch(() => null));
      return out.filter((c): c is ChainCinema => c !== null);
    },

    async seatMap(ref) {
      const [id, venue, event, session, dateCode, region, couple] = ref.split(":");
      if (id !== chain.id || !venue || !event || !session || !/^\d{8}$/.test(dateCode ?? "")) {
        throw new Error("That show link is not one ticketfind made. Pick the show again.");
      }
      // The site always asks for the show info first. Some cinemas' systems refuse the seat call without it.
      const info = await call(
        `/api/getSeatLayoutInfo?eventCode=${event}&dateCode=${dateCode}&regionCode=${region}&venueCode=${venue}`,
      ).catch(() => null);
      const res = await call("/api/doTrans", {
        method: "POST",
        body: { eventCode: event, venueCode: venue, sessionId: session, dateCode, strParam7: couple === "Y" ? "Y" : "N", cmd: "GETSEATLAYOUT" },
      });
      const bms = res?.BookMyShow ?? {};
      const data = String(bms.strData ?? "");
      if (String(bms.blnSuccess) !== "true" || !data.includes("||")) {
        const why = String(bms.strException ?? "").replace(/\s*\(#-?\d+\)\s*$/, "").trim();
        throw new Error(why ? `${chain.name} says: ${why}` : `${chain.name} did not send a seat map for this show.`);
      }
      return parseLayout(data, priceByArea(info, session));
    },
  };
}

interface AreaInfo {
  price: number;
  label: string; // "GOLD"
}

/** Area code -> price and printed name, from the show info call. */
function priceByArea(info: any, session: string): Map<string, AreaInfo> {
  const out = new Map<string, AreaInfo>();
  const shows: any[] = info?.data?.showTimes ?? [];
  const show = shows.find((s) => String(s?.sessionId) === session);
  for (const c of show?.categories ?? []) {
    const p = Number(c.curPrice);
    if (c.areaCatCode) out.set(String(c.areaCatCode), { price: Number.isFinite(p) ? p : 0, label: String(c.priceDesc ?? "").trim() });
  }
  return out;
}

const FREE = new Set([1, 4]); // available, and "best seat" (an available seat the site recommends)
const SEAT = new Set([1, 2, 4, 7, 8, 9]); // real seats; 0 is a gangway and 3 belongs to another price class

/** Turn `strData` into screen-first rows. Exported for tests. */
export function parseLayout(strData: string, info = new Map<string, AreaInfo>()): ChainSeatMap {
  const [areaPart, rowPart = ""] = strData.split("||");
  const areas = new Map<string, { label: string; code: string }>();
  for (const a of areaPart.split("|").filter(Boolean)) {
    const [desc, areaId, code = ""] = a.split(":");
    // Some cinemas print only the code ("GL") here; the show info then has the real name ("GOLD").
    const named = info.get(code)?.label;
    const label = (desc && desc !== code ? desc : named || desc || code || areaId).trim();
    if (areaId) areas.set(areaId, { label, code });
  }

  // Each row with the class of its seats (the class of the row's first seat).
  const parsed: { name: string; cls: string; seats: { label: string; pos: number; free: boolean; cls: string }[] }[] = [];
  for (const r of rowPart.split("|").filter(Boolean)) {
    const parts = r.split(":");
    const name = (parts[1] ?? "").trim();
    if (!name) continue; // a walkway row between blocks
    const seats: (typeof parsed)[number]["seats"] = [];
    parts.slice(2).forEach((tok, pos) => {
      const [head, printed] = tok.split("+");
      const status = Number(head.charAt(1));
      if (!SEAT.has(status)) return; // gangways leave a hole in pos, so seats across an aisle are not neighbours
      const number = head.slice(2).replace(/^0+(?=\d)/, "");
      const label = printed && printed !== "0" && printed !== "00" ? printed : number;
      seats.push({ label, pos, free: FREE.has(status), cls: areas.get(head.charAt(0))?.label ?? "" });
    });
    if (seats.length) parsed.push({ name, cls: seats[0].cls, seats });
  }
  parsed.reverse(); // the site sends the back row first

  // Some screens letter each block from A again (Rohini: SuperStar A to E behind Platinum A to G). Such rows get
  // their class in the name ("SuperStar A"), so every row name and every "H12" seat key stays unique.
  const count = new Map<string, number>();
  for (const r of parsed) count.set(r.name, (count.get(r.name) ?? 0) + 1);
  const rows: ChainRow[] = [];
  const classOf: Record<string, string> = {};
  for (const r of parsed) {
    const name = (count.get(r.name) ?? 0) > 1 && r.cls ? `${r.cls} ${r.name}` : r.name;
    rows.push({ name, seats: r.seats.map(({ label, pos, free }) => ({ label, pos, free })) });
    for (const st of r.seats) if (st.cls) classOf[`${name}${st.label}`] = st.cls;
  }

  // Only classes this screen really has, with a price the site told us (a class missing from the show info is
  // often not sold online, so we do not guess its price).
  const used = new Set(Object.values(classOf));
  const classes = [...areas.values()]
    .filter((a) => used.has(a.label) && (info.get(a.code)?.price ?? 0) > 0)
    .map((a) => ({ label: a.label, price: info.get(a.code)!.price }));
  return { rows, classes, classOf };
}

// ---- the chains (one line each) ----

export const muktaa2 = bmsWhiteLabel({ id: "muktaa2", name: "Mukta A2 Cinemas", companyCode: "MUAR", domain: "muktaa2cinemas.in", ownHost: true });
export const gold = bmsWhiteLabel({ id: "gold", name: "Gold Cinema", companyCode: "SNGL", domain: "goldcinema.co", ownHost: false });
export const asian = bmsWhiteLabel({ id: "asian", name: "Asian Cinemas", companyCode: "ASCI", domain: "www.asianplexcinemas.com", ownHost: false });
export const mayajaal = bmsWhiteLabel({ id: "mayajaal", name: "Mayajaal", companyCode: "MAYA", domain: "www.mayajaal.com", ownHost: true });
export const rohini = bmsWhiteLabel({ id: "rohini", name: "Rohini Silver Screens", companyCode: "ROHI", domain: "www.rohinicomplex.com", ownHost: false });

export const bmsWhiteLabelChains: ChainSource[] = [muktaa2, gold, asian, mayajaal, rohini];
