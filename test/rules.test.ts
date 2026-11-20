import { describe, expect, it } from "vitest";
import { pickSeats, showFits, toHHMM, niceWhen, distanceKm, venueDistance, nearestFirst, type Row } from "../src/server/rules.js";
import { DEFAULT_WANT } from "../src/server/types.js";

const row = (name: string, pattern: string): Row => ({
  name,
  // "1" free, "2" taken, "0" aisle (no seat). Labels count seats only.
  seats: [...pattern].flatMap((ch, pos) => (ch === "0" ? [] : [{ label: "", pos, free: ch === "1" }])).map((s, i) => ({ ...s, label: String(i + 1) })),
});

describe("pickSeats", () => {
  it("never picks the front rows when asked not to", () => {
    const rows = [row("A", "1111"), row("B", "1111"), row("C", "2222"), row("D", "2112")];
    expect(pickSeats(rows, { seats: 2, together: true, skipFrontRows: 2 }).seats).toEqual(["D2", "D3"]);
  });
  it("does not join seats across an aisle", () => {
    const rows = [row("A", "1012")];
    expect(pickSeats(rows, { seats: 2, together: true, skipFrontRows: 0 }).seats).toEqual([]);
  });
  it("prefers the middle of the row", () => {
    const rows = [row("A", "11111111")];
    expect(pickSeats(rows, { seats: 2, together: true, skipFrontRows: 0 }).seats).toEqual(["A4", "A5"]);
  });
  it("counts free seats outside the skipped rows", () => {
    const rows = [row("A", "1111"), row("B", "1222")];
    expect(pickSeats(rows, { seats: 2, together: true, skipFrontRows: 1 })).toEqual({ seats: [], free: 1 });
  });
});

describe("showFits", () => {
  const want = { ...DEFAULT_WANT, dates: ["2026-12-17"], startBefore: "19:00", languages: ["english"] };
  it("keeps an English 4:55 PM show on the 17th", () => {
    expect(showFits({ date: "2026-12-17", time: "04:55 PM", language: "English" }, want)).toBe(true);
  });
  it("drops a show at 7 PM or later", () => {
    expect(showFits({ date: "2026-12-17", time: "07:55 PM", language: "English" }, want)).toBe(false);
  });
  it("drops another language", () => {
    expect(showFits({ date: "2026-12-17", time: "01:00 PM", language: "Tamil" }, want)).toBe(false);
  });
});

describe("near me", () => {
  const velachery = { lat: 12.9791, lng: 80.2209 };
  const want = { ...DEFAULT_WANT, near: { ...velachery, km: 10 } };
  it("measures real distances", () => {
    // Phoenix Market City Velachery to Marina Mall OMR is about 16 km in a straight line.
    expect(Math.round(distanceKm({ lat: 12.9927, lng: 80.2167 }, { lat: 12.836, lng: 80.2294 }))).toBe(17);
  });
  it("keeps close venues and drops far ones", () => {
    expect(venueDistance(want, 12.9927, 80.2167)).toBe(1.6);
    expect(venueDistance(want, 12.836, 80.2294)).toBeNull();
  });
  it("ignores venues without coordinates instead of dropping them", () => {
    expect(venueDistance(want, 0, 0)).toBeUndefined();
    expect(venueDistance({ ...DEFAULT_WANT }, 12.99, 80.21)).toBeUndefined();
  });
  it("sorts nearest first", () => {
    expect(nearestFirst([{ km: 9 }, { km: undefined }, { km: 2 }]).map((m) => m.km)).toEqual([2, 9, undefined]);
  });
});

describe("time helpers", () => {
  it("reads 12-hour and ISO times", () => {
    expect(toHHMM("12:30 AM")).toBe("00:30");
    expect(toHHMM("2026-12-17T16:55:00")).toBe("16:55");
  });
  it("writes a friendly date", () => {
    expect(niceWhen("2026-12-17", "04:55 PM")).toBe("Thu 17 Dec, 4:55 PM");
  });
});
