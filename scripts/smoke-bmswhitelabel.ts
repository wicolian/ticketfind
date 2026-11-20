// Live smoke test for the BookMyShow cinema-website chains (Mukta A2, Gold, Asian, Mayajaal, Rohini).
// `pnpm tsx scripts/smoke-bmswhitelabel.ts [chainId] [city] [movie] [YYYY-MM-DD]`
// Gentle: per chain, one cities call, one show-time call per cinema in one city, and one seat map.
import { bmsWhiteLabelChains } from "../src/server/chains/bmswhitelabel.js";

const [onlyId, cityArg, movieArg, dateArg] = process.argv.slice(2);
const tomorrow = new Date(Date.now() + 5.5 * 3600_000 + 24 * 3600_000).toISOString().slice(0, 10); // India date + 1
const date = dateArg ?? tomorrow;
const plan: Record<string, [string, string]> = {
  muktaa2: ["Mumbai", "Ramayana"],
  gold: ["Mumbai", "Ramayana"],
  asian: ["Hyderabad", "Ramayana"],
  mayajaal: ["Chennai", "Ramayana"],
  rohini: ["Chennai", "Ramayana"],
};

for (const chain of bmsWhiteLabelChains) {
  if (onlyId && chain.id !== onlyId) continue;
  const [city, movie] = [cityArg ?? plan[chain.id]?.[0] ?? "Mumbai", movieArg ?? plan[chain.id]?.[1] ?? "Ramayana"];
  console.log(`\n== ${chain.name} (${chain.id})`);
  try {
    const cities = await chain.cities();
    console.log(`  cities (${cities.length}): ${cities.join(", ")}`);
    const cinemas = await chain.shows(city, movie, date);
    console.log(`  "${movie}" in ${city} on ${date}: ${cinemas.length} cinemas`);
    for (const c of cinemas) {
      console.log(`   - ${c.name}${c.lat ? ` (${c.lat}, ${c.lng})` : ""}`);
      console.log(`     ${c.shows.map((s) => `${s.hhmm} ${s.format} ${s.language} ${s.status}${s.priceFrom ? ` Rs${s.priceFrom}` : ""}`).join(" | ")}`);
    }
    const show = cinemas.flatMap((c) => c.shows.map((s) => ({ c, s }))).find((x) => x.s.status === "open" || x.s.status === "filling");
    if (!show) {
      console.log("  no open show to read a seat map from");
      continue;
    }
    console.log(`  book: ${show.s.bookUrl}`);
    const map = await chain.seatMap(show.s.ref);
    const seats = map.rows.flatMap((r) => r.seats);
    const free = seats.filter((s) => s.free).length;
    console.log(`  seat map ${show.c.name} ${show.s.hhmm} (${show.s.ref}): ${map.rows.length} rows, ${seats.length} seats, ${free} free`);
    console.log(`  classes: ${(map.classes ?? []).map((k) => `${k.label} Rs${k.price}`).join(", ")}`);
    const draw = (r: (typeof map.rows)[number]) => {
      let line = "", last = -1;
      for (const s of r.seats) {
        if (last >= 0 && s.pos - last > 1) line += " ";
        line += s.free ? "." : "x";
        last = s.pos;
      }
      return `${r.name.padStart(3)} ${line}`;
    };
    console.log("  screen this way (rows[0] first):");
    for (const r of map.rows.slice(0, 3)) console.log("   " + draw(r));
    console.log("    ...");
    for (const r of map.rows.slice(-2)) console.log("   " + draw(r));
  } catch (e) {
    console.log("  ERR", (e as Error).message);
  }
}
