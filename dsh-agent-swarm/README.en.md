# dsh-agent-swarm

Agent swarm orchestration for DeepSeek Harness (DSH): the root agent orchestrates subagents through the single `dispatch` entry — model-tier routing, tool-boundary filtering, persona injection, circuit breaking, concurrency limits, and a star-team protocol (root orchestrates, members do not spawn).

[中文 README](README.md) | Design docs under `docs/` (Chinese).

---

## Features

| Capability | Description |
|---|---|
| `dispatch(type, prompt, options?)` | Single delegation entry; unknown `type` fails hard (closed whitelist) |
| Tier routing | lite / standard / pro / ultra → provider/model pinned at creation (zero runtime drift) |
| Tool boundaries | explore/review use allow-whitelists (fail-closed); code denies all five delegation tools (anti-recursion) |
| Persona library | 8 built-in personas (key → full text injection); catalog section visible to root only |
| Protocol injection | Delegation entry + team protocol skeleton injected to root only (delegationDepth filtered) |
| Concurrency limits | maxActive=8 (event-paired accounting) + maxTeam=16 (lazy authoritative count) |
| Circuit breaker | `agent/request-error` counting, tripCodes match → cooldown, checked at tier resolution |
| Structured output | output_schema enforced service-side (`structured_output` tool); one retry then null |
| Timeout | foreground none by default (max 1h), background default 15min; timer cascade dispose/interrupt |
| Summary continuation | foreground output <200 chars auto-retries with a fuller-summary request |
| Audit | dispatch.log structured lines: dispatch/result/error (subagent_id/summary_len/stop/elapsed_ms) |
| Resident members | run_in_background=true → continuable subagents; resume via send_message, enumerate via list_agents |

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

**2. Edit the persona pool** — edit `model-router.personas` (8 built-in templates; override/add/remove freely):
```yaml
model-router:
  personas:
    accelerator:
      text: "For this task you act as an accelerator physicist: ..."
```
New entries automatically appear in the root-only persona catalog section; `dispatch(persona="accelerator")` works immediately.

**3. Types / limits / circuit** — fully commented inside `config.yaml`.

**Local override**: create `model-router.local.yaml` (excluded via `.gitignore`, never committed) with only the fragments you want to override — same structure as `config.yaml` (top-level `model-router:` key).

## Usage

```
dispatch(type="explore", prompt="Analyze module dependencies in src/, report risks")
dispatch(type="code", prompt="Implement xxx with verification evidence", tier="standard")
dispatch(type="review", prompt="Review PR quality with structured feedback", tier="ultra", output_schema={...})
dispatch(type="explore", prompt="Keep researching xxx", run_in_background=true)  # → resume with send_message
```

## Docs

- `docs/DESIGN.md` — Design final (v3 + official review O1-O9 amendments, decisions D1-D28)
- `docs/ARCHITECTURE-REVIEW.md` — Official architecture comparison (O1-O9) + issues A1-A8
- `docs/COMPARISON-REVIEW.md` — Boundary-design comparison vs Kimi Code Swarm / Claude Code Agent Teams
- `docs/MAINTENANCE-ROADMAP.md` — Maintenance roadmap (P0-P2)
- `docs/BADGE-BOARD.md` — Badge-board panel design draft (in discussion)
- `docs/PACKAGE-NAMING.md` — Naming decision record

## License

MIT
