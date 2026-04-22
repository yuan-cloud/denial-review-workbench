# Deployment Runbook

Hosted deployment topology for the Denial Review Workbench.
Single-host plan on the existing Contabo VPS.

> **Plan history (2026-04-22):** The original runbook recommended a
> split topology (Vercel static SPA + Railway/Render container). That
> plan was replaced with a single-host Contabo deployment after
> evaluating operational simplicity, cost, and the fact that the VPS
> already hosts the development environment. The Vercel-first guidance
> and `vercel.json` have been removed.

---

## Topology

```
Internet
  │
  ▼
Cloudflare DNS (workbench.yuanliu.dev)
  │
  ▼
Cloudflare Tunnel (cloudflared on Contabo)
  │
  ▼
Caddy (reverse proxy + static file server)
  ├─ /api/*  →  localhost:8000 (uvicorn)
  └─ /*      →  frontend/dist/ (static SPA)
  │
  ▼
Contabo VPS (single host)
  ├─ uvicorn (systemd service, single worker)
  ├─ data/runs/ (local filesystem, JSONL append)
  └─ sops + age (encrypted secrets)
```

**Domain:** `workbench.yuanliu.dev`
**Ingress:** Cloudflare Tunnel (no exposed ports on VPS)
**Access control:** Cloudflare Access (protected preview)
**TLS:** Cloudflare-managed (tunnel endpoint)

---

## Why Single Host

The backend's architectural constraints (writable JSONL filesystem,
single-worker in-memory state, 10-15s pipeline requests) require a
persistent long-lived process. The Contabo VPS already provides this
for the development environment. Running the production deployment on
the same host eliminates:

- Container platform costs (Railway/Render/Fly.io)
- Split-host CORS coordination
- Separate secret management per platform
- Network latency between frontend and backend

The frontend is a static SPA that Caddy serves directly from the build
output directory. No separate hosting platform is needed.

---

## Components

### Backend: systemd + uvicorn

