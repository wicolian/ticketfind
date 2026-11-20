import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.TICKETFIND_HOME = mkdtempSync(join(tmpdir(), "tf-test-"));
const { pvrInox } = await import("../src/server/adapters/pvrinox.js");
const { DEFAULT_WANT } = await import("../src/server/types.js");

/** Fake PVR INOX: one show with this status, and this seat-map answer. */
function fakeSite(statusTxt: string, seatAnswer: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = url.includes("msessions")
      ? { output: { movieCinemaSessions: [{ cinema: { name: "INOX Test" }, experienceSessions: [{ shows: [{ showTime: "04:55 PM", language: "English", statusTxt, encrypted: "x" }] }] }] } }
      : seatAnswer;
    return new Response(JSON.stringify(body));
  }));
}
const watch = { id: "t", url: "", platform: { id: "pvr-inox", name: "PVR INOX", depth: "seats", meta: { city: "Chennai", movieId: "1" }, title: "T" }, want: { ...DEFAULT_WANT, dates: ["2026-12-17"] }, everySec: 20, status: "watching", createdAt: "", log: [] } as any;
const row = (pattern: string) => ({ n: "H", t: "seats", s: [...pattern].map((c, i) => ({ s: Number(c), displaynumber: String(i + 1) })) });

afterEach(() => vi.unstubAllGlobals());

describe("down versus sold out", () => {
  it("calls a Housefull show sold out", async () => {
    fakeSite("Housefull show!", {});
    expect((await pvrInox.check(watch)).state).toBe("soldout");
  });
  it("calls 'trouble connecting to cinema' down, not sold out", async () => {
    fakeSite("Available", { msg: "trouble connecting to cinema, please try after some time.", output: null });
    expect((await pvrInox.check(watch)).state).toBe("down");
  });
  it("calls a seat map with no free seats sold out", async () => {
    fakeSite("Filling Up Fast", { output: { rows: [row("2222"), row("2222")] } });
    expect((await pvrInox.check(watch)).state).toBe("soldout");
  });
  it("calls free seats that fit open", async () => {
    fakeSite("Available", { output: { rows: [row("2112")] } });
    const r = await pvrInox.check(watch);
    expect(r.state).toBe("open");
    expect(r.matches[0].seats).toEqual(["H2", "H3"]);
  });
  it("calls 'booking not available right now' waiting, not down and not sold out", async () => {
    fakeSite("Available", { msg: "Sorry, This Show is no longer available for booking", output: null });
    expect((await pvrInox.check(watch)).state).toBe("waiting");
  });
});
