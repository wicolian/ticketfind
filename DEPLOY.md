# Deploy the public website (Vercel)

Live at https://ticketfind.vercel.app. The website is Explore and live seats: what's showing, show times by
cinema, and live seats for one show. Watching and alerts need the app on your own computer (`npx ticketfind`).

## How it deploys

The GitHub repo is connected to the Vercel project `ticketfind` (team wicolian's projects):

- Every push to `main` deploys to production.
- Every pull request gets a preview deploy, linked on the pull request by Vercel.

`vercel.json` sets the install and build commands, the output folder (`dist/web`), the functions in `api/`,
and the function region.

## Why the functions run in Mumbai

PVR INOX's servers answer only traffic from India. From Vercel's default US region they return an
"access denied" HTML page instead of data, so `vercel.json` pins the functions to `bom1` (Mumbai).

## Environment variables on Vercel

None are required. See `.env.example` for the optional ones.

Plain words on the website is on when `OPENROUTER_API_KEY` is set (Project > Settings > Environment Variables).
Use a separate key with a credit limit (openrouter.ai > Keys > Edit > Credit limit) so it can never spend more
than that. The website also limits use: 10 requests per visitor per hour and 300 per day for the whole site
(`TICKETFIND_AI_PER_IP_HOUR`, `TICKETFIND_AI_PER_DAY`). For limits shared across all of Vercel's servers,
add a free Upstash Redis (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`).

Never add an Anthropic key to the website.

## Kind to the cinemas

Answers are cached at Vercel's edge: cities 1 hour, movies 5 minutes, show times 30 seconds, seats 10 seconds.
However many people visit, the cinema's servers see at most a few requests a minute per show.
