// Share a watch: a link to the public website that carries the movie and the rules, nothing personal.
import type { Want } from "./api";

export const PUBLIC_SITE = "https://ticketfind.vercel.app";

export interface Shared { title: string; label: string; url: string; want: Want }

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

export function shareLink(x: Shared): string {
  const { near: _skip, ...want } = x.want; // never share someone's location
  return `${PUBLIC_SITE}/#/join/${b64url(JSON.stringify({ ...x, want }))}`;
}

export function readShared(code: string): Shared | null {
  try {
    const x = JSON.parse(fromB64url(code));
    if (typeof x?.url !== "string" || typeof x?.title !== "string" || typeof x?.want?.seats !== "number") return null;
    if (!/^https:\/\/(www\.)?(inoxmovies|pvrcinemas|district)\.(com|in)\//.test(x.url)) return null; // only cinema links
    return x as Shared;
  } catch {
    return null;
  }
}

/** City, movie id and District link from a shared cinema link, for the browser watcher. */
export function movieFromUrl(url: string): { city: string; movieId: string; districtUrl?: string } | null {
  const inox = /\/moviesessions\/([^/]+)\/[^/]+\/(\d+)/.exec(url);
  if (inox) return { city: decodeURIComponent(inox[1]), movieId: inox[2] };
  const d = /-movie-tickets-in-([a-z-]+)-MV(\d+)/.exec(url);
  if (d) return { city: d[1].replace(/\b\w/g, (c) => c.toUpperCase()), movieId: `d${d[2]}`, districtUrl: url };
  return null;
}

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
