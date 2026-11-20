// Pure seat and show rules. No network here, so they are easy to test.
import type { Want } from "./types.js";

/** One seat in a row, in the order the platform draws it. */
export interface Seat {
  /** Label printed on the seat ("12"). */
  label: string;
  /** Position in the row grid; a gap in positions is an aisle or wall. */
  pos: number;
  free: boolean;
}

/** A row of seats. */
export interface Row {
  name: string; // "H"
  seats: Seat[];
}

/**
 * Pick the best block of seats for a person.
 * @param rows rows in screen-first order (row 0 is nearest the screen)
 */
export function pickSeats(rows: Row[], want: Pick<Want, "seats" | "together" | "skipFrontRows">): { seats: string[]; free: number } {
  const usable = rows.slice(Math.min(want.skipFrontRows, rows.length));
  const free = usable.reduce((n, r) => n + r.seats.filter((s) => s.free).length, 0);
  if (free < want.seats) return { seats: [], free };

  // Sweet spot: a little behind the middle of the usable rows, centred left to right.
  const target = usable.length * 0.45;
  let best: { score: number; seats: string[] } | null = null;

  usable.forEach((row, ri) => {
    const sorted = [...row.seats].sort((a, b) => a.pos - b.pos);
    const width = sorted.length ? sorted[sorted.length - 1].pos : 1;
    if (!want.together) {
      const picks = sorted.filter((s) => s.free).slice(0, want.seats);
      if (picks.length === want.seats) {
        const score = Math.abs(ri - target);
        if (!best || score < best.score) best = { score, seats: picks.map((s) => row.name + s.label) };
      }
      return;
    }
    for (let i = 0; i + want.seats <= sorted.length; i++) {
      const block = sorted.slice(i, i + want.seats);
      const joined = block.every((s, k) => s.free && (k === 0 || s.pos === block[k - 1].pos + 1));
      if (!joined) continue;
      const centre = (block[0].pos + block[block.length - 1].pos) / 2;
      const score = Math.abs(ri - target) + Math.abs(centre - width / 2) * 0.35;
      if (!best || score < best.score) best = { score, seats: block.map((s) => row.name + s.label) };
    }
  });

  return { seats: best ? (best as { seats: string[] }).seats : [], free };
}

/** "16:55" from "04:55 PM" or "2026-12-17T16:55:00". */
export function toHHMM(text: string): string | null {
  const iso = /T(\d{2}):(\d{2})/.exec(text);
  if (iso) return `${iso[1]}:${iso[2]}`;
  const m = /(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(text);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** Does a show pass the date, time, language and venue rules? */
export function showFits(
  show: { date: string; time: string; language?: string; venue?: string },
  want: Want,
): boolean {
  if (want.dates.length && !want.dates.includes(show.date)) return false;
  const hhmm = toHHMM(show.time);
  if (hhmm && want.startBefore && hhmm >= want.startBefore) return false;
  if (hhmm && want.startAfter && hhmm < want.startAfter) return false;
  if (want.languages.length && show.language) {
    const lang = show.language.toLowerCase();
    if (!want.languages.some((l) => lang.includes(l.toLowerCase()))) return false;
  }
  if (want.venues.length && show.venue) {
    const v = show.venue.toLowerCase();
    if (!want.venues.some((w) => v.includes(w.toLowerCase()))) return false;
  }
  return true;
}

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Distance to a venue when the person shared a location. Returns null when the venue is too far,
 * undefined when there is nothing to measure (no location, or the venue has no coordinates).
 */
export function venueDistance(want: Want, lat?: unknown, lng?: unknown): number | null | undefined {
  if (!want.near) return undefined;
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || (la === 0 && ln === 0)) return undefined;
  const km = distanceKm(want.near, { lat: la, lng: ln });
  return km <= want.near.km ? Math.round(km * 10) / 10 : null;
}

/** Nearest first when distances are known; otherwise keep the site's order. */
export function nearestFirst<T extends { km?: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
}

/** "Thu 17 Dec, 4:55 PM" */
export function niceWhen(date: string, time: string): string {
  const d = new Date(`${date}T00:00:00`);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const hhmm = toHHMM(time);
  if (!hhmm) return `${day}, ${time}`;
  const [h, m] = hhmm.split(":").map(Number);
  const t = `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  return `${day}, ${t}`;
}
