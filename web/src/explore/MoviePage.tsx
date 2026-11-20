import { useEffect, useMemo, useRef, useState } from "react";
import { api, type CinemaShows, type Movie, type Seats, type Show, type Want } from "../api";
import { External } from "../icons";
import { downloadIcs, leaveMinutes, showIcs } from "../calendar";
import { copy, shareLink } from "../share";

type Where = { lat: number; lng: number } | undefined;

const rupees = (n: number) => `₹${Math.round(n)}`;

const STATUS: Record<Show["status"], string> = { open: "Seats available", filling: "Filling fast", full: "Sold out", closed: "Not on sale" };

function dayLabel(d: string) {
  const dt = new Date(`${d}T00:00:00`);
  return { dow: dt.toLocaleDateString("en-GB", { weekday: "short" }), day: dt.getDate(), mon: dt.toLocaleDateString("en-GB", { month: "short" }) };
}

function SeatPanel({ city, date, show, cinema, group, skip, movie, onWatch, onStop }: {
  city: string; date: string; show: Show; cinema: CinemaShows; group: number; skip: number; movie: Movie; onStop: (id: string) => unknown;
  onWatch: (url: string, want: Want, label: string) => Promise<string>;
}) {
  const [watchId, setWatchId] = useState("");
  const [seats, setSeats] = useState<Seats | null>(null);
  const [watching, setWatching] = useState<"" | "busy" | "done">("");
  const shut = show.status === "closed" || show.status === "full";

  const fromDistrict = show.source === "district";
  useEffect(() => {
    setSeats(null);
    if (shut) return;
    api.seats(city, date, show.ref, group, skip).then(setSeats).catch((e) => setSeats({ ok: false, reason: (e as Error).message }));
  }, [city, date, show.ref, group, skip, shut]);

  // Watch rules match on the cinema's full name, so the watch can never spill over to another cinema.
  const word = cinema.name.replace(/\s*\(.*\)\s*/g, " ").trim();
  const [shared, setShared] = useState("");
  function wantForShow(): Want {
    const [h, m] = show.hhmm.split(":").map(Number);
    const next = `${String(h + Math.floor((m + 1) / 60)).padStart(2, "0")}:${String((m + 1) % 60).padStart(2, "0")}`;
    return { seats: group, together: group > 1, skipFrontRows: skip, dates: [date], languages: show.language ? [show.language.toLowerCase()] : [], venues: [word.toLowerCase()], startAfter: show.hhmm, startBefore: next };
  }
  async function share() {
    const link = shareLink({ title: `${movie.title}`, label: `the ${show.time.replace(/^0/, "")} show at ${cinema.name}`, url: fromDistrict && movie.districtUrl ? movie.districtUrl : movie.link, want: wantForShow() });
    setShared((await copy(link)) ? "Link copied. Friends who open it get pinged for this show too." : link);
  }
  async function watch() {
    setWatching("busy");
    const [h, m] = show.hhmm.split(":").map(Number);
    const next = `${String(h + Math.floor((m + 1) / 60)).padStart(2, "0")}:${String((m + 1) % 60).padStart(2, "0")}`;
    await onWatch(fromDistrict && movie.districtUrl ? movie.districtUrl : movie.link, {
      seats: group, together: group > 1, skipFrontRows: skip, dates: [date], languages: show.language ? [show.language.toLowerCase()] : [],
      venues: [word.toLowerCase()], startAfter: show.hhmm, startBefore: next,
    }, `${movie.title}, ${show.time} at ${word}`).then(setWatchId);
    setWatching("done");
  }
  async function stop() {
    if (watchId) await onStop(watchId);
    setWatchId("");
    setWatching("");
  }

  // District counts are the fallback when its seat map does not answer.
  const districtGood = fromDistrict && !shut && !seats?.ok && (show.free ?? 0) >= group;
  const good = (seats?.ok && seats.best.length > 0) || districtGood;
  return (
    <div className="seat-panel" role="region" aria-label={`Seats for ${show.time}`}>
      <div className="seat-panel-head">
        <div>
          <strong>{show.time.replace(/^0/, "")}</strong> <span className="muted">{[show.language, show.screen].filter(Boolean).join(", ")}</span>
          <div className="seat-verdict">
            {fromDistrict && !shut && seats !== null && !seats.ok ? (
              <span>{districtGood ? <b className="ok">About {show.free} seats free.</b> : <>Only {show.free} free, fewer than {group}.</>} District's count can lag a little. You pick the exact seats on District.</span>
            ) : shut ? (
              <span>{show.status === "full" ? "Sold out right now." : "Not on sale right now."} Seats often come back when other people's holds expire.</span>
            ) : seats === null ? (
              <span className="muted">Checking seats with the cinema...</span>
            ) : !seats.ok ? (
              /trouble|connect|facing|try again|timeout|went wrong|did not answer/i.test(seats.reason)
                ? <span>The cinema's site isn't answering right now. Seats may still be there: tap Ping me and ticketfind keeps trying.</span>
                : <span>This show isn't on sale right now ({seats.reason.replace(/^Sorry,?\s*/i, "").replace(/\.$/, "")}). Ping me and ticketfind will check until it is.</span>
            ) : good ? (
              <span>
                <b className="ok">{seats.freeGood} good seats free.</b> Best for {group}: {seats.best.map((s) => <span key={s} className="seat">{s}</span>)}
                {seats.price ? <> {rupees(seats.price)} each, <b>{rupees(seats.price * group)} for {group}</b>.</> : null}
              </span>
            ) : (
              <span>{seats.free === 0 ? <>No seats can be booked right now{fromDistrict && (show.free ?? 0) > 0 ? ` (District's list says ${show.free}, but its seat map has none open)` : ""}. Seats often come back.</> : <>{seats.free} seats free, but none fit {group > 1 ? `${group} together ` : ""}{skip ? `outside the front ${skip} rows` : ""}.</>}</span>
            )}
          </div>
          {(() => {
            const cls = fromDistrict ? show.classes : seats?.ok ? seats.classes?.map((c) => ({ ...c, free: -1 })) : undefined;
            return cls && cls.length > 0 ? (
              <div className="prices">
                {cls.map((c) => (
                  <span key={c.label} className={`price ${c.free === 0 ? "gone" : ""}`}>{c.label} {rupees(c.price)}{c.free > 0 ? `, ${c.free} free` : c.free === 0 ? ", sold out" : ""}</span>
                ))}
              </div>
            ) : null;
          })()}
        </div>
        <div className="row">
          {good ? (
            <a className="btn btn-primary" href={show.bookUrl} target="_blank" rel="noreferrer">{fromDistrict ? "Book on District" : show.source === "chain" ? `Book on ${cinema.chain ?? "the cinema's site"}` : "Book on PVR INOX"} <External size={14} /></a>
          ) : (
            watching === "done" ? (
              <span className="row"><span className="done-note" role="status">Watching. We'll ping you when seats open.</span><button className="btn btn-ghost btn-sm" onClick={stop}>Stop</button></span>
            ) : (
              <button className="btn btn-primary" onClick={watch} disabled={watching === "busy"}>
                {watching === "busy" ? "Starting..." : "Ping me if seats open"}
              </button>
            )
          )}
          <button className="btn btn-ghost btn-sm" onClick={share} title="Copy a link: friends who open it get pinged for the same show">Share</button>
          <button
            className="btn btn-ghost btn-sm"
            title={`Adds the show with a reminder to leave about ${leaveMinutes(cinema.km)} minutes before`}
            onClick={() => downloadIcs(`${movie.title} ${show.time}`, showIcs({ title: movie.title, cinema: cinema.name, address: cinema.address, date, hhmm: show.hhmm, minutes: movie.minutes, km: cinema.km, bookUrl: show.bookUrl }))}
          >
            Add to calendar
          </button>
          {good && (
            watching === "done" ? <span className="row"><span className="done-note" role="status">Watching</span><button className="btn btn-ghost btn-sm" onClick={stop}>Stop</button></span> : <button className="btn" onClick={watch} disabled={watching === "busy"}>Ping me if these go</button>
          )}
        </div>
      </div>
      {shared && <p className="hint" style={{ margin: 0, wordBreak: "break-all" }} role="status">{shared}</p>}
      {seats?.ok && seats.map.length > 0 && (
        <div className="seatmap" aria-label="Seat map, screen at the top">
          <div className="screen-bar">Screen this way</div>
          {seats.map.map((r, ri) => (
            <div key={`${ri}-${r.row}`} className={`smap-row ${r.front ? "front" : ""}`}>
              <span className="smap-label">{r.row}</span>
              {r.seats.map((f, i) => <i key={i} className={f ? "free" : ""} />)}
            </div>
          ))}
          <div className="smap-legend"><span><i className="free" /> free</span><span><i /> taken</span>{skip > 0 && <span className="muted">Faded rows: front {skip}, skipped</span>}</div>
        </div>
      )}
    </div>
  );
}

