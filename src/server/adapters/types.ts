import type { CheckResult, Platform, Watch } from "../types.js";

export interface Adapter {
  /** True if this adapter understands the link. */
  handles(url: URL): boolean;
  /** Read the link and say what it is. Throws an Error with a human message when the link is not usable. */
  inspect(url: URL): Promise<Platform>;
  /** Look for seats that fit the watch. */
  check(watch: Watch): Promise<CheckResult>;
  /** Do not check more often than this. Be kind to sites that are already struggling. */
  minEverySec: number;
}

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Next N calendar days as YYYY-MM-DD, starting today (local time). */
export function nextDays(n: number, from = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
}

export class UserError extends Error {}
