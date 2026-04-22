# Deployment Security

Security setup for the Contabo single-host deployment. Proportionate
to a prototype with synthetic data, but structured to avoid obvious
operational mistakes.

> **Plan history (2026-04-22):** The original security doc covered a
> Vercel + Railway/Render split. The deployment plan has been pivoted
> to a single Contabo VPS with Cloudflare Tunnel + Access. This
> document reflects the current plan.

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
- For single-host deployment, set to the same domain as the frontend
  (`https://workbench.yuanliu.dev`).

---

## Ingress: Cloudflare Tunnel

- No ports are exposed on the VPS firewall. All external traffic
  arrives through the Cloudflare Tunnel (`cloudflared`).
- The tunnel terminates TLS at Cloudflare's edge. The connection
  between Cloudflare and the VPS is encrypted by the tunnel protocol.
- `cloudflared` runs as a systemd service with auto-restart.

### Cloudflare Access

- `workbench.yuanliu.dev` is gated behind a Cloudflare Access policy.
- Access control options: email allowlist, one-time PIN, or
  Cloudflare service tokens for automated access.
- The policy applies to all routes (frontend and API) since all
  traffic flows through the tunnel.
- This replaces the Vercel Deployment Protection model from the
  earlier plan.

---

## VPS Security

### Filesystem

- `backend/.env` (plaintext): readable only by the service user.
  `chmod 600 backend/.env`.
- `infra/group_vars/all.sops.yml` (sops-encrypted): committed to repo.
- `data/runs/`: writable by the service user. Contains synthetic run
  logs only. No real PHI.

### Process isolation

- The backend runs as user `ubuntu` under systemd, not as root.
- `uvicorn` binds to `127.0.0.1:8000` (localhost only). External
  access is through Caddy + Cloudflare Tunnel.

### No application-level auth

The backend has no authentication. Access control comes from
Cloudflare Access. For this prototype with synthetic data, this is
acceptable. Anyone who bypasses Cloudflare Access (e.g., direct VPS
access) can run pipelines and approve runs.

---

## Preflight Checklist

Run before every deployment or redeployment.

### Secrets

- [ ] `backend/.env` exists and contains `ANTHROPIC_API_KEY`.
- [ ] `backend/.env` is NOT committed to the repository.
- [ ] `infra/group_vars/all.sops.yml` is up to date (edit via `sops` after rotation).
- [ ] `grep -r "sk-ant" .` returns empty (no hardcoded keys).
- [ ] `chmod 600 backend/.env` (readable only by service user).

### CORS

- [ ] `FRONTEND_URL` in `.env` matches `https://workbench.yuanliu.dev`.
- [ ] `VITE_API_BASE` was set correctly when the frontend was last built.
- [ ] Both values use `https://` (not `http://`).

### Access Control

- [ ] Cloudflare Access policy is active for `workbench.yuanliu.dev`.
- [ ] `cloudflared` service is running (`systemctl status cloudflared`).
- [ ] No ports other than SSH are exposed on the VPS firewall.

### Data

- [ ] Security grep returns empty:
      ```bash
      /usr/bin/grep -rE "PHI|patient_name|ssn|date_of_birth" \
          data/ backend/ frontend/src/ \
          --include="*.py" --include="*.tsx" \
          --include="*.json" --include="*.md"
      ```
- [ ] No real patient data in any case packet.
- [ ] `data/runs/` contains only synthetic run logs.

### Health

- [ ] `curl http://localhost:8000/health` returns `{"status":"ok","phase":"3"}`.
- [ ] `curl https://workbench.yuanliu.dev/health` returns the same (through tunnel).
- [ ] systemd service is active: `systemctl is-active denial-review-workbench`.

---

## Incident Response (Prototype Scale)

**API key exposed:**
1. Rotate the key on the Anthropic dashboard.
2. Edit secrets: `sops infra/group_vars/all.sops.yml`
3. Re-deploy: `ansible-playbook -i infra/inventory/hosts.yml infra/site.yml --tags secrets` (restarts service automatically)
4. Review Anthropic usage logs for unauthorized calls.

**VPS compromised:**
1. Rotate `ANTHROPIC_API_KEY` immediately.
2. Rotate the `age` key and re-encrypt all secrets.
3. Review `cloudflared` tunnel credentials.
4. Review Cloudflare Access audit logs.

**Excessive pipeline calls:**
1. Check Anthropic usage dashboard.
2. Tighten Cloudflare Access policy (restrict to specific emails).
3. Consider adding rate limiting at the Caddy layer.

There is no PII exposure risk. All case data is synthetic.
