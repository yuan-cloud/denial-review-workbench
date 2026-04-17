# AGENTS.md — Denial Review Workbench

Guidelines for AI coding agents working in this repo.
Read `docs/PLANS041426.md` first and completely before touching anything.
It is the single source of truth for this sprint.

## Read this first (if you only read 20 lines)

- Canonical spec lives in `docs/PLANS041426.md`. That file wins over everything else.
- Do not implement anything not in that doc. Do not ask for clarification — the doc has the answer.
- All data paths must use `DATA_DIR` from pathlib resolution. Never use bare string paths.
- `errors.py` defines `PipelineError` — import from there in both `pipeline.py` and `anthropic_client.py`.
- `state.py` owns all in-memory run state — import via `from app import state`.
- `pipeline.py` orchestrates model calls — never call the Anthropic SDK directly.
- `replay.py` is read-only — it must never call model providers or write files.
- `App.tsx` uses a `View` union type for navigation — do not install React Router.
- `vite.config.ts` must have `strictPort: true` — Vite must not silently increment the port.
- After every meaningful code change: `uvicorn` restart + `curl /health` + browser smoke test.
- Before editing any file, reserve it via Agent Mail `file_reservation_paths()`. If you get `FILE_RESERVATION_CONFLICT`, do not proceed — pick a different bead from `br ready` instead. Release reservations when your bead is closed. Never edit a file another agent has reserved.

If anything below conflicts with the user, the user wins.

---

## RULE 0 — THE USER OVERRIDE

If the user instructs something that conflicts with this document, the user instruction wins. No exceptions.

---

## RULE 1 — NO FILE DELETION

You may not delete any file or directory unless the user explicitly provides the exact deletion command in this session. This includes files you just created, test files, and temporary scripts.

---

## RULE 2 — IRREVERSIBLE ACTIONS ARE FORBIDDEN

Forbidden unless the user provides the exact command and explicit approval in the same message:

- `git reset --hard`
- `git clean -fd` or `-fxd`
- `rm -rf`
- any command that can delete or overwrite committed code or data

If you are unsure what a command will change, stop and ask. "I think it's safe" is never acceptable.

---

## RULE 3 — THE CANONICAL SPEC IS LAW

`docs/PLANS041426.md` is the constitutional document for this sprint.

Do not duplicate its schemas, route specs, event type lists, or field definitions anywhere else. Reference the spec instead of copying it.

If your change contradicts the spec, stop and flag the conflict. Do not silently implement a deviation.

---

## PROJECT NORTH STAR (do not drift)

Denial Review Workbench is a thin, legible, operator-ready auditable workflow for document-heavy healthcare denial review.

The JSONL event log is truth. The UI is a projection of that truth. The human reviewer is always in the loop and always in control.

---

## TECH STACK

- **Backend.** FastAPI (Python). `uvicorn` single-worker only — `run_states` is not thread-safe.
- **Frontend.** Vite + React + TypeScript. Bun for package management. Never npm, yarn, or pnpm.
- **Storage.** JSONL append-only event log (`data/runs/{run_id}.jsonl`). Phase 1 uses in-memory state via `state.py`.
- **Model.** Anthropic `claude-sonnet-4-6` via `anthropic_client.py`. At most 3 model calls per run.
- **Schemas.** Pydantic on the backend (`schemas.py`). Mirrored manually in TypeScript (`types.ts`).

Do not add dependencies without checking they are consistent with the spec. If you are not 100% sure how to use a third-party library, search online for the latest documentation and current best practices before writing any code.

---

## BACKWARDS COMPATIBILITY

We do not care about backwards compatibility. This is a sprint prototype with no existing users.

- Never create compatibility shims.
- Never create wrapper functions for deprecated APIs.
- Just fix the code directly and migrate callers.

---

## PATH RESOLUTION (CRITICAL)

uvicorn is started from `denial-review-workbench/backend/`:

