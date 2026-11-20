// Every cinema chain read from its own website, in one place for Explore and the watchers.
// A slow or broken chain never holds up the page: each one gets a time limit and is skipped on failure.
import type { Match, Want } from "../types.js";
import { distanceKm, niceWhen, pickSeats, showFits, venueDistance } from "../rules.js";
import { bmsWhiteLabelChains } from "./bmswhitelabel.js";
import { miraj } from "./miraj.js";
import { movietime, rajhans } from "./wemonde.js";
import type { ChainCinema, ChainShow, ChainSource } from "./types.js";

export const CHAINS: ChainSource[] = [miraj, movietime, rajhans, ...bmsWhiteLabelChains];

const LIMIT_MS = 12_000;
function inTime<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, fail) => setTimeout(() => fail(new Error("took too long")), LIMIT_MS))]);
}

const cityKey = (c: string) => c.toLowerCase().replace(/[^a-z]/g, "").replace(/^(bangalore)$/, "bengaluru").replace(/^delhincr$|^newdelhi$/, "delhi");

/** Chains with a cinema in this city. */
async function chainsIn(city: string): Promise<ChainSource[]> {
  const want = cityKey(city);
  const found = await Promise.all(
    CHAINS.map(async (c) => {
      try {
        const cities = await inTime(c.cities());
        return cities.some((x) => cityKey(x) === want || cityKey(x).startsWith(want) || want.startsWith(cityKey(x))) ? c : null;
      } catch {
        return null;
      }
    }),
  );
  return found.filter((c): c is ChainSource => c !== null);
}

export interface ChainCinemaShows {
  chain: ChainSource;
  cinema: ChainCinema;
  km?: number;
}

/** Every chain cinema in the city showing this movie on this date. */
export async function chainCinemas(city: string, title: string, date: string, at?: { lat: number; lng: number }): Promise<ChainCinemaShows[]> {
  if (!title) return [];
  const chains = await chainsIn(city);
  const lists = await Promise.all(
    chains.map(async (chain) => {
      try {
        const cinemas = await inTime(chain.shows(city, title, date));
        return cinemas.filter((c) => c.shows.length).map((cinema) => ({
          chain,
          cinema,
          km: at && cinema.lat !== undefined && cinema.lng !== undefined ? Math.round(distanceKm(at, { lat: cinema.lat, lng: cinema.lng }) * 10) / 10 : undefined,
        }));
      } catch {
        return [];
      }
    }),
  );
  return lists.flat();
}

export const isChainRef = (ref: string) => CHAINS.some((c) => ref.startsWith(`${c.id}:`));
const chainOf = (ref: string) => CHAINS.find((c) => ref.startsWith(`${c.id}:`));

/** Seat panel for a chain show: the same shape explore.seats() returns. */
export async function chainSeats(ref: string, group: number, skipFrontRows: number) {
  const chain = chainOf(ref);
  if (!chain) return { ok: false as const, reason: "This show is not from a cinema ticketfind knows." };
  let map;
  try {
    map = await inTime(chain.seatMap(ref));
  } catch (e) {
    return { ok: false as const, reason: (e as Error).message };
  }
  const rows = map.rows;
  const total = rows.reduce((n, r) => n + r.seats.length, 0);
  const free = rows.reduce((n, r) => n + r.seats.filter((s) => s.free).length, 0);
  const pick = pickSeats(rows, { seats: group, together: group > 1, skipFrontRows });
  const cls = pick.seats[0] ? map.classOf?.[pick.seats[0]] : undefined;
  const price = cls ? map.classes?.find((c) => c.label === cls)?.price : undefined;
  return {
    ok: true as const,
    total,
    free,
    freeGood: pick.free,
    best: [...pick.seats].sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    price,
    classes: map.classes?.length ? [...map.classes].sort((a, b) => a.price - b.price) : undefined,
    map: rows.map((r, i) => ({ row: r.name, front: i < skipFrontRows, seats: [...r.seats].sort((a, b) => a.pos - b.pos).map((s) => (s.free ? 1 : 0)) })),
  };
}

/** For the app's watcher: chain shows that fit the rules and have seats that fit, after a seat-map check. */
export async function chainMatches(city: string, title: string, dates: string[], want: Want, maxSeatChecks = 6): Promise<{ matches: Match[]; looked: number; soldOut: number; down: number }> {
  const matches: Match[] = [];
  let looked = 0, soldOut = 0, down = 0, checks = 0;
  for (const date of dates) {
    for (const { chain, cinema } of await chainCinemas(city, title, date)) {
      const km = venueDistance(want, cinema.lat, cinema.lng);
      if (km === null) continue;
      for (const s of cinema.shows as ChainShow[]) {
        if (!showFits({ date, time: s.time, language: s.language, venue: cinema.name }, want)) continue;
        looked++;
        if (s.status === "full") { soldOut++; continue; }
        if (s.status === "closed" || (s.free !== undefined && s.free < want.seats)) continue;
        if (checks >= maxSeatChecks) continue;
        checks++;
        const r = await chainSeats(s.ref, want.seats, want.skipFrontRows);
        if (!r.ok) { down++; continue; }
        if (r.free === 0) soldOut++;
        if (r.best.length) matches.push({ when: niceWhen(date, s.time), venue: `${cinema.name} (${chain.name})`, seats: r.best, free: r.freeGood, bookUrl: s.bookUrl, km });
      }
    }
  }
  return { matches, looked, soldOut, down };
}
