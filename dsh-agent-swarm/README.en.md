# dsh-agent-swarm

Agent swarm orchestration for DeepSeek Harness (DSH): the root agent orchestrates subagents through the single `dispatch` entry — model-tier routing, tool-boundary filtering, persona injection, circuit breaking, concurrency limits, and a star-team protocol (root orchestrates, members do not spawn).

[中文 README](README.md) | Design docs under `docs/` (Chinese).

---

## Features

| Capability | Description |
|---|---|
| `dispatch(type, prompt, options?)` | Single delegation entry; unknown `type` fails hard (closed whitelist); concurrency-safe, callable in parallel within the same round (fan-out) |
| Tier routing | lite / standard / pro / ultra → provider/model pinned at creation (zero runtime drift); `type` sets the default tier, `tier` overrides explicitly |
| Tool boundaries | explore/write/review use allow-whitelists (fail-closed); code has full tools; all types deny the five delegation tools (dispatch/subagent/subagent_fork/workflow/ralph — anti-recursion, star team); allow list emptied → fail loud |
| Persona library | 8 built-in personas (key → full text injection, or escaped free text); catalog section visible to root only |
| Protocol injection | Delegation entry + Delegation decision (when to delegate / resident vs one-shot / member reuse) + Dispatch failure handling + team protocol skeleton, injected to root only (delegationDepth filtered) |
| Concurrency & depth limits | maxActive=8 (event-paired accounting + synchronous in-flight double check) + maxTeam=16 (lazy authoritative count per dispatch) + maxDepth=3 |
| Circuit breaker | `agent/request-error` counting (subagent failures only, delegationDepth>0), tripCodes match → cooldown; checked at tier resolution, error lists available tiers and cooldown left |
| Structured output | output_schema foreground-only (conflicts with run_in_background → error); one retry then null |
| Timeout | foreground none by default (max 1h), background default 15min; timer cascade dispose/interrupt |
| Summary continuation | foreground output <200 chars auto-retries with a fuller-summary request |
| Label & traceability | label = type + task summary; every dispatch lands a {type, label, tier, subagent_id, start/end, cost} audit line (subagent_id/summary_len/stop/elapsed_ms) |
| Resident members | run_in_background=true → continuable subagents; resume via send_message, enumerate via list_agents; retire via interrupt_agent when maxTeam is reached |

## Installation

Local package (not published to npm), mounted as one row in the swarm preset:

```bash
# 1. Put this directory in your repo (e.g. /path/to/dsh-agent-swarm)
# 2. Add one row to the swarm preset's agent.cordis.yml:
#    - id: dsh-agent-swarm
#      name: '/path/to/dsh-agent-swarm/lib/index.js'
# 3. Open a new session on the swarm preset; dispatch is available.
```

Preset rows accept an **absolute path** (auto-converted to a `file:` URL) or a relative path (resolved from the preset directory).

## Configuration

**Exclusive priority** (hot-reloaded per dispatch; no restart needed):

- **If `model-router.local.yaml` exists** (local private config, excluded via `.gitignore`) → **it is used exclusively** — put your private providers and local-only personas there
- **If no local file** → **`config.yaml`** (committed template) is used — after cloning, ordinary users **edit `config.yaml` directly** to update model routing and the persona pool

Unset fields fall back to the built-in template in `lib/index.js`.

**Default tier template** (no configuration):

| Tier | Provider | Model |
|---|---|---|
| lite / standard | deepseek-official | deepseek-v4-flash |
| pro / ultra | deepseek-official | deepseek-v4-pro |

**Member types** (closed whitelist, 4 built-in; `type` decides the tool boundary + default tier + role, and the role text is prepended to the subagent prompt):

| type | default tier | tool boundary (allow whitelist) | role |
|---|---|---|---|
| explore | lite | read / glob / grep / web_search / skill / list_agents / job_list / job_output / get_goal | read-only research: locate code, understand patterns, gather facts |
| code | lite | all tools (minus the five delegation tools) | implementation: edit, build, self-test; report change summary + verification evidence |
| write | standard | read / glob / grep / web_search / write / edit / skill / todo_write / list_agents / job_list / job_output | writing: papers, notes, READMEs |
| review | pro | read / glob / grep / web_search / skill / list_agents / job_list / job_output / get_goal | independent review: quality/security/performance/edge cases; prioritized issues + concrete fixes |

