// Rate limits for the public website's AI calls, so visitors can't burn the owner's tokens.
// Fixed windows: per visitor per hour, and for the whole site per day.
// With UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN set, counts are shared across every server.
// Without them, each server keeps its own counts in memory (weaker, but never unlimited).

const PER_IP_HOUR = Number(process.env.TICKETFIND_AI_PER_IP_HOUR || 10);
const PER_DAY = Number(process.env.TICKETFIND_AI_PER_DAY || 300);
const mem = new Map<string, { n: number; until: number }>();

async function redisIncr(key: string, ttlSec: number): Promise<number> {
  const url = process.env.UPSTASH_REDIS_REST_URL!, token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([["INCR", key], ["EXPIRE", key, String(ttlSec), "NX"]]),
    signal: AbortSignal.timeout(3000),
  });
  const out = (await res.json()) as { result: number }[];
  return Number(out[0]?.result ?? 0);
}

function memIncr(key: string, ttlSec: number): number {
  const now = Date.now();
  const cur = mem.get(key);
  if (!cur || cur.until < now) {
    mem.set(key, { n: 1, until: now + ttlSec * 1000 });
    return 1;
  }
  cur.n += 1;
  return cur.n;
}

async function incr(key: string, ttlSec: number): Promise<number> {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      return await redisIncr(key, ttlSec);
    } catch {
      /* Redis down: fall back to memory rather than to no limit */
    }
  }
  return memIncr(key, ttlSec);
}

export type Verdict = { ok: true } | { ok: false; retryAfterSec: number; reason: string };

export async function allowAi(ip: string): Promise<Verdict> {
  const hour = Math.floor(Date.now() / 3_600_000);
  const day = Math.floor(Date.now() / 86_400_000);
  const site = await incr(`tf:ai:day:${day}`, 86_400);
  if (site > PER_DAY) return { ok: false, retryAfterSec: 86_400 - (Math.floor(Date.now() / 1000) % 86_400), reason: "Plain words is busy today. Use the menus, they do the same thing." };
  const mine = await incr(`tf:ai:ip:${ip}:${hour}`, 3_600);
  if (mine > PER_IP_HOUR) return { ok: false, retryAfterSec: 3_600 - (Math.floor(Date.now() / 1000) % 3_600), reason: "That's a lot of questions for one hour. Use the menus for now." };
  return { ok: true };
}
