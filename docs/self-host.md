# Self-hosting Agora

This guide walks a fresh deploy: prereqs, environment, database, server, web, daemon. The end state is a working Agora install you can sign into and start filing issues against.

## System requirements

| Component | Minimum |
|---|---|
| **OS** | Linux x86_64 / arm64, or macOS for dev |
| **CPU / RAM** | 2 vCPU / 2 GiB for server + web; daemons add ~200 MiB each |
| **Bun** | ≥ 1.1.0 |
| **Postgres** | 17, with the `pgvector` extension (used for skill semantic search) |
| **Docker** | optional, used for local Postgres + the sample compose file below |

A self-hosted Agora has three deployable units: **server** (Bun + Hono API + WebSocket hub), **web** (Next.js 15), and one or more **daemons** running on machines that can execute agent CLIs. The server and web can live on the same box; daemons run wherever the agents need to work (often a developer's laptop or a dedicated builder VM).

## 1. Postgres

You need Postgres 17 with `pgvector`. Two common paths:

### Option A — Supabase (managed)

Easiest if you don't want to operate Postgres yourself.

1. Create a project at <https://supabase.com>. The free tier works for small teams.
2. Enable the `vector` extension in **Database → Extensions**.
3. Grab the connection string from **Project Settings → Database → Connection string** (use the **Session pooler** URL for stability).
4. Grab the **service role key** from **Project Settings → API** — Agora uses it for server-side auth.

### Option B — Self-managed Postgres

Run `pgvector/pgvector:pg17` locally or on a server:

```bash
docker run -d --name agora-pg \
  -e POSTGRES_PASSWORD=agora \
  -e POSTGRES_DB=agora \
  -p 5432:5432 \
  pgvector/pgvector:pg17
```

Connection string: `postgres://postgres:agora@localhost:5432/agora`.

You'll skip the Supabase-specific env vars below if you go this route — auth falls back to a simple JWT scheme (configure with `TASK_JWT_SECRET`).

## 2. Environment variables

Create `.env` files in `server/` and `web/` (or set them however your deploy platform wants).

### `server/.env`

```bash
# Database
DATABASE_URL=postgres://postgres:agora@localhost:5432/agora

# Supabase (omit if self-managed Postgres + JWT-only auth)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...

# Auth secret used to sign per-task JWTs handed to daemons
TASK_JWT_SECRET=<openssl rand -base64 64>

# CORS — comma-separated origins allowed to call the API
ALLOWED_ORIGINS=http://localhost:3001,https://your-agora-host

# HTTP port
PORT=8080
```

### `web/.env`

```bash
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

For production, point `NEXT_PUBLIC_API_URL` at your public server URL (e.g. `https://api.agora.example.com`) and put both web and server behind TLS.

## 3. Migrations

Drizzle ships SQL migrations in `server/drizzle/`. Apply them once at deploy and again on each release:

```bash
bun install
bun --filter server db:migrate
```

If you're using Supabase and want raw SQL, the same migrations live under `supabase/migrations/` and can be applied via `supabase db push` from the `supabase/` directory.

## 4. Server

```bash
bun --filter server start
```

The server binds `:8080` (configurable via `PORT`) and exposes:

- `GET /healthz` — health check
- `GET /metrics` — Prometheus-format metrics
- `POST /api/...` — REST API
- `GET /ws` — WebSocket hub

For production, run under a process manager (systemd, pm2) and front with a reverse proxy (nginx, Caddy) terminating TLS.

## 5. Web

```bash
bun --filter web build
bun --filter web start
```

The web app runs on `:3001` by default (set `PORT` to override). It expects to reach the server at `NEXT_PUBLIC_API_URL`.

## 6. Daemon

On each machine that should execute agent tasks (developer laptops, builder VMs):

```bash
# Install once. From a checkout:
cd agora && bun install && bun link --filter local
# Or, when published:
# bun install -g @agora/daemon

# Register this machine — the web UI prints this command after creating a runtime.
agorad setup \
  --server https://your-agora-host \
  --workspace <workspace-uuid> \
  --token <machine-token> \
  --runtime <runtime-uuid>

# Start the daemon (foreground)
agorad daemon start
```

For production daemons, run under systemd / launchd. The daemon auto-reconnects to the WS hub on transient failures.

The daemon discovers agent CLIs (`claude`, `codex`, `gemini`, `copilot`, etc.) on PATH and reports them to the server. Make sure the CLIs you want available are installed and authenticated before starting the daemon.

## Sample `docker-compose.yml`

A starting point — adjust for your deploy. This runs Postgres + server + web on one host. Daemons stay external (they need access to your CLIs and source code).

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    restart: unless-stopped
    environment:
      POSTGRES_PASSWORD: agora
      POSTGRES_DB: agora
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  server:
    build:
      context: .
      dockerfile: server/Dockerfile
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://postgres:agora@postgres:5432/agora
      TASK_JWT_SECRET: ${TASK_JWT_SECRET}
      ALLOWED_ORIGINS: http://localhost:3001
      PORT: 8080
      # Supabase vars optional — see Postgres Option B
      SUPABASE_URL: ${SUPABASE_URL:-}
      SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY:-}
    ports:
      - "8080:8080"
    depends_on:
      - postgres

  web:
    build:
      context: .
      dockerfile: web/Dockerfile
    restart: unless-stopped
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8080
      NEXT_PUBLIC_SUPABASE_URL: ${SUPABASE_URL:-}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY:-}
    ports:
      - "3001:3001"
    depends_on:
      - server

