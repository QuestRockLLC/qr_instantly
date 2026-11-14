# QuestRock HELOC — Instantly daily report

One-page Vercel app. Pulls live Instantly workspace stats: daily sent, 7-day inbox activity, campaign open/click/reply/bounce, and recommendations.

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `INSTANTLY_API_KEY` | yes | Instantly API v2 bearer token |
| `REPORT_TOKEN` | recommended | If set, open `/?token=...` |
| `OPENAI_API_KEY` | optional | Same as Call Tracker — GPT recommendations on the dashboard |
| `OPENAI_MODEL` | optional | Default `gpt-4o-mini` |

Do not commit keys. Copy `.env.example` to `.env.local`.

## Local

```bash
cd instantly-daily-report
npm install
cp .env.example .env.local   # then paste keys
npm run dev                  # lightweight Node server (recommended)
```

`npm run dev` uses `server.mjs` (fast, reliable). Use `npm run dev:next` only if you need the Next.js app.

Open http://localhost:3100 (no token needed in local dev).

If you see **unauthorized**, you opened the page without `?token=` while `REPORT_TOKEN` is required in production. Add the query param or set `NEXT_PUBLIC_REPORT_TOKEN`.

First Instantly pull can take 5–15 seconds; the page now shows a timer instead of hanging silently.

## Deploy

```bash
npx vercel --yes
```

In the Vercel project settings, add `INSTANTLY_API_KEY` and `REPORT_TOKEN`.
