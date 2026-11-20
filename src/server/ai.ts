// Optional: Claude turns "2 seats together, not the front rows, before 7pm on the 17th" into watch rules,
// and reads a plain web page to learn what it says when tickets go on sale.
// Without an API key, people fill the same fields by hand.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { PageMarkers, Platform, Want } from "./types.js";

const MODEL = "claude-opus-5-5";

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

function client(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

function check(stop: string | null): void {
  if (stop === "refusal") throw new Error("Claude would not read this request. Fill the fields by hand.");
}

/** Plain words to rules. */
export async function understandWant(apiKey: string, text: string, platform: Platform): Promise<Want> {
  const today = new Date().toISOString().slice(0, 10);
  const res = await client(apiKey).messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(WantSchema) },
    system:
      "You turn a person's ticket wish into watch rules. Only set a rule the person stated or clearly implied. " +
      "Resolve relative dates against today's date. Times are local to the venue.",
    messages: [
      {
        role: "user",
        content: `Today is ${today}. They are watching: ${platform.title} on ${platform.name}.\nTheir wish: ${text}`,
      },
    ],
  });
  check(res.stop_reason);
  const w = res.parsed_output;
  if (!w) throw new Error("Could not read that. Try fewer words, or fill the fields by hand.");
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
  const res = await client(apiKey).messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(MarkerSchema) },
    system:
      "You look at the visible text of a ticket or booking page and choose short phrases ticketfind can watch for. " +
      "Quote phrases exactly as they appear in the text. Prefer a closedText that is on the page now, so its disappearance means the sale opened.",
    messages: [
      {
        role: "user",
        content: `Page: ${url}\nWhat the person wants: ${wish || "know when tickets go on sale"}\n\nVisible page text:\n${text.slice(0, 60_000)}`,
      },
    ],
  });
  check(res.stop_reason);
  const m = res.parsed_output;
  if (!m) throw new Error("Could not read that page. Type the words to watch for by hand.");
  return { openText: m.openText ?? undefined, closedText: m.closedText ?? undefined, explanation: m.explanation };
}
