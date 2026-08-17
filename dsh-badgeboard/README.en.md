# dsh-badgeboard — Subagent Badge Board

English | [中文](README.md)

DSH Web-UI plugin that turns **dispatched subagents** into a visible "badge team".

- **Floating capsule on the right edge of the center column**: presence avatar stack (working members first, idle dimmed, breathing status dots, tier color rings); hover reveals an info card (name + tier badge + role + status)
- **"Team" segment in the details pane**: member list + expandable badge card (styles A/B/C) + archive fields + "Open in Catalog"
- **Auto-open the right pane after dispatch**: detecting a new subagent → refresh the catalog + open the details pane (idempotent)
- **Procedural line-art avatars**: FNV-1a seed hash (subagent_id) → 6-feature pools (face/hair/eyes/brows/mouth/accessory); same agent, same face; not bound to type; zero-asset pipeline

## Features

| Feature | Description |
|---|---|
| **Floating capsule** (`shell.overlay` item `badgeboard-rail`) | 52px rounded capsule at the right edge of the center column, vertically centered (`top:50%`), `right` = measured last `gridTemplateColumns` segment of the frame (details-column width) + 12px; shows only **active members** (working + resting; completed members take no slot), working first, idle dimmed; "团队/Team" header + count badge on top, an independent scrollable member list (fully rendered, wheel-scroll when overflowing), and a working-progress bar + `working/total` at the bottom |
| **Hover info card** | Rendered at capsule level with JS positioning (`useLayoutEffect` recomputes `offsetTop - scrollTop + h/2`), lifted **outside the scroll area** to avoid overflow clipping: 48px line-art avatar + name + role·tier·mode line (tier-colored) + status line; 160ms delayed dismiss (the mouse can move onto the card), auto-close when the item scrolls out of view; triggered by hover and focus alike |
| **Capsule interactions** | Click a member → **open the subagent view** (first `refreshSubagents`, then derive the direct-parent address from the `subagentsByParent` snapshot as `{parentSessionId, childSessionId, mode}`, falling back to `subagentAddress`; silent on failure); click blank space/header/footer → `openDetails()`; keyboard reachable (Tab + Enter/Space; focus/blur drive the info card too) |
| **Team panel** (`details.produced.team` sub-seat) | Header stats (⚡ working / 💤 resting / ✓ done) + **A/B/C badge-card style switcher** (applies to the expanded card via `data-style`, default A, in-memory only) + **↻ refresh archive** (re-fetches the roster RPC); click a row to expand: 48px badge card (full density + 2.6px heavier stroke) + field grid (subagent_id / task / type / tier / mode) + "📂 Open in Catalog" jumping to the native catalog; **Esc** inside the panel closes the right pane; empty-state copy "暂无团队" |
| **Auto-open right pane after dispatch** | Subscribes to `sessions.list` and detects a new child (`parentId` = current session) → `refreshSubagents` + `openDetails()` (idempotent, no open/close bookkeeping); **`seatReady` gate**: no pop-up until the webui-enhance sub-seat has been injected; the child baseline resets on session switch, so no cross-session false triggers |
| **Restart self-healing** | When the catalog is **missing or not ready** (first load after restart: `subagentsByParent[cur]` undefined / loading) → proactively calls `refreshSubagents` (fixes "members don't show until a new dispatch"); members prefer catalog entries with session-layer supplement |
| **Procedural line-art avatars** | FNV-1a 32-bit seed hash (subagent_id, offset basis `0x811c9dc5` / prime `0x01000193`) → per-pool modulo pick (face 4 / hair 8 / eyes 4 / brows 4 / mouth 4 / accessory 7 = **14,336 combinations**); same agent, same face, stable across renders, not bound to type; densities `full` (detail card, with brows) / `simple` (rows/capsule/info card, brows omitted) / `symbol` (reserved by the module, unused in the UI); tier ring: standard blue / pro purple `#8564c4` (dark `#9d84d6`) / ultra amber; breathing halo while working (1.8s opacity animation); `vector-effect: non-scaling-stroke` constant screen stroke |
| **Status model** | Three states: **working** (`activity === 'running'` → halo + colored dot + "working on \<task\>…") / **resting** (dimmed + "waiting for the next round") / **done** (✓ + "done ✓"); status is **dual-encoded** (dot + text) |
| **Role & tier tables** | type → role: explore 研究员 (researcher) / code 工程师 (engineer) / write 文档撰写 (documentation) / review 审查官 (reviewer) / general 通用成员 (general member); unknown → 「成员」 (member); tier → Lite / Standard / Pro / Ultra; unknown → 「职级未知」 (tier unknown), never fabricated |

## Installation

