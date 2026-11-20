#!/usr/bin/env node
// ticketfind: start the local watcher and open the UI.
import { serve } from "@hono/node-server";
import open from "open";
import { buildApp } from "./app.js";
import { engine } from "./engine.js";
import { store } from "./store.js";

const args = process.argv.slice(2);
const port = Number(process.env.PORT ?? (args.find((a) => a.startsWith("--port="))?.split("=")[1] || 4848));
const shouldOpen = !args.includes("--no-open");

engine.start();
serve({ fetch: buildApp().fetch, port, hostname: "127.0.0.1" }, () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`\n  ticketfind is watching. Open ${url}\n  Your data: ${store.home}\n  Stop with Ctrl+C.\n`);
  if (shouldOpen) void open(url);
});
