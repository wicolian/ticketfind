// A cinema chain read straight from its own website (beyond PVR INOX and District).
// Each chain lives in its own file in this folder and exports one ChainSource.
// Explore merges every chain's cinemas into the same list, nearest first.

export interface ChainSeat {
  label: string; // printed on the seat: "12"
  pos: number; // position in the row grid; a gap in pos is an aisle
  free: boolean;
}

export interface ChainRow {
  name: string; // "H"
  seats: ChainSeat[];
}

export interface ChainShow {
  /** Opaque id the same source can turn back into a seat map: "<chainId>:<anything>". */
  ref: string;
  date: string; // YYYY-MM-DD, local time of the cinema
  hhmm: string; // 24 h local start time, "16:55"
  time: string; // "04:55 PM"
  language: string;
  format: string; // "2D", "3D", "IMAX" ...
  status: "open" | "filling" | "full" | "closed";
  /** Free and total seats if the list call gives them (no seat map needed). */
  free?: number;
  total?: number;
  priceFrom?: number; // rupees
  bookUrl: string; // the chain's own page for this show
}

export interface ChainCinema {
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  shows: ChainShow[];
}

export interface ChainSeatMap {
  /** Screen-first: rows[0] is the row nearest the screen. */
  rows: ChainRow[];
  /** Price per seat class, and which class each seat is in ("H12" -> class label). */
  classes?: { label: string; price: number }[];
  classOf?: Record<string, string>;
}

export interface ChainSource {
  id: string; // "miraj"
  name: string; // "Miraj Cinemas"
  /** Cities this chain has cinemas in (names as PVR INOX spells them, e.g. "Chennai", "Mumbai"). */
  cities(): Promise<string[]>;
  /** Every cinema of this chain in the city with its shows of this movie on this date. Match the movie by title. */
  shows(city: string, movieTitle: string, date: string): Promise<ChainCinema[]>;
  /** The seat map for one show, from its ref. Throw an Error with a short human message if the site fails. */
  seatMap(ref: string): Promise<ChainSeatMap>;
}
