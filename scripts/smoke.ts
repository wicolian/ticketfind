// Live smoke test: inspects real links and runs one check. `pnpm tsx scripts/smoke.ts`
import { adapterFor, inspect } from "../src/server/adapters/index.js";
import type { Platform, Want, Watch } from "../src/server/types.js";

const want: Want = { seats: 2, together: true, skipFrontRows: 4, dates: [], languages: ["english"], venues: [] };
const w = (p: Platform): Watch => ({ id: "t", url: "", platform: p, want, everySec: 20, status: "watching", createdAt: "", log: [] });
const links = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "https://www.inoxmovies.com/moviesessions/Chennai/AVENGERS-DOOMSDAY/35312",
      "https://www.district.in/movies/avengers-doomsday-movie-tickets-in-chennai-MV176735",
      "https://in.bookmyshow.com/movies/chennai/x/ET1",
      "https://www.irctc.co.in/nget/train-search",
      "https://example.com",
    ];
for (const u of links) {
  try {
    const p = await inspect(u);
    console.log("INSPECT", p.name, "|", p.depth, "|", p.title, p.blockedReason ? `| BLOCKED: ${p.blockedReason.slice(0, 70)}` : "");
    if (p.id === "pvr-inox" || p.id === "district") {
      const r = await adapterFor(p.id).check(w(p));
      console.log("  CHECK", r.summary, JSON.stringify(r.matches.slice(0, 2)));
    }
  } catch (e) {
    console.log("ERR", u, (e as Error).message);
  }
}
