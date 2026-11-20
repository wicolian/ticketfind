// Optional: Claude turns "2 seats together, not the front rows, before 7pm on the 17th" into watch rules,
// and reads a plain web page to learn what it says when tickets go on sale.
// Without an API key, people fill the same fields by hand.
//
// Two ways in: an Anthropic key (sk-ant-...) calls Claude directly with the Anthropic SDK; an OpenRouter key
// (sk-or-...) calls Claude Haiku 5.5 through OpenRouter, the cheapest Claude that can return these forms.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { PageMarkers, Platform, Want } from "./types.js";

const MODEL = "claude-opus-5-5";
const OPENROUTER_MODEL = process.env.TICKETFIND_OPENROUTER_MODEL || "anthropic/claude-haiku-5.5";

const isOpenRouter = (key: string) => key.startsWith("sk-or-");

/** Ask OpenRouter for JSON that matches a schema. */
async function viaOpenRouter<T>(key: string, schema: z.ZodType<T>, name: string, system: string, user: string): Promise<T> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "ticketfind" },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: 2000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema: z.toJSONSchema(schema) } },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenRouter said no (HTTP ${res.status}): ${data?.error?.message ?? "unknown error"}`);
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  const parsed = schema.safeParse(JSON.parse(text ?? "null"));
  if (!parsed.success) throw new Error("Could not read that. Try fewer words, or fill the fields by hand.");
  return parsed.data;
}

const WantSchema = z.object({
  seats: z.number().int().describe("How many seats. Default 2."),
  together: z.boolean().describe("Seats must be side by side. Default true when seats > 1."),
  skipFrontRows: z.number().int().describe("Rows nearest the screen or stage to avoid. 'Not the front rows' means 4. Default 0."),
  dates: z.array(z.string()).describe("Dates as YYYY-MM-DD. Empty when the person did not name a date."),
  startAfter: z.string().nullable().describe("Earliest start time, HH:MM 24h, or null."),
  startBefore: z.string().nullable().describe("Latest start time, HH:MM 24h, exclusive. 'Before 7pm' is 19:00. Null if none."),
  languages: z.array(z.string()).describe("Lower-case languages, e.g. ['english']. Empty for any."),
  venues: z.array(z.string()).describe("Words from venue names to keep, e.g. ['marina']. Empty for any."),
});

const MarkerSchema = z.object({
  openText: z.string().nullable().describe("Short exact text from the page that appears only when booking is open."),
  closedText: z.string().nullable().describe("Short exact text from the page that shows booking is not open yet."),
  explanation: z.string().describe("One plain sentence for the person about what ticketfind will look for."),
});

/** A day-of-month the model placed in the past moves to the next month that has that day. */
export function notInPast(date: string, today = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  for (let i = 0; d < t && i < 13; i++) {
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const days = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    d = new Date(next.getFullYear(), next.getMonth(), Math.min(Number(m[3]), days));
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function client(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

function check(stop: string | null): void {
  if (stop === "refusal") throw new Error("Claude would not read this request. Fill the fields by hand.");
}

/** Plain words to rules. */
export async function understandWant(apiKey: string, text: string, platform: Platform): Promise<Want> {
  const today = new Date().toISOString().slice(0, 10);
  const system =
    "You turn a person's ticket wish into watch rules. Only set a rule the person stated or clearly implied. " +
    "Resolve relative dates against today's date. Dates are never in the past: \"the 17th\" means the next 17th on or after today. " +
    "Times are local to the venue.";
  const user = `Today is ${today}. They are watching: ${platform.title} on ${platform.name}.\nTheir wish: ${text}`;
  let w: z.infer<typeof WantSchema> | null;
  if (isOpenRouter(apiKey)) {
    w = await viaOpenRouter(apiKey, WantSchema, "watch_rules", system, user);
  } else {
    const res = await client(apiKey).messages.parse({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: zodOutputFormat(WantSchema) },
      system,
      messages: [{ role: "user", content: user }],
    });
    check(res.stop_reason);
    w = res.parsed_output;
  }
  if (!w) throw new Error("Could not read that. Try fewer words, or fill the fields by hand.");
  w.dates = w.dates.map((d) => notInPast(d));
  return {
    seats: Math.max(1, Math.min(10, w.seats)),
    together: w.together,
    skipFrontRows: Math.max(0, Math.min(10, w.skipFrontRows)),
    dates: w.dates,
    startAfter: w.startAfter ?? undefined,
    startBefore: w.startBefore ?? undefined,
    languages: w.languages,
    venues: w.venues,
  };
}

/** Read a page and pick the words that mean "on sale" or "not yet". */
export async function learnPage(apiKey: string, url: string, text: string, wish: string): Promise<PageMarkers & { explanation: string }> {
  const system =
    "You look at the visible text of a ticket or booking page and choose short phrases ticketfind can watch for. " +
    "Quote phrases exactly as they appear in the text. Prefer a closedText that is on the page now, so its disappearance means the sale opened.";
  const user = `Page: ${url}\nWhat the person wants: ${wish || "know when tickets go on sale"}\n\nVisible page text:\n${text.slice(0, 60_000)}`;
  let m: z.infer<typeof MarkerSchema> | null;
  if (isOpenRouter(apiKey)) {
    m = await viaOpenRouter(apiKey, MarkerSchema, "page_markers", system, user);
  } else {
    const res = await client(apiKey).messages.parse({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: zodOutputFormat(MarkerSchema) },
      system,
      messages: [{ role: "user", content: user }],
    });
    check(res.stop_reason);
    m = res.parsed_output;
  }
  if (!m) throw new Error("Could not read that page. Type the words to watch for by hand.");
  return { openText: m.openText ?? undefined, closedText: m.closedText ?? undefined, explanation: m.explanation };
}
