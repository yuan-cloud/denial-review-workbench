# Deployment Runbook

First hosted deployment topology for the Denial Review Workbench.
Evaluates platform fit for the current architecture and provides a
mechanical execution plan for the implementation beads.

---

## Recommended First Topology

**Frontend:** Static site on Vercel or Cloudflare Pages.
**Backend:** Container on Railway, Render, or Fly.io with persistent volume.

This split reflects the actual architecture: the frontend is a standard
Vite/React SPA with no server-side rendering, while the backend requires
a persistent writable filesystem and a long-lived single-worker process.

---

## Why This Split

### Frontend: static SPA

The frontend builds to static assets via `bun run build` (`tsc -b && vite build`).
It has zero server-side dependencies. The only runtime configuration is
`VITE_API_BASE`, which is baked in at build time via Vite's env injection.

Static hosting is the correct deployment shape because:
- No SSR, no API routes, no edge functions needed.
- Build output is a `dist/` directory of HTML, JS, and CSS.
- Vercel, Cloudflare Pages, and Netlify all serve this natively.
- CDN-edge delivery is free and fast.

### Backend: persistent container

The backend has three constraints that rule out serverless/edge deployment:

1. **Writable filesystem.** The JSONL event store appends to
   `data/runs/{run_id}.jsonl` on every pipeline stage and approval.
   Serverless functions have read-only or ephemeral filesystems.

2. **Single-worker requirement.** `state.py` stores run state in a
   module-level Python dict that is not thread-safe and not shared
   across workers. Multiple workers would produce inconsistent state.
   `uvicorn` must run as a single worker.

3. **Long-running requests.** A full pipeline run makes 3 sequential
   Anthropic API calls and takes 10-15 seconds. Most serverless
   platforms have request timeout limits (e.g., Vercel serverless
   functions: 10s on Hobby tier, 60s on Pro).

A container platform (Railway, Render, Fly.io) provides:
- Persistent volume for `data/runs/` JSONL files.
- Single long-lived process (no cold starts, no worker scaling).
- Environment variable management for `ANTHROPIC_API_KEY`.
- Health check endpoint: `GET /health` returns `{"status":"ok","phase":"3"}`.

---

## Why Not Full-Stack Vercel

Vercel's serverless model does not fit the current backend:
- **No persistent filesystem.** JSONL writes would require migrating to
  a database (Vercel KV, Postgres, etc.), which is a non-trivial
  architecture change.
- **Cold starts.** The lifespan hook seeds mock runs on startup. A cold
  start on every request would re-seed state and lose in-memory run
  data from prior requests.
- **Timeout limits.** Pipeline runs exceed the free-tier 10s limit.
- **Worker model.** Vercel functions are stateless and multi-instance.
  The single-worker `state.py` assumption breaks.

Vercel is a good fit for the frontend (static SPA) but not for the
backend without architectural changes that are out of scope for the
first deployment.

---

## Preview vs. Production Shape

### Preview (first deployment target)

- Frontend: Vercel preview deployment (auto-deploy from `main`).
- Backend: Railway or Render free/starter tier, single container.
- Domain: Platform-provided subdomain (e.g., `denial-review.up.railway.app`).
- CORS: `FRONTEND_URL` set to the Vercel preview URL.
- Storage: Persistent volume mounted at the container's `data/runs/` path.
- Protection: Vercel deployment protection enabled (password or
  Vercel Authentication). Backend behind platform auth or IP allowlist.
- Data: Synthetic case data only. No real patient data.

### Production (deferred)

- Custom domain with TLS.
- Backend on a dedicated VPS or managed container with guaranteed uptime.
- Persistent storage backed by real volume (not ephemeral).
- Monitoring and alerting (health check polling, error rate tracking).
- Log aggregation (stdout/stderr from uvicorn → external service).
- Secret rotation schedule for `ANTHROPIC_API_KEY`.

Production deployment is out of scope for the first hosted deployment.

---

## Environment Variables

