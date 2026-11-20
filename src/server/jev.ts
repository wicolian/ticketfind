// Jev (TypeSafe's System One model) reads an event or booking page and answers one typed question:
// can tickets be bought right now? Jev makes the judgement; code makes the decision (see page adapter).
// Docs: https://docs.typesafe.ai  Endpoint: POST https://api.typesafe.ai/v1/systemone

export type SaleState = "on_sale" | "sold_out" | "not_yet" | "unclear";

export interface SaleAnswer {
  state: SaleState;
  confidence: number;
  probabilities: Record<SaleState, number>;
}

export async function askSaleState(apiKey: string, page: { title: string; url: string; text: string }, wish: string): Promise<SaleAnswer> {
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.TICKETFIND_JEV_MODEL || "jev-latest",
      state: {
        page: { title: page.title, address: page.url, visible_text: page.text.slice(0, 12_000) },
        what_the_person_wants: wish || "buy tickets for this event",
      },
      questions: {
        sale: {
          type: "choice",
          instructions: "What does `page` say about buying tickets right now?",
          criteria: {
            on_sale: "Tickets can be bought now: a buy or book button, prices you can select, or a sale that says it is live.",
            sold_out: "No tickets left: sold out, housefull, or every ticket type unavailable.",
            not_yet: "The sale has not started: coming soon, register interest, notify me, or a future sale date.",
            unclear: "The page text does not say whether tickets can be bought.",
          },
        },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Jev said no (HTTP ${res.status}): ${data?.message ?? data?.error ?? "unknown error"}`);
  const a = data?.answers?.sale;
  if (!a?.choice) throw new Error("Jev sent an answer ticketfind could not read.");
  return { state: a.choice as SaleState, confidence: Number(a.confidence ?? 0), probabilities: a.probabilities ?? {} };
}
