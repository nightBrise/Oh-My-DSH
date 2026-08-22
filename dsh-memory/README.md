# dsh-memory

[English](README.md) | [简体中文](README.zh-CN.md)

Project-level cross-session memory plugin for DSH (evolved from the dynamic-plugin iteration; design doc in `DESIGN.md`).

## Features

- **Session checkpoints**: event capture (USER / TOOL_CALL / TOOL_RESULT / ASSISTANT) → window-adaptive threshold ladder auto-trigger → model writer updates the 11-section snapshot incrementally via the KEEP protocol (unchanged sections written as a single `KEEP` line are kept verbatim; `<!-- ckpt-at -->` timestamp; 11K-char budget with over-budget truncation + `⚠️ truncated` flag). The ladder adapts to the context window: no auto-thresholds below 25K (turn-count fallback, see `checkpoint.fallbackTurnInterval`), 20/40/60/80% up to 200K, 10%–90% up to 500K, 5%–90% beyond; the final threshold re-fires once pressure rises again. The writer outputs **plain-text checkpoint markdown** (no JSON — robust against small local models). The model's **thinking mode stays on** by default (16K output budget fits thinking + output); when the first attempt returns **zero text** (thinking exhausted the budget, or the model stopped early — one unified signature) the one retry appends `/no_think` (a per-request Qwen3 switch affecting only that background plugin call, never the main agent conversation), while format-only failures retry with thinking kept. Unrecognized output is retried once, and **every failure mode is non-destructive**: the last good checkpoint file and the event buffer are left untouched for the next attempt (empty buffer skips the write entirely, so a checkpoint never advances its timestamp without new material). A final checkpoint is written on agent disposal.
- **Compaction linkage**: on `compaction/start` a final checkpoint is written if the buffer is non-empty (backstop); after `compaction/end` a memory dump is injected as a system reminder with per-block budgets — **Session checkpoint** (11K, section-aware truncation: bodies cut first, skeleton kept) + **Recent user input (verbatim)** (16K, last user messages ≤2K each) + **Project memory** (10K, section-aware) + **Session notes** (tail 6K) — plus resume instructions (continue the task, never acknowledge the dump). Both are skipped when compaction fails.
- **Cross-session recall**: after the first human message (when the project has memory files), a reminder is injected with the exact memory-file paths (MEMORY.md + a recent session checkpoint), instructing the agent to grep the memory dir and use `history_search` instead of re-asking.
- **Dream consolidation**: `/dream` command or `dream_now` tool → collect windowed checkpoints (`dream.windowDays`) → LLM consolidation (thinking on by default; no explicit `reasoningEffort` — the dsh-llm facade rejects explicit efforts for models without a declared reasoning capability, and the server default keeps thinking on within the 16K budget) → atomic write-back to `<memDir>/MEMORY.md` (snapshot compare against concurrent edits, path-existence validation, line/KB budget); per-run summary appended to `dream.log`, `lastDreamAt`/`dreamCount` updated in `index.json`.
- **History lookup**: `history_search` (sessionQuery index, falls back to persisted-log scan when disabled; `sessionId`/`kind` filters; `limit` 10–50) + `history_around` (seq-anchored context, `before`/`after` 5–20, 20KB output cap).
- **Subagent exclusion**: subagent sessions (`header.origin='subagent'` or `delegationDepth>0`) do not participate in memory — no event buffering, no checkpoint triggering, no reminder/dump injection, and `dream` refuses subagent callers; the write gate still protects `.dsh-memory/` from subagent model writes.
- **Memory protocol section**: a standing `systemPrompt` section (order 150) teaches every session the memory guardrails — how to treat injected dumps (claims, verify before acting, resume silently), which memory files are writable (MEMORY.md + the session's notes.md), and that `.dsh-memory/` is otherwise plugin-owned. The text is self-conditional, so projects without memory pay only ~250 tokens.
- **Dream auto (opt-in)**: with `dream.auto: true`, a fresh session start (`agent/session-start`, `source='startup'`) schedules a background dream when `index.json`'s `lastDreamAt` is older than `dream.intervalDays` (default 7) and there is material to consolidate (recent checkpoints or non-empty MEMORY.md). Default off; subagent sessions never trigger it.
- **Per-project settings**: `.dsh-memory/settings.json` (`memory_config` tool / `/dshmem-config` command).
- **Write gate**: agent `write`/`edit` targeting `.dsh-memory/` is denied except `MEMORY.md` and `sessions/<sid>/notes.md` (plugin-owned paths are agent-read-only).
- **Legacy migration**: a root-level `MEMORY.md` (if present) is copied once into `<memDir>/MEMORY.md` on first touch.

## Tools & commands

| Name | Type | Description |
|---|---|---|
| `memory_config` | tool | Read/update `.dsh-memory/settings.json` (`action=get` default, `action=set` with `key` + `value`; values as strings, numbers/booleans auto-converted) |
| `dream_now` | tool | Manually trigger dream consolidation for the current project (`reason` optional, written to `dream.log`) |
| `history_search` | tool | Full-text search over history events (`query` required; `sessionId` scope; `kind` event-type filter; `limit` default 10, max 50) |
| `history_around` | tool | Context around a `history_search` hit (`sessionId` + `seq` required; `before`/`after` default 5, max 20; 20KB cap) |
| `/dream` | command | Manual dream trigger for the current project |
| `/dshmem-config` | command | Show config, or `set <key> <value>` (e.g. `set dream.windowDays 14`) |

## Installation (profile bundle)

1. Declare the local package in the active profile's manifest (or use the published npm name):
   ```json
   // ~/.dsh/profiles/web/package.json
   { "dependencies": { "dsh-memory": "file:/path/to/dsh-memory" },
     "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-memory"] } } }
   ```
2. Install in the profile directory — pnpm **copies** the `file:` dependency into the profile's own `node_modules/dsh-memory` (this copy is the one the loader resolves):
   ```bash
   cd ~/.dsh/profiles/web && pnpm install
   ```
   The peer `@deepseek-ai/dsh-tools` resolves automatically: the loader's baseUrl is the profile directory and Node's parent walk reaches DSH's flat module fallback `~/.dsh/profiles/node_modules`, which `dsh-app-boot` maintains with symlinks for every in-box package. No manual dependency links are needed.
3. **After changing this repository**: re-sync the copy, then restart dsh (a `file:` dependency is a snapshot copy, not a live link):
   ```bash
   rm -rf ~/.dsh/profiles/web/node_modules/dsh-memory && cd ~/.dsh/profiles/web && pnpm install
   ```
4. Restart the dsh process to activate (a dynamic-plugin iteration vanishes with the process; do not run it alongside the packaged one).

> The bundle row is declared by the package's `cordis.patch.yml` (wired via `dsh.bundle.patch`); later profile patch layers can target it by id (e.g. `- id: dsh-memory` with `disabled: true`).
>
> Note: `~/.dsh/profiles/node_modules` is a DSH-native, auto-maintained flat fallback (in-box dependency symlinks only). A manually placed `dsh-memory` symlink there is redundant — the profile's own `node_modules` wins module resolution — and should not be created.

## Configuration (`.dsh-memory/settings.json`)

```json
{ "memory": { "dirName": ".dsh-memory", "disableWrite": false },
  "checkpoint": { "fallbackTurnInterval": 20 },
  "dream": { "windowDays": 7, "inputMaxTokens": 50000, "maxLines": 200, "maxKB": 10, "auto": false, "intervalDays": 7 } }
```

| Key | Default | Meaning |
|---|---|---|
| `memory.dirName` | `.dsh-memory` | Memory directory name under the project root |
| `memory.disableWrite` | `false` | One-click write freeze: checkpoint/injection/dream disabled; reads kept |
| `checkpoint.fallbackTurnInterval` | `20` | Turn-count fallback trigger when the context window cannot be measured (1–1000) |
| `dream.windowDays` | `7` | Window for collecting checkpoints into a dream run (1–365) |
| `dream.inputMaxTokens` | `50000` | Budget for checkpoint text fed into the dream input (1000–500000) |
| `dream.maxLines` | `200` | MEMORY.md line budget after consolidation (10–1000) |
| `dream.maxKB` | `10` | MEMORY.md size budget in KB after consolidation (1–100) |
| `dream.auto` | `false` | Opt-in: auto-dream on fresh session start when the interval gate is due |
| `dream.intervalDays` | `7` | Minimum days between auto dream runs (1–365) |

`memory.disableWrite: true` — one-click write freeze (checkpoint/injection/dream disabled; reads kept).

## Layout

```
<project>/.dsh-memory/
├── MEMORY.md / settings.json / index.json / dream.log
└── sessions/<sid>/{checkpoint.md, notes.md}
```

- `MEMORY.md` — project-level durable knowledge (written by dream; agent may edit via the write gate)
- `settings.json` — per-project configuration (see above)
- `index.json` — metadata (`version`, `lastDreamAt`, `dreamCount`)
- `dream.log` — JSON-lines record of dream runs
- `sessions/<sid>/checkpoint.md` — 11-section session checkpoint (quarantined as `checkpoint.md.invalid` when validation fails)
- `sessions/<sid>/notes.md` — agent scratchpad (read by checkpoint writer / dream; writable via the write gate)

## License

MIT © 2026 zhangny