```bash
cd backend && uvicorn app.main:app --reload --port 8000
```

This sets `cwd = denial-review-workbench/backend/`. Bare relative paths like `"data/cases/..."` resolve to `backend/data/cases/...` which does not exist.

Add to the top of every backend file that touches the filesystem:

```python
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data"
```

Use `DATA_DIR` everywhere. Never use bare string paths.

Live pipeline calls also need `ANTHROPIC_API_KEY` in the current shell environment. The project owner may create `backend/.env` manually, but agents must never create, overwrite, or commit that file.

Owner-only setup:

```bash
echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" > \
    /data/projects/denial-review-workbench/backend/.env
```

Agent usage before any `POST /runs` call that needs the live model:

```bash
set -a
source /data/projects/denial-review-workbench/backend/.env
set +a
# Verify: echo "Key: $([ -n "$ANTHROPIC_API_KEY" ] && echo YES || echo NO)"
```

Treat `backend/.env` as operational state only. Source it when needed; do not author it yourself.

---

## PORT CONFIGURATION (CRITICAL — must stay in sync)

Frontend and backend ports are configured via environment variables.
Never hardcode port numbers in source files.

### frontend/vite.config.ts

```typescript
export default defineConfig({
    server: {
        port: parseInt(process.env.VITE_PORT || "5274"),
        strictPort: true,   // exit loudly if port is taken; never drift silently
    },
    plugins: [react()],
});
```

`strictPort: true` causes Vite to exit with an error at startup instead of silently incrementing the port.

### CORS in main.py

```python
import os

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5274")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

If the CORS origin and the actual Vite port ever differ, every browser API call fails silently with a CORS error. The UI freezes. The network tab shows the reason but nothing in the terminal warns you. Keep them in sync.

### .env (project root)

```
VITE_PORT=5274
FRONTEND_URL=http://localhost:5274
```

Both values must agree. Change one, change both.

---

## MULTI-AGENT REALITY

This repo may have multiple agents editing concurrently.

- Do not stash, revert, reset, or "clean up" changes you did not author.
- Treat unexpected diffs as legitimate work by other agents.
- Never "restore a clean working tree" by destructive actions.
- If you encounter a merge conflict, resolve only the files you touched.

---

## NOTE FOR CODEX

You constantly stop working with concerned questions that look similar to this:

```
Unexpected changes (need guidance)

- Working tree still shows edits I did not make in backend/app/pipeline.py,
  frontend/src/App.tsx. Please advise whether to keep/commit/revert these
  before any further work. I did not touch them.

Next steps (pick one)

