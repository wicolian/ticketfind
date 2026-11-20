// Tells the web app it is the public website, so it hides watching and alerts.
import type { IncomingMessage, ServerResponse } from "node:http";

export default function handler(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=3600" });
  res.end(JSON.stringify({ public: true, ai: Boolean(process.env.OPENROUTER_API_KEY) }));
}
