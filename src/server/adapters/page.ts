// Any other site: load the page and look for words that mean "on sale" or "sold out".
import type { CheckResult, Platform, Watch } from "../types.js";
import { type Adapter, BROWSER_UA, UserError } from "./types.js";

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
    const { status, text } = await fetchPage(watch.url);
    if (status >= 500) return { matches: [], summary: `The site is down right now (HTTP ${status}).`, troubled: 1 };
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
