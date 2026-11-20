import type { Platform, Watch } from "../types.js";
import { district } from "./district.js";
import { page } from "./page.js";
import { pvrInox } from "./pvrinox.js";
import { type Adapter, UserError } from "./types.js";

/** Sites ticketfind will not touch, and why. Kept honest on purpose. */
const BLOCKED: { host: RegExp; name: string; reason: string }[] = [
  {
    host: /(^|\.)irctc\.co\.in$/i,
    name: "IRCTC",
    reason:
      "IRCTC does not allow automated access, and Tatkal bots are illegal under the Railways Act. Use IRCTC's own alerts or the Rail Connect app.",
  },
  {
    host: /(^|\.)bookmyshow\.com$/i,
    name: "BookMyShow",
    reason:
      "BookMyShow blocks automated checks. For PVR INOX cinemas, paste the same show from inoxmovies.com or district.in instead: they read the same seats.",
  },
];

const ORDERED: Adapter[] = [pvrInox, district];

export function adapterFor(platformId: Platform["id"]): Adapter {
  if (platformId === "pvr-inox") return pvrInox;
  if (platformId === "district") return district;
  return page;
}

export async function inspect(raw: string): Promise<Platform> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UserError("That does not look like a link. Copy it from the address bar and paste it again.");
  }
  const blocked = BLOCKED.find((b) => b.host.test(url.hostname));
  if (blocked) {
    return { id: "blocked", name: blocked.name, depth: "none", blockedReason: blocked.reason, meta: {}, title: blocked.name };
  }
  const adapter = ORDERED.find((a) => a.handles(url)) ?? page;
  return adapter.inspect(url);
}

export function minEverySec(watch: Watch): number {
  return adapterFor(watch.platform.id).minEverySec;
}

export { UserError };