```bash
# 1. Repo-local package: this directory is the package (file: dependency)
# 2. Mount it in the web profile (~/.dsh/profiles/web/package.json):
#    dependencies: add "dsh-badgeboard": "file:/home/zhangny/Oh-My-DSH/dsh-badgeboard"
#    dsh.profile.bundles: add "dsh-badgeboard"
# 3. cd ~/.dsh/profiles/web && pnpm install
# 4. Restart dsh web
```

> **Syncing changes**: the profile's `node_modules` holds pnpm copies, not symlinks, so `pnpm install` won't re-copy changed content (it reports "Already up to date"). After editing package files, sync manually:
> `cp lib/client.js ~/.dsh/profiles/web/node_modules/dsh-badgeboard/lib/client.js` (same for the host), then refresh the page (client rev = content sha1, so the new version is picked up automatically).

`cordis.patch.yml` auto-inserts the plugin row (id `badgeboard`) — no manual profile editing.

## Cross-package contracts

| Item | Contract |
|---|---|
| `details.produced.team` sub-seat | declared by webui-enhance / registered by badgeboard (renaming requires syncing both packages) |
| Host archive RPC | `POST /dsh-badgeboard/badge-team/roster`, `/badge-team/status` |
| Right-edge positioning | measures the last `gridTemplateColumns` segment of the frame (details-column width) + 12px; follows open/close and drag-resize |
| Trigger | `sessions.list` subscription detects a new child (`parentId` = current session) → `layout.openDetails()` (idempotent, gated on `seatReady`) |

### RPC contract

Registered on the host via `webServer.register({ kind: 'prefix', path: '/dsh-badgeboard' })`; the client calls `fetch('/dsh-badgeboard/<method>')` with POST JSON; envelope `{ ok: true, value }` / `{ ok: false, error }`; unknown method 404, invalid body 400 (8MB cap), handler errors 500.

| Method | `value` returned |
|---|---|
| `badge-team/roster` | `{ members: [{id, type, tier, persona}], pending: [{ts, type, tier, persona}] }` (pending: last 10 only) |
| `badge-team/status` | `{ rosterSize }` (archive table size) |

Full design: `dsh-agent-swarm/docs/BADGE-BOARD-SPEC.md` (v0.2.6, Chinese).

## Data model (3-layer merge, keyed by childId)

| Layer | Source | Contents |
|---|---|---|
| ① Catalog layer (authoritative, live subscription) | `sessions.list` snapshot `subagentsByParent[cur]` | `SubagentListEntry{id, label, activity, mode, hasChildren}`; entries are read only when `state === 'ready'` |
| ② Session layer (supplement) | snapshot `byId` | `displayTitle` title fallback, `running`, `completed`, `parentId` |
| ③ Archive layer (captured at dispatch time only) | host `tools/result` (filtered by `exec.name === 'dispatch'`) | `{type, tier, persona}` (+ `prompt` used internally, not returned by RPC) |

- **Archive join**: continuable subagents exact-match on `result.value.subagentId`; frontend one-shot subagents have no subagentId → best-effort pending match within a **60s window** (newest-first, one-shot consumption via `frontMatched`); on failure, degrade to "tier unknown" while status/title still render
- **Retention**: the host archive table is capped at 100 entries (oldest evicted), pending is capped at 100 (the RPC returns only the last 10); event-order insensitive
- **Cold recovery**: after a page refresh, layers ①② rebuild from the snapshot (live); after a host restart the archive layer is lost → tier shows "unknown", documented and accepted

## Files

- `lib/index.js` — host half: captures dispatch archives from `tools/result` + webServer HTTP routes (roster / status)
- `lib/client.js` — client half (ModuleLoader format): floating capsule + hover info card + team panel + inline avatar generator
- `lib/avatar-gen.js` — canonical procedural line-art avatar generator module (the client inlines a copy; keep them in sync)
- `package.json` — exports: `.` → host (`lib/index.js`), `./client` → client; `dsh.bundle.patch` / `dsh.client.platform: web`; peer `react ^18.2.0`
- `cordis.patch.yml` — bundle plugin row (id `badgeboard`)

## Known limitations

- Requires the updated webui-enhance (details-pane tabs + sub-seat declaration); without it the capsule still works, but the team segment won't render and no auto-open happens
- Archive join: continuable subagents exact-match on `subagentId`; frontend one-shot subagents rely on the 60s best-effort window
- The avatar generator is an inline copy: after editing `lib/avatar-gen.js`, sync the inline code inside client.js
- The A/B/C style is in-memory only (resets to A on refresh), not persisted
- Multi-session semantics: only children of the current session (`parentId === current`) appear in the panel/capsule
- The `symbol` density is a reserved capability of the avatar-gen module; the current UI doesn't use it

## License

MIT
