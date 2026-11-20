import { describe, expect, it, vi } from "vitest";
vi.stubGlobal("btoa", (s: string) => Buffer.from(s, "binary").toString("base64"));
vi.stubGlobal("atob", (s: string) => Buffer.from(s, "base64").toString("binary"));
const { shareLink, readShared, movieFromUrl } = await import("../web/src/share");
const want = { seats: 2, together: true, skipFrontRows: 4, dates: ["2026-12-20"], languages: ["english"], venues: ["pvr aerohub"], startAfter: "20:10", startBefore: "20:11", near: { lat: 12.97, lng: 80.22, km: 10 } };

describe("share a watch", () => {
  it("round-trips through a link and never carries the location", () => {
    const link = shareLink({ title: "Avengers: Doomsday", label: "the 8:10 PM show at PVR Aerohub", url: "https://www.inoxmovies.com/moviesessions/Chennai/AVENGERS-DOOMSDAY/35312", want });
    expect(link.startsWith("https://ticketfind.vercel.app/#/join/")).toBe(true);
    const back = readShared(link.split("/join/")[1])!;
    expect(back.want.venues).toEqual(["pvr aerohub"]);
    expect("near" in back.want).toBe(false);
  });
  it("refuses links that are not cinema pages", () => {
    const evil = shareLink({ title: "x", label: "y", url: "https://evil.example/phish", want });
    expect(readShared(evil.split("/join/")[1])).toBeNull();
  });
  it("finds the city and movie in PVR INOX and District links", () => {
    expect(movieFromUrl("https://www.inoxmovies.com/moviesessions/Chennai/AVENGERS-DOOMSDAY/35312")).toEqual({ city: "Chennai", movieId: "35312" });
    expect(movieFromUrl("https://www.district.in/movies/o-m-operation-mole-movie-tickets-in-chennai-MV225928")?.movieId).toBe("d225928");
  });
});
