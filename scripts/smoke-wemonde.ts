// Live smoke test for the Wemonde chain sources (MovieTime, Rajhans). `npx tsx scripts/smoke-wemonde.ts [movie title]`
import { movietime, rajhans } from "../src/server/chains/wemonde.js";
import type { ChainCinema, ChainRow, ChainSource } from "../src/server/chains/types.js";

/** Cities, one movie's cinemas and shows (today, else tomorrow), and one seat map summary. */
async function summary(src: ChainSource, city: string, title: string) {
  console.log(`== ${src.name} (${src.id})`);
  const cities = await src.cities();
  console.log(`cities (${cities.length}):`, cities.join(", "));
  const day = (n: number) => {
    const d = new Date(Date.now() + n * 864e5 + 5.5 * 36e5); // India date
    return d.toISOString().slice(0, 10);
  };
  let cinemas: ChainCinema[] = [];
  let date = day(0);
  for (const n of [0, 1]) {
    date = day(n);
    cinemas = await src.shows(city, title, date);
    if (cinemas.some((c) => c.shows.some((s) => s.status !== "closed"))) break;
  }
  console.log(`shows of "${title}" in ${city} on ${date}: ${cinemas.length} cinemas`);
  for (const c of cinemas) {
    console.log(`  ${c.name} | ${c.lat ?? "?"},${c.lng ?? "?"}`);
    for (const s of c.shows) console.log(`    ${s.time} ${s.language} ${s.format} ${s.status} ${s.free}/${s.total} ${s.ref}`);
  }
  const show = cinemas.flatMap((c) => c.shows).find((s) => s.status !== "closed" && s.status !== "full");
  if (!show) return console.log("no open show to read seats for");
  console.log(`book: ${show.bookUrl}`);
  const map = await src.seatMap(show.ref);
  const seats = map.rows.flatMap((r) => r.seats);
  const free = seats.filter((s) => s.free).length;
  console.log(`seat map ${show.ref}: ${map.rows.length} rows, ${seats.length} seats, ${free} free (list said ${show.free}/${show.total})`);
  console.log(`classes: ${(map.classes ?? []).map((c) => `${c.label} Rs ${c.price}`).join(", ")}`);
  const cls = (r: ChainRow) => map.classOf?.[r.name + r.seats[0].label] ?? "?";
  const first = map.rows[0], last = map.rows[map.rows.length - 1];
  console.log(`rows[0] (nearest screen) = ${first.name} ${cls(first)} | last row = ${last.name} ${cls(last)}`);
  for (const r of map.rows) {
    let line = "", at = Math.min(...r.seats.map((s) => s.pos));
    for (const s of r.seats) {
      line += " ".repeat(Math.max(0, s.pos - at)) + (s.free ? "." : "x");
      at = s.pos + 1;
    }
    console.log(`  ${r.name.padEnd(3)} ${line}`);
  }
  console.log("  (screen above row 1 of this drawing; . free, x taken, blank = aisle)");
}

const title = process.argv[2] ?? "Ramayana";
await summary(movietime, "Delhi-NCR", title);
console.log("");
await summary(rajhans, "Surat", title);
