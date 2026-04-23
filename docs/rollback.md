# Rollback and Recovery

Recovery plan for the first public deployment on the Contabo VPS.
Required before `bd-3mj.7.4` can be marked complete.

---

## Preferred Recovery: Redeploy from Known-Good Commit

If the deployed code is broken, roll back to the last working commit
and redeploy.

```bash
cd /data/projects/denial-review-workbench

# 1. Identify the last known-good commit
git log --oneline -10

# 2. Check out that commit
git checkout <known-good-sha>

# 3. Re-run the full deploy playbook from that commit
ansible-playbook -i infra/inventory/hosts.yml infra/site.yml

# 4. Verify
curl -sf https://workbench.yuanliu.dev/health && echo "OK" || echo "FAIL"
```

This is the preferred path because it uses the same tooling as the
forward deploy: the same playbook re-renders secrets, ensures the
backend service is up, validates the Caddy config, and rebuilds the
frontend static assets. No special recovery infrastructure is needed.

### When to use

- Backend crash after a code change.
- Frontend broken after a build.
- Pipeline produces incorrect results after a prompt change.

---

## Fallback Recovery: Contabo Snapshot Restore

If the VPS itself is corrupted (filesystem damage, misconfigured
system packages, broken Python environment), restore from a Contabo
VPS snapshot.

1. Log in to the Contabo customer panel.
2. Navigate to VPS snapshots.
3. Restore the most recent snapshot.
4. SSH back in and verify services:
   ```bash
   systemctl status denial-review-workbench
   systemctl status caddy
   curl -sf http://localhost:8000/health
   ```

### Limitations

- Contabo snapshots are point-in-time. Any JSONL run logs written
  after the snapshot was taken are lost.
- Snapshot availability depends on the Contabo plan and whether
  snapshots were configured. This should be verified before the
  first public deploy.
- Snapshot restore replaces the entire VPS disk. There is no
  selective file recovery.

---

## Partial JSONL Events

### The problem

If the backend crashes mid-pipeline (e.g., during `append_event`),
the last line of a JSONL file may be truncated or incomplete. This
produces invalid JSON on that line.

### Current behavior

`event_store.read_events()` (`event_store.py:31-47`) handles this:
- Blank lines are skipped.
- Lines that fail `json.loads()` are skipped with a warning log.
- All valid events before the corrupted line are returned normally.

`replay.replay_run()` calls `read_events()` and therefore inherits
this resilience. A run with a partial terminal event replays as if
that event never happened.

### Recovery policy

**Tolerate, do not truncate.** The corrupted line stays in the file.
Replay skips it automatically. This is the correct behavior because:

1. Truncating the file would modify the append-only log, violating
   the audit invariant.
2. The corrupted line is evidence of what happened (a crash). Removing
   it destroys forensic context.
3. Replay already handles it correctly — no manual intervention is
   needed for the UI to work.

If the partial event represents a critical pipeline stage (e.g., a
partially written `approved` event), the run's status will reflect
the last successfully written event. The operator can re-approve or
re-run the pipeline as appropriate.

### What this means operationally

- A crash during a pipeline run leaves the run in an intermediate
  state (e.g., `approval_requested` instead of `approved`).
- The UI shows the run at its last complete stage.
- The operator can continue from that point (approve, re-run, etc.).
- No manual JSONL editing is ever required.

---

## DNS Rollback

To take the workbench offline, delete the A record for `workbench`
in Vercel DNS. The domain stops resolving after TTL expiry. No VPS
changes needed. See `docs/dns-cutover.md` for details.

---

## Validation Status

| Recovery path | Validated? | Notes |
|--------------|-----------|-------|
| Redeploy from commit | Theoretical | Same commands as forward deploy; not yet exercised as a rollback |
| Contabo snapshot | Theoretical | Depends on snapshot being configured; not yet verified |
| Partial JSONL tolerance | Tested | `test_replay.py::TestMalformedJSONLResilience` verifies replay skips corrupted lines |
| DNS rollback | Theoretical | A record deletion is a standard Vercel DNS operation |

The partial JSONL tolerance is the only path with automated test
coverage. The other paths use standard operational procedures
(git checkout, ansible-playbook, Contabo panel, DNS deletion) that
have not been exercised as rollback scenarios against the live
deployment.

---

## Pre-Deploy Checklist (Rollback Readiness)

- [ ] Contabo snapshot exists or is scheduled before DNS cutover.
- [ ] Current `main` commit hash is recorded as the known-good baseline.
- [ ] `ansible-playbook site.yml` runs cleanly from the current commit.
- [ ] `curl https://workbench.yuanliu.dev/health` is the post-rollback
      verification command.