/** Time of day presets for the filter row. Times are the show's start, 24 h. */
const TIMES: Record<string, { label: string; after?: string; before?: string }> = {
  any: { label: "Any time" },
  morning: { label: "Morning", before: "12:00" },
  before7: { label: "Before 7 PM", before: "19:00" },
  evening: { label: "Evening", after: "17:00", before: "21:00" },
  late: { label: "Late night", after: "21:00" },
};
const ampm = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`; };

/** What a plain-words search on Explore asked for, handed to this page once. */
export interface Intent { movieId: string; group?: number; skip?: number; lang?: string; date?: string; after?: string; before?: string; place?: string }
function takeIntent(movieId: string): Intent | null {
  try {
    const x = JSON.parse(sessionStorage.getItem("tf.intent") ?? "null") as Intent | null;
    if (x?.movieId !== movieId) return null;
    sessionStorage.removeItem("tf.intent");
    return x;
  } catch {
    return null;
  }
}

export function MoviePage({ city, movie, where, onBack, onWatch, onLocate, onStop }: {
  city: string; movie: Movie; where: Where; onBack: () => void; onLocate: () => void; onStop: (id: string) => unknown;
  onWatch: (url: string, want: Want, label: string) => Promise<string>;
}) {
  const [intent] = useState(() => takeIntent(movie.id));
  const [data, setData] = useState<{ days: string[]; date?: string; cinemas: CinemaShows[] } | null>(null);
  const [date, setDate] = useState<string | undefined>(intent?.date);
  const [error, setError] = useState("");
  // Preferences stick across movies and visits.
  const saved = (() => { try { return JSON.parse(localStorage.getItem("tf.prefs") ?? "{}"); } catch { return {}; } })();
  const [group, setGroup] = useState<number>(intent?.group ?? saved.group ?? 2);
  const [skip, setSkip] = useState<number>(intent?.skip ?? saved.skip ?? 4);
  const [lang, setLang] = useState<string>(intent?.lang ? intent.lang[0].toUpperCase() + intent.lang.slice(1) : saved.lang ?? "All");
  // Time of day: a preset, or the exact span a plain-words search asked for.
  const custom = intent && (intent.after || intent.before) ? { after: intent.after, before: intent.before } : undefined;
  const preset = custom && Object.keys(TIMES).find((k) => TIMES[k].after === custom.after && TIMES[k].before === custom.before);
  const [time, setTime] = useState<string>(custom ? preset ?? "custom" : TIMES[saved.time] ? saved.time : "any");
  const span = time === "custom" ? custom : TIMES[time];
  const before = span?.before, after = span?.after;
  const [place, setPlace] = useState(intent?.place ?? "");
  const [updatedAt, setUpdatedAt] = useState(0);
  // Rush mode: refresh every 15 s and list seats that come back, with a notification when a sold-out show reopens.
  const [rush, setRush] = useState(false);
  const [feed, setFeed] = useState<{ at: number; text: string; ref: string }[]>([]);
  const prevRef = useRef(new Map<string, { status: Show["status"]; free?: number }>());
  const [, tick] = useState(0);
  const [allWatch, setAllWatch] = useState<"" | "busy" | string>("");
  useEffect(() => {
    try { localStorage.setItem("tf.prefs", JSON.stringify({ group, skip, lang, time: time === "custom" ? "any" : time })); } catch { /* private window */ }
  }, [group, skip, lang, time]);
  const [openOnly, setOpenOnly] = useState(false);
  const [picked, setPicked] = useState<{ cinema: string; ref: string } | null>(null);

  useEffect(() => {
    setData(null);
    setError("");
    prevRef.current = new Map();
    const load = () => api.shows(city, movie.id, date, where, movie.districtUrl).then((r) => {
      const prev = prevRef.current, next = new Map<string, { status: Show["status"]; free?: number }>(), events: { at: number; text: string; ref: string }[] = [];
      for (const c of r.cinemas) for (const s of c.shows) {
        next.set(s.ref, { status: s.status, free: s.free });
        const p = prev.get(s.ref);
        if (!p) continue;
        const reopened = (p.status === "full" || p.status === "closed") && (s.status === "open" || s.status === "filling");
        const more = s.free !== undefined && p.free !== undefined && s.free > p.free;
        if (reopened || more) {
          const text = `${c.name.split(",")[0]} ${s.time.replace(/^0/, "")}: ${reopened ? "back on sale" : `${s.free! - p.free!} seats came back`}${s.free !== undefined ? ` (now ${s.free})` : ""}`;
          events.push({ at: Date.now(), text, ref: s.ref });
          if (reopened && rushRef.current) {
            try { if (Notification.permission === "granted") new Notification("Seats back on sale", { body: `${movie.title}: ${text}`, tag: s.ref }); } catch { /* fine */ }
          }
        }
      }
      prevRef.current = next;
      if (events.length) setFeed((f) => [...events, ...f].slice(0, 12));
      setData(r); setDate(r.date); setUpdatedAt(Date.now()); setError("");
    }).catch((e) => setError((e as Error).message));
    load();
    // Live: refresh show statuses every 30 seconds while the page is visible.
    const t = window.setInterval(() => { if (rushRef.current || document.visibilityState === "visible") load(); }, rush ? 15_000 : 30_000);
    const clock = window.setInterval(() => tick((n) => n + 1), 5_000);
    return () => { window.clearInterval(t); window.clearInterval(clock); };
  }, [city, movie.id, date, where?.lat, where?.lng, rush]);
  const rushRef = useRef(rush);
  rushRef.current = rush;

  async function watchAll() {
    if (!date) return;
    setAllWatch("busy");
    const want: Want = {
      seats: group, together: group > 1, skipFrontRows: skip, dates: [date],
      languages: lang === "All" ? [] : [lang.toLowerCase()], venues: place ? [place.toLowerCase()] : [],
      ...(after ? { startAfter: after } : {}),
      ...(before ? { startBefore: before } : {}),
      ...(where ? { near: { ...where, km: 10 } } : {}),
    };
    const id = await onWatch(movie.link, want, `${movie.title} on ${dayLabel(date).dow} ${dayLabel(date).day} ${dayLabel(date).mon}`);
    setAllWatch(id);
  }

  const langs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of data?.cinemas ?? []) for (const s of c.shows) if (s.language) seen.set(s.language.toLowerCase(), s.language);
    if (lang !== "All") seen.set(lang.toLowerCase(), seen.get(lang.toLowerCase()) ?? lang);
    return ["All", ...seen.values()];
  }, [data, lang]);
  const near = place.toLowerCase();
  const cinemas = (data?.cinemas ?? [])
    .filter((c) => !near || `${c.name} ${c.address}`.toLowerCase().includes(near))
    .map((c) => ({ ...c, shows: c.shows.filter((s) => (lang === "All" || s.language.toLowerCase() === lang.toLowerCase()) && (!openOnly || s.status === "open" || s.status === "filling") && (!before || s.hhmm < before) && (!after || s.hhmm >= after)) }))
    .filter((c) => c.shows.length);
  const openShows = cinemas.reduce((n, c) => n + c.shows.filter((s) => s.status === "open" || s.status === "filling").length, 0);

  return (
    <section>
      <button className="btn btn-ghost btn-sm back" onClick={onBack}>Back to movies</button>
      <header className="movie-hero">
        {movie.poster && <img className="movie-poster" src={movie.poster} alt="" />}
        <div>
          <h1 className="page-title">{movie.title}</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>{[movie.certificate, movie.languages.join(", "), movie.genres.join(", ")].filter(Boolean).join(" | ")}</p>
          {movie.advance && <span className="badge" style={{ marginTop: 8 }}>Advance booking, releases {movie.release}</span>}
        </div>
      </header>

      {data && data.days.length > 0 && (
        <div className="days" role="tablist" aria-label="Date">
          {data.days.map((d) => {
            const l = dayLabel(d);
            return (
              <button key={d} role="tab" aria-selected={d === date} className="day" onClick={() => { setDate(d); setPicked(null); }}>
                <span>{l.dow}</span><b>{l.day}</b><span>{l.mon}</span>
              </button>
            );
          })}
        </div>
      )}

      {intent?.date && data && data.days.length > 0 && !data.days.includes(intent.date) && (
        <p className="hint" role="status" style={{ marginTop: -4 }}>
          No shows on {dayLabel(intent.date).dow} {dayLabel(intent.date).day} {dayLabel(intent.date).mon} yet. These are the first days on sale.
        </p>
      )}
      {place && (
        <div className="chips" style={{ marginBottom: 12 }}>
          <button className="chip" aria-pressed="true" onClick={() => setPlace("")} aria-label={`Show cinemas everywhere, not only ${place}`}>
            Cinemas in {place} <span aria-hidden="true">x</span>
          </button>
        </div>
      )}
      <div className="prefs">
        <label className="pref">Seats
          <select className="select" value={group} onChange={(e) => setGroup(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        <label className="pref">Rows
          <select className="select" value={skip} onChange={(e) => setSkip(Number(e.target.value))}>
            <option value={0}>Any row</option>{[2, 3, 4, 5].map((n) => <option key={n} value={n}>Skip front {n}</option>)}
          </select>
        </label>
        <label className="pref">Time
          <select className="select" value={time} onChange={(e) => setTime(e.target.value)}>
            {Object.entries(TIMES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            {custom && !preset && <option value="custom">{custom.after && custom.before ? `${ampm(custom.after)} to ${ampm(custom.before)}` : custom.before ? `Before ${ampm(custom.before)}` : `From ${ampm(custom.after!)}`}</option>}
          </select>
        </label>
        {langs.length > 2 && (
          <label className="pref">Language
            <select className="select" value={lang} onChange={(e) => setLang(e.target.value)}>{langs.map((l) => <option key={l}>{l}</option>)}</select>
          </label>
        )}
        <label className="check pref-check"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Only shows with seats</label>
        <button
          className={`btn btn-sm rush ${rush ? "on" : ""}`}
          aria-pressed={rush}
          title="Refresh every 15 seconds and list seats as they come back"
          onClick={() => { const on = !rush; setRush(on); setFeed([]); if (on && "Notification" in window && Notification.permission === "default") void Notification.requestPermission(); }}
        >
          {rush ? "Rush mode on" : "Rush mode"}
        </button>
        {!where && <button className="btn btn-sm" onClick={onLocate}>Sort by distance</button>}
        <div className="prefs-cta">
          {allWatch && allWatch !== "busy" ? (
            <span className="row"><span className="done-note" role="status">Watching every show that fits</span><button className="btn btn-ghost btn-sm" onClick={async () => { await onStop(allWatch); setAllWatch(""); }}>Stop</button></span>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={watchAll} disabled={!date || allWatch === "busy"} title="One watch for every show on this date that fits these settings">
              {allWatch === "busy" ? "Starting..." : "Ping me for any show that fits"}
            </button>
          )}
        </div>
      </div>

      {rush && (
        <div className="rush-feed" role="log" aria-live="polite" aria-label="Seats freed">
          <strong>Seats freed</strong>
          {feed.length === 0 ? <span className="muted"> Watching every 15 seconds. Seats that come back show up here.</span> : (
            <ul>{feed.map((f) => <li key={f.at + f.ref}><time>{new Date(f.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time> {f.text}</li>)}</ul>
          )}
        </div>
      )}
      {error ? (
        <div className="callout callout-danger" role="alert">Could not load show times: {error}</div>
      ) : data === null ? (
        <div className="stack">{[0, 1, 2].map((i) => <div key={i} className="card cinema skeleton"><div className="sk-line" /><div className="sk-line short" /></div>)}</div>
      ) : data && data.days.length === 0 ? (
        <div className="card empty">
          <h3>Tickets aren&apos;t on sale in {city} yet</h3>
          <p>{movie.release ? `It releases ${movie.release}. ` : ""}ticketfind can watch for you and ping you the moment booking opens, before the rush.</p>
          {allWatch && allWatch !== "busy" ? (
            <div className="row" style={{ justifyContent: "center", marginTop: 12 }}><span className="done-note" role="status">Watching. We&apos;ll ping you when tickets open.</span><button className="btn btn-ghost btn-sm" onClick={async () => { await onStop(allWatch); setAllWatch(""); }}>Stop</button></div>
          ) : (
            <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={allWatch === "busy"} onClick={async () => {
              setAllWatch("busy");
              const id = await onWatch(movie.link, { seats: group, together: group > 1, skipFrontRows: skip, dates: [], languages: lang === "All" ? [] : [lang.toLowerCase()], venues: [] }, `${movie.title} when tickets open`);
              setAllWatch(id);
            }}>Ping me when tickets open</button>
          )}
        </div>
      ) : cinemas.length === 0 ? (
        <div className="card empty">
          <h3>{openOnly ? "No shows with seats on this day" : "No shows on this day"}</h3>
          <p>{openOnly ? "Turn off \"Only shows with seats\" and tap a sold-out time to get pinged when seats come back." : "Pick another date above."}</p>
        </div>
      ) : (
        <>
          <p className="faint" style={{ fontSize: 13, margin: "0 0 8px" }}>
            <span className="live-dot" aria-hidden="true" /> Live, updated {Math.max(0, Math.round((Date.now() - updatedAt) / 1000))}s ago. {cinemas.length} cinemas, {openShows} shows with seats{where ? ", nearest first" : ""}. Tap a time to check seats.
          </p>
          <div className="stack">
            {cinemas.map((c) => (
              <article key={c.name} className="card cinema">
                <div className="spread">
                  <h3>{c.name}</h3>
                  <span className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
                    <span className="src-tag" title={`Seats and booking on ${c.source === "district" ? "District" : c.source === "chain" ? `${c.chain}'s own site` : "PVR INOX"}`}>Books on {c.source === "district" ? "District" : c.source === "chain" ? c.chain : "PVR INOX"}</span>
                    {c.km !== undefined && <span className="faint mono">{c.km} km</span>}
                  </span>
                </div>
                <div className="times">
                  {c.shows.map((s) => (
                    <button
                      key={s.ref}
                      className={`time t-${s.status}`}
                      aria-pressed={picked?.ref === s.ref}
                      title={STATUS[s.status]}
                      onClick={() => setPicked(picked?.ref === s.ref ? null : { cinema: c.name, ref: s.ref })}
                    >
                      <b>{s.time.replace(/^0/, "")}</b>
                      <span>{s.status === "full" ? "Sold out" : s.source !== "pvrinox" && s.free !== undefined ? `${s.free} free` : s.screen && s.screen !== "Premium" ? s.screen : s.language}</span>
                      {s.priceFrom !== undefined && s.status !== "full" && <span className="chip-price">from {rupees(s.priceFrom)}</span>}
                    </button>
                  ))}
                </div>
                {picked?.cinema === c.name && date && (() => {
                  const s = c.shows.find((x) => x.ref === picked.ref);
                  return s ? <SeatPanel city={city} date={date} show={s} cinema={c} group={group} skip={skip} movie={movie} onWatch={onWatch} onStop={onStop} /> : null;
                })()}
              </article>
            ))}
          </div>
          <div className="legend">
            <span><i className="t-open" /> Seats available</span><span><i className="t-filling" /> Filling fast</span><span><i className="t-full" /> Sold out</span><span><i className="t-closed" /> Not on sale</span>
          </div>
        </>
      )}
    </section>
  );
}
