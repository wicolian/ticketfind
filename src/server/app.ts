// Local HTTP API for the web UI. Binds to 127.0.0.1 only: your keys and webhooks never leave your machine
// except to the services you configured.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { inspect, UserError } from "./adapters/index.js";
import { fetchPage } from "./adapters/page.js";
import { learnPage, understandWant } from "./ai.js";
import { engine } from "./engine.js";
import * as explore from "./explore.js";
import { sendAlert } from "./notify/index.js";
import { store } from "./store.js";
import { DEFAULT_WANT, type Settings } from "./types.js";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "web");

function apiKey(): string | undefined {
  return store.settings().anthropicApiKey || process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY || undefined;
}

/** Settings as the UI sees them: secrets reduced to "is it set". */
function publicSettings() {
  const s = store.settings();
  const c = s.channels;
  const mask = (v?: string) => (v ? `••••${v.slice(-4)}` : "");
  return {
    channels: {
      desktop: c.desktop,
      ntfyTopic: c.ntfyTopic ?? "",
      ntfyServer: c.ntfyServer ?? "",
      discordWebhook: mask(c.discordWebhook),
      slackWebhook: mask(c.slackWebhook),
      telegramBotToken: mask(c.telegramBotToken),
      telegramChatId: c.telegramChatId ?? "",
    },
    aiReady: Boolean(apiKey()),
    jevReady: Boolean(s.typesafeApiKey || process.env.TYPESAFE_API_KEY),
    jevKey: mask(s.typesafeApiKey),
    onTabClose: s.onTabClose ?? "keep",
    aiKey: mask(s.anthropicApiKey),
  };
}

export function buildApp(): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    const human = err instanceof UserError;
    return c.json({ error: human ? err.message : `Something broke: ${err.message}` }, human ? 400 : 500);
  });

  app.get("/api/meta", (c) => c.json({ public: false, ai: Boolean(apiKey()) }));
  app.get("/api/state", (c) => c.json({ watches: engine.list(), settings: publicSettings() }));
  // Sent by the page as it closes (navigator.sendBeacon). See engine.tabClosed.
  app.post("/api/tab-closed", (c) => {
    engine.tabClosed();
    return c.body(null, 204);
  });

  // Explore: browse a city, a movie's show times, and live seats for one show.
  app.get("/api/explore/cities", async (c) => {
    const list = await explore.cities();
    const lat = Number(c.req.query("lat")), lng = Number(c.req.query("lng"));
    const nearest = Number.isFinite(lat) && Number.isFinite(lng) && c.req.query("lat") ? explore.nearestCity(list, { lat, lng })?.name : undefined;
    return c.json({ cities: list, nearest });
  });
  app.get("/api/explore/movies", async (c) => {
    const city = c.req.query("city") || "Chennai";
    const [movies, comingSoon] = await Promise.all([explore.movies(city), explore.comingSoon(city).catch(() => [])]);
    return c.json({ movies, comingSoon });
  });
  app.get("/api/explore/trending", async (c) => c.json({ trending: await explore.trending() }));
  app.get("/api/explore/shows", async (c) => {
    const q = c.req.query();
    const at = q.lat && q.lng ? { lat: Number(q.lat), lng: Number(q.lng) } : undefined;
    return c.json(await explore.shows(q.city || "Chennai", q.movie, q.date, at, q.dmovie));
  });
  app.get("/api/explore/seats", async (c) => {
    const q = c.req.query();
    return c.json(await explore.seats(q.city || "Chennai", q.date, q.ref, Number(q.group || 2), Number(q.skip || 0)));
  });

  app.post("/api/inspect", async (c) => {
    const { url } = await c.req.json<{ url: string }>();
    const platform = await inspect(url);
    return c.json({ platform, want: DEFAULT_WANT });
  });

  app.post("/api/understand", async (c) => {
    const key = apiKey();
    if (!key) throw new UserError("Add an AI key under Alerts (Anthropic or OpenRouter) to type your wish in plain words.");
    const { url, text, platform } = await c.req.json();
    if (platform.id === "page") {
      const page = await fetchPage(url);
      return c.json({ page: await learnPage(key, url, page.text, text) });
    }
    return c.json({ want: await understandWant(key, text, platform) });
  });

  app.post("/api/watches", async (c) => {
    const body = await c.req.json();
    if (body.platform?.id === "blocked") throw new UserError(body.platform.blockedReason);
    return c.json(await engine.create(body));
  });

  // Bulk: stop, pause or resume many watches at once (all of them when no ids are given).
  app.post("/api/watches/bulk", async (c) => {
    const { action, ids } = await c.req.json<{ action: "stop" | "pause" | "resume"; ids?: string[] }>();
    const targets = engine.list().filter((w) => !ids || ids.includes(w.id)).map((w) => w.id);
    for (const id of targets) {
      if (action === "stop") engine.remove(id);
      else engine.update(id, { status: action === "pause" ? "paused" : "watching" });
    }
    return c.json({ done: targets.length });
  });

  app.patch("/api/watches/:id", async (c) => {
    const w = engine.update(c.req.param("id"), await c.req.json());
    return w ? c.json(w) : c.json({ error: "That watch is gone." }, 404);
  });

  app.post("/api/watches/:id/check", async (c) => {
    const { checkNow } = await import("./engine.js");
    return c.json(await checkNow(c.req.param("id")));
  });

  app.delete("/api/watches/:id", (c) => {
    engine.remove(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.put("/api/settings", async (c) => {
    const next = await c.req.json<{ channels: Record<string, unknown>; aiKey?: string; jevKey?: string; onTabClose?: "keep" | "stop" }>();
    const cur: Settings = store.settings();
    const channels = { ...cur.channels } as Record<string, unknown>;
    for (const [k, v] of Object.entries(next.channels ?? {})) {
      // Masked values come back unchanged from the UI: keep the stored secret.
      if (typeof v === "string" && v.startsWith("••••")) continue;
      channels[k] = typeof v === "string" ? v.trim() || undefined : v;
    }
    const aiKey = next.aiKey && !next.aiKey.startsWith("••••") ? next.aiKey.trim() || undefined : cur.anthropicApiKey;
    const jevKey = next.jevKey === undefined || next.jevKey.startsWith("••••") ? cur.typesafeApiKey : next.jevKey.trim() || undefined;
    store.saveSettings({ channels: channels as unknown as Settings["channels"], anthropicApiKey: next.aiKey === "" ? undefined : aiKey, typesafeApiKey: jevKey, onTabClose: next.onTabClose === "stop" ? "stop" : "keep" });
    return c.json(publicSettings());
  });

  app.post("/api/test-ping", async (c) => {
    const sent = await sendAlert(store.settings().channels, {
      title: "ticketfind test",
      body: "If you can read this, alerts work. You'll get one like it when seats open.",
      url: "http://127.0.0.1",
    });
    return c.json({ sent });
  });

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const off = engine.subscribe((e) => void stream.writeSSE({ data: JSON.stringify(e) }));
      stream.onAbort(off);
      while (!stream.aborted) {
        await stream.writeSSE({ event: "ping", data: "" });
        await stream.sleep(25_000);
      }
    }),
  );

  // The built web UI.
  const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
  };
  app.get("*", (c) => {
    const p = c.req.path === "/" ? "/index.html" : c.req.path;
    let file = join(WEB_DIR, p);
    if (!file.startsWith(WEB_DIR) || !existsSync(file)) file = join(WEB_DIR, "index.html");
    if (!existsSync(file)) return c.text("The web UI is not built. Run: pnpm build", 500);
    return c.body(readFileSync(file), 200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  });

  return app;
}
