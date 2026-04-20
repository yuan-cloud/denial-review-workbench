# Deployment Security

Security setup for the first hosted deployment. Proportionate to a
prototype with synthetic data, but structured to avoid obvious
platform-risk mistakes.

---

## Secrets Handling

### ANTHROPIC_API_KEY

- Store as an encrypted environment variable on the backend container
  platform (Railway, Render, or Fly.io).
- Never commit to the repository. `backend/.env` is in `.gitignore`.
- Never set in the Vercel/Cloudflare frontend build environment.
  The frontend has no use for it.
- Rotation: rotate if the key is ever exposed in logs, screenshots,
  or deployment artifacts. No scheduled rotation needed for a
  prototype, but treat any exposure as a rotation trigger.

### FRONTEND_URL

- Not a secret. It is the public URL of the frontend deployment.
- Set on the backend container to configure CORS.
- If this value does not match the actual frontend origin, all
  browser API calls fail silently with CORS errors.

### VITE_API_BASE

- Not a secret. It is the public URL of the backend.
- Baked into the frontend JS bundle at build time. Visible to anyone
  who inspects the deployed code. This is expected and unavoidable
  for a client-side SPA.

---

## Vercel (Frontend)

### Deployment Protection

- Enable Deployment Protection for all preview deployments.
  Options: Vercel Authentication (team-only) or Standard Protection
  (password). Either prevents accidental public access.
- Production deployments: enable protection until the project is
  explicitly ready for public access.

### Project Settings Review

Before the first deployment:
- [ ] Verify the project is not set to "Public" in Project Settings.
- [ ] Verify Deployment Protection is enabled.
- [ ] Verify no sensitive environment variables are set (the frontend
      needs only `VITE_API_BASE`).
- [ ] Verify the connected Git repo branch is `main` (not a personal
      fork or experimental branch).

### Build Output

Vite builds to `frontend/dist/`. The output is static HTML, JS, and
CSS. No server-side code runs on Vercel. The Vercel project should be
configured as a static site (Framework Preset: Vite), not a Node.js
serverless function.

---

## Backend Container Platform

### Access Control

The backend has no application-level authentication. For preview
deployment, access control must come from the platform:

- **Railway:** Use a private networking configuration or restrict
  the service to internal access only, then expose via a proxy with
  basic auth.
- **Render:** Private services are available on paid plans. On free
  tier, the backend URL is publicly accessible. Mitigate by treating
  the preview URL as semi-public (acceptable for synthetic data).
- **Fly.io:** Use `fly wireguard` for private access, or accept that
  the public URL is reachable.

For a prototype with synthetic-only data, a publicly accessible
backend is acceptable. The risk is API cost (someone could call
POST /runs repeatedly and burn Anthropic credits), not data exposure.

### Environment Variable Security

- Set `ANTHROPIC_API_KEY` as a secret/encrypted variable, not a
  plaintext environment variable.
- Set `FRONTEND_URL` to the exact Vercel deployment URL (including
  protocol and no trailing slash). CORS mismatch is the most common
  deployment failure.
- Do not set `DEBUG=true` or enable debug/reload modes in production.

### Logs

Container platforms capture stdout/stderr from uvicorn. Review:
- No `ANTHROPIC_API_KEY` value appears in startup logs.
- No patient data appears in logs (synthetic data only, but verify).
- Pipeline errors log the stage name and error type, not raw API
  responses that might contain model output.

---

## Preflight Checklist

Run before every preview or production deployment.

### Secrets

- [ ] `ANTHROPIC_API_KEY` is set as encrypted secret on backend platform.
- [ ] `ANTHROPIC_API_KEY` is NOT set anywhere on Vercel.
- [ ] `backend/.env` is NOT committed to the repository.
- [ ] `grep -r "sk-ant" .` returns empty (no hardcoded keys).

### CORS

- [ ] `FRONTEND_URL` on the backend matches the actual Vercel URL.
- [ ] `VITE_API_BASE` in the Vercel build env matches the actual
      backend URL.
- [ ] Both values use the same protocol (both `https://` for hosted).

### Protection

- [ ] Vercel Deployment Protection is enabled.
- [ ] Backend platform access is restricted or risk is accepted
      (synthetic data only, API cost is the exposure).

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

### Logs and Activity

- [ ] Review recent deployment logs for leaked secrets.
- [ ] Review recent Vercel deployment list for unexpected deployments.
- [ ] Confirm health check returns `{"status":"ok","phase":"3"}`.

---

## Incident Response (Prototype Scale)

If the API key is exposed:
1. Rotate the key immediately on the Anthropic dashboard.
2. Update the encrypted secret on the backend platform.
3. Restart the backend container.
4. Review Anthropic usage logs for unauthorized calls.

If the backend URL is abused (excessive pipeline calls):
1. Check Anthropic usage dashboard for unexpected charges.
2. Restrict backend access (platform firewall, IP allowlist, or
   take the service offline).
3. Consider adding a rate limiter (production concern, not preview).

There is no PII exposure risk. All case data is synthetic.
