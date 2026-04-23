# Deployment Runbook

Hosted deployment for the Denial Review Workbench.
Single Contabo VPS with Caddy, systemd, and Let's Encrypt.

> **Plan history (2026-04-22):** Two earlier plans were evaluated and
> replaced. The original split topology (Vercel SPA + Railway container)
> was replaced by a Cloudflare Tunnel + Access plan, which was then
> simplified to the current approach: direct Caddy exposure with Let's
> Encrypt TLS, no Cloudflare Tunnel, no Cloudflare Access. The site
> (`yuanliu.dev`) stays on Vercel. DRW is served from the Contabo VPS
> at `workbench.yuanliu.dev` via a Vercel DNS A record.

---

## Topology

```
Internet
  │
  ▼
Vercel DNS: workbench.yuanliu.dev → A record → Contabo VPS IP
  │
  ▼
Caddy (port 443, Let's Encrypt TLS)
  ├─ /health, /cases, /runs/*, /demo-fallback/*  →  localhost:8000
  └─ /*  →  frontend/dist/ (static SPA)
  │
  ▼
Contabo VPS
  ├─ uvicorn (systemd: denial-review-workbench, single worker)
  ├─ data/runs/ (local filesystem, JSONL append)
  └─ sops + age secrets (via Ansible)
```

**Domain:** `workbench.yuanliu.dev`
**DNS:** Vercel DNS A record pointing to the Contabo VPS IP
**TLS:** Let's Encrypt via Caddy (automatic)
**Site:** `yuanliu.dev` stays on Vercel (unrelated to this deployment)

---

## Why This Path

The backend needs a writable filesystem, a single long-lived worker,
and tolerance for 10-15s requests. A VPS provides all three. Caddy
handles TLS automatically via Let's Encrypt. No tunnel, no edge
proxy, no container orchestrator.

The frontend is a static SPA. Caddy serves the build output directly
alongside the API reverse proxy. One process handles both.

---

## Components

### Backend: systemd + uvicorn

```ini
# /etc/systemd/system/denial-review-workbench.service
[Unit]
Description=Denial Review Workbench
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/data/projects/denial-review-workbench/backend
EnvironmentFile=/data/projects/denial-review-workbench/backend/.env
ExecStart=/usr/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- `--host 127.0.0.1`: localhost only. Caddy proxies external traffic.
- No `--workers`: single-worker constraint is architectural.
- No `--reload`: production mode.
- `EnvironmentFile`: `.env` written by Ansible `secrets` role.
- `Restart=on-failure`: auto-restart on crash, 5s backoff.

### Caddy

```
workbench.yuanliu.dev {
    handle /health {
        reverse_proxy localhost:8000
    }
    handle /cases {
        reverse_proxy localhost:8000
    }
    handle /runs/* {
        reverse_proxy localhost:8000
    }
    handle /demo-fallback/* {
        reverse_proxy localhost:8000
    }
    handle {
        root * /data/projects/denial-review-workbench/frontend/dist
        try_files {path} /index.html
        file_server
    }
}
```

Caddy obtains and renews TLS certificates from Let's Encrypt
automatically. No manual certificate management. The per-route proxy
approach avoids backend code changes (no `/api/` prefix needed).

### Frontend build

```bash
cd frontend && bun install && \
    VITE_API_BASE=https://workbench.yuanliu.dev bun run build
```

Build output goes to `frontend/dist/`. Caddy serves it as static
files with SPA fallback.

---

## DNS

Add one A record in Vercel DNS for `yuanliu.dev`:

| Type | Name | Value |
|------|------|-------|
| A | workbench | `<Contabo VPS IP>` |

This resolves `workbench.yuanliu.dev` to the VPS. Caddy handles TLS.

---

## Environment Variables

### Backend (.env on VPS)

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for live pipeline |
| `FRONTEND_URL` | Yes | `https://workbench.yuanliu.dev` (CORS origin) |

### Frontend (build-time)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_BASE` | Yes | `https://workbench.yuanliu.dev` (baked at build) |

For single-host deployment, both point to the same domain.

---

## Secrets Management

Secrets are encrypted in `infra/group_vars/all.sops.yml` (sops + age).
The Ansible `secrets` role templates `backend/.env` (mode 0600) at
deploy time.

**Bootstrap:** `cd infra && ./scripts/sops-setup.sh`

**Edit secrets:** `sops infra/group_vars/all.sops.yml`

**Deploy secrets:**
```bash
ansible-playbook -i infra/inventory/hosts.yml infra/site.yml --tags secrets
```

The handler restarts the backend service automatically after writing
`.env`.

---

## Health Check

```bash
curl https://workbench.yuanliu.dev/health
# Expected: {"status":"ok","phase":"3"}
```

---

## Deployment Steps

### First deployment

1. Bootstrap secrets: `cd infra && ./scripts/sops-setup.sh`
2. Edit secrets: `sops infra/group_vars/all.sops.yml`
3. Add DNS A record for `workbench` in Vercel DNS.
4. Run Ansible: `ansible-playbook -i infra/inventory/hosts.yml infra/site.yml`
5. Build frontend: `cd frontend && bun install && VITE_API_BASE=https://workbench.yuanliu.dev bun run build`
6. Install Caddy Caddyfile (see above).
7. Start services: `systemctl start caddy denial-review-workbench`
8. Verify: `curl https://workbench.yuanliu.dev/health`

### Redeployment

```bash
cd /data/projects/denial-review-workbench
git pull --ff-only
ansible-playbook -i infra/inventory/hosts.yml infra/site.yml
curl -sf https://workbench.yuanliu.dev/health && echo "OK" || echo "FAIL"
```
