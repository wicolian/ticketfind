// District (and TicketNew) seat maps: the same call District's seat page makes for a signed-out visitor.
// The guest token is not issued by a server: District's own page makes one up for every visitor, in this form.
import { BROWSER_UA } from "./adapters/types.js";

export function guestToken(): string {
  return `${Date.now()}_${Math.floor(1e18 * Math.random())}_${Math.random().toString(36).substring(2, 34)}`;
}

export interface DistrictShowKey {
  cid: string; // cinema (entityCode)
  sid: string; // session id
  pid: string; // provider id
  mid: string; // movie code
  fid: string; // format id
  fmt: string; // screen format, e.g. "2D"
  contentId: string;
  date: string;
  city: string;
}

export const refOf = (k: DistrictShowKey) => ["district", k.cid, k.sid, k.pid, k.mid, k.fid, k.fmt, k.contentId, k.date, k.city].map(encodeURIComponent).join("|");
export function keyOf(ref: string): DistrictShowKey | null {
  const p = ref.split("|").map(decodeURIComponent);
  if (p[0] !== "district" || p.length < 10) return null;
  const [, cid, sid, pid, mid, fid, fmt, contentId, date, city] = p;
  return { cid, sid, pid, mid, fid, fmt, contentId, date, city };
}

export interface DistrictSeatRow { name: string; area: string; seats: { label: string; pos: number; free: boolean }[] }

/** Rows screen-first (District lists them back to front). Throws with District's own message on failure. */
export async function districtSeatMap(k: DistrictShowKey): Promise<DistrictSeatRow[]> {
  const res = await fetch("https://www.district.in/gw/consumer/movies/v1/select-seat?country=IN", {
    method: "POST",
    headers: {
      "User-Agent": BROWSER_UA,
      "Content-Type": "application/json; charset=utf-8",
      api_source: "district",
      "x-app-type": "ed_web",
      "x-guest-token": guestToken(),
      paytmCinemaId: k.cid,
      Origin: "https://www.district.in",
      Referer: "https://www.district.in/movies/",
    },
    body: JSON.stringify({
      cinemaId: Number(k.cid),
      sessionId: k.sid,
      providerId: Number(k.pid),
      screenOnTop: true,
      freeSeating: false,
      screenFormat: k.fmt,
      moviecode: k.mid,
      config: { socialDistancing: 1 },
      retrieve: false,
      contentId: k.contentId,
      cityKey: k.city,
      sessionDate: k.date,
      fetchSessions: true,
      movieFormatCode: k.fid,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data?.seatLayout) {
    const msg = data?.status?.message?.title || data?.error || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  const rows: DistrictSeatRow[] = [];
  for (const a of data.seatLayout.colAreas?.objArea ?? [])
    for (const r of a.objRow ?? []) {
      const seats = (r.objSeat ?? []).map((s: any) => ({ label: String(s.displaySeatNumber ?? s.seatNumber ?? ""), pos: Number(s.GridSeatNum), free: String(s.SeatStatus) === "0" }));
      if (seats.length) rows.push({ name: String(r.PhyRowId ?? "").replace(/\.$/, ""), area: String(a.AreaDesc ?? ""), seats });
    }
  return rows.reverse(); // screen-first
}