```ini
# /etc/systemd/system/denial-review-workbench.service
[Unit]
Description=Denial Review Backend
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

Key settings:
- `--host 127.0.0.1`: bind to localhost only. Caddy proxies external traffic.
- No `--workers` flag: single-worker constraint is architectural.
- No `--reload` flag: production mode.
- `EnvironmentFile`: loads `ANTHROPIC_API_KEY` from `.env` (written by Ansible `secrets` role).
- `Restart=on-failure`: auto-restart on crash, 5s backoff.

### Frontend: Caddy static serving

Build the frontend and let Caddy serve the output:

```bash
cd frontend && bun install && bun run build
```

Caddy serves `frontend/dist/` for all non-API paths. SPA fallback
(try_files) ensures client-side routing works if ever added.

### Caddy: reverse proxy + static

```
workbench.yuanliu.dev {
    handle /api/* {
        reverse_proxy localhost:8000
    }
    handle {
        root * /data/projects/denial-review-workbench/frontend/dist
        try_files {path} /index.html
        file_server
    }
}
```

Note: the backend routes do not currently use an `/api/` prefix. The
Caddy config above assumes either:
1. Adding a `root_path="/api"` to the FastAPI app, or
2. Using `handle_path /api/*` with `strip_prefix` to remove `/api/`
   before proxying to uvicorn.

The simpler alternative is proxying specific backend paths:

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

This avoids any backend code changes. Choose one approach during
implementation.

### Cloudflare Tunnel

`cloudflared` runs as a systemd service on the VPS and connects to
Cloudflare's edge. No ports are exposed on the VPS firewall. All
external traffic arrives through the tunnel.

### Cloudflare Access

Cloudflare Access gates `workbench.yuanliu.dev` behind an
authentication policy (email allowlist or one-time PIN). This replaces
the Vercel Deployment Protection model. The protection applies to both
frontend and API routes since all traffic flows through the tunnel.

---

## Environment Variables

### Backend (.env on VPS)

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for live pipeline |
| `FRONTEND_URL` | Yes | `https://workbench.yuanliu.dev` (CORS origin) |

The backend reads `FRONTEND_URL` for CORS (`main.py:26`). This must
match the Cloudflare domain exactly.

### Frontend (build-time)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_BASE` | Yes | Backend URL (baked in at build time) |

For the single-host deployment, set this to the same domain as the
frontend (e.g., `https://workbench.yuanliu.dev`). The Caddy config
routes API requests to the backend.

---

## Secrets Management

### sops + age (via Ansible)

Secrets are encrypted at rest in `infra/group_vars/all.sops.yml` using
sops with age keys. The Ansible `secrets` role templates `backend/.env`
from the decrypted vault variables at deploy time.

**Bootstrap:** Run `infra/scripts/sops-setup.sh` once to generate the
age keypair and configure `infra/.sops.yaml` with the public key.

**Edit secrets:**
```bash
sops infra/group_vars/all.sops.yml
```

SOPS opens `$EDITOR`. Replace placeholder values with real secrets.
The file is encrypted on save. The committed version contains only
ciphertext.

**Deploy secrets:** `ansible-playbook -i infra/inventory/hosts.yml infra/site.yml --tags secrets`
writes `backend/.env` (mode 0600) from the `backend.env.j2` template.

The plaintext `backend/.env` must never be committed. The encrypted
`infra/group_vars/all.sops.yml` is safe to commit.

### Rotation

Rotate `ANTHROPIC_API_KEY` if:
- The key appears in any log, screenshot, or deployment artifact.
- The `.env` file is accidentally committed.
- The VPS is compromised.

After rotation: edit secrets via `sops infra/group_vars/all.sops.yml`,
then re-deploy: `ansible-playbook -i infra/inventory/hosts.yml infra/site.yml --tags secrets`. The handler
restarts the backend service automatically.

---

## Backups

### Cloudflare R2

JSONL run logs (`data/runs/`) are the critical persistent data.
Encrypted backups to Cloudflare R2:

```bash
tar czf - data/runs/ | age -r $(cat ~/.config/sops/age/keys.txt | grep "public key" | cut -d: -f2 | tr -d ' ') \
    > /tmp/runs-backup-$(date +%Y%m%d).tar.gz.age

# Upload to R2
aws s3 cp /tmp/runs-backup-*.tar.gz.age s3://denial-review-backups/ \
    --endpoint-url https://<account-id>.r2.cloudflarestorage.com
```

Schedule as a cron job. Retain at least 7 daily backups.

---

## Health Check

```bash
curl https://workbench.yuanliu.dev/health
# Expected: {"status":"ok","phase":"3"}
```

For systemd-level monitoring, add a health check timer:

```bash
# Check every 60 seconds
systemctl status denial-review-workbench
curl -sf http://localhost:8000/health || systemctl restart denial-review-workbench
```

---

## Deployment Steps

### First deployment

1. Bootstrap secrets: `cd infra && ./scripts/sops-setup.sh`
2. Edit secrets: `sops infra/group_vars/all.sops.yml`
3. Run Ansible: `ansible-playbook -i infra/inventory/hosts.yml infra/site.yml`
4. Build frontend: `cd frontend && bun install && VITE_API_BASE=https://workbench.yuanliu.dev bun run build`
5. Configure Caddy with the Caddyfile above.
6. Install and configure `cloudflared` tunnel.
7. Configure Cloudflare Access policy for `workbench.yuanliu.dev`.
8. Start backend: `systemctl start denial-review-workbench`
9. Verify: `curl http://localhost:8000/health`
10. Verify: `curl https://workbench.yuanliu.dev/health`

### Redeployment (after code changes)

```bash
cd /data/projects/denial-review-workbench
git pull --ff-only
cd frontend && bun install && VITE_API_BASE=https://workbench.yuanliu.dev bun run build
cd ..
systemctl restart denial-review-workbench
curl -sf http://localhost:8000/health && echo "OK" || echo "FAIL"
```