1. Decide how to handle the unrelated modified files above so we can resume cleanly.
```

NEVER EVER DO THAT AGAIN. The answer is literally ALWAYS the same: those are changes created by the potentially multiple other agents working on the project at the same time. This happens multiple times per minute. The way to deal with it is simple: you NEVER, under ANY CIRCUMSTANCE, stash, revert, overwrite, or otherwise disturb in ANY way the work of other agents. Just treat those changes identically to changes that you yourself made. Just tell yourself you made the changes and simply don't recall it for some reason.

---

## NOTE ON BUILT-IN TODO FUNCTIONALITY

If the user asks you to explicitly use your built-in TODO functionality, do not complain and say you need to use beads instead. You can use built-in TODOs if the user specifically tells you to do so. Always comply with such instructions.

---

## AGENT MAIL — MULTI-AGENT COORDINATION

Agent Mail is the coordination substrate for multi-agent work on this repo.
If you are the only agent in this session, skip this section.

### How agents access Agent Mail

Coding agents (Claude Code, Codex CLI, Gemini CLI) access Agent Mail natively via MCP tools.
You do NOT need to implement HTTP wrappers. MCP tools are available directly:
`ensure_project`, `register_agent`, `send_message`, `fetch_inbox`, `acknowledge_message`.

If MCP tools are not available, flag it to the user immediately.

### Registration

```python
ensure_project(project_key="/data/projects/denial-review-workbench")
register_agent(
    project_key="/data/projects/denial-review-workbench",
    program="claude-code",
    model="claude-sonnet-4-6",
    name="AdjectiveNoun",          # pick a name like SchemaBuilder, ReplayWriter
    task_description="<what you are doing>"
)
```

### File reservations (before editing)

Reserve files before editing. Use narrow patterns:

```python
file_reservation_paths(
    project_key="/data/projects/denial-review-workbench",
    agent_name="<YourName>",
    paths=["backend/app/pipeline.py"],
    ttl_seconds=3600,
    exclusive=True,
    reason="<phase>-<task>"        # e.g. "phase1-schemas"
)
```

Recommended reservation patterns:

```
"backend/app/pipeline.py"          # model calls
"backend/app/main.py"              # routes
"backend/app/schemas.py"           # Pydantic models
"backend/app/event_store.py"       # JSONL store
"backend/app/replay.py"            # read-only reconstruction
"frontend/src/App.tsx"             # navigation
"frontend/src/pages/**"            # page components
"frontend/src/components/**"       # shared components
"data/cases/**"                    # case documents
"docs/**"                          # spec and plan
```

Collision prevention rule: If `file_reservation_paths()` returns `FILE_RESERVATION_CONFLICT`, stop immediately. Do not edit the file. Run `br ready` to find a different unblocked bead and work on that instead. Never force-edit a reserved file. The reservation system only works if every agent respects it without exception.

### Communication

```python
send_message(
    project_key="/data/projects/denial-review-workbench",
    sender_name="<YourName>",
    to=["<OtherAgent>"],
    subject="[phase1] schemas done",
    body_md="Pydantic schemas and types.ts complete. Ready for routes.",
    thread_id="phase1"
)
```

### Mapping cheat sheet

| Concept | Value |
|---------|-------|
| Mail `thread_id` | phase and task name (e.g. `phase1-backend`) |
| Mail subject | `[phase] task description` |
| File reservation `reason` | phase-task (e.g. `phase1-pipeline`) |
| Commit messages | include phase and task |

---

## BEADS VIEWER (bv) — triage and planning

**CRITICAL: Use ONLY `--robot-*` flags with bv. Bare `bv` launches an interactive TUI that blocks your session.**

```bash
bv --robot-triage                           # start here — prioritized triage
bv --robot-next                             # single top pick with claim command
bv --robot-plan                             # parallel execution tracks
bv --robot-insights                         # full graph metrics
bv --robot-alerts                           # stale issues, blocking cascades
```

**Important:** `br` is non-invasive — it NEVER runs git commands automatically. You must manually commit changes after `br sync --flush-only`.

### Beads + Agent Mail mapping cheat sheet

| Concept | Value |
|---------|-------|
| Mail `thread_id` | `br-###` |
| Mail subject | `[br-###] ...` |
| File reservation `reason` | `br-###` |
| Commit messages | include `br-###` for traceability |

---

## KEY RULES (must not be violated)

### errors.py is first
Write `errors.py` before `pipeline.py` and `anthropic_client.py`. Both import `PipelineError` from there. Writing it first prevents the circular import.

```python
class PipelineError(Exception):
    def __init__(self, stage: str, raw_response: str, cause: Exception):
        self.stage = stage
        self.raw_response = raw_response
        self.cause = cause
        super().__init__(f"Pipeline failed at {stage}: {cause}")
```

### state.py is the only run state owner

```python
from app import state          # module-level import — never individual functions
state.seed(run_id, data)
state.get(run_id)
state.update(run_id, data)
```

Never access `run_states` directly from `main.py`.
Never import individual functions from `state.py`.

### FILENAME_TO_TYPE is a required constant

The `"notes" → "clinical_notes"` mapping is a semantic rename — not derivable by pattern. Any agent implementing `load_documents` by pattern will produce `"notes"` and fail Pydantic validation silently.