volumes:
  postgres-data:
```

Bring it up:

```bash
TASK_JWT_SECRET=$(openssl rand -base64 64) docker compose up -d
docker compose exec server bun --filter server db:migrate
```

> The `server/Dockerfile` and `web/Dockerfile` aren't shipped in this phase — for now, build images yourself with a base of `oven/bun:1` or run the workspaces directly with `bun start`.

## Deploy steps (summary)

1. Provision Postgres 17 + pgvector.
2. Apply migrations: `bun --filter server db:migrate`.
3. Configure env vars for server + web.
4. Start the server (`bun --filter server start`).
5. Build + start the web app (`bun --filter web build && bun --filter web start`).
6. Front both with TLS (Caddy / nginx).
7. Sign in via GitHub OAuth, create a workspace.
8. On each agent machine: install the CLI, run `agorad setup`, start the daemon.

## Authentication

The default auth is **GitHub OAuth via Supabase Auth**. To use it:

1. Create a GitHub OAuth app, point its callback at `https://your-supabase-project.supabase.co/auth/v1/callback`.
2. In Supabase: **Authentication → Providers → GitHub** → paste the client ID + secret.
3. Set `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `web/.env`.

For headless / API-only access, every user can mint **Personal Access Tokens** under Settings → Tokens (see [users/settings.md](./users/settings.md)). The CLI uses these.

## Operations

- **Logs** — server logs to stdout in JSON (pino). Forward to your aggregator of choice.
- **Metrics** — `GET /metrics` exposes Prometheus counters: HTTP requests, WS connections, task dispatch latency, queue depth, autopilot tick stats.
- **Health** — `GET /healthz` returns `200 OK` with `{ "ok": true }` when the DB is reachable.
- **Backups** — back up Postgres. There is no separate state. Skill content + issue history are all in the DB.
- **Upgrades** — `git pull && bun install && bun --filter server db:migrate && restart`. Migrations are forward-only.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Daemon shows offline despite running | WS endpoint unreachable. Check `--server` URL, firewall, TLS cert. |
| Agent assigned but task stays `queued` | No online runtime matches the agent's `runtime_id`. Restart the daemon, check Settings → Runtimes. |
| Web shows "session expired" loop | `NEXT_PUBLIC_SUPABASE_URL` mismatch with the URL the GitHub OAuth callback was registered against. |
| Skill semantic search returns nothing | `pgvector` extension not enabled. `CREATE EXTENSION IF NOT EXISTS vector;` then re-index. |
| Tasks stuck in `running` after daemon crash | Should auto-recover within ~90s via the runtime monitor. If not, check server logs for `tickMonitor` errors. |

If you hit something this doc doesn't cover, file an issue on the upstream repo with `self-host` in the title.
