# Adding a site

An adapter teaches ticketfind one booking site. It is one file in `src/server/adapters/` with four parts:

```ts
export const mySite: Adapter = {
  minEverySec: 30,                       // never check faster than this
  handles: (url) => url.hostname.endsWith("mysite.com"),
  async inspect(url) { /* read the link, return a Platform with a title */ },
  async check(watch) { /* return { matches, summary, troubled } */ },
};
```

Then add it to `ORDERED` in `src/server/adapters/index.ts`.

## Rules for a good adapter

1. **Use what the site's own page uses.** Open the site with your browser's network tab, find the call that lists shows and the call that draws the seat map, and use those. Do not scrape pixels.
2. **Seat-level when you can.** If the site gives a seat map, build `Row[]` in screen-first order and call `pickSeats(rows, watch.want)`. The front-row and side-by-side rules then work for free. A gap in `pos` means an aisle, so seats across it never count as together.
3. **Filter shows with `showFits`.** It handles dates, the start-time window, language and venue.
4. **Say what happened, in plain words.** `summary` is shown to people: "Checked 40 shows. None have seats that fit yet." Count shows the site could not answer for in `troubled`.
5. **Throw `UserError` for a bad link,** with a sentence that tells people which link to paste instead.
6. **Respect the site.** No captcha solving, no bot-wall bypasses, no logins, no holding seats. If a site blocks automated checks, add it to `BLOCKED` in `index.ts` with an honest reason instead.

## Test it live

```bash
pnpm tsx scripts/smoke.ts https://mysite.com/the-show-list-page
```

Add a unit test for any parsing that can be checked without the network.