```python
FILENAME_TO_TYPE: dict[str, str] = {
    "denial-letter": "denial_letter",
    "auth-request":  "auth_request",
    "notes":         "clinical_notes",   # semantic rename — not mechanical
}
```

### run IDs from live pipeline must never reuse mock IDs

Mock IDs (`run-case-001-mock`, `run-case-002-mock`, `run-case-003-mock`) are seeding artifacts only.
Live pipeline runs use `make_run_id(case_id)` which produces `run-{case_id}-{timestamp}`.
Example: `"run-case-002-20260413142233"`. Human-readable prefix aids debugging. Timestamp suffix ensures uniqueness.
Mock IDs must never appear in JSONL event logs.

### POST /runs decorator must include status_code=201

```python
@app.post("/runs", status_code=201)
```

Without it, FastAPI returns 200. The frontend uses `res.ok` and will not break either way, but the decorator must be correct.

### lifespan hook is mandatory

`uvicorn --reload` restarts the Python process on every `.py` file save. `run_states` is in-memory. Every reload wipes all state and returns 404s on every subsequent GET. This makes Phase 1 development non-functional without it.

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    for case_id in ["case-001", "case-002", "case-003"]:
        mock_path = DATA_DIR / "cases" / case_id / "mock_run.json"
        if mock_path.exists():
            with open(mock_path) as f:
                mock_data = json.load(f)
            state.seed(mock_data["run_id"], mock_data)
    yield

app = FastAPI(lifespan=lifespan)
```

Never use bare `FastAPI()`. Always `FastAPI(lifespan=lifespan)`.

### replay.py is read-only — enforce strictly

This comment must appear verbatim in `replay.py` and never be removed:

```python
# Replay is read-only reconstruction from persisted events.
# It must never call model providers or produce new side effects.
```

Never call `pipeline.py` functions from `replay.py`.
Never call `anthropic_client.py` from `replay.py`.
Never write any new events or files from `replay.py`.

### is_replay_response is response metadata, never domain state

Never persist it to JSONL. Never store it in `state.py`. Set it on return values using `model_copy`:

```python
return result.model_copy(update={"is_replay_response": False})
```

`model_copy` signals "response variant" not domain mutation. Direct attribute assignment is acceptable but `model_copy` is the project standard for this field.

### Evidence highlighting uses two-stage match

`DocumentPanel.tsx` implements exact `indexOf` first, case-insensitive `indexOf` fallback second. The fallback slices the original text at the match position to preserve source casing in the rendered `<mark>` element. This is intentional — model output does not always preserve source text capitalization.

### vite.config.ts must lock the port

If Vite silently picks a different port, the CORS origin no longer matches and every API call fails with a CORS error. The UI freezes without explanation.

```typescript
export default defineConfig({
    server: {
        port: parseInt(process.env.VITE_PORT || "5274"),
        strictPort: true,
    },
    plugins: [react()],
});
```

`strictPort: true` causes Vite to exit with an error at startup instead of silently incrementing the port. The port value and `FRONTEND_URL` in main.py must always agree.

### App.tsx uses View union — no React Router

```typescript
type View =
    | { page: "cases" }
    | { page: "run"; caseId: string; runId: string };
```

`CaseListPage` receives `onSelectCase: (caseId: string, runId: string) => void`.
`RunPage` receives `caseId`, `runId`, and `onBack: () => void`.

Do not install React Router; v1 is a single-view SPA, navigation is tab-switching rather than URL routing, all state lives in React, and there is no shareable URL surface.

---

## ESCALATION BRANCH — honor strictly

When `findings.should_escalate` is true:
- status becomes `"escalated"`
- `draft_next_action` is NOT called
- `recommendation` remains `null`
- Approve button is NOT shown
- Center panel shows escalation notice only
- Server must return 409 on approve — do not rely on UI guard alone

`"rejected"` is not a v1 status. Do not add it anywhere.

---

## APPROVE ROUTE — server guards are mandatory

Execute these guards before any access to `recommendation`:

```python
state_dict = state.get(run_id)
if state_dict is None:
    raise HTTPException(status_code=404)