**1. Configure model tiers** — edit `model-router.tiers` in `config.yaml` (or in your local override file):
```yaml
model-router:
  tiers:
    lite:     { provider: deepseek-official, model: deepseek-v4-flash }
    standard: { provider: deepseek-official, model: deepseek-v4-flash }
    pro:      { provider: deepseek-official, model: deepseek-v4-pro }
    ultra:    { provider: deepseek-official, model: deepseek-v4-pro }
```
(For your own providers: configure the API-key env var under `llm-pi-ai.providers` in `~/.dsh/settings.yaml` first, then point `provider` at your provider name. **Keep private config in `model-router.local.yaml` — never in `config.yaml`, it is committed to GitHub.**)

**2. Edit the persona pool** — edit `model-router.personas` (8 built-in: physics / ml / data / research / docs / backend / reviewer / statistician; override/add/remove freely):
```yaml
model-router:
  personas:
    accelerator:
      text: "For this task you act as an accelerator physicist: ..."
```
New entries automatically appear in the root-only persona catalog section; `dispatch(persona="accelerator")` works immediately.

**3. Limits & circuit** — fully commented inside `config.yaml` under `limits`/`circuit`; defaults:

| Key | Default | Description |
|---|---|---|
| limits.maxActive | 8 | concurrent working subagents (global in-flight + per-session active-children double check) |
| limits.maxTeam | 16 | total continuable resident members (lazy count per dispatch; retire via interrupt_agent when reached) |
| limits.maxDepth | 3 | delegation depth cap (enforced service-side; backstop for the star team) |
| circuit.tripCodes | RATE_LIMIT / QUOTA / TIMEOUT / TRANSPORT / SERVER / EMPTY_RESPONSE | failure codes counted |
| circuit.threshold / cooldownMs | 2 / 60000ms | consecutive-failure threshold and cooldown duration |

**4. Other switches** — `protocolSection` (root protocol injection on/off) / `personaCatalogSection` (root persona catalog on/off) / `logPath` (audit log path, default `./dispatch.log`).

**Local override**: create `model-router.local.yaml` (excluded via `.gitignore`, never committed) with only the fragments you want to override — same structure as `config.yaml` (top-level `model-router:` key).

## Usage

```
dispatch(type="explore", prompt="Analyze module dependencies in src/, report risks")
dispatch(type="code", prompt="Implement xxx with verification evidence", tier="standard")
dispatch(type="write", prompt="Write a README for utils/ matching the repo style", persona="docs")
dispatch(type="review", prompt="Review PR quality with structured feedback", output_schema={...})
dispatch(type="review", prompt="Review PR quality", tier="ultra", timeout=600)
dispatch(type="explore", prompt="Keep researching xxx", run_in_background=true)  # → resume with send_message
```

## Docs

- `docs/DESIGN.md` — Design final (v3 + official review O1-O9 amendments, decisions D1-D28)
- `docs/ARCHITECTURE-REVIEW.md` — Official architecture comparison (O1-O9) + issues A1-A8
- `docs/COMPARISON-REVIEW.md` — Boundary-design comparison vs Kimi Code Swarm / Claude Code Agent Teams
- `docs/MAINTENANCE-ROADMAP.md` — Maintenance roadmap (P0-P2)
- `docs/BADGE-BOARD.md` — Badge-board panel design draft (in discussion)
- `docs/BADGE-BOARD-SPEC.md` — Badge-board right-panel Spec (v0.2.12 final, shipped in the `dsh-badgeboard` package)
- `docs/NOTES.md` — model-router iteration notes (v1-v8 dynamic-plugin iterations)
- `docs/PACKAGE-NAMING.md` — Naming decision record

## License

MIT
