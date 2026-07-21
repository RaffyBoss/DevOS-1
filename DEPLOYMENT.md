# DevOS Deployment Guide

How to deploy DevOS V4 in production, from a single local container to a
multi-tenant enterprise stack.

---

## Deployment profiles

DevOS ships with three runtime profiles and matching Docker targets.

| Profile | DB | External deps | Use case | Docker target |
|---|---|---|---|---|
| **Micro** | SQLite | None (Ollama can be external) | Personal / air-gapped | `micro` |
| **Standard** | SQLite (+ Supabase optional) | Supabase, optional ChromaDB | Small team / multi-tenant | `standard` |
| **Enterprise** | Postgres/pgvector + Redis | Supabase, Redis, Postgres | Production multi-tenant | `enterprise` |

Profile container: [`Dockerfile`](Dockerfile).  Compose orchestration:
[`docker-compose.yml`](docker-compose.yml).

---

## Environment variables

Copy `.env.example` to `.env` and set at least these:

### Required for every deployment

| Variable | Purpose | Example |
|---|---|---|
| `JWT_SECRET` | HS256 signing key for local tokens; also seeds the Fernet secrets vault | `openssl rand -hex 32` |
| `DATABASE_URL` | SQLAlchemy async URL | `sqlite+aiosqlite:///./data/devos.db` |
| `AUTH_MODE` | `local`, `supabase`, or `dual` | `dual` |
| `ALLOWED_ORIGINS` | CORS allow-list | `https://devos.example.com` |

### Required for Supabase / dual auth

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_KEY` | Public anon key (frontend auth) |
| `SUPABASE_JWT_SECRET` | Legacy HS256 secret; only for pre-2024 projects |

### Required for at least one LLM

| Variable | Provider |
|---|---|
| `OLLAMA_HOST` | Ollama |
| `OPENAI_API_KEY` | OpenAI / Azure-compatible |
| `OPENROUTER_API_KEY` | OpenRouter |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `GEMINI_API_KEY` | Google Gemini |
| `HUGGINGFACE_API_KEY` | HuggingFace router |
| `NARAROUTER_API_KEY` | NaraRouter |

Set `DEFAULT_PROVIDER` to one of: `ollama`, `openai`, `openrouter`, `deepseek`,
`gemini`, `huggingface`, `nararouter`.

### Optional integrations

- `TAVILY_API_KEY` / `SEARXNG_URL` — web search
- `NTPY_URL` — push notifications
- `SMTP_*` / `TELEGRAM_*` — notification channels
- `CHROMADB_HOST` / `CHROMADB_PORT` — external Chroma vector store

---

## Container deployment

### Micro (single container)

```bash
docker build --target micro -t devos:micro .
docker run -d \
  --name devos \
  -p 8000:8000 \
  -v devos_data:/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e ADMIN_PASSWORD="$(openssl rand -base64 24)" \
  devos:micro
```

### Standard / Compose

```bash
cp .env.example .env
# edit .env: SUPABASE_URL, SUPABASE_KEY, JWT_SECRET, ADMIN_PASSWORD
docker compose --profile standard up -d
```

### Enterprise / Compose

```bash
docker compose --profile enterprise up -d
```

The enterprise profile adds Redis and expects either a managed Postgres or the
Postgres service referenced in `docker-compose.yml`.

### Health check

All profiles expose:

```
GET /api/health
```

Used by both the Docker `HEALTHCHECK` and compose `healthcheck`. The endpoint
returns a 200 with a `db` field; if the database is unreachable the status is
`degraded`.

---

## Reverse proxy / TLS

Put DevOS behind a reverse proxy that terminates TLS and forwards `X-Forwarded-*`
headers. Example Caddyfile:

```
devos.example.com {
    reverse_proxy localhost:8000 {
        header_up X-Forwarded-For {remote}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-Host {host}
    }
}
```

Nginx equivalent is in [`frontend-src/nginx.conf`](frontend-src/nginx.conf); adapt
it to proxy the backend instead of serving static files if you use Nginx as the
primary edge server.

---

## Frontend rebuilds

The production frontend is the static build in `frontend/build/`. After editing
React sources in `frontend-src/`:

```bash
python3 cli.py build
```

or directly:

```bash
cd frontend-src && npm ci && npm run build
```

Then restart the server or rebuild the container so it copies the new
`frontend/build/` assets.

---

## Security checklist

Before exposing DevOS to the internet:

- [ ] Set a strong, persistent `JWT_SECRET`.  Changing it invalidates all sessions
      and makes stored secrets undecryptable.
- [ ] Set a strong `ADMIN_PASSWORD` and rotate it after first login.
- [ ] Run over HTTPS only; set `ALLOWED_ORIGINS` to the production domain(s).
- [ ] If using Supabase, confirm `AUTH_MODE` is `dual` during migration, then
      switch to `supabase` once all admin identities are synced.
- [ ] Restrict filesystem access: DevOS writes to `data/`, `workspace/`, and
      sandbox temp dirs. Run the container with a read-only root filesystem and
      volume mounts for the writable paths if possible.
- [ ] For untrusted code execution, deploy with a sandbox runtime
      (gVisor/Firecracker/Docker with seccomp). The built-in
      [`SandboxedExecutor`](governance/sandbox.py) provides process/resource
      limits, but it runs in the same kernel as the host.
- [ ] Add a Content-Security-Policy and security headers at the reverse proxy or
      in FastAPI middleware ( helmet-equivalent ).
- [ ] Enable rate limiting and audit logging; review
      [`governance/audit.py`](governance/audit.py) events regularly.
- [ ] Back up `data/` and the `JWT_SECRET` together; secrets are encrypted with
      a key derived from `JWT_SECRET`, so losing it means losing stored secrets.

---

## Updating DevOS

```bash
git pull
docker compose --profile standard down
docker compose --profile standard build --no-cache
docker compose --profile standard up -d
```

Database schema migrations are handled automatically on startup by
[`core/database.py`](core/database.py) using `Base.metadata.create_all()` plus a
small PRAGMA-based column migration for SQLite. For Postgres enterprise
deployments, apply migrations manually or with a tool such as Alembic.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `401 Invalid token` after restart | `JWT_SECRET` changed; if unset, DevOS persists one in `core/.devos_secret` — copy that into `.env`. |
| `503 All LLM providers failed` | No provider keys are set or Ollama is unreachable. Set keys or check `OLLAMA_HOST`. |
| Scripts run but produce no output | Check `SCRIPT_TIMEOUT` and the script language runtime inside the container. |
| Webhook URLs 404 | Webhook tokens are URL-safe but not paths; POST to `/api/scripts/webhook/{token}`. |
