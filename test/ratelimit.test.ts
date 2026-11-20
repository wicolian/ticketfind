import { describe, expect, it } from "vitest";

describe("public AI rate limit (no Redis: per-server memory)", () => {
  it("lets a visitor make 10 requests an hour, then says no", async () => {
    process.env.TICKETFIND_AI_PER_IP_HOUR = "10";
    process.env.TICKETFIND_AI_PER_DAY = "300";
    delete process.env.UPSTASH_REDIS_REST_URL;
    const { allowAi } = await import("../src/server/ratelimit.js");
    const results = [];
    for (let i = 0; i < 11; i++) results.push((await allowAi("203.0.113.7")).ok);
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
    expect(results[10]).toBe(false);
    // Someone else is not affected.
    expect((await allowAi("198.51.100.2")).ok).toBe(true);
  });
});
