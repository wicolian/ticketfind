import { describe, expect, it } from "vitest";
import { pickSeats, showFits, toHHMM, niceWhen, type Row } from "../src/server/rules.js";
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

describe("time helpers", () => {
  it("reads 12-hour and ISO times", () => {
    expect(toHHMM("12:30 AM")).toBe("00:30");
    expect(toHHMM("2026-12-17T16:55:00")).toBe("16:55");
  });
  it("writes a friendly date", () => {
    expect(niceWhen("2026-12-17", "04:55 PM")).toBe("Thu 17 Dec, 4:55 PM");
  });
});
