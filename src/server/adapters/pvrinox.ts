// PVR INOX (inoxmovies.com, pvrcinemas.com). Seat-level: reads the same seat map the site draws.
// Rows come screen-first; seat status 1 = free, 2 = taken, 0 = gap (aisle).
import type { CheckResult, Match, Platform, Watch } from "../types.js";
import { nearestFirst, niceWhen, pickSeats, showFits, venueDistance, type Row } from "../rules.js";
import { type Adapter, BROWSER_UA, nextDays, UserError } from "./types.js";
import { chainMatches } from "../chains/index.js";

const API = "https://api3.inoxmovies.com/api/v1/booking/";

function headers(city: string): Record<string, string> {
  return {
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
  };
}

async function post<T = any>(path: string, city: string, body: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method: "POST",
    headers: headers(city),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  try {
    // The site sometimes sends raw control characters inside strings.
    return JSON.parse(text.replace(/[\u0000-\u001f]+/g, " "));
  } catch {
    throw new Error(`PVR INOX answered with something that is not JSON (HTTP ${res.status}).`);
  }
}

/** /moviesessions/{City}/{MOVIE-SLUG}/{movieId} */
function parseLink(url: URL): { city: string; movieId: string; slug: string } | null {
  const m = /\/moviesessions\/([^/]+)\/([^/]+)\/(\d+)/i.exec(url.pathname);
  if (!m) return null;
  return { city: decodeURIComponent(m[1]), slug: m[2], movieId: m[3] };
}

async function sessions(city: string, movieId: string, date: string) {
  return post("content/msessions", city, {
    city,
    mid: movieId,
    experience: "ALL",
    specialTag: "ALL",
    lat: "0.000",
    lng: "0.000",
    lang: "ALL",
    format: "ALL",
    dated: date,
    time: "00:00-24:00",
    cinetype: "ALL",
    hc: "ALL",
    adFree: false,
    bbt: false,
  });
}

export const pvrInox: Adapter = {
  minEverySec: 15,

  handles: (url) => /(^|\.)(inoxmovies|pvrcinemas)\.com$/i.test(url.hostname),

  async inspect(url): Promise<Platform> {
    const link = parseLink(url);
    if (!link) {
      throw new UserError(
        "Paste the page that lists all the show times for the movie (it has /moviesessions/ in the link), not a seat page.",
      );
    }
    let title = link.slug.replace(/-/g, " ").toLowerCase();
    try {
      const res = await sessions(link.city, link.movieId, "NA");
      const name: string | undefined = res?.output?.movie?.filmName;
      if (name) title = name.replace(/\s*\(.*$/, "").toLowerCase();
    } catch {
      /* the title is a nice-to-have */
    }
    title = title.replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      id: "pvr-inox",
      name: "PVR INOX",
      depth: "seats",
      meta: { city: link.city, movieId: link.movieId },
      title: `${title} in ${link.city}`,
    };
  },

  async check(watch: Watch): Promise<CheckResult> {
    const { city, movieId } = watch.platform.meta;
    let dates = watch.want.dates;
    if (!dates.length) {
      // No dates given: use the days PVR INOX is actually selling.
      const res = await sessions(city, movieId, "NA");
      dates = (res?.output?.days ?? []).filter((d: any) => d.enable !== false).map((d: any) => String(d.dt)).slice(0, 4);
      if (!dates.length) dates = nextDays(4);
    }
    const matches: Match[] = [];
    let looked = 0;
    let troubled = 0;
    let soldOut = 0;

    for (const date of dates) {
      const res = await sessions(city, movieId, date);
      for (const cs of res?.output?.movieCinemaSessions ?? []) {
        const venue: string = cs.cinema?.name ?? "Cinema";
        const km = venueDistance(watch.want, cs.cinema?.latitude, cs.cinema?.longitude);
        if (km === null) continue; // farther than the person wants to travel
        for (const exp of cs.experienceSessions ?? []) {
          for (const show of exp.shows ?? []) {
            if (!showFits({ date, time: show.showTime, language: show.language, venue }, watch.want)) continue;
            looked++;
            const status = String(show.statusTxt ?? "");
            if (/housefull|sold/i.test(status)) { soldOut++; continue; }
            if (/lapsed/i.test(status)) continue; // not on sale right now (often during an outage): keep trying
            const layout = await post("ticketing/seatlayout", city, {
              dated: date,
              encrypted: show.encrypted,
              onPage: false,
              layoutType: "NEW",
            });
            const out = layout?.output;
            if (!out?.rows) {
              // "trouble connecting to cinema" and friends mean the site is down, not that seats are gone.
              if (/trouble|connect|facing|try again|timeout|went wrong/i.test(String(layout?.msg ?? ""))) troubled++;
              continue;
            }
            const rows: Row[] = out.rows
              .filter((r: any) => r.t === "seats" && Array.isArray(r.s))
              .map((r: any) => ({
                name: String(r.n),
                seats: r.s
                  .map((s: any, pos: number) => ({ label: String(s.displaynumber ?? ""), pos, st: s.s }))
                  .filter((s: any) => s.st === 1 || s.st === 2)
                  .map((s: any) => ({ label: s.label, pos: s.pos, free: s.st === 1 })),
              }));
            const pick = pickSeats(rows, watch.want);
            if (!rows.some((r) => r.seats.some((x) => x.free))) soldOut++;
            if (pick.seats.length) {
              matches.push({
                when: niceWhen(date, show.showTime),
                venue: venue.replace(/,?\s*Chennai$/i, ""),
                seats: [...pick.seats].sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
                free: pick.free,
                bookUrl: `https://www.inoxmovies.com/seatlayout/${show.encrypted}`,
                km,
              });
            }
          }
        }
      }
    }

    // The same movie at chains PVR INOX does not sell (Miraj, MovieTime, Mukta A2, Mayajaal ...).
    const title = String(watch.platform.title ?? "").replace(/\s+in\s+[^]+$/, "");
    const more = await chainMatches(city, title, dates, watch.want).catch(() => ({ matches: [], looked: 0, soldOut: 0, down: 0 }));
    matches.push(...more.matches);
    looked += more.looked;
    soldOut += more.soldOut;
    troubled += more.down;

    const summary =
      looked === 0
        ? "No shows fit your rules yet."
        : matches.length
          ? `${matches.length} of ${looked} shows have seats for you.`
          : `Checked ${looked} shows. None have seats that fit yet.${troubled ? ` ${troubled} could not reach the cinema.` : ""}`;
    const state = matches.length ? "open" : troubled ? "down" : looked > 0 && soldOut === looked ? "soldout" : "waiting";
    return { matches: nearestFirst(matches), summary, troubled, state };
  },
};
