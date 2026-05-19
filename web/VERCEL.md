# Vercel configuration notes

`vercel.json` in this directory pins the Next.js framework, jumps to
the repo root for `bun install` (so the workspace resolves), and
proxies `/api/*` + `/ws` through Vercel to the Render-hosted server.

## Before the first deploy

1. Create the Render service (see `/DEPLOY.md`) and copy its public URL.
   It will look like `https://agora-server.onrender.com` — likely with a
   suffix if the name is taken.
2. Open `web/vercel.json` and replace both `agora-server.onrender.com`
   strings with your real Render hostname. Commit the change.
3. In the Vercel project settings, set the **Root Directory** to `web`.
   Without this, Vercel runs `next build` from the repo root and can't
   find the app.
4. Set the env vars listed in `web/.env.production.example` in the
   Vercel dashboard (Project → Settings → Environment Variables).

The proxy keeps the browser on a single origin, which sidesteps the
cookie/CORS dance with the server. If you'd rather hit the Render
service directly from the client, delete the `rewrites` block and set
`NEXT_PUBLIC_API_URL` to the Render URL instead.
