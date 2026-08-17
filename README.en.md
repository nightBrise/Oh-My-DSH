# Oh-My-DSH

简体中文 | [English](README.en.md)

**Oh-My-DSH** is a personal plugin collection for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (DSH), inspired by Oh-My-Zsh: self-built, battle-tested DSH plugins gathered in one repository, ready to use.

Currently includes **4 plugins** covering agent orchestration, session memory, and the web UI:

| Plugin | One-liner |
| --- | --- |
| [dsh-agent-swarm](dsh-agent-swarm/) | Star-team subagent orchestration: single `dispatch` entry, model-tier routing, tool-boundary filtering, persona injection, circuit breaking, concurrency limits |
| [dsh-memory](dsh-memory/) | Project-level cross-session memory: session checkpoints, compaction linkage, Dream consolidation, history lookup |
| [dsh-webui-enhance](dsh-webui-enhance/) | `dsh web` GUI enhancements: token usage stats, artifact preview panel, Deep copy pool, @file mention, session deletion |
| [dsh-badgeboard](dsh-badgeboard/) | Subagent badge board: makes dispatched subagents visible as a "badge team" (floating avatar capsule, team panel, seeded line-art avatars) |

---

## Quick Start

**Prerequisite**: DeepSeek Harness installed, `dsh` CLI available.

```bash
# 1. Clone this repository
git clone https://github.com/nightBrise/Oh-My-DSH.git
cd Oh-My-DSH

# 2. Install the plugins you need (see the installation index below)
```

### Installation Index

The four plugins mount differently — follow each plugin's own README:

| Plugin | Install method | Docs |
| --- | --- | --- |
| `dsh-agent-swarm` | Mount `lib/index.js` in a swarm preset (one config line) | [dsh-agent-swarm/README.md](dsh-agent-swarm/README.md) |
| `dsh-memory` | Profile bundle: `package.json` dependency + flat symlink | [dsh-memory/README.md](dsh-memory/README.md) |
| `dsh-webui-enhance` | `dsh plugin --profile web add` (local path or GitHub source) | [dsh-webui-enhance/README.md](dsh-webui-enhance/README.md) |
| `dsh-badgeboard` | Web profile dependency + bundle row (`file:` reference to this dir) | [dsh-badgeboard/README.md](dsh-badgeboard/README.md) |

> Mounting each plugin from a local path works in all cases; if a plugin is later published separately to GitHub, its README also covers GitHub-based installation.

---

## Plugins

### 🐝 dsh-agent-swarm — Star-Team Subagent Orchestration

- **Single dispatch entry**: `dispatch(type, prompt, options?)` with a closed whitelist of types (explore / code / write / review); unknown types fail hard; same-round fan-out is concurrent (isConcurrencySafe)
- **Tier routing**: lite / standard / pro / ultra → different models; provider/model pinned at creation, zero runtime drift
- **Tool boundaries**: allow-lists for explore/write/review (fail-closed); review also gets read-only bash (git inspection via `git diff HEAD`); code has full tools; all types deny the five delegation tools (recursion guard + star team)
- **Persona library**: 10 built-in personas injected in full (or free text); directory section visible to root only
- **Protocol injection**: delegation entry + delegation-decision guidance + tier-decision rules + parallelism & reuse discipline + acceptance loop (maker/checker separation) + EARS acceptance criteria + failure handling + team protocol skeleton, injected into root only
- **Reliability**: dual concurrency caps + depth cap (maxActive / maxTeam / maxDepth), circuit breaking with cooldown, structured output, timeout cascades, summary follow-up, label & traceability audit
- **Auditing**: structured `dispatch.log` lines (dispatch / result / error)
- **Persistent members**: `run_in_background=true` creates continuable subagents; `send_message` to follow up, `list_agents` to enumerate

📄 Docs: `docs/DESIGN.md` (final design), `docs/ARCHITECTURE-REVIEW.md`, `docs/COMPARISON-REVIEW.md`, and more

### 🧠 dsh-memory — Project-Level Cross-Session Memory

- **Session checkpoints**: event capture → window-adaptive threshold ladder auto-triggers → model writer updates the 11-section snapshot incrementally (KEEP protocol)
- **Compaction linkage**: memory dump injected after `compaction/end`; skipped when compaction fails
- **Dream consolidation**: `/dream` or the `dream_now` tool → windowed checkpoint collection → LLM consolidation → atomic write-back to `MEMORY.md`
- **History lookup**: `history_search` (sessionQuery index, falls back to persisted-log scan when disabled) + `history_around` (seq-anchored context)
- **Per-project settings**: `.dsh-memory/settings.json` (`memory_config` tool / `/dshmem-config` command)

