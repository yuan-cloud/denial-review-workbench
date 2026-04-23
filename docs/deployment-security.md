# Deployment Security

Security setup for the Contabo single-host deployment. Proportionate
to a prototype with synthetic data, but structured to avoid obvious
operational mistakes.

> **Plan history (2026-04-22):** Earlier drafts covered Vercel split
> and Cloudflare Tunnel + Access plans. The launch path is now simpler:
> Caddy with Let's Encrypt on the Contabo VPS, no Cloudflare proxy
> layer. This document reflects the current plan.

---

## Secrets Handling

### ANTHROPIC_API_KEY

- Encrypted at rest in `infra/group_vars/all.sops.yml` (sops + age).
- Ansible `secrets` role templates `backend/.env` (mode 0600) at
  deploy time. The plaintext `.env` is never committed.
- Loaded by systemd's `EnvironmentFile` directive at service start.
- Rotation trigger: any exposure in logs, screenshots, artifacts, or
  if the VPS is compromised.

### FRONTEND_URL

- Not a secret. Set to `https://workbench.yuanliu.dev` in the backend
  `.env` for CORS configuration.
- If this does not match the actual domain, all browser API calls fail
  silently with CORS errors.

### VITE_API_BASE

- Not a secret. Baked into the frontend JS bundle at build time.
- Set to `https://workbench.yuanliu.dev` for the single-host deploy.

---

## Network Security

### TLS

Caddy obtains and renews Let's Encrypt certificates automatically.
All external traffic is HTTPS. Caddy listens on ports 80 (redirect)
and 443 (TLS).

### Firewall

Open ports on the VPS:
- **22** (SSH)
- **80** (Caddy, HTTP → HTTPS redirect)
- **443** (Caddy, HTTPS)

uvicorn binds to `127.0.0.1:8000` (localhost only). It is not directly
accessible from the internet.

### No application-level auth

The backend has no authentication. Anyone who can reach
`workbench.yuanliu.dev` can use the workbench. For a prototype with
synthetic data, this is acceptable. The risk is API cost (Anthropic
credits from pipeline calls), not data exposure.

---

## VPS Security

### Filesystem

- `backend/.env` (plaintext): mode 0600, readable only by `ubuntu`.
- `infra/group_vars/all.sops.yml` (sops-encrypted): committed to repo.
- `data/runs/`: writable by `ubuntu`. Contains synthetic run logs only.

### Process isolation

- The backend runs as user `ubuntu` under systemd, not as root.
- Caddy runs as its own user with access to ports 80/443.

---

## Preflight Checklist

### Secrets

- [ ] `backend/.env` exists and contains `ANTHROPIC_API_KEY`.
- [ ] `backend/.env` is NOT committed to the repository.
- [ ] `infra/group_vars/all.sops.yml` is up to date.
- [ ] `grep -r "sk-ant" .` returns empty (no hardcoded keys).
- [ ] `chmod 600 backend/.env`.

### CORS

- [ ] `FRONTEND_URL` in `.env` is `https://workbench.yuanliu.dev`.
- [ ] `VITE_API_BASE` was set to the same domain at last build.
- [ ] Both use `https://`.

### Network

- [ ] Caddy is running and serving TLS on port 443.
- [ ] Only ports 22, 80, 443 are open on the VPS firewall.
- [ ] uvicorn binds to `127.0.0.1`, not `0.0.0.0`.

### Data

- [ ] Security grep returns empty:
      ```bash
      /usr/bin/grep -rE "PHI|patient_name|ssn|date_of_birth" \
          data/ backend/ frontend/src/ \
          --include="*.py" --include="*.tsx" \
          --include="*.json" --include="*.md"
      ```
- [ ] No real patient data in any case packet.

### Health

- [ ] `curl http://localhost:8000/health` returns `{"status":"ok","phase":"3"}`.
- [ ] `curl https://workbench.yuanliu.dev/health` returns the same.
- [ ] `systemctl is-active denial-review-workbench` returns `active`.

---

## Incident Response (Prototype Scale)

**API key exposed:**
1. Rotate the key on the Anthropic dashboard.
2. Edit secrets: `sops infra/group_vars/all.sops.yml`
3. Re-deploy: `ansible-playbook -i infra/inventory/hosts.yml infra/site.yml --tags secrets`
4. Review Anthropic usage logs for unauthorized calls.

**VPS compromised:**
1. Rotate `ANTHROPIC_API_KEY` immediately.
2. Rotate the `age` key and re-encrypt all secrets.
3. Review SSH authorized keys.
4. Consider rotating Let's Encrypt certificates (Caddy handles this).

**Excessive pipeline calls:**
1. Check Anthropic usage dashboard.
2. Add rate limiting at the Caddy layer.
3. Restrict access via IP allowlist in Caddyfile if needed.

There is no PII exposure risk. All case data is synthetic.
