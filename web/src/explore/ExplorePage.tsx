import { useEffect, useMemo, useState } from "react";
import { api, type Movie } from "../api";

export function ExplorePage({ city, onOpen }: { city: string; onOpen: (m: Movie) => void }) {
  const [movies, setMovies] = useState<Movie[] | null>(null);
  const [error, setError] = useState("");
  const [lang, setLang] = useState("All");
  const [advanceOnly, setAdvanceOnly] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    setMovies(null);
    setError("");
    api.movies(city).then((r) => setMovies(r.movies)).catch((e) => setError((e as Error).message));
  }, [city]);

  const languages = useMemo(() => {
    const count = new Map<string, number>();
    for (const m of movies ?? []) for (const l of m.languages) count.set(l, (count.get(l) ?? 0) + 1);
    return ["All", ...[...count.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l)];
  }, [movies]);

  const needle = q.trim().toLowerCase();
  const shown = (movies ?? []).filter((m) => (lang === "All" || m.languages.includes(lang)) && (!advanceOnly || m.advance) && (!needle || m.title.toLowerCase().includes(needle)));
  const advanceCount = (movies ?? []).filter((m) => m.advance).length;

  return (
    <section>
      <div className="explore-head">
        <h1 className="page-title">Now showing in {city}</h1>
        <p className="muted" style={{ margin: 0 }}>Live seats at PVR and INOX cinemas. Pick a movie to see show times near you.</p>
      </div>

      <div className="search-row">
        <input
          className="input search"
          type="search"
          placeholder="Search movies"
          aria-label="Search movies"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && shown.length === 1) onOpen(shown[0]); }}
        />
      </div>
      <div className="chips" role="toolbar" aria-label="Filter movies">
        {languages.map((l) => (
          <button key={l} className="chip" aria-pressed={lang === l} onClick={() => setLang(l)}>{l}</button>
        ))}
        {advanceCount > 0 && (
          <button className="chip" aria-pressed={advanceOnly} onClick={() => setAdvanceOnly((v) => !v)}>
            Advance booking <span className="chip-count">{advanceCount}</span>
          </button>
        )}
      </div>

      {error ? (
        <div className="callout callout-danger" role="alert">Could not load movies for {city}: {error}</div>
      ) : movies === null ? (
        <div className="posters" aria-busy="true">
          {Array.from({ length: 10 }, (_, i) => <div key={i} className="poster-card skeleton"><div className="poster" /><div className="sk-line" /><div className="sk-line short" /></div>)}
        </div>
      ) : shown.length === 0 ? (
        <div className="card empty">
          <h3>{needle ? `Nothing matches "${q.trim()}"` : `No ${lang} movies here right now`}</h3>
          <p>{needle ? "Check the spelling, or clear the search." : "Try another language, or switch city at the top."}</p>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => { setLang("All"); setAdvanceOnly(false); setQ(""); }}>Show all movies</button>
        </div>
      ) : (
        <div className="posters">
          {shown.map((m) => (
            <button key={m.id} className="poster-card" onClick={() => onOpen(m)}>
              <div className="poster">
                {m.poster ? <img src={m.poster} alt="" loading="lazy" /> : <span className="poster-fallback">{m.title}</span>}
                {m.advance && <span className="poster-tag">Advance booking</span>}
              </div>
              <span className="poster-title">{m.title}</span>
              <span className="poster-meta">{[m.certificate, m.languages.slice(0, 2).join(", ") + (m.languages.length > 2 ? ` +${m.languages.length - 2}` : "")].filter(Boolean).join(" | ")}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
