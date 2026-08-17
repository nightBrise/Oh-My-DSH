# dsh-memory

[English](README.md) | [简体中文](README.zh-CN.md)

Project-level cross-session memory plugin for DSH (evolved from the dynamic-plugin iteration; design doc in `DESIGN.md`).

## Features

- **Session checkpoints**: event capture → window-adaptive threshold ladder (5%–90%) auto-trigger → model writer updates the 11-section snapshot incrementally via the KEEP protocol (`<!-- ckpt-at -->` timestamp, 11K-char budget, over-budget truncation with `⚠️ truncated` flag)
- **Compaction linkage**: injects a memory dump (checkpoint + MEMORY.md) after `compaction/end`; skipped when compaction fails
- **Cross-session recall**: injects a reminder after the first human message with exact memory-file paths
- **Dream consolidation**: `/dream` command or the `dream_now` tool → collect windowed checkpoints → LLM consolidation (reasoningEffort off) → atomic write-back to `.dsh-memory/MEMORY.md` (snapshot compare against concurrent edits, path existence validation, line/KB budget)
- **History lookup**: `history_search` (sessionQuery index, falls back to persisted-log scan when disabled) + `history_around` (seq-anchored context)
- **Per-project settings**: `.dsh-memory/settings.json` (`memory_config` tool / `/dshmem-config` command)

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

## Configuration (`.dsh-memory/settings.json`)

```json
{ "memory": { "dirName": ".dsh-memory", "disableWrite": false },
  "checkpoint": { "writerRetryOnce": true, "fallbackTurnInterval": 20 },
  "dream": { "windowDays": 7, "inputMaxTokens": 50000, "maxLines": 200, "maxKB": 10 } }
```

`memory.disableWrite: true` — one-click write freeze (checkpoint/injection/dream disabled; reads kept).

## Layout

```
<project>/.dsh-memory/
├── MEMORY.md / settings.json / index.json / dream.log
└── sessions/<sid>/{checkpoint.md, notes.md}
```

## License

MIT © 2026 zhangny