if state_dict["status"] == "escalated":
    raise HTTPException(status_code=409, detail="Cannot approve an escalated run")
if state_dict["status"] == "approved":
    raise HTTPException(status_code=409, detail="Run already approved")

# JSONL guard — survives server restart
if any(e.get("type") == "approved" for e in read_events(run_id)):
    raise HTTPException(status_code=409, detail="Run already approved")
```

Note: in-memory guards are faster but not sufficient after restart. JSONL is the authoritative source for approval state.

`final_recommendation.draft_text` must never be null. If the reviewer approves without editing, fall back to the existing draft value. Replay reads this field — null here breaks the replay panel.

---

## GET /runs — never re-read mock file

Mock seeding happens once at POST /runs and on startup via the lifespan hook.
All subsequent reads go through `state.get(run_id)`.
Never re-read `mock_run.json` on GET — approval mutations will be invisible on refresh.

Note (updated behavior): GET /runs checks state first. If state is missing (after restart), it falls back to `replay_run(run_id)` and returns the result with `is_replay_response: False` — because a GET /runs is not a replay request from the user's perspective. `replay_run()` sets `is_replay_response: True` by default, so the fallback path must explicitly override it.

---

## MODEL CALLS — three maximum, strict order

1. `extract_facts`
2. `analyze_gap`
3. `draft_next_action` — only when `should_escalate` is false

`pipeline.py` imports ONLY `call_model` from `anthropic_client.py`.
Never import the Anthropic SDK directly in `pipeline.py`.
`call_model` catches `APITimeoutError`, `APIConnectionError`, `RateLimitError` and wraps them as `PipelineError`.

---

## STRUCTURED LOGGING — no print() anywhere

```python
import logging
logger = logging.getLogger(__name__)

logger.info("pipeline stage %s complete", stage_name)
logger.warning("malformed JSONL line skipped: %s", line[:100])
logger.error("pipeline failed at %s: %s", stage, error)
```

Never use `print()` in any production path. `print()` does not appear in log aggregators and cannot be suppressed.

---

## UBS — BUG SCANNING BEFORE COMMITS

Golden rule: run UBS on changed files before every commit. Exit 0 means safe. Exit >0 means fix and re-run.

Run UBS per staged batch before each commit — not once at the end. If making multiple logical changes in one session, run `ubs --staged` before each `git commit`, not after staging all changes at once. This catches issues per logical group rather than letting a bad file contaminate a clean commit.

```bash
ubs backend/app/pipeline.py            # specific file — USE THIS mid-edit
ubs $(git diff --name-only --cached)   # staged files — before commit
ubs .                                  # whole project
```

Fix workflow:
1. Read finding — category plus fix suggestion.
2. Navigate `file:line:col` — view context.
3. Verify real issue (not false positive).
4. Fix root cause, not symptom.
5. Re-run `ubs <file>` until exit 0.
6. Commit.

---

## CASS AND CM — LEARNING FROM HISTORY

Never run bare `cass` (TUI). Always use `--robot` or `--json`.
stdout is data-only, stderr is diagnostics; exit code 0 means success.

```bash
cass health
cass search "fastapi pydantic validation" --robot --limit 5
cass view /path/to/session.jsonl -n 42 --json
cass expand /path/to/session.jsonl -n 42 -C 3 --json   # with surrounding context
cass capabilities --json
cass robot-docs guide
```

Tips:
- Use `--fields minimal` for lean output.
- Filter by agent with `--agent`.
- Use `--days N` to limit to recent history.

### cm — procedural memory

Before starting complex tasks, retrieve relevant context:

```bash
cm context "<task description>" --json
```

Returns:
- `relevantBullets` — rules that may help
- `antiPatterns` — pitfalls to avoid
- `historySnippets` — past sessions that solved similar problems
- `suggestedCassQueries` — searches for deeper investigation

Protocol:
1. Run `cm context "<task>" --json` before non-trivial work.
2. Reference rule IDs when following them (e.g. "Following b-8f3a2c...").
3. Leave inline comments when rules help or hurt: `# [cass: helpful b-xyz] - reason`
4. End your session. Learning happens automatically.

