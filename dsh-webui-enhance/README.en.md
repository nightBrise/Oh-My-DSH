# dsh-webui-enhance

English | [中文](README.md)

A **Web GUI enhancement plugin** for DSH (DeepSeek Harness): adds a set of practical session and statistics features to `dsh web` without modifying DSH source.

> This package was solidified from the dynamic plugin `demo-3`; every feature line has been accepted by the user.

## ✨ Features

| Feature | Description |
| --- | --- |
| **Token Usage** | New "Token Usage" tab at the top of the conversation page: twin donut charts (provider/model share), provider detail table (with totals row), current-workspace session usage table (click a row to open that session), live current-session context measurement (context/pressure tokens), balance/quota cards (live DeepSeek query, 55s server cache, refreshed every 60s; Xiaomi/Tongyi link to their consoles), and a last-30-days / current-month stacked daily chart (hovering a day switches the detail table, donuts and session table to that day's data, with a tooltip). Usage auto-refreshes every 10s, balance every 60s |
| **Produced-file Tab Preview** | Click a produced-file chip in the conversation tail (internally dispatches a `dsh:produced-open` event) → opens in the right panel as **browser-style tabs**: open multiple products, click a tab to switch, close individually; renders: **images** (base64), **Markdown** (headings/tables/images/lists/code blocks/quotes), **HTML** (sandboxed iframe), **code/log** (monospace text). The panel defaults to half of the width beside the sidebar; drag the divider to resize (no shell 520px cap) |
| **Details segments (Produced / Team)** | The right panel hosts **📦 Produced / 👥 Team** segments (both with `aria-pressed`): Team is shown by default when the bar opens; opening a produced file auto-switches to the Produced segment and opens the bar; clicking a produced tab returns to preview. The **Team segment renders the child seat `details.produced.team`** (content injected by the companion dsh-badgeboard plugin; a placeholder is shown when it is not installed) |
| **Deep phrase pool** | The generating-status line picks uniformly at random from 60 "Deep xxx…" phrases (no immediate repeats), one fixed phrase per status element (re-picked for new elements/sessions), with a gradient shimmer animation |
| **@file mentions** | Typing `@` in the composer triggers workspace file fuzzy search (prefix/contains/fuzzy match; ignores `node_modules`, `.git` and dot-prefixed entries; directory traversal depth ≤ 5), inserting `@path ` on pick; the model reads the file itself |
| **Delete session** | 🗑️ button in the session header with two-step confirmation; physically removes the session log under `~/.dsh` (running sessions defer cleanup until they finish; if cleanup is unavailable the session is only removed from the list, logs kept) |
| **Responsive width** | Message column, composer and user bubbles adapt to window width (up to 1280px) |

## 📦 Install

Requirements: DeepSeek Harness installed and `dsh web` able to start; pnpm needed (`corepack enable`).

Install from GitHub (this package is distributed via GitHub, not published to npm):

```bash
# Option 1: GitHub shorthand (recommended)
dsh plugin --profile web add <your-github-username>/dsh-webui-enhance

# Option 2: full git URL
dsh plugin --profile web add git+https://github.com/<your-github-username>/dsh-webui-enhance.git

# restart after install
dsh web
```

The package ships `dsh.bundle.patch` (cordis.patch.yml), so the plugin row `webui-enhance` is inserted into the profile automatically — no manual config.

If your environment cannot apply the bundle patch automatically, append to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: webui-enhance
      name: 'dsh-webui-enhance'
```

## 🔄 Update

```bash
dsh plugin --profile web update dsh-webui-enhance
```

## ❌ Uninstall

```bash
dsh plugin --profile web remove dsh-webui-enhance
```

## 🗂 Data

- **Usage records**: persisted at `~/.dsh/dsh-usage/usage-records.json` (up to 50k records, 2s debounced writes), captured by listening to `llm/stream`; subagent calls count into totals (records without a sessionId don't appear in the session table). After uninstall you may delete this file manually.
- Session-log deletion only removes the session's log directory under `~/.dsh` (path-guarded: the directory name must equal the sessionId and live under `/sessions/`); workspace files are never touched.

## 🏗 Package layout

```
dsh-webui-enhance/
├── package.json        # ESM; main=lib/index.js (host); exports ./client
├── cordis.patch.yml    # bundle patch: auto-inserts the plugin row
├── LICENSE             # MIT
├── lib/
│   ├── index.js        # host half: usage capture/persistence, HTTP RPC routes (/dsh-webui-enhance/*)
│   └── client.js       # client half: ModuleLoader format, React components + fetch RPC
├── README.md           # Chinese docs
└── README.en.md        # English
```

### Communication architecture

Static plugins don't rely on the dynamic runner's `harness.handle` / `host.call`; instead:

- The **host half** registers JSON RPC via `ctx.webServer.register({ kind: 'prefix', path: '/dsh-webui-enhance', handler })` (methods: `tokens-usage` / `tokens-balance` / `tokens-measure` / `file-search` / `produced-open` / `delete-session`);
- The **client half** calls `fetch('/dsh-webui-enhance/<method>')` with POST JSON, envelope `{ ok, value }` / `{ ok: false, error }`;
- The **client half** also registers slots through `ctx.get('slots')`: `details` (produced panel), `conversation.view` (Token Usage), `conversation.session.header.actions` (delete session), `tool.view.cordis` (debug panel), and registers the `@` file trigger source via `inputTriggers`, opening/closing the right bar via `ctx.get('layout')`.

> This matches the community plugin @linxin666/dsh-client-ui-aionui-panel (prefix routes via `dsh-host-webserver`) — the standard way for DSH static UI plugins to exchange data between host and client.

### Cross-package contract (with dsh-badgeboard)

- **`details` child-seat declaration**: when registering the `details` slot (id `produced`, priority -1), the produced panel declares the child seat `details.produced.team` (`{ kind: 'single', scope: 'session' }`); the Team segment renders it via `renderSlot('details.produced.team', {})`, and the companion plugin dsh-badgeboard injects its team badgeboard through `slots.inject('details.produced.team')` + `slots.register`.
- **Details open-state/width exposure**: when the produced panel opens the bar it sets `data-dsh-wide`, `data-dsh-details-open` and the CSS variables `--dsh-sidebar-px` / `--dsh-details-px` / `--dsh-handle-left` on the shell frame (the parent of `[data-shell-overlay]`), and sets `data-dragging` while the divider is being dragged; companion plugins (e.g. dsh-badgeboard's mid-rail) use these to sense the details open state and width.

## 🛠 Development

```bash
# Syntax check (hand-written ESM/browser code, no build step)
node --check lib/index.js
node --check lib/client.js

# Local testing before pushing to GitHub: reference the folder from the profile
dsh plugin --profile web add /path/to/dsh-webui-enhance
```

Changes take effect after restarting `dsh web`. Release flow: push to a GitHub repo → users follow the Install section above.

The "Web UI 改造 Demo" debug panel on the Cordis tool page (`tool.view.cordis` slot, key `self`) shows the plugin status and the `@` file-search source registration; you can type a keyword to test `file-search` (limit 5) and the width takeover directly.

## ⚠️ Notes

- The shell's `details` slot was occupied by the "tool details panel"; this plugin (slot id `produced`) replaces it with the Produced/Team segmented panel. Team is shown by default when the bar opens; opening a produced file auto-switches to the Produced segment.
- Produced-file reads fall back across `workspaceRoot`, all live sessions' `cwd` and persisted session headers' `cwd`, so cross-workspace works; `..` traversal is rejected.
- The panel width is driven by CSS variables + `!important` (`data-dsh-wide` / `data-dsh-details-open` expose the open state); closing the panel restores the shell default. Drag takeover has no 520px cap.
- The Team segment content is provided by the companion plugin dsh-badgeboard; without it a placeholder ("Team badgeboard not loaded (badgeboard plugin not running)") is shown.
- Balance query needs `DEEPSEEK_API_KEY` configured (credentials), otherwise the card shows "API Key not configured".

## 📄 License

MIT
