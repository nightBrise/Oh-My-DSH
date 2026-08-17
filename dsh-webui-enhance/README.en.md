# dsh-webui-enhance

English | [中文](README.md)

A **Web GUI enhancement plugin** for DSH (DeepSeek Harness): adds a set of practical session and statistics features to `dsh web` without modifying DSH source.

> This package was solidified from the dynamic plugin `demo-3`; every feature line has been accepted by the user.

## ✨ Features

| Feature | Description |
| --- | --- |
| **Token Usage** | New "Token Usage" tab at the top of the conversation page: twin donut charts (provider/model share), provider detail table, current-workspace session usage table, balance/quota cards (live DeepSeek query with 60s cache; Xiaomi/Tongyi link to their consoles), and a last-30-days / current-month stacked daily chart (hover-linked tooltip) |
| **Produced-file Tab Preview** | Click a produced-file chip in the conversation tail → opens in the right panel as **browser-style tabs**: open multiple products, click a tab to switch, close individually; renders: **images** (base64), **Markdown** (headings/tables/images/lists/code blocks/quotes), **HTML** (sandboxed iframe), **code/log** (monospace text). The panel defaults to half of the width beside the sidebar; drag the divider to resize (no shell 520px cap) |
| **Deep phrase pool** | The generating-status line picks uniformly at random from 60 "Deep xxx…" phrases, **a fresh phrase per session**, with a gradient shimmer animation |
| **@file mentions** | Typing `@` in the composer triggers workspace file fuzzy search (prefix/contains/fuzzy match, depth-limited), inserting `@path ` on pick; the model reads the file itself |
| **Delete session** | 🗑️ button in the session header with two-step confirmation; physically removes the session log under `~/.dsh` (running sessions defer cleanup until they finish) |
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
- Session-log deletion only removes the session's log directory under `~/.dsh`; workspace files are never touched.

## 🏗 Package layout

```
dsh-webui-enhance/
├── package.json        # ESM; main=lib/index.js (host); exports ./client
├── cordis.patch.yml    # bundle patch: auto-inserts the plugin row
├── LICENSE             # MIT
├── lib/
│   ├── index.js        # host half: usage capture/persistence, HTTP RPC routes (/dsh-webui-enhance/*)
│   └── client.js       # client half: ModuleLoader format, React components + fetch RPC
└── README.md           # zh; English in README.en.md
```

### Communication architecture

Static plugins don't rely on the dynamic runner's `harness.handle` / `host.call`; instead:

- The **host half** registers JSON RPC via `ctx.webServer.register({ kind: 'prefix', path: '/dsh-webui-enhance', handler })` (methods: `tokens-usage` / `tokens-balance` / `tokens-measure` / `file-search` / `produced-open` / `delete-session`);
- The **client half** calls `fetch('/dsh-webui-enhance/<method>')` with POST JSON, envelope `{ ok, value }` / `{ ok: false, error }`.

> This matches the community plugin @linxin666/dsh-client-ui-aionui-panel (prefix routes via `dsh-host-webserver`) — the standard way for DSH static UI plugins to exchange data between host and client.

## 🛠 Development

```bash
# Syntax check (hand-written ESM/browser code, no build step)
node --check lib/index.js
node --check lib/client.js

# Local testing before pushing to GitHub: reference the folder from the profile
dsh plugin --profile web add /path/to/dsh-webui-enhance
```

Changes take effect after restarting `dsh web`. Release flow: push to a GitHub repo → users follow the Install section above.

## ⚠️ Notes

- The shell's `details` slot was occupied by the "tool details panel"; this plugin replaces it with the produced-file preview panel.
- Produced-file reads fall back across `workspaceRoot` and all live sessions' `cwd`, so cross-workspace works; `..` traversal is rejected.
- The panel width is driven by CSS variables + `!important`; closing the panel restores the shell default.
- Balance query needs `DEEPSEEK_API_KEY` configured (credentials), otherwise the card shows "API Key not configured".

## 📄 License

MIT
