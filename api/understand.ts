// Public website: plain words to show filters, behind rate limits. Only on when OPENROUTER_API_KEY is set.
import type { IncomingMessage, ServerResponse } from "node:http";
import { understandWant } from "../src/server/ai.js";
import { allowAi } from "../src/server/ratelimit.js";
import type { Platform } from "../src/server/types.js";

const MAX_TEXT = 300;

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra });
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return send(res, 404, { error: "Plain words is not turned on for this website." });
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4_000) return send(res, 413, { error: "That's too long." });
  }
  let input: { text?: string; title?: string };
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    return send(res, 400, { error: "Could not read that request." });
  }
  const text = String(input.text ?? "").trim().slice(0, MAX_TEXT);
  if (!text) return send(res, 400, { error: "Type what you want first." });

  const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "unknown";
  const verdict = await allowAi(ip);
  if (!verdict.ok) return send(res, 429, { error: verdict.reason }, { "Retry-After": String(verdict.retryAfterSec) });

  const platform: Platform = { id: "pvr-inox", name: "PVR INOX", depth: "seats", meta: {}, title: String(input.title ?? "a movie").slice(0, 120) };
  try {
    send(res, 200, { want: await understandWant(key, text, platform) });
  } catch (e) {
    send(res, 502, { error: (e as Error).message });
  }
}
