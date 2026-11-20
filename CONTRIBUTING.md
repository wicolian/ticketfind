# Contributing

Thanks for helping people get seats.

- **New site?** Read [docs/adapters.md](docs/adapters.md). One adapter per pull request, with a smoke-test run pasted in the description.
- **Bug?** Open an issue with the link you pasted (remove anything personal), what you expected, and what ticketfind said.
- **Before you open a pull request:** `pnpm typecheck && pnpm test && pnpm build`.

## Ground rules

ticketfind tells people when seats open. It does not hold or buy seats, solve captchas, get past bot walls, or automate sites that forbid it (such as IRCTC). Pull requests that add any of that will be closed. This keeps the tool fair to everyone in the same queue and keeps users out of trouble.

## Copy and UI

Write for people, not for the code: "Seats open", not `status: FOUND`. Buttons say what they do ("Start watching", "Book now"). Every state needs a design: loading, empty, error, blocked. Keep one main action per screen.
