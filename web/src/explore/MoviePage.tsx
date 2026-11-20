import { useEffect, useMemo, useState } from "react";
import { api, type CinemaShows, type Movie, type Seats, type Show, type Want } from "../api";
import { External } from "../icons";

type Where = { lat: number; lng: number } | undefined;

const STATUS: Record<Show["status"], string> = { open: "Seats available", filling: "Filling fast", full: "Sold out", closed: "Not on sale" };

function dayLabel(d: string) {
  const dt = new Date(`${d}T00:00:00`);
  return { dow: dt.toLocaleDateString("en-GB", { weekday: "short" }), day: dt.getDate(), mon: dt.toLocaleDateString("en-GB", { month: "short" }) };
}

function SeatPanel({ city, date, show, cinema, group, skip, movie, onWatch }: {
  city: string; date: string; show: Show; cinema: CinemaShows; group: number; skip: number; movie: Movie;
  onWatch: (url: string, want: Want, label: string) => Promise<string>;
}) {
  const [watchId, setWatchId] = useState("");
  const [seats, setSeats] = useState<Seats | null>(null);
  const [watching, setWatching] = useState<"" | "busy" | "done">("");
  const shut = show.status === "closed" || show.status === "full";

  useEffect(() => {
    setSeats(null);
    if (shut) return;
    api.seats(city, date, show.ref, group, skip).then(setSeats).catch((e) => setSeats({ ok: false, reason: (e as Error).message }));
  }, [city, date, show.ref, group, skip, shut]);

  // Watch rules match on the cinema's full name, so the watch can never spill over to another cinema.
  const word = cinema.name.replace(/\s*\(.*\)\s*/g, " ").trim();
  async function watch() {
    setWatching("busy");
    const [h, m] = show.hhmm.split(":").map(Number);
    const next = `${String(h + Math.floor((m + 1) / 60)).padStart(2, "0")}:${String((m + 1) % 60).padStart(2, "0")}`;
    await onWatch(movie.link, {
      seats: group, together: group > 1, skipFrontRows: skip, dates: [date], languages: show.language ? [show.language.toLowerCase()] : [],
      venues: [word.toLowerCase()], startAfter: show.hhmm, startBefore: next,
    }, `${movie.title}, ${show.time} at ${word}`).then(setWatchId);
    setWatching("done");
  }
  async function stop() {
    if (watchId) await api.remove(watchId);
    setWatchId("");
    setWatching("");
  }

  const good = seats?.ok && seats.best.length > 0;
  return (
    <div className="seat-panel" role="region" aria-label={`Seats for ${show.time}`}>
      <div className="seat-panel-head">
        <div>
          <strong>{show.time.replace(/^0/, "")}</strong> <span className="muted">{[show.language, show.screen].filter(Boolean).join(", ")}</span>
          <div className="seat-verdict">
            {shut ? (
              <span>{show.status === "full" ? "Sold out right now." : "Not on sale right now."} Seats often come back when other people's holds expire.</span>
            ) : seats === null ? (
              <span className="muted">Checking seats with the cinema...</span>
            ) : !seats.ok ? (
              <span>The cinema did not answer: {seats.reason}</span>
            ) : good ? (
              <span><b className="ok">{seats.freeGood} good seats free.</b> Best for {group}: {seats.best.map((s) => <span key={s} className="seat">{s}</span>)}</span>
            ) : (
              <span>{seats.free} seats free, but none fit {group > 1 ? `${group} together ` : ""}{skip ? `outside the front ${skip} rows` : ""}.</span>
            )}
          </div>
        </div>
        <div className="row">
          {good ? (
            <a className="btn btn-primary" href={show.bookUrl} target="_blank" rel="noreferrer">Book on PVR INOX <External size={14} /></a>
          ) : (
            watching === "done" ? (
              <span className="row"><span className="done-note" role="status">Watching. We'll ping you when seats open.</span><button className="btn btn-ghost btn-sm" onClick={stop}>Stop</button></span>
            ) : (
              <button className="btn btn-primary" onClick={watch} disabled={watching === "busy"}>
                {watching === "busy" ? "Starting..." : "Ping me if seats open"}
              </button>
            )
          )}
          {good && (
            watching === "done" ? <span className="row"><span className="done-note" role="status">Watching</span><button className="btn btn-ghost btn-sm" onClick={stop}>Stop</button></span> : <button className="btn" onClick={watch} disabled={watching === "busy"}>Ping me if these go</button>
          )}
        </div>
      </div>
      {seats?.ok && seats.map.length > 0 && (
        <div className="seatmap" aria-label="Seat map, screen at the top">
          <div className="screen-bar">Screen this way</div>
          {seats.map.map((r) => (
            <div key={r.row} className={`smap-row ${r.front ? "front" : ""}`}>
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

export function MoviePage({ city, movie, where, onBack, onWatch, onLocate }: {
  city: string; movie: Movie; where: Where; onBack: () => void; onLocate: () => void;
  onWatch: (url: string, want: Want, label: string) => Promise<string>;
}) {
  const [data, setData] = useState<{ days: string[]; date?: string; cinemas: CinemaShows[] } | null>(null);
  const [date, setDate] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [group, setGroup] = useState(2);
  const [skip, setSkip] = useState(4);
  const [lang, setLang] = useState("All");
  const [openOnly, setOpenOnly] = useState(false);
  const [picked, setPicked] = useState<{ cinema: string; ref: string } | null>(null);

  useEffect(() => {
    setData(null);
    setError("");
    api.shows(city, movie.id, date, where).then((r) => { setData(r); setDate(r.date); }).catch((e) => setError((e as Error).message));
  }, [city, movie.id, date, where?.lat, where?.lng]);

  const langs = useMemo(() => ["All", ...new Set((data?.cinemas ?? []).flatMap((c) => c.shows.map((s) => s.language)).filter(Boolean))], [data]);
  const cinemas = (data?.cinemas ?? [])
    .map((c) => ({ ...c, shows: c.shows.filter((s) => (lang === "All" || s.language === lang) && (!openOnly || s.status === "open" || s.status === "filling")) }))
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

      <div className="prefs">
        <label className="pref">Seats
          <select className="select" value={group} onChange={(e) => setGroup(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        <label className="pref">Rows
          <select className="select" value={skip} onChange={(e) => setSkip(Number(e.target.value))}>
            <option value={0}>Any row</option>{[2, 3, 4, 5].map((n) => <option key={n} value={n}>Skip front {n}</option>)}
          </select>
        </label>
        {langs.length > 2 && (
          <label className="pref">Language
            <select className="select" value={lang} onChange={(e) => setLang(e.target.value)}>{langs.map((l) => <option key={l}>{l}</option>)}</select>
          </label>
        )}
        <label className="check pref-check"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Only shows with seats</label>
        {!where && <button className="btn btn-sm" onClick={onLocate}>Sort by distance</button>}
      </div>

      {error ? (
        <div className="callout callout-danger" role="alert">Could not load show times: {error}</div>
      ) : data === null ? (
        <div className="stack">{[0, 1, 2].map((i) => <div key={i} className="card cinema skeleton"><div className="sk-line" /><div className="sk-line short" /></div>)}</div>
      ) : cinemas.length === 0 ? (
        <div className="card empty">
          <h3>{openOnly ? "No shows with seats on this day" : "No shows on this day"}</h3>
          <p>{openOnly ? "Turn off \"Only shows with seats\" and tap a sold-out time to get pinged when seats come back." : "Pick another date above."}</p>
        </div>
      ) : (
        <>
          <p className="faint" style={{ fontSize: 13, margin: "0 0 8px" }}>
            {cinemas.length} cinemas, {openShows} shows with seats{where ? ", nearest first" : ""}. Tap a time to check seats.
          </p>
          <div className="stack">
            {cinemas.map((c) => (
              <article key={c.name} className="card cinema">
                <div className="spread">
                  <h3>{c.name}</h3>
                  {c.km !== undefined && <span className="faint mono">{c.km} km</span>}
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
                      <span>{s.screen && s.screen !== "Premium" ? s.screen : s.language}</span>
                    </button>
                  ))}
                </div>
                {picked?.cinema === c.name && date && (() => {
                  const s = c.shows.find((x) => x.ref === picked.ref);
                  return s ? <SeatPanel city={city} date={date} show={s} cinema={c} group={group} skip={skip} movie={movie} onWatch={onWatch} /> : null;
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
