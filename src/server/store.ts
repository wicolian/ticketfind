// Everything lives in two JSON files in ~/.ticketfind (or $TICKETFIND_HOME). No database to install.
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Settings, Watch } from "./types.js";

const HOME = process.env.TICKETFIND_HOME ?? join(homedir(), ".ticketfind");
const WATCHES = join(HOME, "watches.json");
const SETTINGS = join(HOME, "settings.json");

mkdirSync(HOME, { recursive: true });

function read<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function write(file: string, value: unknown, secret = false): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
  if (secret) chmodSync(file, 0o600);
}

export const store = {
  home: HOME,
  watches(): Watch[] {
    return read<Watch[]>(WATCHES, []);
  },
  saveWatches(list: Watch[]): void {
    write(WATCHES, list);
  },
  settings(): Settings {
    return read<Settings>(SETTINGS, { channels: { desktop: true } });
  },
  saveSettings(s: Settings): void {
    write(SETTINGS, s, true); // holds webhook URLs and the API key
  },
};
