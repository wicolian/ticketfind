# Deploy the public website (Vercel)

The website is Explore and live seats: what's showing, show times by cinema, and live seats for one show.
Watching and alerts need the app on your own computer (`npx ticketfind`), so the website links there.

## Once

1. **Create the project:** `npx vercel@66.5.0 link` in this folder (pick your Vercel account, project name `ticketfind`).
   Vercel reads `vercel.json`: it installs with pnpm, builds `dist/web`, and serves the functions in `api/`.
2. **Copy two ids** from `.vercel/project.json`: `orgId` and `projectId`.
3. **Make a token** at https://vercel.com/account/tokens.
4. **Add three GitHub secrets** (repo Settings > Secrets and variables > Actions):
   `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

From then on, `.github/workflows/deploy.yml` deploys every push to `main` to production, and every pull
request gets a preview link in its job summary. (Do not also connect the repo in Vercel's dashboard, or it deploys twice.)

## Environment variables on Vercel

None are required. See `.env.example` for the optional ones.

To turn on plain words on the website, add `OPENROUTER_API_KEY` in Vercel (Settings > Environment Variables).
Use a separate key with a credit limit (openrouter.ai > Keys > Edit > Credit limit) so it can never spend more
than that. The website also limits use: 10 requests per visitor per hour and 300 per day for the whole site
(`TICKETFIND_AI_PER_IP_HOUR`, `TICKETFIND_AI_PER_DAY`). For limits shared across all of Vercel's servers,
add a free Upstash Redis (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`).

Never add an Anthropic key to the website.

## Kind to the cinemas

Answers are cached at Vercel's edge: cities 1 hour, movies 5 minutes, show times 30 seconds, seats 10 seconds.
However many people visit, the cinema's servers see at most a few requests a minute per show.
