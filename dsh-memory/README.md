# dsh-memory

[English](README.md) | [简体中文](README.zh-CN.md)

Project-level cross-session memory plugin for DSH (evolved from the dynamic-plugin iteration; design doc in `DESIGN.md`).

## Features

- **Session checkpoints**: event capture (USER / TOOL_CALL / TOOL_RESULT / ASSISTANT) → window-adaptive threshold ladder auto-trigger → model writer updates the 11-section snapshot incrementally via the KEEP protocol (unchanged sections returned as `KEEP` are kept verbatim; `<!-- ckpt-at -->` timestamp; 11K-char budget with over-budget truncation + `⚠️ truncated` flag). The ladder adapts to the context window: no auto-thresholds below 25K (turn-count fallback, see `checkpoint.fallbackTurnInterval`), 20/40/60/80% up to 200K, 10%–90% up to 500K, 5%–90% beyond; the final threshold re-fires once pressure rises again. Validation failures trigger one retry (`checkpoint.writerRetryOnce`); still-invalid output is quarantined to `checkpoint.md.invalid`, degraded output falls back to a template; a final checkpoint is written on agent disposal.
- **Compaction linkage**: on `compaction/start` a final checkpoint is written if the buffer is non-empty (backstop); after `compaction/end` a memory dump (checkpoint + MEMORY.md) is injected as a system reminder; both are skipped when compaction fails.
- **Cross-session recall**: after the first human message (when the project has memory files), a reminder is injected with the exact memory-file paths (MEMORY.md + a recent session checkpoint), instructing the agent to grep the memory dir and use `history_search` instead of re-asking.
- **Dream consolidation**: `/dream` command or `dream_now` tool → collect windowed checkpoints (`dream.windowDays`) → LLM consolidation (`reasoningEffort: off`) → atomic write-back to `<memDir>/MEMORY.md` (snapshot compare against concurrent edits, path-existence validation, line/KB budget); per-run summary appended to `dream.log`, `lastDreamAt`/`dreamCount` updated in `index.json`.
- **History lookup**: `history_search` (sessionQuery index, falls back to persisted-log scan when disabled; `sessionId`/`kind` filters; `limit` 10–50) + `history_around` (seq-anchored context, `before`/`after` 5–20, 20KB output cap).
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

1. Local package (or use the published npm name in dependencies):
   ```json
   // ~/.dsh/profiles/web/package.json
   { "dependencies": { "dsh-memory": "file:/path/to/dsh-memory" },
     "dsh": { "profile": { "bundles": [..., "dsh-memory"] } } }
   ```
2. Create the flat symlink (bundle resolution: `$DSH_HOME/profiles/node_modules`):
   ```bash
   ln -sfn /path/to/dsh-memory ~/.dsh/profiles/node_modules/dsh-memory
   ```
3. In-package dependency link (peer `@deepseek-ai/dsh-tools` resolved from the install closure):
   ```bash
   mkdir -p /path/to/dsh-memory/node_modules/@deepseek-ai
   ln -sfn <dsh-install>/node_modules/@deepseek-ai/dsh-tools /path/to/dsh-memory/node_modules/@deepseek-ai/dsh-tools
   ```
4. Restart the dsh process (the dynamic-plugin version disappears with the process; do not keep both).

> The bundle row is declared in `cordis.patch.yml` (wired via `dsh.bundle.patch`); later profile patch layers can address it by id (e.g. `- id: dsh-memory` with `disabled: true`).

## Configuration (`.dsh-memory/settings.json`)

```json
{ "memory": { "dirName": ".dsh-memory", "disableWrite": false },
  "checkpoint": { "writerRetryOnce": true, "fallbackTurnInterval": 20 },
  "dream": { "windowDays": 7, "inputMaxTokens": 50000, "maxLines": 200, "maxKB": 10 } }
```

| Key | Default | Meaning |
|---|---|---|
| `memory.dirName` | `.dsh-memory` | Memory directory name under the project root |
| `memory.disableWrite` | `false` | One-click write freeze: checkpoint/injection/dream disabled; reads kept |
| `checkpoint.writerRetryOnce` | `true` | Retry the model writer once when checkpoint validation fails |
| `checkpoint.fallbackTurnInterval` | `20` | Turn-count fallback trigger when the context window cannot be measured (1–1000) |
| `dream.windowDays` | `7` | Window for collecting checkpoints into a dream run (1–365) |
| `dream.inputMaxTokens` | `50000` | Budget for checkpoint text fed into the dream input (1000–500000) |
| `dream.maxLines` | `200` | MEMORY.md line budget after consolidation (10–1000) |
| `dream.maxKB` | `10` | MEMORY.md size budget in KB after consolidation (1–100) |

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
