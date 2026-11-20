// Shared shapes between the engine, adapters, API and web UI.

/** What the person actually wants. Written in their words, stored as fields. */
export interface Want {
  /** How many seats. */
  seats: number;
  /** Seats must sit side by side. */
  together: boolean;
  /** Never pick the N rows nearest the screen or stage. 0 = any row. */
  skipFrontRows: number;
  /** Only these dates (YYYY-MM-DD). Empty = any date the link covers. */
  dates: string[];
  /** Show must start at or after this time (HH:MM, 24h). */
  startAfter?: string;
  /** Show must start before this time (HH:MM, 24h). */
  startBefore?: string;
  /** Only these languages, lower case ("english"). Empty = any. */
  languages: string[];
  /** Only venues whose name contains one of these words. Empty = any venue the link covers. */
  venues: string[];
  /** Only venues within km of this point. Set from the browser; never sent to any site. */
  near?: { lat: number; lng: number; km: number };
}

/** For plain web pages: what the page says when tickets are or are not on sale. */
export interface PageMarkers {
  /** Text that appears when you can book ("Book now", "Available"). */
  openText?: string;
  /** Text that appears while you cannot ("Sold out", "Coming soon"). */
  closedText?: string;
}

export type PlatformId = "pvr-inox" | "district" | "page" | "blocked";

export interface Platform {
  id: PlatformId;
  /** Human name shown in the UI. */
  name: string;
  /** What ticketfind can see on this platform, in plain words. */
  depth: "seats" | "counts" | "page" | "none";
  /** Why a blocked platform cannot be watched. */
  blockedReason?: string;
  /** Extra facts the adapter pulled from the link (city, movie id...). */
  meta: Record<string, string>;
  /** A title for the watch, e.g. "Avengers: Doomsday in Chennai". */
  title: string;
}

/** One bookable option the engine found. */
export interface Match {
  /** "Thu 17 Dec, 4:55 PM" */
  when: string;
  /** "INOX The Marina Mall, OMR" */
  venue: string;
  /** Seats picked for the person, e.g. ["H18", "H19"]. Empty when the platform only gives counts. */
  seats: string[];
  /** Free seats that fit the rules (outside the front rows). */
  free: number;
  /** Where to book it. */
  bookUrl: string;
  /** Distance from the person, when they shared their location. */
  km?: number;
}

/** Result of one check. */
export interface CheckResult {
  matches: Match[];
  /** One line for people: "Checked 9 shows. 2 open, 7 sold out." */
  summary: string;
  /** Shows the site could not answer for (outage, closed). */
  troubled: number;
}

export type WatchStatus = "watching" | "found" | "paused" | "error";

export interface LogEntry {
  at: string; // ISO time
  kind: "check" | "found" | "gone" | "error" | "notify";
  text: string;
}

export interface Watch {
  id: string;
  url: string;
  platform: Platform;
  want: Want;
  page?: PageMarkers;
  /** Seconds between checks. */
  everySec: number;
  status: WatchStatus;
  createdAt: string;
  lastCheckAt?: string;
  last?: CheckResult;
  lastError?: string;
  /** Newest first, capped. */
  log: LogEntry[];
}

export interface Channels {
  desktop: boolean;
  ntfyTopic?: string;
  ntfyServer?: string;
  discordWebhook?: string;
  slackWebhook?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}

export interface Settings {
  channels: Channels;
  /** Optional. Lets ticketfind read your request in plain words. An Anthropic (sk-ant-) or OpenRouter (sk-or-) key. */
  anthropicApiKey?: string;
  /** Optional. TypeSafe key: Jev reads event pages and says when tickets go on sale. */
  typesafeApiKey?: string;
  /** What happens when the last ticketfind tab closes. Default keep. */
  onTabClose?: "keep" | "stop";
}

export const DEFAULT_WANT: Want = {
  seats: 2,
  together: true,
  skipFrontRows: 0,
  dates: [],
  languages: [],
  venues: [],
};
