// Send one alert to every channel the person turned on. A failing channel never blocks the others.
import { execFile } from "node:child_process";
import { platform } from "node:os";
import type { Channels } from "../types.js";

export interface Alert {
  title: string; // "2 seats together, Thu 17 Dec 4:55 PM"
  body: string; // "INOX The Marina Mall, H18 + H19"
  url: string; // where to book
}

async function post(url: string, body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }) {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

function desktop(a: Alert): Promise<void> {
  return new Promise((resolve) => {
    const os = platform();
    const done = () => resolve();
    if (os === "darwin") {
      const esc = (s: string) => s.replace(/["\\]/g, "'");
      execFile("osascript", ["-e", `display notification "${esc(a.body)}" with title "${esc(a.title)}" sound name "Glass"`], done);
    } else if (os === "linux") {
      execFile("notify-send", ["-u", "critical", a.title, a.body], done);
    } else if (os === "win32") {
      const ps = `[reflection.assembly]::loadwithpartialname('System.Windows.Forms');$n=New-Object System.Windows.Forms.NotifyIcon;$n.Icon=[System.Drawing.SystemIcons]::Information;$n.Visible=$true;$n.ShowBalloonTip(10000,'${a.title.replace(/'/g, "")}','${a.body.replace(/'/g, "")}',[System.Windows.Forms.ToolTipIcon]::Info)`;
      execFile("powershell", ["-NoProfile", "-Command", ps], done);
    } else done();
  });
}

/** Returns one line per channel: "phone: sent" or "slack: failed (HTTP 404)". */
export async function sendAlert(ch: Channels, a: Alert): Promise<string[]> {
  const jobs: [string, () => Promise<void>][] = [];
  if (ch.desktop) jobs.push(["desktop", () => desktop(a)]);
  if (ch.ntfyTopic)
    jobs.push([
      "phone",
      () =>
        post(`${(ch.ntfyServer || "https://ntfy.sh").replace(/\/$/, "")}/${encodeURIComponent(ch.ntfyTopic!)}`, a.body, {
          Title: a.title,
          Priority: "urgent",
          Tags: "tickets",
          Click: a.url,
          Actions: `view, Book now, ${a.url}`,
        }),
    ]);
  if (ch.discordWebhook) jobs.push(["discord", () => post(ch.discordWebhook!, { content: `**${a.title}**\n${a.body}\n${a.url}` })]);
  if (ch.slackWebhook) jobs.push(["slack", () => post(ch.slackWebhook!, { text: `*${a.title}*\n${a.body}\n<${a.url}|Book now>` })]);
  if (ch.telegramBotToken && ch.telegramChatId)
    jobs.push([
      "telegram",
      () =>
        post(`https://api.telegram.org/bot${ch.telegramBotToken}/sendMessage`, {
          chat_id: ch.telegramChatId,
          text: `${a.title}\n${a.body}\n${a.url}`,
        }),
    ]);

  return Promise.all(
    jobs.map(async ([name, run]) => {
      try {
        await run();
        return `${name}: sent`;
      } catch (e) {
        return `${name}: failed (${(e as Error).message})`;
      }
    }),
  );
}