### Recording decisions

```bash
cm add "decision: <what and why>" --category decision --json
cm add "architecture: <pattern>" --category architecture --json
```

Note: `cm record` is not a valid command. The correct command is `cm add` (alias for `cm playbook add`). For project-scoped entries run `cm init --repo` first, then use `cm playbook import --repo`.

---

## CODE EDITING DISCIPLINE

### No script-based mass edits
Do not run or propose scripts that bulk-modify the repo. Make edits deliberately, file by file, and review diffs.

### No file proliferation
Do not create `pipeline_v2.py`, `main_improved.py`, or similar variations.
New files are allowed only for genuinely new modules. The bar is very high.

---

## QUALITY GATES

If you changed backend code:

```bash
cd backend && python -m pytest        # if tests exist
curl -s $BACKEND_URL/health           # must return {"status": "ok", ...}
```

If you changed frontend code:

```bash
cd frontend && bun run typecheck
```

Before every commit:

```bash
ubs $(git diff --name-only --cached)
```

Do not commit code that fails any gate.

---

## LANDING THE PLANE (session completion)

Work is NOT complete until changes are committed. Never say "ready to commit when you are." YOU must commit.

### Session protocol checklist

```bash
git status                   # check what changed
git pull --ff-only           # pull before staging to prevent
                              # shared-index collision in hot
                              # multi-agent worktrees
git add <explicit files>     # stage code changes — never git add -A in shared worktree
br sync --flush-only         # export beads to JSONL
git add .beads/              # stage beads changes
git diff --cached --name-only  # verify what you are committing
git commit -m "<phase>-<task>: <summary>"
git push
```

### Mandatory workflow

1. Run quality gates (if code changed).
2. Run UBS on staged files: `ubs $(git diff --name-only --cached)`. Fix until exit 0.
3. Update beads: close finished work, update in-progress items.
4. `br sync --flush-only`.
5. Release Agent Mail file reservations (multi-agent sessions only).
6. Commit and push per checklist above.
7. Produce the handoff note.

### Handoff note template

```markdown
## Handoff: {phase} · {task}

### What changed
- {file}: {what and why}

### Gate results
- health: {curl output}
- typecheck: {pass/fail}
- ubs: {exit code}

### Open questions
- {anything the next agent needs to decide, or "None"}
```

If you have no open questions, write "None". Do not omit the section.

### Critical rules

- Work is NOT complete until `git commit` succeeds.
- Never stop mid-task without committing what you have and noting status.
- Never use `git add -A` in a shared worktree. Stage files explicitly.
- If commit fails, resolve and retry until it succeeds.

---

## FLYWHEEL TOOL REFERENCE

This repo runs on the Agent Flywheel ecosystem on a Contabo VPS.
All tools below are available in NTM/tmux agent panes.

### AI Coding Agents

| Alias | Full command | Agent |
|-------|-------------|-------|
| `cc` | `claude --dangerously-skip-permissions` | Claude Code |
| `cod` | `codex --dangerously-bypass-approvals-and-sandbox` | Codex CLI |
| `gmi` | `gemini --yolo` | Gemini CLI |

### Core Flywheel Tools

