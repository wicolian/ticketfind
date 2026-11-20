// District (district.in). Counts only: reads the free-seat count District prints for each show.
// The seat map itself needs a browser session, so ticketfind cannot pick exact seats here.
import type { CheckResult, Match, Platform, Watch } from "../types.js";
import { nearestFirst, niceWhen, showFits, venueDistance } from "../rules.js";
import { type Adapter, BROWSER_UA, nextDays, UserError } from "./types.js";

/** /movies/{slug}-movie-tickets-in-{city}-MV{contentId} */
function parseLink(url: URL): { slug: string; city: string; contentId: string } | null {
  const m = /\/movies\/(.+)-movie-tickets-in-([a-z-]+)-MV(\d+)/i.exec(url.pathname);
  if (!m) return null;
  return { slug: m[1], city: m[2], contentId: m[3] };
}

async function pageData(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA }, signal: AbortSignal.timeout(25_000) });
  const html = await res.text();
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error(`District sent a page without show data (HTTP ${res.status}).`);
  return JSON.parse(m[1]);
}

function sessionsOf(data: any): any {
  const all = data?.props?.pageProps?.data?.serverState?.movieSessions ?? {};
  return Object.values(all)[0] as any;
}

export const district: Adapter = {
  minEverySec: 30,

  // Movies only. District events and concerts are plain pages: the page adapter watches those.
  handles: (url) => /(^|\.)district\.in$/i.test(url.hostname) && url.pathname.startsWith("/movies/"),

  async inspect(url): Promise<Platform> {
    const link = parseLink(url);
    if (!link) {
      throw new UserError(
        "Paste the District page that lists all cinemas for the movie (its link ends in -MV and a number), not a seat page.",
      );
    }
    const data = await pageData(url.toString()).catch(() => null);
    const ms = data && sessionsOf(data);
    const name: string = ms?.meta?.movie?.name ?? link.slug.replace(/-/g, " ");
    const city = link.city.replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      id: "district",
      name: "District",
      depth: "counts",
      meta: { city: link.city, contentId: link.contentId, base: `${url.origin}${url.pathname}` },
      title: `${name.replace(/\b\w/g, (c: string) => c.toUpperCase())} in ${city}`,
    };
  },

  async check(watch: Watch): Promise<CheckResult> {
    const { base, contentId } = watch.platform.meta;
    let dates = watch.want.dates;
    if (!dates.length) {
      // No dates given: start from the first day District sells and look 4 days ahead.
      const first = sessionsOf(await pageData(base));
      const day: string | undefined = first?.arrangedSessions?.[0]?.sessions?.[0]?.showDate;
      dates = nextDays(4, day ? new Date(`${day}T00:00:00`) : new Date());
    }
    const matches: Match[] = [];
    let looked = 0;

    for (const date of dates) {
      const ms = sessionsOf(await pageData(`${base}?fromdate=${date}`));
      for (const cinema of ms?.arrangedSessions ?? []) {
        const venue: string = cinema.entityName ?? "Cinema";
        const km = venueDistance(watch.want, cinema.data?.lat, cinema.data?.lon);
        if (km === null) continue; // farther than the person wants to travel
        for (const s of cinema.sessions ?? []) {
          if (s.showDate !== date) continue;
          if (!showFits({ date, time: s.showTimeLocal ?? s.showTimeText, language: s.lang, venue }, watch.want)) continue;
          looked++;
          const free = Number(s.avail ?? 0);
          if (free < watch.want.seats) continue;
          matches.push({
            when: niceWhen(date, s.showTimeLocal ?? s.showTimeText),
            venue: venue.split(",")[0],
            seats: [],
            free,
            km,
            bookUrl:
              `https://www.district.in/movies/seat-layout/${s.fid}?encsessionid=${cinema.entityCode}-${s.sid}-` +
              `${String(s.mid).toLowerCase()}-${cinema.entityCode}&freeseating=false&fromsessions=&type=MOVIES` +
              `&contentid=${contentId}&sessionid=${s.sid}`,
          });
        }
      }
    }
    const summary = looked
      ? matches.length
        ? `${matches.length} of ${looked} shows show free seats. District's count can lag, so open it fast.`
        : `Checked ${looked} shows. All full for now.`
      : "No shows fit your rules yet.";
    return { matches: nearestFirst(matches), summary, troubled: 0 };
  },
};
