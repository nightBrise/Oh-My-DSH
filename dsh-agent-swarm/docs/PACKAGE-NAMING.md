# model-router 建包命名讨论

> 状态：**已定稿（2026-08-17）**
> 最终决策：**包名 `dsh-agent-swarm`** / 挂载走 **preset 行** / 仓库名与包名一致（`dsh-agent-swarm`）/ **双语 README**（中文主 + English）/ **版本 0.1.0**
> 背景：dispatch v8 动态插件 → 建包（本地包，不推 npm，用户上传 GitHub）
> 依据：DSH 官方包规范（@deepseek-ai/dsh-*）+ dsh-memory 本地建包先例 + awesome-dsh-plugin 社区命名惯例

---

## 1. DSH 官方命名规范（权威）

官方包命名：`@deepseek-ai/dsh-<域>`（npm scope + dsh 前缀 + 领域词）
- 工具类：`dsh-tool-subagent` / `dsh-tool-bash` / `dsh-tool-fs`
- 服务类：`dsh-subagent` / `dsh-agent-presets` / `dsh-system-prompt`
- UI 类：`dsh-client-ui-trajectory` / `dsh-client-ui-subagent`
- 功能类：`dsh-memory`（用户已有本地包，无 scope）

**bundle 机制**（dsh-memory 已验证）：本地包 `package.json` 声明 `dsh.bundle.patch: ./cordis.patch.yml`，profile 的 `dsh.profile.bundles` 引用包名，`node_modules` 用 `file:` 链接。

## 2. 社区命名惯例（awesome-dsh-plugin 调研）

社区插件命名模式（约 100+ 个插件）：
| 模式 | 示例 | 占比 |
|---|---|---|
| **`dsh-<功能词>`**（主流，无 scope） | dsh-spotlight / dsh-hud / dsh-sysmon / dsh-pomodoro / dsh-multi-chat | ~70% |
| **`dsh-plugin-<功能词>`** | dsh-plugin-tts / dsh-plugin-open-app / dsh-plugin-toggle | ~15% |
| **`dsh-<域名>-<功能>`**（厂商风格） | dsh-web-restart / dsh-web-lan-access / dsh-model-search | ~10% |
| **`dsh-<领域>-<功能>`**（复合） | dsh-git-graph / dsh-task-board / dsh-live-stats | 少量 |
| 无 dsh 前缀（罕见） | arcana / terminal / prompt-for-me | 少量 |

**社区事实**：
1. 绝大多数 `dsh-` 前缀 + 功能词，**无 scope**（npm 上直接 `dsh-x`）
2. `dsh-suite`（whyihaveyou）做插件目录，要求声明 `dsh.bundle` 清单 → 我们的包必须带 `dsh.bundle` 字段才能进生态
3. `awesome-dsh-plugin` 收列标准即"可经 `dsh plugin add` 安装 + 声明 dsh.bundle"

## 3. 候选命名方案

| 方案 | 包名 | 仓库名 | 理由 | 风险 |
|---|---|---|---|---|
| A. `dsh-swarm` | `dsh-swarm` | dsh-swarm | 语义直白（agent swarm）；社区风格主流（dsh-+功能词）；无 scope | npm 可能已有同名（需查） |
| B. `dsh-model-router` | `dsh-model-router` | dsh-model-router | 与现有 model-router 目录名一致；但"模型路由"只描述一半（dispatch 是治理+路由） | npm 已存在（调研笔记提过 dsh-model-router 是参考项目） |
| C. `dsh-agent-swarm` | `dsh-agent-swarm` | dsh-agent-swarm | 更精确（agent swarm）；与 kimi "agent swarm" 术语呼应 | 较长；可能撞名 |
| D. `dsh-dispatch` | `dsh-dispatch` | dsh-dispatch | 以唯一入口工具命名 | 但包功能超出 dispatch 单工具（含协议/面板） |
| E. `dsh-team` | `dsh-team` | dsh-team | 呼应团队语义 | 撞名风险高（dsh-agent-teams 是官方调研对象） |

**倾向：A `dsh-swarm`**——社区风格最主流、语义覆盖（路由+治理+团队）最完整、与"swarm preset"命名体系一致（preset id 已是 swarm）。

## 4. 包内结构（按 dsh-memory 先例）

```
dsh-swarm/
├── package.json          # name: dsh-swarm; dsh.bundle.patch: ./cordis.patch.yml
├── cordis.patch.yml      # insert: - id: dsh-swarm, name: 'dsh-swarm'
├── lib/
│   └── index.js          # 插件主体（v8 代码迁移 + 分层：config/circuit/limits/toolfilter/audit/protocol/tool）
├── README.md             # 中文说明（用户 GitHub 展示）
└── docs/                 # DESIGN.md / ARCHITECTURE-REVIEW.md / COMPARISON-REVIEW.md / MAINTENANCE-ROADMAP.md 移入
```

**挂载方式**：不是 bundle 而是 **preset 行**？——两种路径需确认：
- 路径 1（bundle）：profile.bundles 加 `dsh-swarm` → 全局挂载（泄漏到所有 preset，与 O1 冲突）
- 路径 2（preset 行）：swarm/agent.cordis.yml 加一行 `name: 'dsh-swarm'` → 仅 swarm preset 可见（**O1 正确路径**）

## 5. 待确认问题

1. 包名选 A/B/C/D/E 哪个？（倾向 A）
2. 挂载路径走 preset 行（推荐，O1）还是 bundle？
3. 仓库名与包名一致？（`dsh-swarm` 仓库 + `dsh-swarm` 包）
4. README 语言：中文主 README + English stub，还是双语？
5. 版本号起点：0.1.0（未发布）还是 1.0.0（dsh-memory 用 1.0.0）？
6. 是否把 model-router/ 目录整体改名/移动为 dsh-swarm/？（还是 dsh-swarm 作为子目录）