| Tool | Alias | Purpose | Key commands |
|------|-------|---------|-------------|
| NTM | `ntm` | Agent orchestration | `ntm spawn`, `ntm attach`, `ntm send`, `ntm list` |
| Agent Mail | MCP | Multi-agent coordination | Accessed via MCP tools natively |
| Beads Rust | `br` | Task tracker | `br ready`, `br update`, `br close`, `br sync` |
| Beads Viewer | `bv` | Task graph / triage | `bv --robot-triage` (ONLY robot flags) |
| UBS | `ubs` | Bug scanner | `ubs <file>`, `ubs --staged` |
| CASS | `cass` | Session search | `cass search "..." --robot --limit 5` |
| CM | `cm` | Procedural memory | `cm context "<task>" --json` |
| CAAM | `caam` | Account rotation | `caam status`, `caam activate` |
| SLB | `slb` | Safety lock box | Intercepts destructive commands |
| DCG | `dcg` | Destructive command guard | `dcg explain "<command>"` |

### The Flywheel Loop

```
Plan (br) → Coordinate (Agent Mail) → Execute (NTM + Agents) → Remember (CASS/CM) → Scan (UBS) → Repeat
```

---

## DEFINITION OF DONE (this sprint)

- [ ] `curl $BACKEND_URL/health` returns `{"status": "ok", "phase": "3"}`
- [ ] case-002 runs end-to-end with live model calls
- [ ] case-003 shows escalation notice, no draft, no approve button
- [ ] POST approve on escalated run returns 409 (server guard)
- [ ] Replay reconstructs same result without calling the model
- [ ] REPLAY badge appears in right panel on replay
- [ ] Approve button becomes "Approved ✓" badge after approval
- [ ] GET /runs after approve returns approved state (not stale mock)
- [ ] Evidence ref click highlights source quote in document panel
- [ ] Vite port locked via `VITE_PORT` env var with `strictPort: true`
- [ ] CORS origin matches Vite port (both read from env/config)
- [ ] Back button returns to case list without hard reload
- [ ] Security grep returns empty:
  ```bash
  # Use absolute path — some environments alias grep to
  # ripgrep (rg), which uses different flag syntax and
  # silently fails with --include flags
  /usr/bin/grep -rE "PHI|patient_name|ssn|date_of_birth" \
      data/ backend/ frontend/src/ \
      --include="*.py" --include="*.tsx" \
      --include="*.json" --include="*.md"
  ```
- [ ] 7-minute demo arc performable without apology

<!-- br-agent-instructions-v1 -->

---

## Beads Workflow Integration

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`/`bd`) for issue tracking. Issues are stored in `.beads/` and tracked in git.

### Essential Commands

```bash
# View ready issues (unblocked, not deferred)
br ready              # or: bd ready

# List and search
br list --status=open # All open issues
br show <id>          # Full issue details with dependencies
br search "keyword"   # Full-text search

# Create and update
br create --title="..." --description="..." --type=task --priority=2
br update <id> --status=in_progress
br close <id> --reason="Completed"
br close <id1> <id2>  # Close multiple issues at once

# Sync with git
br sync --flush-only  # Export DB to JSONL
br sync --status      # Check sync status
```

### Workflow Pattern

1. **Start**: Run `br ready` to find actionable work
2. **Claim**: Use `br update <id> --status=in_progress`
3. **Work**: Implement the task
4. **Complete**: Use `br close <id>`
5. **Sync**: Always run `br sync --flush-only` at session end

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready` shows only unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers 0-4, not words)
- **Types**: task, bug, feature, epic, chore, docs, question
- **Blocking**: `br dep add <issue> <depends-on>` to add dependencies

### Session Protocol

**Before ending any session, run this checklist:**

```bash
git status              # Check what changed
git add <files>         # Stage code changes
br sync --flush-only    # Export beads changes to JSONL
git commit -m "..."     # Commit everything
git push                # Push to remote
```

### Best Practices

- Check `br ready` at session start to find available work
- Update status as you work (in_progress → closed)
- Create new issues with `br create` when you discover tasks
- Use descriptive titles and set appropriate priority/type
- Always sync before ending session

<!-- end-br-agent-instructions -->
