import { describe, expect, it } from "vitest";
import { leaveMinutes, showIcs } from "../web/src/calendar";

describe("calendar file", () => {
  it("has the show, the cinema and a leave-now alarm based on distance", () => {
    const ics = showIcs({ title: "Avengers: Doomsday", cinema: "PVR Aerohub", address: "Chennai Airport", date: "2026-12-20", hhmm: "20:10", minutes: 155, km: 6, bookUrl: "https://example.com/book" });
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:Avengers: Doomsday at PVR Aerohub");
    expect(ics).toContain("LOCATION:PVR Aerohub\\, Chennai Airport");
    expect(ics).toContain(`TRIGGER:-PT${leaveMinutes(6)}M`);
    expect(leaveMinutes(6)).toBe(33);
    expect(ics.split("\r\n").filter((l) => /^DT(START|END):\d{8}T\d{6}Z$/.test(l))).toHaveLength(2);
  });
});
