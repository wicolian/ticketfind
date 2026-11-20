// "Add to calendar": a standard .ics file with the show, the cinema, and a reminder to leave in time.
// Travel time is a rough city guess (about 3 minutes per km, plus 15 to park and get tickets).

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

export function leaveMinutes(km?: number): number {
  return km === undefined ? 45 : Math.round(15 + km * 3);
}

export function showIcs(o: { title: string; cinema: string; address?: string; date: string; hhmm: string; minutes?: number; km?: number; bookUrl: string }): string {
  const start = new Date(`${o.date}T${o.hhmm}:00`);
  const end = new Date(start.getTime() + (o.minutes || 165) * 60_000);
  const leave = leaveMinutes(o.km);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ticketfind//EN",
    "BEGIN:VEVENT",
    `UID:${stamp(start)}-${Math.random().toString(36).slice(2)}@ticketfind`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(`${o.title} at ${o.cinema}`)}`,
    `LOCATION:${esc([o.cinema, o.address].filter(Boolean).join(", "))}`,
    `DESCRIPTION:${esc(`Booked through ${o.bookUrl}\nLeave about ${leave} minutes before the show${o.km !== undefined ? ` (${o.km} km away)` : ""}.`)}`,
    `URL:${o.bookUrl}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(`Leave now for ${o.title} at ${o.cinema}`)}`,
    `TRIGGER:-PT${leave}M`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function downloadIcs(name: string, ics: string) {
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name.replace(/[^\w-]+/g, "-").toLowerCase()}.ics` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
