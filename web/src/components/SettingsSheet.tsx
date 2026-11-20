import { useEffect, useState } from "react";
import { api, type PublicSettings } from "../api";
import { X } from "../icons";

function randomTopic(): string {
  const words = ["seat", "rush", "front", "row", "aisle", "show", "ticket", "popcorn"];
  const w = () => words[Math.floor(Math.random() * words.length)];
  return `ticketfind-${w()}-${w()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function SettingsSheet({ settings, onClose, onSaved }: { settings: PublicSettings; onClose: () => void; onSaved: (s: PublicSettings, msg: string) => void }) {
  const [ch, setCh] = useState(settings.channels);
  const [aiKey, setAiKey] = useState(settings.aiKey);
  const [onTabClose, setOnTabClose] = useState(settings.onTabClose ?? "keep");
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<string[] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof typeof ch>(k: K, v: (typeof ch)[K]) => setCh({ ...ch, [k]: v });

  async function save(andTest = false) {
    setBusy(true);
    try {
      const s = await api.saveSettings({ channels: ch, aiKey, onTabClose });
      if (andTest) {
        const r = await api.testPing();
        setTestResult(r.sent.length ? r.sent : ["No channels are on yet."]);
        onSaved(s, "Saved. Test ping sent.");
      } else {
        onSaved(s, "Saved.");
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="sheet-head">
          <h2 id="settings-title">Where should we ping you?</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="sheet-body">
          <div className="channel">
            <label className="check" style={{ minHeight: 0 }}>
              <input type="checkbox" checked={ch.desktop} onChange={(e) => set("desktop", e.target.checked)} />
              <span><h4>This computer</h4><span className="hint" style={{ margin: 0 }}>A notification with a sound.</span></span>
            </label>
          </div>

          <div className="channel">
            <h4>Your phone</h4>
            <p className="hint" style={{ marginTop: 0 }}>
              Install the free <a href="https://ntfy.sh" target="_blank" rel="noreferrer">ntfy</a> app and subscribe to this topic. No account needed. Anyone who knows the topic can read it, so keep it random.
            </p>
            <div className="paste">
              <input className="input mono" placeholder="ticketfind-..." value={ch.ntfyTopic} onChange={(e) => set("ntfyTopic", e.target.value)} />
              <button type="button" className="btn btn-sm" onClick={() => set("ntfyTopic", randomTopic())}>Make one</button>
            </div>
          </div>

          <details className="fold channel">
            <summary>Discord, Slack, Telegram</summary>
            <div className="stack" style={{ marginTop: 12 }}>
              <div>
                <label className="label" htmlFor="discord">Discord webhook URL</label>
                <input id="discord" className="input" value={ch.discordWebhook} onChange={(e) => set("discordWebhook", e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="slack">Slack webhook URL</label>
                <input id="slack" className="input" value={ch.slackWebhook} onChange={(e) => set("slackWebhook", e.target.value)} />
              </div>
              <div className="grid">
                <div>
                  <label className="label" htmlFor="tgtok">Telegram bot token</label>
                  <input id="tgtok" className="input" value={ch.telegramBotToken} onChange={(e) => set("telegramBotToken", e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="tgchat">Telegram chat ID</label>
                  <input id="tgchat" className="input" value={ch.telegramChatId} onChange={(e) => set("telegramChatId", e.target.value)} />
                </div>
              </div>
            </div>
          </details>

          <div className="channel">
            <h4>Plain-words setup (optional)</h4>
            <p className="hint" style={{ marginTop: 0 }}>
              With an AI key you can type "2 seats together, not the front rows, before 7 pm" instead of filling fields. Use an Anthropic key, or an OpenRouter key (it uses Claude Haiku, about $0.0002 per request). The key stays on this computer.
            </p>
            <input className="input mono" type="password" placeholder="sk-ant-... or sk-or-..." value={aiKey} onChange={(e) => setAiKey(e.target.value)} autoComplete="off" />
          </div>

          <div className="channel">
            <h4>When you close this tab</h4>
            <label className="check" style={{ minHeight: 36 }}>
              <input type="radio" name="tabclose" checked={onTabClose === "keep"} onChange={() => setOnTabClose("keep")} />
              <span>Keep watching, and tell me it still is</span>
            </label>
            <label className="check" style={{ minHeight: 36 }}>
              <input type="radio" name="tabclose" checked={onTabClose === "stop"} onChange={() => setOnTabClose("stop")} />
              <span>Stop everything, and tell me it stopped</span>
            </label>
            <p className="hint" style={{ marginTop: 0 }}>A refresh doesn't count. ticketfind waits 15 seconds for the tab to come back.</p>
          </div>

          {testResult && (
            <div className="callout callout-ok" role="status">
              <div>{testResult.map((t) => <div key={t}>{t}</div>)}</div>
            </div>
          )}
        </div>
        <div className="sheet-foot">
          <button className="btn" disabled={busy} onClick={() => save(true)}>Send a test ping</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => save(false)}>Save</button>
        </div>
      </aside>
    </div>
  );
}
