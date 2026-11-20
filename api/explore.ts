// Vercel function for the public website: Explore only (cities, movies, show times, live seats).
// No watches, no alerts, no keys: those need the ticketfind app on your own computer.
// The CDN caches answers briefly so a busy public site never multiplies load on the cinema's servers.
import type { IncomingMessage, ServerResponse } from "node:http";
import * as explore from "../src/server/explore.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const q = Object.fromEntries(new URL(req.url ?? "/", "http://localhost").searchParams);
  const city = q.city || "Chennai";
  const at = q.lat && q.lng ? { lat: Number(q.lat), lng: Number(q.lng) } : undefined;
  let body: unknown;
  let cache = 60;
  try {
    switch (q.fn) {
      case "cities": {
        const list = await explore.cities();
        body = { cities: list, nearest: at ? explore.nearestCity(list, at)?.name : undefined };
        cache = 3600;
        break;
      }
      case "movies": {
        const [movies, comingSoon] = await Promise.all([explore.movies(city), explore.comingSoon(city).catch(() => [])]);
        body = { movies, comingSoon };
        break;
      }
      case "trending":
        body = { trending: await explore.trending() };
        cache = 600;
        cache = 300;
        break;
      case "shows":
        body = await explore.shows(city, q.movie, q.date, at, q.dmovie);
        cache = 30;
        break;
      case "seats":
        body = await explore.seats(city, q.date, q.ref, Number(q.group || 2), Number(q.skip || 0));
        cache = 10;
        break;
      default:
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Unknown explore call." }));
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": `public, s-maxage=${cache}, stale-while-revalidate=${cache * 4}`,
    });
    res.end(JSON.stringify(body));
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `The cinema site did not answer: ${(e as Error).message}` }));
  }
}
