// Any other site: load the page and look for words that mean "on sale" or "sold out".
import type { CheckResult, Platform, Watch } from "../types.js";
import { type Adapter, BROWSER_UA, UserError } from "./types.js";
import { askSaleState } from "../jev.js";
import { store } from "../store.js";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A 1280x900 screenshot of the page, taken with agent-browser if it is installed. Undefined if not. */
async function screenshot(url: string): Promise<Buffer | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "tf-shot-"));
  const file = join(dir, "page.png");
  const run = (args: string[]) => new Promise<void>((ok, fail) => execFile("agent-browser", args, { env: { ...process.env, AGENT_BROWSER_SESSION: "ticketfind-shot" }, timeout: 60_000 }, (e) => (e ? fail(e) : ok())));
  try {
    await run(["set", "viewport", "1280", "900"]);
    await run(["open", url]);
    await new Promise((r) => setTimeout(r, 5000));
    await run(["screenshot", file]);
    return readFileSync(file);
  } catch {
    return undefined; // no agent-browser, or the page did not load: Jev reads the text only
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Jev reads the page when a TypeSafe key is set and no words were given. */
export function jevKey(): string | undefined {
  return store.settings().typesafeApiKey || process.env.TYPESAFE_API_KEY || undefined;
}

const SALE_WORDS = { on_sale: "on sale", sold_out: "sold out", not_yet: "not on sale yet", unclear: "not saying" } as const;
const OPEN_AT = 0.7; // Jev must be at least this sure before ticketfind pings you

/** Visible text of an HTML page, lower case, whitespace squashed. */
export function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchPage(url: string): Promise<{ status: number; text: string; title: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  });
  const html = await res.text();
  const title = (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "").trim();
  return { status: res.status, text: pageText(html), title };
}

export const page: Adapter = {
  minEverySec: 60,

  handles: () => true,

  async inspect(url): Promise<Platform> {
    const got = await fetchPage(url.toString()).catch((e) => {
      throw new UserError(`Could not open that link: ${(e as Error).message}`);
    });
    if (got.status === 403 || /attention required|you have been blocked|captcha/i.test(got.text.slice(0, 2000))) {
      throw new UserError("That site blocks automated checks, so ticketfind cannot watch it.");
    }
    return {
      id: "page",
      name: url.hostname.replace(/^www\./, ""),
      depth: "page",
      meta: {},
      title: got.title || url.hostname,
    };
  },

  async check(watch: Watch): Promise<CheckResult> {
    const { status, text, title } = await fetchPage(watch.url);
    if (status >= 500) return { matches: [], summary: `The site is down right now (HTTP ${status}). Still trying.`, troubled: 1, state: "down" };
    const key = jevKey();
    if (key && !watch.page?.openText && !watch.page?.closedText) {
      const shot = watch.page?.picture ? await screenshot(watch.url) : undefined;
      const a = await askSaleState(key, { title, url: watch.url, text, screenshot: shot }, "");
      const open = a.state === "on_sale" && a.confidence >= OPEN_AT;
      const pct = Math.round(a.confidence * 100);
      return open
        ? {
            matches: [{ when: "Now", venue: new URL(watch.url).hostname.replace(/^www\./, ""), seats: [], free: 0, bookUrl: watch.url }],
            summary: `Jev ${shot ? "looked at" : "read"} the page: tickets are on sale (${pct}% sure).`,
            troubled: 0,
          }
        : { matches: [], summary: `Jev ${shot ? "looked at" : "read"} the page: ${SALE_WORDS[a.state]} (${pct}% sure).`, troubled: 0, state: a.state === "sold_out" && a.confidence >= OPEN_AT ? "soldout" : "waiting" };
    }
    const lower = text.toLowerCase();
    const open = watch.page?.openText?.toLowerCase();
    const closed = watch.page?.closedText?.toLowerCase();
    const isOpen = open ? lower.includes(open) && !(closed && lower.includes(closed)) : closed ? !lower.includes(closed) : false;
    if (!open && !closed) return { matches: [], summary: "Tell ticketfind what the page says when tickets are on sale.", troubled: 0 };
    return isOpen
      ? {
          matches: [{ when: "Now", venue: new URL(watch.url).hostname.replace(/^www\./, ""), seats: [], free: 0, bookUrl: watch.url }],
          summary: open ? `The page now says "${watch.page?.openText}".` : `"${watch.page?.closedText}" is gone from the page.`,
          troubled: 0,
        }
      : { matches: [], summary: "No change yet.", troubled: 0 };
  },
};
