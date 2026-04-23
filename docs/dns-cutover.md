# DNS Cutover: workbench.yuanliu.dev

One DNS record connects the workbench to its public URL.

---

## Record

| Field | Value |
|-------|-------|
| **Provider** | Vercel DNS (manages `yuanliu.dev`) |
| **Type** | A |
| **Name** | `workbench` |
| **Value** | `154.12.234.43` |
| **TTL** | Auto (or 60s for initial testing) |

This resolves `workbench.yuanliu.dev` to the Contabo VPS.

---

## Where to Add

1. Log in to Vercel.
2. Go to the `yuanliu.dev` project → Settings → Domains.
3. Open DNS Records for `yuanliu.dev`.
4. Add an A record: Name = `workbench`, Value = `154.12.234.43`.
5. Save.

No proxy, no CNAME, no Cloudflare. A direct A record.

---

## Verify Immediately After

### 1. DNS resolution

```bash
dig workbench.yuanliu.dev +short
# Expected: 154.12.234.43
```

If the record returns nothing, wait 1-2 minutes for propagation.
Vercel DNS propagation is typically fast (under 60 seconds).

### 2. Caddy TLS certificate

Once DNS resolves, Caddy automatically requests a Let's Encrypt
certificate for `workbench.yuanliu.dev`. Check Caddy logs:

```bash
journalctl -u caddy --since "5 minutes ago" | grep -i "certificate\|tls\|acme"
```

A successful certificate issuance looks like:
```
certificate obtained successfully ... workbench.yuanliu.dev
```

If Caddy fails to obtain a certificate:
- Verify ports 80 and 443 are open on the VPS firewall.
- Verify Caddy is running: `systemctl status caddy`.
- Verify the Caddyfile uses `workbench.yuanliu.dev` as the site address.
- Check Let's Encrypt rate limits if multiple attempts failed.

### 3. Health check through public URL

```bash
curl https://workbench.yuanliu.dev/health
# Expected: {"status":"ok","phase":"3"}
```

### 4. Frontend loads

Open `https://workbench.yuanliu.dev` in a browser. The case list
should render with three cases.

---

## Cutover Checklist

- [ ] Caddy is running on the VPS with the correct Caddyfile.
- [ ] Backend systemd service is active: `systemctl is-active denial-review-workbench`.
- [ ] VPS firewall allows ports 80 and 443.
- [ ] A record added in Vercel DNS: `workbench` → `154.12.234.43`.
- [ ] `dig workbench.yuanliu.dev +short` returns `154.12.234.43`.
- [ ] Caddy obtained Let's Encrypt certificate (check logs).
- [ ] `curl https://workbench.yuanliu.dev/health` returns ok.
- [ ] Browser loads case list at `https://workbench.yuanliu.dev`.

---

## Rollback

To take the workbench offline, delete the A record in Vercel DNS.
`workbench.yuanliu.dev` stops resolving immediately (after TTL
expiry). No VPS changes needed.