### 🖥️ dsh-webui-enhance — Web GUI Enhancements

- **Token usage**: dual donut charts (provider/model), detail tables, balance card (live DeepSeek query), 30-day stacked chart
- **Artifact preview**: click an artifact chip → browser-style tab cards panel; renders images / Markdown / HTML (iframe sandbox) / code & logs
- **Details-pane sections**: artifact / team tabs (renders the subagent team for badgeboard), open state exposed to companion plugins
- **Image auto-recognition**: in text-only-model conversations, user images are automatically recognized by the configured vision model (default Xiaomi mimo-v2.5) and injected as structured text; same-image cache for 10 minutes
- **Deep copy pool**: 60 generation-status lines with per-session random wording and gradient shimmer animation
- **@file mention**: type `@` in the input to fuzzy-search workspace files; the inserted path is read by the model itself
- **Session deletion**: two-step confirmation, physically cleans session logs under `~/.dsh`
- **Responsive width**: message column, input, user bubbles adapt to window width (1280px cap)

### 🏷️ dsh-badgeboard — Subagent Badge Board

- **Floating capsule on the middle-pane right edge**: online avatar stack (working agents first, idle dimmed, breathing status dot, seniority ring), hover info card
- **"Team" section in the details pane**: member list + expanded badge card (A/B/C style switching) + profile fields + "open in directory"
- **Click member to jump to subagent view**: direct-parent address derived from snapshot, keyboard accessible
- **Auto-open right pane on dispatch**: detects new subagents → refreshes roster + opens details pane (idempotent, gated on `seatReady`, only for dispatches within the current session)
- **Restart self-healing**: proactively calls `refreshSubagents` when the catalog is not ready (capsule survives restarts); members prefer catalog entries with session-layer supplement
- **Seeded line-art avatars**: FNV-1a hash of `subagent_id` → deterministic generation from a 6-element pool (14,336 combos); same agent keeps the same face, zero asset pipeline
- **Cross-package contract**: depends on the updated webui-enhance details-pane sections; host profile RPC `POST /dsh-badgeboard/badge-team/*`

📄 Full design: `dsh-agent-swarm/docs/BADGE-BOARD-SPEC.md` (v0.2.12)

---

## Repository Layout

```
Oh-My-DSH/
├── README.md               # This document (Chinese)
├── README.en.md            # English README
├── LICENSE                 # MIT © 2026 nightBrise
├── dsh-agent-swarm/        # Plugin 1: star-team subagent orchestration
│   ├── lib/index.js        #   Plugin body (ESM)
│   ├── config.yaml         #   Committed template config (tiers / personas / limits)
│   ├── model-router.local.yaml  # Local private config (gitignored, not committed)
│   └── docs/               #   Design / architecture review / comparison / roadmap
├── dsh-memory/             # Plugin 2: project-level cross-session memory
│   ├── lib/index.js
│   ├── cordis.patch.yml    #   Bundle patch: auto-inserts the plugin line
│   └── DESIGN.md
├── dsh-webui-enhance/      # Plugin 3: web GUI enhancements
│   ├── lib/index.js        #   Host half: usage capture / RPC routes
│   ├── lib/client.js       #   Client half: React components / fetch RPC
│   └── cordis.patch.yml
└── dsh-badgeboard/         # Plugin 4: subagent badge board
    ├── lib/index.js        #   Host half: dispatch profile capture / RPC routes
    ├── lib/client.js       #   Client half: floating capsule + team panel (inlined avatar generator)
    ├── lib/avatar-gen.js   #   Seeded line-art avatar generator (canonical module)
    └── cordis.patch.yml
```

## Development

All plugins are hand-written ESM / browser code — no build step; restart `dsh` after changes:

```bash
# Syntax check
node --check dsh-agent-swarm/lib/index.js
node --check dsh-memory/lib/index.js
node --check dsh-webui-enhance/lib/index.js
node --check dsh-webui-enhance/lib/client.js
node --check dsh-badgeboard/lib/index.js
node --check dsh-badgeboard/lib/client.js
```

- `dsh-agent-swarm`: config hot-reloads on every dispatch — edit `config.yaml` without restarting
- `dsh-memory`: local development requires the three-step profile bundle install (dependency links); do not keep the old dynamic-plugin version alongside
- `dsh-webui-enhance`: local development via `dsh plugin --profile web add /path/to/dsh-webui-enhance`
- `dsh-badgeboard`: depends on the updated webui-enhance (details-pane sections); the avatar generator is inlined — after editing `lib/avatar-gen.js`, sync the inlined copy in client.js

## License

[MIT](LICENSE) © 2026 nightBrise