### Backend container

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for live pipeline |
| `FRONTEND_URL` | Yes | CORS allowed origin (the frontend URL) |
| `PORT` | Platform-specific | Some platforms (Railway, Render) set this automatically |

The backend reads `FRONTEND_URL` for CORS (`main.py:26`). If this does
not match the actual frontend URL, every browser API call fails silently.

### Frontend build

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_BASE` | Yes | Backend URL (baked in at build time) |

Set this in the Vercel/Cloudflare build environment. It is not a runtime
variable; Vite replaces `import.meta.env.VITE_API_BASE` during the build.

---

## Health Check

The backend exposes `GET /health` returning `{"status":"ok","phase":"3"}`.
Configure the container platform to poll this endpoint. Recommended
interval: 30 seconds. Failure threshold: 3 consecutive failures.

---

## Persistent Storage

The JSONL event store writes to `data/runs/`. This directory must
survive container restarts.

**Railway:** Use a persistent volume mounted at the container's
`data/runs/` path.

**Render:** Use a persistent disk attached to the service.

**Fly.io:** Use a Fly Volume mounted at the data directory.

If the volume is lost, all run history is lost. Replay and evidence
export depend on these files existing. Mock runs (`mock_run.json`) are
in the git repo and survive redeployment, but live run JSONL files do not.

---

## Security Considerations

### Vercel (frontend)

- Enable Deployment Protection on preview deployments to prevent
  accidental public access before the project is ready.
- `VITE_API_BASE` is baked into the JS bundle and visible to anyone
  who inspects the deployed frontend. This is expected; the backend
  URL is not a secret.
- Do not put `ANTHROPIC_API_KEY` in the Vercel build environment.
  The frontend never needs it.

### Backend container

- `ANTHROPIC_API_KEY` must be set as a secret/encrypted environment
  variable on the container platform, not in a committed file.
- The backend currently has no authentication. Anyone who can reach
  the backend URL can run pipelines and approve runs. For preview
  deployment, rely on platform-level access controls (IP allowlist,
  platform auth). Adding application-level auth is a production
  concern, not a preview requirement.
- The `data/` directory contains synthetic case data. No real PHI.
  The security grep in CI verifies this on every push.

### Cloudflare Pages (alternative frontend)

- Cloudflare Pages Direct Upload avoids connecting a Git repo to
  Cloudflare, which reduces the blast radius if the Cloudflare
  account is compromised. The tradeoff is manual deploy steps
  instead of auto-deploy on push.
- For preview deployments, auto-deploy from Git (Vercel) is simpler.

---

## Container Start Command

```bash
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

Do not use `--reload` in deployed environments. Do not add `--workers`.
The single-worker constraint is architectural, not a deployment choice.

---

## Execution Plan for Implementation Beads

### bd-3mj.7.1 (backend container)

1. Add `Dockerfile` to repo root:
   - Base: `python:3.13-slim`
   - Install dependencies from `requirements.txt`
   - Copy `backend/` and `data/` into the image
   - CMD: `uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}`
   - Expose port 8000
2. Add `railway.toml` or `render.yaml` for the chosen platform.
3. Configure persistent volume for `data/runs/`.
4. Set environment variables: `ANTHROPIC_API_KEY`, `FRONTEND_URL`.
5. Verify: `curl https://<backend-url>/health`

### bd-3mj.7.2 (frontend hosting)

1. Connect the GitHub repo to Vercel.
2. Set build command: `cd frontend && bun install && bun run build`
3. Set output directory: `frontend/dist`
4. Set environment variable: `VITE_API_BASE=https://<backend-url>`
5. Enable Deployment Protection on preview deployments.
6. Verify: visit the Vercel URL, confirm case list loads.

### bd-3mj.7.3 (security checklist)

1. Verify `ANTHROPIC_API_KEY` is set as encrypted secret, not plaintext.
2. Verify `FRONTEND_URL` matches the actual Vercel preview URL.
3. Verify Deployment Protection is enabled on Vercel.
4. Verify backend is not publicly accessible without platform auth.
5. Run security grep against deployed data directory.
