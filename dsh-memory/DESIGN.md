# dsh-memory 设计讨论（v1：项目级跨会话记忆 + 自动压缩 + Dream）

> 状态：讨论中，未定稿。本文档随讨论持续更新，定稿后再写代码。
> 参与：用户 + 开发 agent。
> 参考：[MiMo Code：将编程 Agent 扩展到长程任务（官方博客）](https://mimo.xiaomi.com/zh/blog/mimo-code-long-horizon)

## 0. 目标（v1，已与用户对齐）

一个 DSH 插件，参考 Mimo Code 的四层记忆架构，实现：

1. **项目级跨会话记忆**：每个工作区（workspace）一套独立的记忆文件，跨会话持久；不同工作区使用同一套流程、互不共享记忆（**不做 Global 记忆层**，v1 明确排除）
2. **会话级自动压缩**：token 阈值触发结构化 checkpoint（仿 Mimo cycle 的提前提取），与 DSH 既有 compaction **互补并行**——DSH compaction 管原始上下文裁剪，我们管结构化记忆写入与注入
3. **Dream 模式**：定时 + 手动触发，Host 直接 `llm.stream` 调用模型对记忆文件做合并/去重/路径验证/压缩
4. **History 回溯工具**：薄封装 `sessionQuery.searchEvents`，模型可按需搜索历史会话细节

- **形态**：先动态插件（cordis_define）迭代，机制稳定后建包/预设（与 model-router 相同路径）
- **GUI 面板**：留待后续版本
- **Distill**（固化重复模式为 skill/SOP）：v2

## 1. Mimo 机制 → DSH 映射

| Mimo Code | DSH 落点 | 说明 |
|---|---|---|
| History（SQLite 全量轨迹） | **原生已有**：`session/event` 事件流 + `sessionPersistence` + `sessionQuery.searchEvents` | 不重建，只做薄封装工具 |
| Project 记忆（MEMORY.md） | 项目根 `MEMORY.md` + `.dsh-memory/` 目录 | 可审查、可提交 git、随项目走 |
| Session 记忆（checkpoint.md，11 字段） | `.dsh-memory/sessions/<sid>/checkpoint.md`（**单文件覆盖式**，D14） | 结构化提取，Mimo 11 字段结构 |
| Cycle checkpoint（阈值阶梯） | `tokenMeter.measure` + `assistant/message` usage 锚点，默认 40/60/80%，每阈值一次 + 最终 gate（D19） | 提前于 DSH 压缩触发阈值，独立触发 |
| Writer subagent（独立提取者） | v1 用 Host 直接 `llm.stream`（不派子代理） | 决策 D4，见 §10 |
| Rebuild 注入（65K 分层注入） | 无 rebuild 概念；改为「`agent.inject()` 合成 dump（压缩后）+ recall reminder」，不常驻上下文 | Mimo 源码核实后的协议移植（§5.5/§5.6） |
| **无限上下文（cycle 链）** | **DSH 压缩原生保证**（pre-step 压力触发 + overflow 恢复，物理输入有界）+ **我们补结构化层**（提前提取 + 压缩后 dump 注入） | §5.6 机制对照 |
| 单写者不变量 | 插件代码强制：每文件唯一写入方 + 路径白名单 | 决策 D8/D9 |
| Dream（opt-in 周期整合） | `agent/created` 检查式调度 + `llm.stream` 整合；**默认手动**，`dream.auto` 显式开启 | 决策 D18（Mimo 同款） |
| 文件而非向量库（可审查性） | 全文件存储，无向量库 | 与 Mimo 一致 |

## 2. 已确认的机制事实（源码验证）

以下均来自 DSH 源码（`node_modules/@deepseek-ai/*/lib`），实现时以此为准：

1. **`systemPrompt.section({name, order, text|provider})`**：在**调用 context 的 scope** 注册；`text` 可为每次 assembly 求值的 provider；`renderPrompt` **丢弃空串 section**（无记忆时零开销）；section 引用 `{{variable}}` 由 renderPrompt 插值。agent 预设正是挂载进 agent scope context（`dsh-agent-presets` 拒绝挂进无 scope context），scope 层可沿父子链上溯（`chainLayers`）→ **在 agent scope 注册一次，子树 subagent 的 assembly 大概率自动继承（待实现时验证）**
2. **`agent/created` 事件**：payload `{agent}`；`Agent` 构造于 scope context（`constructor(ctx)`），即 `agent.ctx` 是 agent 的 scope context → 在 handler 里 `agent.ctx.systemPrompt.section(...)` 即按 agent scope 注册，agent 销毁时 scope 层自动 unwind
3. **`tokenMeter.measure(session)`** → `{totalTokens, surfaceTokens, nodes, logRevision, baseline}`：`totalTokens` 是当前请求+响应压力，`nodes` 是逐节点 token 定价 → checkpoint 阈值判定的依据
4. **DSH 自动压缩**（`BasicCompactionEngine`，`auto` 默认 true）：
   - `agent/pre-step` 瀑布内按压力阈值（`thresholdRatio`）调用 `compactIfNeeded(agent, 'pressure')`
   - `agent/request-error` 上处理 `context-window-exceeded` → `compactIfNeeded(agent, 'context-overflow')` → `{kind:'retry'}`
   - 压缩以**会话事件** `compaction/start` / `compaction/summary` / `compaction/end` 落盘（`start` 即 durable lock；summary 后紧跟替换 surface 的 `user/message`）→ 我们通过 `session/event` 监听即可，无需碰压缩实现
5. **`session/event(session, event)`** 事件类型：`turn/start`、`turn/end{reason}`、`step/start`、`step/end`、`user/message`（`source` 区分真人/注入/目标轮）、`assistant/message{usage}`、`tool/call{name,arguments}`、`tool/result{message,error?,meta?}`（`meta` 必须 JSON 可序列化，fs 工具携带 contextual diff）、`compaction/*`、`todo/write`、`request/header` … → checkpoint 提取与 history 工具的原始素材
6. **`llm.stream(GenerateOptions)`**：`{provider, model, messages, system?, tools?, temperature?, maxTokens?, stop?, signal?, sessionId?, purpose?}`；`purpose` 仅 `'compaction' | 'session-title'`（dream 调用留空）；产出 `StreamChunk`（block-start/text-delta/reasoning-delta/...）→ dream 与 checkpoint writer 的直接调用通道
7. **`sessionQuery.searchEvents({sessionId, query, filters, limit, cursor})`**：全文检索单会话事件（query 按数据解释，非 FTS 语法），返回带 `snippet` 的 hits；跨会话用 `searchSessions` → history 工具直接封装
8. **项目身份**：`session.header.cwd` 存在；`workspaceRegistry.resolveByPath(path)` → `{id, path(规范化), title, sessionIds}`（workspace 会过滤 cwd 不匹配的会话）→ 项目锚点解析顺序见 §4
9. **fs 沙箱**：`fs.writeText(target, content, expected?, signal?, sandboxPolicy?)` —— **不传 sandboxPolicy 时回退 `ctx.sandboxPolicy.resolve()`**（部署默认模式 + 默认 workspaceRoot），对任意项目目录的写入会被默认策略挡下 → 插件必须**显式传 `{mode:'workspace-write', workspaceRoot: <projectRoot>}`**，并自行保证只写记忆白名单路径（Mimo 同款「writer 只能写指定路径」模型）
10. **动态插件 host 半 ctx 是沙箱 façade**：只能访问 `inject` 声明的服务 + `ctx.on` / `ctx.provide` / `ctx.tools.register` / timer（inject 后）→ 插件声明 `inject: ['fs','systemPrompt','tokenMeter','sessions','sessionQuery','llm','agents','workspaceRegistry','timer']`（按需裁剪）
11. **`agent/turn-stopping`**（serial，turn 关闭前被 await）+ `turn/end` 会话事件（异步 fire-and-forget）→ checkpoint 落盘选异步路径，不阻塞 turn 关闭
12. **`harness.registerTool(ctx, tool)`**：注册模型可见工具；ToolExecution 携带调用方 agent（`exec.agent`）→ 记忆工具用 `exec.agent.session.header.cwd` 解析项目
13. **`agent/disposed`** 事件：agent 离开注册表 → 最终 checkpoint 与内存状态清理时机
14. **`agent.inject(message: UserMessage)`**（dsh-agent runtime-types）：向会话注入合成 user 消息的官方通道（file-change notices/AGENTS.md/skill content 同款，`user/message` 的 `source` 可区分）→ Mimo `insertRebuildBoundary`（压缩后记忆 dump）与 recall reminder 的注入载体

## 3. 架构总览

```
┌─ 存储层（每个项目一份，全文件，可审查）──────────────────────────────┐
│  <projectRoot>/                                                     │
│    MEMORY.md                          ← 项目记忆（dream/写门维护）    │
│    .dsh-memory/（gitignore）                                         │
│      sessions/<sid>/checkpoint.md     ← 会话 checkpoint（单文件覆盖） │
│      sessions/<sid>/notes.md          ← 主 Agent 自由 scratchpad      │
│      index.json                       ← 元数据（上次 dream 时间等）    │
│      dream.log                        ← dream 运行记录                │
└─────────────────────────────────────────────────────────────────────┘
┌─ Host 插件（生命周期钩子）───────────────────────────────────────────┐
│  agent/created        → 解析项目锚点 → 初始化会话状态（水位/队列）      │
│  session/event        → turn/end、compaction/*、user/message 调度      │
│  tokenMeter/usage     → 40/60/80% 阈值阶梯 → checkpoint 写入           │
│  compaction/start     → 并发写 checkpoint（与 summarizer 并行）        │
│  compaction/end       → agent.inject() 注入记忆 dump（§5.5/§5.6）      │
│  user/message         → 动态注入 recall reminder（§5.5）               │
│  agent/disposed       → 最终 checkpoint + 状态清理                    │
│  Dream（检查式调度）→ llm.stream 整合 → 原子写回 MEMORY.md             │
└─────────────────────────────────────────────────────────────────────┘
┌─ 模型工具与写门（经 exec.agent 解析项目）────────────────────────────┐
│  history_search / history_around / dream_now（仅模型无法原生替代的）   │
│  记忆读写：原生 read/grep/write/edit + tools/pre-execute 写门（§6）    │
└─────────────────────────────────────────────────────────────────────┘
```

## 4. 存储布局与项目锚点

### 4.1 项目锚点解析（按优先级）

1. 会话已挂到 workspace（`workspace.sessionIds` 含该 session）→ 用 `workspace.path`
2. 从 `session.header.cwd` 逐级向上找 `.git`（或 `MEMORY.md` / `.dsh-memory` 已存在）作为锚点
3. 兜底：`cwd` 本身

锚点解析结果缓存在插件内存（key=sessionId），`agent/disposed` 清理。

### 4.2 文件职责与单写者

| 文件 | 唯一写入方 | 说明 |
|---|---|---|
| `MEMORY.md` | Dream 整合 + 主 agent 经写门写（§6） | 项目持久知识：背景、用户规则、架构决策与理由、验证过的技术事实 |
| `.dsh-memory/sessions/<sid>/checkpoint.md` | 插件 checkpoint writer（**单文件覆盖式**，D14） | 11 字段结构化（Mimo 同款：当前意图、下一步动作、工作约束、任务树、当前工作、涉及文件、跨任务发现、错误与修复、运行时状态、设计决策、杂项） |
| `.dsh-memory/sessions/<sid>/notes.md` | 主 agent 经写门用 write 工具写（§6，D22） | checkpoint 时读取、逐条路由到对应字段后**重置为模板**（Mimo 语义：每条都经过判断，无论是否路由，D21） |
| `.dsh-memory/index.json` | 插件 | 上次 dream 时间、watermark（last_checkpoint_message_id）等元数据 |

> 注：Mimo 的 `tasks/<TID>/*.md` 依赖其 task 工具 DB（结构化任务系统）；**DSH 无对应工具**（`todo/write` 是 log-only 的 UI 状态快照，源码注明 "never derived history"）——v1 不设 tasks 目录，任务树从 `todo/write` 快照提取（与 Mimo 的差异记录于 §12）。

`.dsh-memory/` 整体建议加入项目 `.gitignore`（checkpoint/notes 含工具输出，可能有敏感内容，D13/R13）；`MEMORY.md` 是否提交由用户决定。

**写入路径白名单**：插件自身的 fs 写（memoryFs 封装）显式 `sandboxPolicy {mode:'workspace-write', workspaceRoot: projectRoot}` + 白名单（仅上表文件），越界直接拒绝（Mimo 的权限模型：代码层强制，不靠 prompt 自述）。containment 判定基于 `fs.resolve` 后的规范化路径（R1）。**模型侧写 MEMORY.md/notes.md 走普通 write/edit 工具 + `tools/pre-execute` 写门拦截**（§6），白名单语义见 §6。

### 4.3 MEMORY.md 区块结构

```markdown
# <project> 项目记忆

## 背景
## 用户规则
## 架构决策
## 技术事实
## 待验证 / 过时候选（dream 清理对象）
```

### 4.4 存储位置差异：Mimo 实际用 data 目录（源码核实，提请重决）

**已拍板的方案**是「项目内文件」（MEMORY.md + .dsh-memory/）。但 Mimo 源码（`memory/paths.ts` + `memory/service.ts`）实际把记忆放在 **`<data>/memory/`**（data 目录，如 `~/.local/share/mimocode`），布局：

```
<data>/memory/
  global/                       ← 全局记忆（跨项目）
  projects/<pid>/MEMORY.md      ← 项目记忆（pid = repo 绝对路径 sha256 前 12 位）
  sessions/<sid>/checkpoint.md  ← 会话 checkpoint（单文件覆盖式）
  sessions/<sid>/notes.md
  sessions/<sid>/tasks/<TID>/*.md
```

**data 目录方案的利弊**：
- ✅ 记忆（含工具输出摘编）**天然不进项目 git**——R13 的免费缓解，无需 gitignore 纪律
- ✅ 不污染项目目录；跨项目/跨会话统一根；FTS 索引集中在 SQLite
- ✅ 兼容导入 Claude Code 记忆（`parseCcPath` 读 `~/.claude/projects/<slug>/memory`，`memory.cc_index` 开关）
- ❌ 不随项目迁移/克隆走（pid 按路径哈希，换机器路径不同即失联）
- ❌ 用户需要知道 data 目录位置才能审查（可审查性打折，但文件仍可读可改）

**项目内方案的利弊**（已拍板）：
- ✅ 随项目走、可提交 git、审查即见
- ❌ checkpoint/notes 含工具输出，需要 gitignore 纪律（D13/R13）；对 git 仓库是噪音

**建议**：维持项目内方案（已拍板），但**记忆文件只放 MEMORY.md 一个在项目根，checkpoint/notes/index 全部放 `<项目>/.dsh-memory/` 并 gitignore**——即"项目内混合"：可审查的主记忆随项目，含敏感副产物的会话文件不提交。若你改主意要 data 目录方案，改动集中在 §4 存储层，其余设计不变。

写门只允许主 agent 写 MEMORY.md（`## ` 区块整块替换语义由写门 + 提取约束保证），禁止破坏结构。区块划分由 dream 维护。

### 4.5 用户与记忆的交互（审查补充 F-06：可审查性的落地路径）

| 动作 | 途径 | 说明 |
|---|---|---|
| **审查**系统记住了什么 | 直接打开 `<projectRoot>/MEMORY.md` 与 `.dsh-memory/sessions/*/` | 全部文件，无需任何工具；dream 输出格式（Consolidated/Updated/Deleted）与 dream.log 提供变更视图 |
| **修正/删除**记错的条目 | 编辑器直接改文件 | 下一次 checkpoint 的 writer 会读到修改后的内容（增量更新基础）；dream 快照比对保证不覆盖用户编辑（R5） |
| **禁用写入** | `memory.disable_write: true` | 读保留、写全关、自动注入停；随时可恢复 |
| **整体关闭** | `memory.enabled: false` | 插件不挂载任何钩子 |
| **彻底清理** | 删除 `.dsh-memory/` 与 `MEMORY.md` | 无残留元数据（index.json 仅 dream 时间/watermark，丢失无害） |

> 记忆系统的每个字节都是用户可读可改的普通文件——这是选文件而非向量库的根本原因（§1），也是上述交互全部成立的前提。

### 4.6 文件格式规范（实现规格，第五轮审查 FMT-01 补充）

**checkpoint.md**（每会话一个，单文件覆盖式；`## §N` 标题行与 `_斜体说明_` 行**永不修改**——Mimo 同款，校验器依赖）：

```markdown
# Session checkpoint
Topic: <≤80 字符一行摘要>          ← 校验器要求（缺失/超长 = error）
_sourceSeqRange: 123-456_          ← 插件写入，覆盖的事件区间（供 dream 交叉核对）
_last_checkpoint_message_id: <id>  ← watermark，只在 writer 成功时推进
## §1 Active intent
_最近用户请求逐字引用（block-quote），不得改写_
> "<用户原话>"
## §2 Next concrete action
_具体下一步；用户给了原话则逐字引用_
## §3 Directives (this session)
_仅本会话的工作偏好；项目级规则归 MEMORY.md，不重复_
## §4 Task tree
_来自 todo/write 快照；🔵/🔄/🟡/✅/❌ 状态_
## §5 Current work
_checkpoint 前正在做的事，含具体文件与代码位置_
## §6 Files and code sections
_正在读写文件，一行一个用途_
## §7 Discovered knowledge (cross-task)
_跨任务事实；MEMORY.md 提升候选；每条带 Why: 与 How to apply: 行_
## §8 Errors and fixes
_错误与修复，新的在前_
## §9 Live resources
_运行时状态（分支/未提交文件/进程）_
## §10 Design decisions and discussion outcomes
_讨论达成的决策与理由_
## §11 Open notes
_杂项（引用/未决问题）；宁可留空_
```

**MEMORY.md**（5 区块，dream 与写门共同维护）：

```markdown
# <project> 项目记忆
## 背景
_项目是什么、目标是什么_
## 用户规则
_用户显式给出的硬约束；精确值（DSN/端口/token/命令行）逐字节保留（D20）_
## 架构决策
_决策 + YYYY-MM-DD + 理由（dream Phase 4 要求）_
## 技术事实
_跨会话验证过的技术事实，带来源 [ses_xxx]_
## 待验证 / 过时候选
_无法验证的标 [unverified]；dream 的清理对象_
```

**notes.md**：`## [turn N · YYYY-MM-DDTHH:MM:SSZ]` 条目 + 防重复提示（"(see entry above)"）；checkpoint 时读取、逐条路由后**重置为模板**（D21）。

**index.json**：

```json
{ "version": 1, "lastDreamAt": 0, "dreamCount": 0 }
```

损坏时按"从未 dream"处理（重跑无害，FMEA）。

**预算**：checkpoint 总 11K / 分节（§8 budgets）；MEMORY.md ≤200 行/10KB；notes 读取侧截断 8KB（R12）。

## 5. 生命周期钩子（Host 半）

### 5.1 会话开始（agent/created）

1. 解析项目锚点；无锚点（cwd 不存在/无 git 且非 workspace）→ 该 agent 不启用记忆（静默跳过）
2. 初始化会话运行状态（内存）：水位、watermark、writer 单槽队列、**事件缓冲**（§5.3）
3. **检查式 dream 调度**：距上次 dream ≥ interval 且项目年龄达标 → 触发（§7.1）

> **recall reminder 不在 agent/created 注册**（修订，审查 A 类发现）：改为**每条 `user/message` 时动态判断注入**（§5.5）——「项目有记忆产物才注入」，会话中途产生记忆也能覆盖，且**不再依赖 agent-scope section 注册**（R2 的 scope 链风险随之降级为仅剩 dump 注入的目标 agent 解析问题，见 §5.5）。

### 5.2 checkpoint 触发（自动压缩）

两个独立触发源，统一入口 `writeCheckpoint(agent, reason)`：

- **阈值阶梯触发**（Mimo 同款，prune.ts）：`turn/end` 后测量，阈值默认 `["40%", "60%", "80%"]`（窗口 ≤200K 时 Mimo 默认 4 档 20/40/60/80）；**每个阈值只触发一次**；**最终阈值失败后简化重试**（审查 F-02）：不再做精确的 recovery gate 步进——失败后每跨过 `retryStepRatio`（默认 5%，即 80%→85%→90%…）或每 `fallbackTurnInterval` turns 重试一次，实现等价语义（retry budget = 剩余窗口）且实现简单
- **压缩联动（兜底而非常规路径，时序修订 T-04）**：阈值阶梯正常工作时，压缩发生时（≥80% 压力）80% 阈值早已触发且 watermark 已推进——checkpoint 已是最新。`session/event` 收到 `compaction/start` 时只做**落后检查**：watermark 落后于当前事件 seq（说明阈值链路故障/上次写入失败）才补写 checkpoint（与 summarizer 并行）；否则跳过。压缩后 dump 使用磁盘上压缩前最近一次成功的 checkpoint（§5.5），**不等**触发时刻的异步 writer（否则 dump 会读到旧快照或阻塞注入路径）

**watermark 不变量**（R5/R6 的 Mimo 解法）：checkpoint 头记录 `last_checkpoint_message_id`，**只在 writer 成功时推进**；模板只在文件缺失时写 → **失败 = 更旧的 checkpoint，永不缺失、永不半写**。写入异步 fire-and-forget（不阻塞 turn 关闭），**per-session 单槽队列 + 新者胜出**（pending 存在则被新请求顶替，范围超集防重复劳动）。

**测量兜底（审查补充 F-05）**：`tokenMeter.measure` 不可用或失败时，退化为**按 turn 计数触发**（`fallbackTurnInterval` 默认 20 turns 一次）——保证测量链路异常时自动压缩不失效。

**写后校验-重试（v1 简化，审查 F-02）**：writer 完成后跑校验器（结构：topic ≤80 字符、§1-§11 齐全且有序；预算：总 11K/分节；去重：跨 checkpoint Discovered 标题；**filler 检测**：`Next: continue/resume/keep going` 等占位词，Mimo 同款）。失败 → **最多 1 次反射重试**（只修列出的问题，其余内容不变）→ 仍失败则隔离改名 `checkpoint.invalid.md`（留现场）+ 下次阈值自然重试。预算超限（v1）→ **截断 + 头部 `⚠️ truncated` 标记**（dump 时附 `"Truncated at ~N tokens. Read(path, offset=L)"` 提示）；**spillover 主题拆分留 v2**（超限是小概率事件，截断+History 兜底已够用，审查 F-03）。expectedRevisions（用户指令必须出现在 MEMORY.md 的校验）依赖指令追踪机制，**列为 v2**（§12）。

### 5.3 checkpoint 内容来源

- `turn/end` 前的 `user/message`（**最近用户消息逐字切片**，逐字保留关键约束，防 writer 改写意图，R10）
- `tool/call` + `tool/result`（读文件、编辑、bash 执行、报错 → 「涉及文件」「错误与修复」；提取输入先过脱敏，R13）
- `assistant/message` 的 reasoning/结论（「设计决策」）
- `notes.md` 当前内容（路由到字段后清空）
- `todo/write`（「任务树」）
- 上一次 checkpoint 全文（增量更新基础）

checkpoint 头部记录 `sourceSeqRange`（覆盖的事件序列号区间，供 dream 与 History 交叉核对）。

**提取输入组装（事件缓冲，修订）**：插件为每个启用记忆的会话维护**内存事件缓冲**——`session/event` 监听器按序追加 `user/message`、`tool/call`、`tool/result`、`assistant/message`、`todo/write` 的**最小标量字段**（role/name/arguments/content 截断/error/meta 摘编，不保留完整消息对象），预算上限 `bufferMaxTokens`（默认 30K，超限从旧端丢弃——「保近期、摘要远期」）。checkpoint 触发时，writer 输入 = 缓冲内容（脱敏后）+ 上次 checkpoint 全文 + notes.md；**成功写入后清空缓冲**（与 watermark 推进同事务语义：失败不清空，下次阈值自然重试）。

> 进程重启/插件更新导致缓冲丢失（R3）：watermark 只覆盖"上次成功 checkpoint"，重启后缓冲为空 → 下次提取退化为「上次 checkpoint + 当前会话尾部」——**可接受降级**（结构化状态不丢，丢失的只是重启窗口内的事件细节，History 层仍在）。

**提取执行（v1 直调 llm.stream，输出协议修订 T-07）**：输入 = 自上次 checkpoint 的事件缓冲摘编（脱敏后）+ 上次 checkpoint 全文 + notes.md。**输出协议用"逐节更新 + KEEP 语义"而非"完整新文件"**——JSON 结构 `{sections: {"§1": "新内容" | "KEEP", ...}, memory_updates: [...], notes_reset: true}`：模型只需输出**发生变化的节**，未提及的节显式标 `KEEP` 由插件保留原文。理由：Mimo 的 writer 是子代理、用 Edit 只改变化的 section（保留性天然好）；直调模式若要求"输出完整新文件"，模型漏写任何一节都会造成**内容级静默丢失**（校验器只能查结构齐全，查不出"某条 §7 观察消失了"）。KEEP 协议把"模型漏写"从"丢内容"降级为"保持原样"，同时省 token（未变节不重写）。调用打 `purpose` 留空；provider/model 取自会话当前路由（R15 回退链），失败降级为「结构化摘要 + 原始事件摘编」纯文本写入（保证磁盘上永远有东西）。

### 5.4 会话结束（agent/disposed）

写最终 checkpoint（若水位内尚有未落盘状态）；清理内存状态；agent scope 的注册由 scope 自动 unwind。

### 5.5 注入协议（Mimo rebuild dump + recall reminder 的 DSH 落地）

**原则（Mimo 源码核实）**：记忆**不常驻**在每次模型请求里——只出现在两个时机：

1. **压缩/重建后 dump**（Mimo insertRebuildBoundary + renderRebuildContext 的移植）：`compaction/end` 会话事件后，向会话注入一条合成用户消息，内容：
   - 边界标记 + 记忆索引概览
   - **Session checkpoint**（全文，预算截断，超限附 `"⚠️ Truncated at ~N tokens. Read(<path>, offset=L)"`）
   - **Project memory**（全文，预算截断）+ **Recent user input (verbatim)**（FIFO、预算限制；取自事件缓冲，缓冲丢失时用 sessionQuery 按 seq 补拉）
   - **verify-before-act 文案**（R9 核心对抗）："Memory entries name functions, files, flags, paths — those are CLAIMS about a point in time when they were written. Verify before acting on a specific name."
   - "already loaded" 头：这些块已在上下文中，不要整文件重读，用 grep/工具定位细节
   - **消息格式（防被当指令执行）**：整条用 `<system-reminder>...</system-reminder>` 包裹 + 明确的 boundary 标记（Mimo 同款）——模型应视为上下文补充而非新任务
   - **注入 source（第三轮审查 T-02 修订）**：`agent.inject({id, role:'user', content, source:{kind:'plugin', plugin:'<pluginId>', form:'snapshot', sections:[...]}})`——`form:'snapshot'` 的命名 sections 结构正好承载 dump 的各个块（checkpoint/memory/notes/reminder），且这是插件注入的**官方认可形态**（`MessageSourceMap` 可扩展，`ContextFormed` 语义：snapshot 后到者取代先者——多次 dump 自然覆盖）
   - **dump 不等 writer（时序修订 T-04）**：dump 直接使用**磁盘上压缩前最近一次成功的 checkpoint**——这正是 Mimo rebuild 的语义（"将一路记下来的结构化记录变现"，而非压缩瞬间仓促生成）。compaction/start 的并发写降级为**兜底**（§5.2：watermark 落后于当前事件 seq 时才写）
   - **目标 agent 解析**：`session/event` 只带 session 对象——用 `agents.get(session.id)` 解析（v0.1 验证其对 root/subagent 的行为）；解析失败跳过本次注入（下一轮 reminder 兜底）
2. **recall reminder**（Mimo prompt.ts 移植，**降频修订 T-06 + 动态文案 W-03**）：注入轻量提醒——「本项目有记忆，开始相关工作时先读记忆文件；细节用 `grep` 在 `.dsh-memory/` 下定位；历史会话原文用 `history_search`。不要问用户记忆里已有的事」。**文案动态生成（走查发现）**：注入时 stat 项目记忆目录，按实际存在性列出——存在才写 `MEMORY.md`（项目规则/决策/事实）、存在才写**最新 checkpoint 的精确路径**（`.dsh-memory/sessions/<sid>/checkpoint.md`，按 mtime 取最新）——模型可直接 read，无需 glob 猜测；空记忆项目不注入（零开销）。**注入时机（修订）**：只在两种时机注入——(a) 会话**第一条真人消息**后（告知记忆存在与路径）；(b) `compaction/end` 后若 dump 注入失败/被跳过（兜底提醒）。**不再每条用户消息注入**：注入消息无论走 `agent.inject` 还是 pre-step 替换，都会作为持久 `user/message` 事件 append（源码核实：`for (const message of decision.messages) session.append("user/message", ...)`）——每条一注入就是上下文线性累积（N 条消息 = N×120 token）；而首次 reminder 已告知路径、dump 已带 already-loaded 头，反复提醒收益 < 成本（Mimo 每条提醒的语境是频繁 rebuild，我们无此频率）。**循环防护（T-01，必须）**：注入消息的 `source.kind` 为 `'plugin'`，监听器**只对 `source.kind === 'user'` 的真人消息触发注入**——否则注入消息自身回流为 `user/message` 事件，形成无限注入循环（源码核实：inject 的消息会作为 synthetic user/message 事件持久记录，`source` 是唯一区分依据）。

注入后记忆内容的刷新不依赖任何"每 assembly 求值"——下一次 dump 自然带上最新文件内容（§9.1 R4 的彻底解法）。

### 5.6 无限上下文：机制对照与实现路径（Mimo cycle/rebuild ↔ DSH compaction）

**Mimo"无限上下文"的三件套**（源码核实）：
1. **checkpoint 提前提取**（40/60/80% 阈值，writer 独立提取）——质量保证：在高压力下提取会退化，所以提前；
2. **rebuild 换窗口**（窗口满 → 切断、以持久化 checkpoint 为种子开新窗、插入 boundary 合成消息）——"逻辑会话是 cycle 的链，链没有最大长度"；
3. **history 兜底**（SQLite 全量轨迹，按需回溯）——压缩/提取丢的细节永远找得回。

**DSH 现状与本插件的映射**：

| Mimo | DSH 现状 | 本插件补什么 |
|---|---|---|
| checkpoint 提前提取 | 无结构化提取（压缩只有仓促 summary） | 阈值阶梯 checkpoint（40/60/80%，watermark 不变量）——**在 DSH 压缩触发之前**把结构化状态落盘 |
| rebuild 换窗口 | `compaction` 服务（当前部署已挂载，auto 默认开）：`agent/pre-step` 压力触发 + `agent/request-error` overflow 恢复，summary 替换旧 span——会话不会因上下文耗尽而死，物理输入始终有界 | 压缩后 dump（§5.5）：注入 checkpoint + 项目记忆 + 逐字用户消息 + verify-before-act——模型在压缩后看到的**不只是仓促 summary，而是提前提取的结构化状态**，等效 Mimo rebuild 的"新窗口种子"语义 |
| history 兜底 | 原生：sessionPersistence（JSONL 全量）+ sessionQuery（FTS） | `history_search` / `history_around` 薄封装 |

**结论**：等效"无限上下文"**可以实现**，且 DSH 的自动压缩是前提而非对手（D3 互补并行的正确性在这里得到印证）。与 Mimo 的差异：DSH 压缩保留近期 tail（`tail_turns`/`preserve_recent_tokens`），压缩后上下文 = summary + 近期原文 + 我们的 dump，占用比 Mimo rebuild 略高但**增长有界**；物理窗口上限不变（所有方案的共同约束）。

**关键实现细节——注入时机（v0.2 验证项）**：DSH 压缩在 `agent/pre-step` 瀑布内**同步**完成，而 `compaction/end` 是**异步** post-commit 事件——若只在事件里注入，模型当前 step 的请求已发出，dump 要下一轮才可见。精确解法：在 `agent/pre-step` 瀑布注册**并列 listener**，检测到刚完成的压缩（事件 seq / compactionId 前进）后，利用该瀑布的**消息替换能力**（"Reject a proposed step or replace the messages that enter it"）把 dump 附加进本 step 的输入——这是 Mimo `insertRebuildBoundary` 的精确等价物。需验证：并列 listener 与 compaction listener 的相对顺序、能否在瀑布内读到压缩结果；验证失败则接受"下一轮可见"（summary 本身已提供连续性，dump 是增强）。

## 6. 模型工具与写门（harness.registerTool + tools/pre-execute）

**工具面（v1 精简后，审查结论 F-01）**：记忆文件就在项目内（MEMORY.md 在根、checkpoint/notes 在 `.dsh-memory/`），**DSH 原生 `read`/`grep`/`glob`/`write`/`edit` 已完整覆盖"读、搜、写"记忆的能力**——不自建 `memory_search`（FTS 索引）/`memory_read`/`notes_append` 专用工具（那是 Mimo 的 data 目录布局的配套，其记忆在 SQLite 之外、文件多；我们项目内布局文件少，grep 足够）。v1 只保留模型**无法用原生工具替代**的三个：

| 工具 | 参数 | 行为 |
|---|---|---|
| `history_search` | `query`、`sessionId?`、`kind?`、`tool_name?`、`limit?`（默认 10 最大 50） | FTS 检索会话事件（sessionQuery 封装——原生工具面无此能力），返回 snippet（32 token 窗口）；0 结果引导换词或改用 memory 文件 grep |
| `history_around` | `message_id`、`before?`（5）、`after?`（5） | 以 message_id 为锚拉消息上下文，**输出上限 20KB**（引导 search→message_id→targeted Read） |
| `dream_now` | `reason?` | 手动触发 dream（后台执行，立即返回已接受） |

**写门（写权限的强制边界，Mimo memory-path-guard.ts 移植）**：模型写记忆 = **普通写工具 + `tools/pre-execute` 瀑布拦截**（Mimo 核心理念：守卫必须在所有写工具上，不靠新工具自封）。写门只拦截**模型工具调用**；插件自身的 checkpoint/dream 写入走 `memoryFs` 封装（§4.2，两层通道分离）。写门规则：

- **拦截面（第四轮审查 W-01）**：`write`、`edit`（当前部署工具面核实）+ **动态发现的写类工具**（实现时遍历 `tools.schemas()`，检测 schema 含文件写语义参数的工具名并入拦截名单，防未来新增写工具漏网）；`bash` 不在拦截面（Mimo 同款 prompt 纪律）——但 bash 的 `sandbox_permissions` 升级需要用户审批（工具描述确认），写门盲区有审批兜底
- 路径 `path.resolve` 后 containment（防 `..` 穿越与符号链接逃逸，R1）
- **主 agent（模型）写**：只允许 `<projectRoot>/MEMORY.md` 与 `.dsh-memory/sessions/<sid>/notes.md`（checkpoint.md 保留给插件 writer——Mimo 同款"任务文件保留给 writer"的 DSH 对应物）
- **子代理写**：与主 agent 同白名单（按调用方 agent 的 cwd 解析项目）
- `disable_write: true` 时：记忆树内所有写一律拒绝，拒绝文案明确「写已关，记忆仍可读，但不会自动加载；不要用其他路径重试」（防重试循环，Mimo 文案设计）
- 拒绝消息即纠正：给出合法路径列表 + "不要用其他路径重试"
- bash 不在覆盖范围（prompt 层纪律，Mimo 明示的取舍）

所有工具返回 JSON，量小（snippet 截断），失败返回明确错误码。

## 7. Dream 模式

### 7.1 触发（Mimo auto-dream.ts 移植）

- **默认手动**：`dream_now` 工具（未来 GUI 按钮）。`dream.auto: true` 才自动——**与 Mimo 一致，默认不自动**（R20 的 Mimo 解法，原"默认 7 天自动"作废）
- **自动（opt-in）**：任意 `agent/created` 时检查（进程内插件无持久定时器，检查式最可靠）：
  - `dream.auto === true` 且距上次 dream ≥ `interval_days`（默认 7）
  - **项目年龄门槛**：最早顶级会话距今 ≥ interval 才首次跑（防新项目空跑）
  - **防双跑**：`MIN_SPAWN_GAP_MS = 10s`（进程内）——两个会话同时触发时只有一个生效
- 上次 dream 时间存 `.dsh-memory/index.json`（Mimo 存 SessionTable，我们无此表）

### 7.2 执行（Host 直接 llm.stream，Mimo dream.txt 移植）

1. **输入组装（窗口 = 最近 7 天，总预算 `inputMaxTokens` 默认 50K，§8）**：
   - 近期 `checkpoint.md`（每会话单文件覆盖式，按 mtime 取窗口内最近 N 个，超预算从旧端截断）、当前 `MEMORY.md` 全文、`notes.md`（尾部 N 字符）
   - **不读全量历史**——"Do not read every file exhaustively. Prefer recent and repeated signals."
2. **验证阶段（R9 的核心防线，Mimo Phase 3）**：候选事实用 `sessionQuery.searchEvents`/`searchSessions` **对照原始轨迹验证**——只有「用户显式陈述 / 明确设计决策 / 跨会话重复证据」三者之一支持时才提升；验证引用路径用 `fs.stat`（Glob 等价物）
3. **整合（Phase 4）**：MEMORY.md 区块 Rules / Architecture decisions（**决策 + 绝对日期 + 理由**）/ Discovered durable knowledge / Patterns / Gotchas；合并去重；相对日期转 YYYY-MM-DD；**移除被新轨迹证明过时的条目**；每条 1-3 行；**保留来源 `[ses_xxx]`**
4. **修剪（Phase 5）**：**MEMORY.md ≤200 行/10KB 硬预算**；删除被取代/单会话相关/低信号条目；无法验证的标 `[unverified]`；验证函数/类名（grep 等价物）
5. **原子写回**：快照比对（启动时读入、写回前重读，任何人改过即放弃，R5）+ 原子写 + per-project 互斥锁（R11）
6. **输出与日志**：固定格式（Consolidated / Updated / Deleted / Skipped / Workflow candidates / Health）+ dream.log 记录输入规模与用量——可审查性

### 7.3 与 Mimo 的差异（记录在案）

- Mimo 用独立系统 Agent（真实会话，可审查可中断）执行 dream；v1 用 Host 直接 `llm.stream`（简化：不需要子代理审批链路，输入由插件组装，输出 schema 约束）。代价：dream 过程不可见、不可中断——v1 接受，dream.log 兜底
- Mimo 的「session 层观察稳定 → 提升到 project 层」在 v1 简化为：dream 整合时由模型基于多个 checkpoint 的重复出现判断哪些值得进 MEMORY.md，不做显式计数统计（验证阶段已按 dream.txt 移植）

## 8. 配置（settings 或插件 config，v1 先硬编码默认值 + settings 覆盖）

```yaml
memory:
  enabled: true
  dirName: .dsh-memory            # checkpoint/notes/index 所在（gitignore）
  disable_write: false            # 负向开关（Mimo 同款）：写全关、读保留、自动注入停
  allowOutsideWorkspace: true     # 允许以任意项目根为写门/memoryFs 的 workspaceRoot（R1）；false 时仅 workspace 内项目启用
checkpoint:
  thresholds: ["40%", "60%", "80%"]  # 阈值阶梯（窗口 ≤200K 时 Mimo 默认 20/40/60/80）
  reserved: 20000                 # 为 checkpoint 操作预留的窗口缓冲
  budgets: { checkpoint: 11000, memory: 10000 }  # 总 token 预算（v1 超限截断 + truncated 标记）
  bufferMaxTokens: 30000          # 事件缓冲上限（§5.3）
  fallbackTurnInterval: 20        # 测量不可用时的按 turn 兜底触发（F-05）
  retryStepRatio: 0.05            # 最终阈值失败后的简化重试步进（F-02）
  writerTimeoutMs: 120000         # writer/dream 的 llm 调用超时（FMEA）
dream:
  auto: false                     # 默认手动（Mimo 同款 opt-in）
  interval_days: 7
  window_days: 7                  # dream 回顾窗口
  maxLines: 200                   # MEMORY.md 行数硬预算
  maxKB: 10
  inputMaxTokens: 50000           # dream 输入总预算（§7.2 的 dreamInputMaxTokens 统一为此名）
modelOverrides: {}                # 可选：dream/writer 指定 provider/model，缺省用会话路由
```

## 9. 风险与未决问题（详细）

按类别分 A（安全与信任）/ B（正确性）/ C（生命周期与可靠性）/ D（成本与性能）/ E（运维）。每条含：场景、影响、严重度（影响 × 概率）、缓解设计、验证方式。

### A. 安全与信任

#### R1 显式 sandboxPolicy 覆盖部署策略（受信任 writer）

- **场景**：写门（§6）对所有写工具拦截记忆路径写入，需要以任意项目根为工作区（`{mode:'workspace-write', workspaceRoot: projectRoot}`），绕过部署默认沙箱模式（§2.9：不传时回退 `ctx.sandboxPolicy.resolve()`，默认 workspaceRoot 之外会被挡）。插件由此获得「以任意项目根为工作区」的写权限——这正是让记忆在非 workspace 项目里可用的前提，但也意味着插件代码本身成为信任边界。
- **影响**：若写门的路径校验有漏洞（`path.resolve` 后 containment 缺失、符号链接逃逸），一次写入就能落在项目根之外；更现实的场景是模型输出被直接拼进 write/edit 工具的路径参数。后果从「记忆文件损坏」到「任意目录被覆盖」不等。
- **严重度**：高（利用成功时）/ 低概率（resolve 后 containment + 白名单 + 单一写门，利用面小）。
- **缓解**（Mimo 源码核实后升级）：
  1. **写门在 `tools/pre-execute` 瀑布实现**（单一入口，覆盖所有写工具），containment 判定基于 `fs.resolve` 后的规范化路径——符号链接指向项目外的 `.dsh-memory` 被拒绝；
  2. 白名单按 agent 分策略：writer 精确白名单 / 主 agent 只 MEMORY.md + notes.md（D9）；
  3. 拒绝消息即纠正：给出合法路径 + "不要用其他路径重试"（防模型重试循环，Mimo 文案设计）；
  4. 插件自身写文件仍经 `memoryFs` 封装（显式 sandboxPolicy + resolve 后校验）；
  5. 文档明示这是「受信任 writer」决策；若部署策略不允许，配置项 `allowOutsideWorkspace: false` 退回「仅 workspace 内项目启用」。
- **验证**：v0.1 单元测试覆盖——白名单外路径、`../` 穿越、符号链接逃逸、`path.resolve` 边界均须拒绝；集成测试验证真实项目目录写入成功。

#### R9 记忆污染：一次坏写入毒化全部未来会话（跨会话放大）

- **场景**：会话 A 的模型在写 MEMORY.md 时写入幻觉/过时的「事实」（或 checkpoint 提升时把临时观察当成了稳定结论）。该条目进入 MEMORY.md，被后续会话的 dump/召回机制带给该项目此后每一个会话，持续影响后续所有决策。用户不主动读 MEMORY.md 就察觉不到。
- **影响**：错误架构决策、错误技术事实在多个会话间自我强化；这是记忆系统最危险的失效模式——Mimo 用「verify-before-act 文案 + dream 验证修剪 + 文件可审查」三层防线对抗。
- **严重度**：高（正确性）/ 中概率（模型写记忆是常态路径）。
- **缓解**（Mimo 源码核实后升级）：
  1. **verify-before-act 注入文案**（第一道防线）：dump 时附带"记忆条目是 CLAIMS，行动前用代码/工具验证"（D17）；
  2. **dream 提升前验证**（第二道防线）：候选事实对照原始轨迹——只有「用户显式陈述 / 明确设计决策 / 跨会话重复证据」支持才提升；无法验证标 `[unverified]`；条目保留来源 `[ses_xxx]`（D18 联动）；
  3. **写后校验**：discovered 条目强制 `Why:`/`How to apply:` 行 + 跨 checkpoint 标题去重（D16 联动）；
  4. **provisional 已砍除**（T-05）：写门无内容改写通道，v1 靠上述防线 + 文件可审查兜底；条目改写通道（内容标记）列为 v2；
  5. dream 显式清除被新轨迹证明过时的条目，删除动作全部记入 dream.log（可审查）。
- **验证**：v0.3 集成测试——写入伪造条目 → 断言新会话 dump 中该条目被标记或缺失；dream 后断言升格/删除符合预期。

#### R13 敏感内容进入记忆与注入链

- **场景**：工具输出常含密钥（env、token、内网路径）；checkpoint 输入包含 `tool/result` 原文，若提取时逐字复制，密钥会落在 `.dsh-memory/checkpoint.md`（磁盘）；`history_search` 的 snippet 会回显原文；压缩后 dump 若含密钥，则**随上下文发给模型供应商**。
- **影响**：密钥落盘 + 随 dump 外发 + 若 `.dsh-memory` 被误提交 git 则永久泄露。
- **严重度**：高（发生即严重）/ 中概率（bash/env 输出是高频操作）。
- **缓解**（Mimo 源码核实后修正，D20）：
  1. **区分来源**：「用户显式提供的精确值」（DSN/端口/token/完整命令行）逐字保存——可召回优先，Mimo EXACT-FORM 规则；「工具输出里出现的敏感内容」不逐字提取（只允许"引用了 env 中的 X 变量"这类指代）；
  2. 提取输入与 snippet 做常见模式脱敏（`sk-*`、`AKIA*`、`token=` 等正则替换为占位符）；
  3. 提供 `.dsh-memory/.gitignore` 模板（checkpoint/notes/log **默认不提交**；MEMORY.md 是否提交由用户决定，D13）；
  4. 存储位置备选（data 目录方案天然不进 git，§4.4）——若用户改选该方案，本条风险显著降低。
- **验证**：v0.2 集成测试——构造含假密钥的 tool/result → 断言 checkpoint 文件与 dump 中工具来源的密钥被脱敏、用户显式提供的精确值被逐字保留。

#### R5 dream 与活跃会话并发写 MEMORY.md（覆盖用户内容）

- **场景**：dream 运行期间（几十秒的模型调用）：用户正在编辑器里手改 MEMORY.md；或模型通过 write 工具写入新条目；或第二个 dream 被另一个会话触发。dream 的产物是「完整新文件」整体写回，任何并发修改都会被无声覆盖。
- **影响**：用户手写内容丢失——可审查性是本设计的第一原则，**覆盖用户内容会直接摧毁信任**；模型的写入基于旧快照，形成「写→被覆盖→再写」的反馈循环。
- **严重度**：高（信任）/ 中概率（dream 与活跃编辑并发是常态）。
- **缓解**：
  1. **快照比对（version check）**：dream 开始时读入 MEMORY.md 内容作为输入快照；写回前重读磁盘，与快照不一致（任何人改过）→ **放弃本次写回**，记 dream.log，下次重试；
  2. 原子写（临时文件 + rename）；
  3. per-project 进程内互斥锁（R11 同源）+ dream 触发 10s gap（Mimo 同款）；`dream_now` 手动触发时若项目有活跃会话，在日志中提示。
- **验证**：v0.3 集成测试——dream 输入组装后、写回前修改文件 → 断言写回被拒绝且文件保持用户版本。

### B. 正确性

#### R2 记忆可见性作用域（reminder 动态注入后降级为低危）

- **场景**（修订）：reminder 与 dump 均通过 `agent.inject()` 注入**当前会话消息流**（§5.5），不再依赖 agent-scope section 注册——「跨项目串味」的路径（全局 section 被其他项目会话看到）已不存在。残余风险：① subagent 与 root 共享 sessionID 时，注入消息会进入共享会话流（DSH 的 F37 等价隔离机制需确认——子代理是否能看到父会话的注入消息）；② dump 的目标 agent 解析（`agents.get(session.id)`）失败时注入丢失。
- **影响**：最坏情形是子代理看到父会话的记忆 dump（信息泄漏面 = 同一项目的另一会话，可接受）或注入丢失（功能降级，reminder 兜底）。
- **严重度**：低-中 / 低概率（机制变更后风险面收窄）。
- **缓解**：v0.1 探针验证注入消息在子代理侧的可见性（按 `delegationDepth` 过滤注入目标可作兜底）；注入失败静默跳过 + console 日志。
- **验证**：实现探针 + 单测断言。

#### R10 checkpoint 提取有损与增量漂移

- **场景**：11 字段提取是对事件流的**有损压缩**；checkpoint 采用「覆盖式增量更新」（每次重写整个文件），若 writer 某次遗漏了之前记下的观察，该信息**永久丢失**（不像 History 层还在，但结构化层丢了）；更隐蔽的是：writer 用自己的话改写用户意图（Mimo 明确在 rebuild 里保留「最近用户消息逐字切片」防的就是这个）。
- **影响**：会话恢复/压缩后对任务的重新理解出现偏差；静默发生，无报错。
- **严重度**：中 / 中概率（长会话多次增量后漂移累积）。
- **缓解**：
  1. checkpoint 保留**「最近用户消息逐字切片」字段**（原文引用，不许改写）；
  2. writer prompt 硬约束：所有用户约束逐字保留、禁止发明、遗漏宁可多写；
  3. checkpoint 头记录 `sourceSeqRange`（覆盖的事件序列号区间），dream 可据 History 交叉核对；
  4. 输入按「保近期、摘要远期」截断（R6 同源）。
- **验证**：v0.2 单测——构造含多条用户约束的事件序列 → 断言 checkpoint 中约束逐字出现。

#### R18 agent/created 覆盖所有 agent（含子代理、无 cwd agent）

- **场景**：`agent/created` 对**每一个** agent 触发（root、subagent、可能的 headless/API agent）。若不过滤：每个子代理都注册一份 section（重复、浪费，还可能因 section 同名抛错——§2.1 重复注册直接 throw）、checkpoint writer 被高频触发、无 cwd 的 agent 解析锚点失败抛异常。
- **影响**：注册风暴 + 异常毛刺 + 子代理各自写 checkpoint 造成磁盘噪音；最坏情况是插件整体 `apply` 报错。
- **严重度**：中 / 高概率（子代理是日常操作）。
- **缓解**：`agent/created` 处理器过滤——仅 `delegationDepth === 0`（无 `parentSession`）且锚点解析成功的 agent 进入注册流程；锚点解析包 try/catch，失败静默跳过并 console 日志一次；section 注册前先 dispose 同名旧注册（幂等，防更新残留）。
- **验证**：v0.1 单测——分别以 root/subagent/无 cwd agent 触发，断言注册数量与行为。

### C. 生命周期与可靠性

#### R3 动态插件进程内生命周期（重启/更新/停止即失）

- **场景**：动态插件活在 DSH 进程内：进程重启、插件 update（旧 fiber 先 dispose）、stop/undefine、开发期反复迭代——所有 `ctx.on` 钩子、scope section、工具瞬时消失；**记忆文件在磁盘上不丢**，但注入、checkpoint 触发、dream 调度全部停止。更新发生在会话中途时，会话水位（阈值进度、待写队列）也随 fiber 丢失。
- **影响**：会话中途记忆功能静默消失（模型调用 `history_search`/`dream_now` 得到「工具不存在」）；半写的 checkpoint 文件残留（原子写缓解）；迭代期这是必然高频发生的事件。
- **严重度**：中 / 高概率（迭代期 100%）。
- **缓解**：
  1. 所有文件写原子化（临时文件+rename），崩溃不产生半写文件；
  2. checkpoint 文件自描述（头含 sessionId、seq、时间），插件重启后对同 session 重新初始化时**覆盖式续写**，不依赖进程内状态；
  3. 注册幂等 + dispose 先于注册（防同名 section throw）；
  4. 稳定后建包/预设让每会话自动挂载（D1 的终点）；v1 期间文档写明「每个会话需要重新 run」。
- **验证**：开发期迭代即验证；v1.0 前补「重启后会话续写」集成测试。

#### R6 checkpoint writer 模型调用失败与降级

- **场景**：writer 的 `llm.stream` 调用失败：供应商故障、限流、会话结束中断、输出非合法 JSON、输入超长。
- **影响**：阈值点没有结构化 checkpoint → 之后若发生压缩，结构化状态缺失（提前提取的意义落空）；连续失败在每次阈值反复烧 token；降级写入的纯文本摘编结构化程度低。
- **严重度**：中 / 中概率。
- **缓解**：
  1. 失败后降级为「结构化摘要 + 原始事件摘编」纯文本写入（磁盘上永远有东西，宁可糙不可无）；
  2. 单次重试（指数退避）；失败记 console/dream.log；下次阈值自然重试（增量语义保证不重复劳动）；
  3. 输入按「保近期、摘要远期」截断上限（防输入超长）；
  4. 输出 JSON 校验失败 → 提示模型修复一次 → 再失败走降级路径。
- **验证**：v0.2 故障注入测试（mock stream 抛错/输出非法 JSON）。

#### R15 模型路由可用性（writer/dream 用什么模型）

- **场景**：writer 依赖会话当前路由（provider/model）；dream 可能在任意触发点运行（某会话的 agent/created 时检查到期）。若会话路由缺失（headless、配置未完成）、或触发的会话与目标项目不匹配，调用无从发起。
- **影响**：checkpoint/dream 静默失败，功能不稳定。
- **严重度**：低-中 / 低概率（正常配置下有路由）。
- **缓解**：回退链——会话路由 → `agentDefaultModel.currentSelection()` → `config.modelOverrides`；全失败 → 降级写入（R6）+ 日志。**会话路由的读取机制待定**（v0.1 探针）：`sessionQuery.readSession` / `request/header` 事件的 EpochHeader（含 route 信息？）/ `agentDefaultModel` 直读——三者择一，探针确认后固化。
- **验证**：v0.2 单测三个回退层级 + 路由读取探针。

#### R16 原子写崩溃残留与文件锁

- **场景**：进程在 temp 写入与 rename 之间崩溃 → `.tmp` 残留；Windows 上文件被编辑器占用时 rename 失败。
- **影响**：目录脏、写失败（低危）。
- **严重度**：低 / 低概率。
- **缓解**：temp 命名带 `.tmp` 前缀，插件启动时清扫 `.dsh-memory` 下残留 temp；rename 失败重试一次后报错。
- **验证**：v0.1 单测（模拟残留清扫）。

### D. 成本与性能

#### R4 注入与读盘的 token/缓存成本

- **场景**：记忆**不常驻**（§5.5 协议已从源头解决）：dump 只在压缩/重建后注入（有预算截断），日常仅**首条真人消息一次的 recall reminder**（~120 token，降频修订 T-06）与 dump 失败时的兜底提醒。残余成本：① reminder 每会话 1-2 条（远小于常驻注入，无累积）；② dump 的 token 预算（checkpoint 11K + memory 10K，Mimo 实测数值）；③ 压缩后注入的 dump 改变上下文前缀 → 供应商前缀缓存短时失效。
- **影响**：可控的固定成本；无每步开销。
- **严重度**：低 / 高概率（持续发生，但量级小）。
- **缓解**：budgets 硬上限（超限截断 + `"Truncated at ~N"` 提示）；reminder 动态判断（无记忆项目零注入，§5.5）；dream 维护 MEMORY.md 紧凑性（≤200 行/10KB，§7.2 第 4 条）；v1 前实测单会话成本。
- **验证**：v0.1 基准——100 步会话的 reminder 累加成本与 dump 峰值占用统计。

#### R17 tokenMeter.measure 是 O(surface)

- **场景**：`measure()` 每次克隆全部 surface 节点定价（§2.3 源码注：O(surface)）。若在**每个** turn/end 都测一次，200-turn 会话的累计测量成本是 O(n²) 量级；表面上看每步只多几 ms，长会话尾部会变得明显。
- **影响**：长会话尾部每轮延迟增长。
- **严重度**：低-中 / 高概率（长会话必现）。
- **缓解**：非每轮测量——仅当「上次测量已越过最低阈值水位」或「每 K 轮（默认 5）」时才测量；阈值判定用缓存值近似；若后续有更廉价的 surface 投影信号（`sessionProjectionCache`）则切换。
- **验证**：v0.2 基准——对比每轮测量 vs 降频测量的延迟。

#### R7 history 回溯成本与模型误用

- **场景**：模型调用 `history_search`：宽泛 query、大 limit、跨会话 `searchSessions` 全库扫描；返回 snippet 直接进上下文。
- **影响**：FTS 查询耗时阻塞 step；snippet token 成本；跨会话检索把**本项目其他会话**的原始内容带进当前上下文（功能上合理，但量要受控）。
- **严重度**：低-中 / 中概率。
- **缓解**：limit 默认小（10）、snippet 截断（~200 字符）、跨会话检索限定 `workspace.sessionIds` 范围 + 最近 N 天；工具 description 写清用法与成本提示；v0.3 实测单查询延迟。
- **验证**：v0.3 基准测试。

#### R12 notes.md 无界增长

- **场景**：模型经 write 工具自由写 notes.md（写门允许）；notes 只在 checkpoint 触发时被路由重置；长会话不触阈值 → notes 无限膨胀，且 dump 含 notes 内容 → 上下文成本随膨胀。
- **影响**：上下文与磁盘成本缓慢上涨。
- **严重度**：低 / 中概率。
- **缓解**（修订，对齐精简后的工具面 F-01）：**读取侧截断**——dump 对 notes 只取尾部 N 字符（默认 8KB），checkpoint 提取输入同理；磁盘侧由 checkpoint 重置（D21）自然回收；写门在拒绝文案中提示「notes 会在 checkpoint 时重置，保持精简」。
- **验证**：v0.1 单测——超长 notes 下 dump/提取输入只含尾部。

#### R14 checkpoint 文件随会话数累积

- **场景**：每会话一个 `checkpoint.md`（单文件覆盖式，会话内大小有界）；但项目长期使用后会话数增长 → 文件数增长；dream 只按 7 天窗口取近期文件，更早的 checkpoint 无人整合。
- **影响**：目录脏；dream 盲区（早期经验只在 History 层可寻）。
- **严重度**：低 / 高概率（时间必然）。
- **缓解**（修订，对齐 D14 单文件覆盖 + D18 窗口）：会话内无累积（覆盖式）；跨会话靠 dream 窗口机制（7 天）自然聚焦近期；可选清理：dream 运行后归档窗口外 checkpoint 至 `archive/`（不删除，History 层仍在）；保留期可配置。
- **验证**：v0.3 集成测试。

#### R20 dream 静默成本

- **场景**：`dream.auto: true` 时每项目每 interval 自动跑一次 dream（大模型调用，输入含近期 checkpoint）；多项目叠加；插件 `llm.stream` 不经过审批门。
- **影响**：成本账单意外；用户不知道跑了。
- **严重度**：低-中 / 低概率（默认手动，opt-in 后才有此风险）。
- **缓解**（修订，对齐 D18）：**默认手动**（`dream.auto: false`，Mimo 同款 opt-in）；项目年龄门槛 + 7 天窗口 + `inputMaxTokens` 上限 + `maxTokens` 输出上限；dream.log 记录每次输入规模与用量；auto 开启时在日志明示触发。
- **验证**：v0.3 日志断言。

### E. 运维

#### R11 同项目多会话并发（互斥与双跑）

- **场景**：同一项目并行开多个 GUI 会话：各自写独立 checkpoint 文件（无冲突）；但可能**同时触发 dream**（index.json 竞态、双倍 token）；两个会话同时写 MEMORY.md（交错丢失）。
- **影响**：dream 双跑浪费 + 写丢失（后者被 R5 的快照比对部分兜住）。
- **严重度**：中 / 中概率（并行会话是常态）。
- **缓解**：per-project 进程内互斥锁（dream 与写门写入均持锁）；index.json 原子写 + 版本字段；进程重启后锁自然释放（可接受）。
- **验证**：v0.3 并发集成测试（两个模拟会话同时触发）。

#### R8 llm.stream 的 purpose 未标记 dream/writer 语义

- **场景**：`GenerateOptions.purpose` 仅枚举 `'compaction' | 'session-title'`；我们的 writer/dream 调用留空 → 适配器/遥测把它们当普通会话调用对待（路由、计量、可能的特殊定价均无区分）。
- **影响**：遥测归因不准；错失供应商对辅助调用的特殊处理；成本归因难。
- **严重度**：低 / 低概率。
- **缓解**：留空 + 自记 dream.log（输入规模、用量）；后续向 DSH 提议扩展 purpose 枚举。
- **验证**：v0.3 日志核对。

### 严重度总览

| ID | 风险 | 影响 | 概率 | 一句话缓解 |
|---|---|---|---|---|
| R1 | 沙箱显式覆盖被利用 | 高 | 低 | realpath 校验 + 不可控路径段 + 单一封装 |
| R9 | 记忆污染跨会话放大 | 高 | 中 | verify-before-act + dream 验证 + [unverified] |
| R13 | 敏感内容进记忆/注入 | 高 | 中 | 提取脱敏 + gitignore 模板 |
| R5 | dream 覆盖用户内容 | 高 | 中 | 快照比对 + 原子写 + 版本号 |
| R2 | 注入消息的子代理可见性 | 低-中 | 低 | 动态注入后风险收窄；delegationDepth 过滤兜底 |
| R10 | checkpoint 有损与漂移 | 中 | 中 | 逐字用户消息 + 硬约束 + 校验-重试 + sourceSeqRange |
| R3 | 动态插件重启即失 | 中 | 高 | 原子写 + 自描述文件 + 建包终点 |
| R6 | writer 调用失败 | 中 | 中 | 降级写入 + 重试 + 下次阈值重试 |
| R18 | 子代理/无 cwd agent 风暴 | 中 | 高 | delegationDepth 过滤 + try/catch |
| R15 | 路由缺失 | 低-中 | 低 | 回退链 agentDefaultModel |
| R16 | 原子写残留 | 低 | 低 | 启动清扫 + 重试 |
| R4 | 注入/读盘成本 | 低 | 高 | mtime 缓存 + 截断 + 空串丢弃 |
| R17 | measure O(surface) | 低-中 | 高 | 降频测量 |
| R7 | history 回溯成本 | 低-中 | 中 | limit/snippet 限制 + 项目范围 |
| R12 | notes 无界增长 | 低 | 中 | 容量上限 |
| R14 | checkpoint 累积 | 低 | 高 | dream 归档/删除 |
| R20 | dream 静默成本 | 低-中 | 低 | 默认手动 opt-in + 预算 + 日志 |
| R11 | 多会话并发 | 中 | 中 | per-project 锁 + 版本号 |
| R8 | purpose 未标记 | 低 | 低 | 自记日志；提议扩展 |

## 9.1 Mimo 源码对策对照（2026-08-17 读码核实）

读了 `XiaomiMiMo/MiMo-Code`（`packages/opencode/src/`）的完整实现：`tool/memory-path-guard.ts`（写门）、`tool/memory.ts`（记忆工具）、`session/checkpoint.ts` + `checkpoint-templates.ts` + `checkpoint-validator.ts` + `checkpoint-retry.ts`（writer/校验/重试）、`session/auto-dream.ts` + `agent/prompt/dream.txt`（dream）、`session/prune.ts`（阈值触发）、`session/compaction.ts`、`tool/history.ts`、`memory/service.ts` + `paths.ts` + `write-gate.ts`（存储/搜索）、`config/config.ts`（配置 schema）。逐条对照我们的风险：

| 风险 | Mimo 源码实际对策（文件） | 我们的采纳 |
|---|---|---|
| **R1 路径/写权限** | **单一写门** `assertMemoryWriteAllowed` + `assertAgentWriteSandbox`（memory-path-guard.ts）：**覆盖所有写工具**（write/edit/apply_patch/notebook_edit，"cannot be bypassed by a widened write permission or a new write tool"）；`path.resolve` 后 containment（注释明确举例 `<worktree>/.mimocode/../src/x.ts` 逃逸）；**按 agent 分策略**：checkpoint-writer 只允许精确白名单（projects/&lt;pid&gt;/MEMORY.md、sessions/&lt;sid&gt;/checkpoint.md、notes.md、tasks/&lt;TID&gt;/*.md + spillover 变体），dream/distill 加 `.mimocode/`，主 agent 可写 memory 树但不能碰 `tasks/*`（保留给 writer）；**错误消息即纠正**（给出正确路径 + "不要用其他路径重试"防重试循环 + `disable_write` 专门文案）；`buildPath` 组件校验拒绝 `..`/绝对路径注入；明确承认 bash 不在覆盖（"trust the model, permission layer is a backstop"） | **采纳，升级我们的方案**：DSH 侧用 **`tools/pre-execute` 瀑布实现同款写门**（不只封装我们自己的 memoryFs——它拦不住主 agent 用普通 write/edit 工具写 MEMORY.md）；resolve 后 containment；按 agent 分策略（checkpoint-writer 白名单 / 主 agent 记忆树）；防重试文案 |
| **R9 记忆污染** | ① **verify-before-act 注入文案**（session/llm.ts:243："Memory entries name functions, files, flags, paths — those are **CLAIMS** about a point in time... Verify before acting"）② **dream Phase 3 提升前验证**（dream.txt："Promote a fact only when supported by an explicit user statement, a clear design decision, or repeated evidence across sessions"——用 SQLite 只读查询对照原始轨迹）③ **Phase 5 修剪**：删被新轨迹/代码证明过时的条目、无法验证标 `[unverified]`、条目保留来源 `[ses_xxx]` ④ 校验器强制 Discovered 条目带 `Why:` / `How to apply:` 行 + 跨 checkpoint 标题去重 ⑤ writer 的 **MEMORY.md canonical 去重**（D 编号规则已存在于 MEMORY.md 则删 §3 行）⑥ `validateMemory` 的 **expectedRevisions**（最近用户指令必须在 MEMORY.md 有对应文本） | **采纳 ①②③⑤⑥**；provisional 因无内容改写通道砍除（T-05），v1 靠「验证+修剪+CLAIMS 文案」三重防线（与 Mimo 一致），内容改写通道列 v2 |
| **R13 敏感内容** | **没有脱敏机制，立场与我们相反**：EXACT-FORM CONSTRAINT LITERAL 规则要求**逐字节保存**用户提供的精确值（DSN/端口/API token/密钥/完整命令行——"preserve the literal byte-for-byte"，可召回优先）；**缓解靠存储位置**（`<data>/memory/` 在 data 目录，不进项目 git）；`cc_index` 默认关（注释明示 "prompt-injection-vulnerable agent" 风险） | **部分采纳**：区分来源——「用户显式提供的精确值」逐字保存（采纳 Mimo）；「工具输出里出现的敏感内容」不逐字提取（保留我们的约束）；**存储位置差异提请用户重决**（§4.4） |
| **R5 并发写** | writer **1-slot 队列 + 新者胜出**（checkpoint.ts F40：pending 已存在则被新请求顶替，范围超集防重复劳动）；**watermark 不变量**：`last_checkpoint_message_id` 只在成功时推进 + 模板只在文件缺失时写 → **失败 = 更旧的 checkpoint，永不缺失**；dream 触发 `MIN_SPAWN_GAP_MS = 10s` 防双跑 + lastRun 查数据库；dream 是**系统会话**（标题 "Auto Dream" 入库，可审查可中断） | **采纳 watermark + 单槽队列**（替代我们"版本号"的粗粒度方案）；gap 防双跑吸收 |
| **R10 提取有损** | §1 Active intent **必须逐字引用用户请求**（writer prompt CRITICAL CONSTRAINTS）；rebuild 时 **Recent user input (verbatim)** 直接从 DB 取（FIFO + 预算限制，不依赖 writer 转述——"writer summaries paraphrase user commands, losing anchors"）；**写后校验**：结构校验（topic ≤80 字符、小节齐全/顺序）+ 校验失败 **quarantine**（改名 `checkpoint.invalid.md` 留现场）+ **反射消息重试**（只修列出的问题，其他内容保持不变）；**filler 检测**（`Next: continue/resume/keep going` 等）；任务树以 task 工具 DB 为唯一事实源、绝不发明 ID | **全部采纳**：§5.3 已含逐字字段；校验-重试循环补入 v0.2 |
| **R6 writer 失败** | 失败自愈不变量（同上 watermark）；**阈值阶梯每阈值只触发一次**，**最终阈值 recovery gate**（gate = 剩余窗口步进，"retry budget is the remaining window rather than a count"）→ 下一次阈值跨越是自然重试；validate-retry 循环；rebuild 等待 writer **有界**（`writerWaitMs` 超时用磁盘现有内容，timeout 与 failure 严格区分——慢 writer 不会禁用 checkpointing） | **采纳阈值阶梯 + gate + 有界等待** |
| **R20 dream 成本** | **`dream.auto` 默认 false**（手动 `/dream` 命令 + 显式 opt-in 自动）；**项目年龄门槛**（最早顶级会话距今 ≥ interval 才首次跑，防新项目空跑）；窗口 = 最近 7 天（不读全部历史）；**MEMORY.md ≤200 行/10KB 硬预算**；输出格式固定（Consolidated/Updated/Deleted/Skipped/Workflow candidates/Health）；系统会话可审查 | **采纳，修改我们的设计**：默认手动，auto opt-in（原设计"默认 7 天自动"作废）；年龄门槛吸收 |
| **R7 history 成本** | around 操作 **20KB 上限**（低于框架默认）+ 引导"search → message_id → targeted Read"；limit 默认 10 最大 50；FTS5 snippet 32 token 窗口；0 结果时给**升级指导**（换词/直接 grep/history 拿逐字） | **采纳**：history_search 增加 around 操作 + 引导文案 |
| **R11 多会话并发** | MIN_SPAWN_GAP_MS（dream/distill）+ writer 单槽队列 + 单写门统一 | 采纳（已有 per-project 锁；补 gap） |
| **R14 checkpoint 累积** | **v5 单文件覆盖式**：每会话只有一个 `checkpoint.md`（writer 每次覆盖、carry forward 旧条目），无编号无累积；超预算才产生 `checkpoint-<topic>.md` spillover | **采纳，修改我们的设计**：checkpoint 改为单文件覆盖（原 per-sessionId 多文件 + dream 归档的方案作废） |
| **R4 注入成本** | **不在每次 assembly 注入**：① rebuild 时才 dump（checkpoint/MEMORY/notes/global 全量或预算截断，每节 token caps + `"⚠️ Truncated at ~N tokens. Read(path, offset=L)"` 提示 + "already loaded" 头防重复 Read）② **每条用户消息后注入 ~120 token 的 recall reminder**（"This session has memory at ... Recall content not in your context with: memory.search / Read..." + "Don't ask the user about something memory may already record"）——**主动查询协议**，日常零占用 | **采纳，修改我们的设计**：放弃"每 assembly 注入摘要 section"；改为「压缩/重建后 dump（`agent.inject()`，§5.6 的 pre-step 同步注入为精确形态）+ 动态 recall reminder」（§5.5） |
| **R12 notes 增长** | notes 在 checkpoint 预算内；writer 每次 checkpoint **用 Write 重置为 NOTES_TEMPLATE 原文**（每条内容都经过判断，无论是否路由）；防重复提示（"add a short (see entry above) reference"）；filler 检测 | 采纳（模板重置与我们"路由后清空"一致） |
| **R2 作用域** | 无 scope 链概念：sessionID 共享 + **agent_id 切片隔离**（prompt.ts F37：subagent 的 message slice 按 agentID 过滤，防子代理看到父对话漂移）；**路径索引 SQL-scoped**（rebuild 的 memory keys index 只列当前 session/project+global，"other sessions' files are not leaked"） | 部分采纳：DSH 侧 scope 链仍须 v0.1 探针；路径索引泄漏防护吸收 |
| **R18 子代理** | `SYSTEM_SPAWNED_AGENT_TYPES = {checkpoint-writer, dream, distill}`；writer 触发 skip 条件含 system-spawned subagent（系统 agent 不写 checkpoint）；global/non-git fallback 项目有专门处理 | 采纳过滤思路 |
| **R17 测量成本** | 用模型 **usage 报告 + 预估**（无 O(surface) 重放测量问题）| 部分采纳：DSH 侧优先用 `assistant/message` 事件的 usage 锚点，`tokenMeter.measure` 降频 |
| **R3 生命周期** | 常驻 CLI 进程（不适用）| 维持：动态插件 → 稳定建包 |
| **R8 purpose** | 无对应概念（内部系统会话天然区分）| 维持：自记日志 |

**源码带来的三个架构级修正**（已体现到 §4/§5/§6/§7/§8/§10）：
1. **存储位置**：Mimo 实际把记忆放 `<data>/memory/`（data 目录，projects/&lt;pid&gt;/MEMORY.md，pid = repo 路径 sha256 前 12 位），**不是项目目录**——不进 git（R13 的天然缓解）、不污染项目；但不可随项目迁移。与我们已拍板的"项目内文件"冲突，**提请用户重决**（§4.4）。
2. **注入协议**：从"每次 assembly 注入摘要"改为"rebuild dump + recall reminder"（R4 的彻底解法）。
3. **checkpoint 单文件覆盖式** + watermark 不变量 + 写后校验-重试（R10/R6/R14 的落地形态）。

## 10. 决策记录

| # | 决策 | 理由 |
|---|---|---|
| D1 | 动态插件迭代 → 稳定后建包/预设 | 与 model-router 一致；机制未验证前不固化 |
| D2 | 存储：MEMORY.md 在项目根（可提交），checkpoint/notes/index 在 `.dsh-memory/`（gitignore）——「项目内混合」；data 目录备选见 §4.4。**2026-08-17 用户变更：MEMORY.md 移至 `.dsh-memory/MEMORY.md`**（全量随 `.dsh-memory/` gitignore；迁移由插件 `ensureMemoryMigrated` 复制完成，根旧文件用户手动删——fs 服务无删除 API） | 可审查性随项目走 + 敏感副产物不进 git（R13） |
| D3 | 压缩互补并行：DSH compaction 管裁剪，我们管结构化写入与注入 | 不碰主循环压缩实现，风险最小 |
| D4 | checkpoint writer 用 Host `llm.stream` 直调，不派子代理 | 简化链路；提取输入由插件组装可控 |
| D5 | dream 一次模型调用输出完整新 MEMORY.md（确定性重写） | 避免增量 patch 的状态漂移；失败可整体重试 |
| D6 | 注入 = **rebuild dump + recall reminder**（Mimo 协议），不常驻上下文 | 源码核实：Mimo 不在每次 assembly 注入；dump 只在压缩/重建后，日常仅 ~120 token 提醒（R4） |
| D7 | 不做 Global 记忆层；GUI 后置 | 用户拍板；多工作区隔离优先 |
| D8 | 写门：`tools/pre-execute` 瀑布拦截所有写工具对记忆路径的写（Mimo 单写门移植），路径 resolve 后 containment | 守卫必须覆盖所有写工具，不靠新工具自封（R1） |
| D9 | 单写者：checkpoint/tasks 只由 writer 写，主 agent 只写 MEMORY.md/notes.md | Mimo 同款：tasks/* 保留给 writer |
| D10 | 项目锚点：workspace → `.git` 上溯 → cwd 兜底 | 覆盖 GUI workspace 与纯 CLI 两类用法 |
| D11 | 检查式 dream 调度（agent/created 时检查到期），不依赖长驻定时器 | 动态插件重启即失，检查式最可靠 |
| D12 | ~~provisional 标记~~ → **v1 砍除，靠 Mimo 三重防线**（verify-before-act + dream 验证 + [unverified] 标记）：写门只能 allow/deny、**无法改写模型写入的 MEMORY.md 内容**（无内容改写通道），provisional 标记没有执行点（第三轮审查 T-05） | 防记忆污染跨会话放大（R9）；provisional 的内容改写通道列为 v2 |
| D13 | `.dsh-memory/` 建议 gitignore（checkpoint 含工具输出）；MEMORY.md 提交与否用户自决 | 防敏感内容进版本库（R13） |
| D14 | checkpoint 单文件覆盖式（每会话一个 checkpoint.md，carry forward）+ spillover 拆分 | Mimo v5 形态：无编号无累积（R14） |
| D15 | watermark 不变量：`last_checkpoint_message_id` 成功才推进、模板仅缺失时写 | 失败 = 更旧的 checkpoint，永不缺失（R5/R6） |
| D16 | 写后校验-重试：结构/预算/去重校验 → 隔离 `checkpoint.invalid.md` → 反射消息重试 | Mimo validate-retry：保证提取质量（R10） |
| D17 | verify-before-act 注入文案：记忆条目是 CLAIMS，行动前验证 | R9 的第一道防线（Mimo llm.ts:243 同款） |
| D18 | dream 默认手动，`dream.auto` 显式 opt-in + 项目年龄门槛 + 7 天窗口 | Mimo 同款：防静默成本与空跑（R20） |
| D19 | 阈值阶梯（默认 40/60/80%，每阈值一次 + 最终 gate）+ 降频测量 | Mimo prune.ts 同款：自然重试 + 控制测量成本（R6/R17） |
| D20 | 记忆条目区分来源：用户显式提供的精确值逐字保存；工具输出的敏感内容不逐字提取 | Mimo EXACT-FORM 规则与我们的脱敏约束的调和（R13） |
| D21 | notes.md 重置为模板（Mimo 语义：每条内容都经过判断，无论是否路由）；不设 tasks/ 目录（DSH 无 task 工具，任务树取自 todo/write 快照） | 与 Mimo 语义一致；消除无来源的目录结构（§12 审查发现） |
| D22 | v1 **不提供记忆专用读写工具**（memory_search/memory_read/notes_append）：记忆文件在项目内，DSH 原生 read/grep/glob/write/edit + 写门已覆盖；只保留模型无法替代的 history_search/history_around/dream_now | 功能不大于实用（F-01）：砍掉 FTS 索引与配套复杂度，模型经 reminder 指引使用原生工具 |
| D23 | v1 checkpoint 预算超限用**截断 + truncated 标记**（非 spillover 拆分）；校验-重试限 1 次；最终阈值用简化步进重试（非精确 gate） | 超限/失败是小概率事件，截断 + History 兜底够用；spillover 与精确 gate 留 v2（F-02/F-03） |
| D24 | **2026-08-20 P0 修复**：memoryFs 全部写入显式传 `{mode:'workspace-write', workspaceRoot: projectRoot}` | 实测 denial（`file access denied under workspace-write mode`）：agentless 调用的策略回退根≠项目根，默认解析被拒；§2.9/R1 设计本意落地（fs 契约第 5 参数运行时核实存在） |
| D25 | **2026-08-20 子代理过滤**：`header.origin==='subagent' \|\| delegationDepth>0` 的会话不参与记忆（不缓冲/不 checkpoint/不 reminder/dump；dream 拒绝子代理触发）；写门对子代理模型写仍生效 | mimo servesCheckpoint 对应物；实测 27 个会话目录 20 个是子代理噪音（3/4 writer 调用浪费）；字段持久化于 header（与 DSH 原生 subagent 判定同字段，dsh-subagent childSessionMeta 单一 stamp 点覆盖 spawn+fork） |
| D26 | **2026-08-20 协议注入拍板 ④c**：内存协议用 `systemPrompt.section()` 程序化注册（常驻、动态条件），不写 AGENTS.md（原生 dsh-agent-instructions 注入机制保留给用户/跨工具共享场景，README 文档化） | 护栏文本需常驻可见（mimo 同款系统提示词协议）；AGENTS.md 是用户拥有的文件，插件托管区块有冲突面 |
| D27 | **2026-08-20 原生重叠全量审计**：遍历 160+ `@deepseek-ai` 包 + base composition 挂载表——DSH 原生**无任何跨会话/项目级记忆**；易混淆项澄清：`dsh-session-checkpoint-policy` 是持久化落盘检查点（非内容记忆）、`dsh-agent-instructions` 是静态 AGENTS.md 注入、`sessionQuery`/SQLite FTS 是原始日志检索、原生压缩摘要是单会话内浓缩。全部优化方向的机制复用原生 API（fs/sandboxPolicy/systemPrompt/agent/session-start/sessionQuery/agents.header），无一需改 DSH 核心 | 不重复造轮子（用户指令）；审计结论写入 README 安装节与本报告 |
| D28 | **2026-08-21 writer 可靠性重构（P1 前置）**：① 输出协议 JSON → 纯文本 checkpoint markdown（JSON 键名精确匹配失败会静默产出全 (none)——`applyKeep` 对键差一个字符即落 `undefined→继承旧→首写为空` 分支；JSON 转义/提前停止对本地小模型均不可靠）② 解析改为节标题正则 + 继承语义（KEEP/空/缺标题 → 继承旧节；显式 (none) 视为有效清空；无 Topic 且无节标题 = garbage → 纠偏重试一次）③ **任何失败非破坏**：不动 checkpoint 文件、不清缓冲（旧 degraded fallback 会把最后好 checkpoint 覆盖成全 (none) 模板+新时间戳，压缩后 dump 即丢失全部 checkpoint 内容——实测发生）④ maxTokens 4096→8192 + `reasoningEffort:'off'`（dream 已验证该参数有效；writer 空输出 x2 疑为思考模式吃掉 content）⑤ 空缓冲跳过写入（时间戳不虚假进展）；阈值 skipped/queued 不标记 crossed（下次 turn/end 重试）⑥ dream 输出解析加代码围栏剥离（JSON 保留：dream 记录良好，结构化字段有日志价值） | 日志实证：3× JSON parse failed（outLen 1145-1697 提前停止）+ 1× empty x2 + 全 (none) checkpoint 被注入压缩上下文 |
| D29 | **2026-08-21 dump 扩展 ③**：compaction/end dump = Session checkpoint 11K（章节感知截断：先按比例切 body 保骨架，结构超预算则只留标题+检索指引）+ Recent user input (verbatim) 16K（独立 `st.recentUser` 列表，各条 ≤2K，**不随 buffer 清空**——buffer 在 checkpoint 成功后即空，dump 仍需逐字回放）+ Project memory 10K（章节感知）+ Session notes 尾部 6K + 恢复指令（直接接续、不致谢不复述，mimo rebuild dump 同款措辞） | mimo rebuild dump 区块预算表对应物；旧 dump 仅 ckpt+mem 两个简单 slice，压缩后模型丢失最近用户意图与便签 |
| D30 | **2026-08-21 协议注入 ④c 落地**：`systemPrompt.section({name:'dsh-memory-protocol', order:150})` 常驻段，文本**自条件化**（"若上下文出现 dump 则……"）——`AssembleContext` 只有 `scope`/`signal`，无会话信息，provider 无法按会话动态开关；代价：无记忆项目固定 ~250 tokens（可接受）；`systemPrompt` 用 `ctx.get` 可选获取（缺失静默跳过，不阻塞其余功能） | D26 拍板的实现形态；段内规则：dump=CLAIMS 行动前验证、可写白名单（MEMORY.md+notes.md）、history_search 指引 |
| D31 | **2026-08-21 dream.auto ⑤**：`agent/session-start`（`payload:{agent, source}`，`source==='startup'`）→ 非子代理 + 项目锚点 + `dream.auto`（默认 false）+ 间隔门（`index.lastDreamAt` 早于 `dream.intervalDays`，默认 7 天）+ 素材门（近期 checkpoint 或非空 MEMORY.md）→ `runDream(agent,'auto')` 后台触发（dreamLocks 防重）；新配置键 `dream.auto`/`dream.intervalDays` | mimo dream.auto 语义对应物（新会话启动检查式触发）；不用 dsh-schedule（墙钟提醒语义不符） |
| D32 | **2026-08-21 writer 思考策略（修正 D28④）**：实测发现本地 Qwen3 处思考模式——`reasoningEffort:'off'` 未透传至 llama.cpp，思考吃光输出预算（max_tokens=50 时 finish=length 且 content 全空），导致 writer 6/6 空输出。修正为**自适应**：初调保留思考（maxTokens 16384 容纳 思考+输出——实测思考 7118 字符 + 输出 648 字符，finish=stop）→ 仅当出现"思考吃光预算"签名（空输出 + finish=length）时重试追加 `/no_think`（Qwen3 按请求开关；只作用于该次插件后台调用，**主 agent 对话回路不受影响**）。dream 保持思考开启（整合判断任务思考有价值，16K 预算足够）。另将 writer 流收集改用 `collectStreamText`（补 block-end 交付形态 + finishReason 诊断） | 用户指正：不能把本地模型思考模式一刀切关掉；dsh-llm 层无 chat_template_kwargs/extraBody 透传通道，prompt 级 /no_think 是插件侧唯一开关 |
| D33 | **2026-08-21 writer 空输出根因 + 零文本重试规则（修正 D32）**：D32 上线后初调仍空输出，日志签名 `finish = [object Object]`。根因（独立 pi-ai 复现 + 请求日志代理取证）：① dsh finish chunk 的 `reason` 是 pi-ai 适配器 `mapStopReason` 返回的**对象** `{kind:'stop'\|'max-tokens'\|'error'\|'aborted', failure?}`，D32 的字符串比较 `=== 'length'` 恒 false → `/no_think` 兜底从未触发（`String(object)` 即日志里的 `[object Object]`）；② 排除项：pi-ai 请求构造（自定义模型 compat 自动探测 `maxTokensField=max_completion_tokens`、thinkingFormat=openai）与 SSE 解析（reasoning_content→thinking_delta、content→text_delta）独立复现全部正常（16384 预算：思考+文本+done，8.4s）；llama.cpp 对 max_tokens/max_completion_tokens 两种字段名都识别；流式 SSE 格式标准。修复：`collectStreamText` 将 finish 对象归一化为紧凑字符串（`kind[:failure.code]`）；重试规则改为**零文本签名**——初调零文本（思考吃光预算 / 模型提前停止 / EMPTY_RESPONSE 的统一签名，不依赖 finish 形状）→ 重试追加 `/no_think`；有文本但格式错 → 常规纠偏重试（思考保留） | 独立复现证明 模型+pi-ai+服务器 链路全正常，问题仅在 dsh chunk 形状与重试判定；零文本签名比解析 finish 形状更健壮 |
 | D34 | **2026-08-21 真正的空输出根因：dsh-llm 门面拒绝显式 reasoningEffort（修正 D28-D33 的 `reasoningEffort:'off'` 参数）**：D33 上线后日志首次出现可读签名 `finish = error:UNSUPPORTED_REASONING_EFFORT zeroText = true`——每次 writer 调用**毫秒级失败，从未到达模型**（usage 记录 `in:0/out:0/finish:None`、8090 无活动连接）。完整证据链：① llama-local 为手写声明路由（pi-ai 目录无此 provider），模型条目无 `reasoningEfforts` → `resolveModelReasoning` 物化 `reasoning: false` → adapter 模型信息无 `reasoning` 字段（`reasoningInfo` 对 `!model.reasoning` 返回 `{}`）；② **dsh-llm 门面规则（dsh-llm/lib/index.js L1274）：模型无 reasoning 能力声明时，任何显式 `reasoningEffort`（含 `'off'`）直接抛 `UNSUPPORTED_REASONING_EFFORT`**——主对话从不传 effort 所以正常，插件传了 `'off'` 所以全灭；③ 独立 pi-ai 复现：无 reasoning 字段的物化模型 `getSupportedThinkingLevels = ["off"]`，pi-ai 层本身支持 off——被拒发生在门面层，与 pi-ai/服务器无关。修正 D28-D33 的历史误判：v0.3.0 系列（D28/D32/D33）的全部空输出都是门面拒绝（`[object Object]` 即错误 chunk 对象），不是"思考吃光预算"；思考吃预算问题只存在于 v0.2.0（无 reasoningEffort 参数 + 4K 小预算时代），16K 预算已覆盖。修复：**writer 与 dream 调用彻底移除 `reasoningEffort` 参数**——省略后门面不校验、adapter 不发送 reasoning 字段、llama.cpp 按 Qwen3 模板**默认开思考**（16K 预算实测 思考 7118 字符 + 输出 648 字符，finish=stop），思考模式默认保留、`/no_think` 零文本兜底（D33 规则）不变。**教训：给手写声明（无 reasoningEfforts 声明）的模型传任何 reasoningEffort 都会被门面拒绝；要声明思考能力需在 settings 模型条目写 `reasoningEfforts`（如 `off:` + 各级 wire 值）** | D33 的可读 finish 签名 + usage 记录 in:0/out:0 + 门面源码 L1274 + adapter reasoningInfo 源码 + 独立 pi-ai 物化复现 |

## 11. 迭代路径

- **v0.1** ✅ 已完成（2026-08-17）：存储层 + 项目锚点 + 写门（tools/pre-execute）+ 最简 checkpoint（阈值阶梯 + 事件缓冲 + llm 提取 + 单次校验）+ recall reminder（动态注入）+ 机制探针（V-01/02/04/06 全部 ✅）；实测：写门拦截/放行、reminder 跨会话召回、writer 输出质量（逐字引用/KEEP 协议两次写入确认）
- **v0.2** ✅ 已完成（2026-08-17）：压缩联动（compaction/end dump 注入端到端 ✅ + compaction/start 兜底 + 压缩失败跳过注入 IM-07）+ 校验反射重试 + 空输出重试 + 测量兜底（F-05）+ 写门 CONFIG 化 + writer 全局并发上限 + pre-step 探针（V-05 部分 ✅：payload 结构确认、并列监听不干扰；"压缩结果可读性"待真实压缩时观察）
- **v0.3** ✅ 已完成（2026-08-18）：Dream 手动（`dream_now` 工具 + `/dream` 命令，llm 整合 + 原子写回 + 路径存在性验证 + 行数/KB 预算 + dream.log）+ `history_search`/`history_around`（sessionQuery 索引 + 持久化日志降级）+ **真实项目试用**（Oh-My-DSH 本仓，跨项目隔离待观察）
- **v1.0** ✅ 已完成（2026-08-18）：配置化（`.dsh-memory/settings.json` + `memory_config` 工具 + `/dshmem-config` 命令）、异常路径打磨
- **建包/预设** ✅ 已完成（2026-08-17 → 2026-08-20 修复）：正式包 `dsh-memory`，profile bundle 安装（`~/.dsh/profiles/web` pnpm 副本，非 symlink）
- **v1.1 P0** ✅ 已完成（2026-08-20）：① memoryFs 全部写入显式 `sandboxPolicy`（修 agentless 回退根≠项目根导致的 denial，D24）② 子代理会话过滤（`origin/delegationDepth` 不参与记忆，D25）。**双路径实测通过**：settings 写入 + 20% 阈值 checkpoint 落盘成功；子代理 `b41b5cda` 事件流过但零目录零注入
- **v1.2** ✅ 已完成（2026-08-21，live 验证通过）：writer 可靠性重构（纯文本协议 + 非破坏失败，D28；思考策略 D32→D33→D34：移除 reasoningEffort 参数——门面拒绝无 reasoning 能力声明模型的显式 effort——思考默认保留 + 零文本 `/no_think` 兜底）+ dump 扩展（四区块预算表 + 章节感知截断 + 最近用户逐字回放，D29）+ 协议段 ④c（`systemPrompt.section` 常驻自条件化，D30）+ dream.auto（`agent/session-start` opt-in + 间隔/素材双门，D31）。**live 验证（2026-08-21）**：writer 首次真实内容写入 ✅（threshold-20，初调一次成功，思考+输出装进 16K）、空缓冲跳过语义 ✅、非破坏性失败 ✅（多次）、protocol section 注册 ✅（4 次进程启动）；dream.auto 待新会话实测
- **v2**（backlog）：spillover 拆分、dream 证据预取（sessionQuery FTS + fs.stat 验证 + `[unverified]`）、GC/归档（sessionQuery.listSessions 对账）、同 step dump（`agent/pre-step`）、settings 迁移官方服务、expectedRevisions 指令追踪、watermark 完整实现、per-session 豁免

## 12. 深度审查（2026-08-17，全文档）

**审查方法**：通读全文档（570 行）做一致性交叉检查；关键机制对照 DSH 源码（`@deepseek-ai/*/lib`）与 Mimo 源码（`packages/opencode/src/`）复核可行性；逐条核对决策记录与正文引用。发现按 P0（一致性错误，必须修）/ P1（设计缺口，影响实现正确性）/ P2（细节问题）分类。**P0 与 P1 已直接修订入文**，本节记录发现、修订动作与遗留验证项。

### P0 一致性错误（已修订）

| # | 发现 | 修订 |
|---|---|---|
| C-01 | §3 架构图残留旧机制：`checkpoints/<sessionId>.md` 多文件布局、agent-scope section 注入、20/45/70% 阈值、section provider 自动刷新、timer 调度——与 D14/D6/D19/D11 决策矛盾；工具框重复两行 | 架构图整体重写（§3） |
| C-02 | §4.2 文件表 `checkpoints/<sessionId>.md` 与 D14 单文件覆盖式矛盾；"仅上表 5 个路径"与 4 行表不符 | §4.2 改为 `sessions/<sid>/checkpoint.md`（单文件覆盖），白名单表述对齐 |
| C-03 | R20 缓解写"v0.3 默认自动+日志"、配置名 `dreamEnabled`——与 D18（默认手动 opt-in）直接矛盾 | R20 重写，对齐 D18 与 §8 配置名（§9） |
| C-04 | §9.1 R4 行仍写"DSH 机制待验证：systemPrompt.context() 可行性"——`agent.inject()` 已在 §2.14 确认存在 | §9.1 R4 行更新为 agent.inject + pre-step 同步注入 |
| C-05 | tasks/ 目录无来源：DSH 无 task 工具（todo/write 是 log-only UI 状态，源码注明 "never derived history"），Mimo 的 tasks/<TID>/*.md 无法移植；§4.2/§6/D9 均引用 | 移除 tasks/ 目录；任务树改用 todo/write 快照；D9 修订；新增 D21 |
| C-06 | R12/R4 引用已废弃的"摘要注入"机制 | R12 改 dump 尾部截断；R4 引用修正（§9） |

### P1 设计缺口（已修订）

| # | 发现 | 修订 |
|---|---|---|
| G-01 | **checkpoint 提取输入来源未定义**："自上次 checkpoint 的会话事件"没有实现路径（进程内缓冲？重启恢复？） | §5.3 补事件缓冲设计：最小标量字段、`bufferMaxTokens`（30K）、成功写入后清空、重启降级语义 |
| G-02 | **提取输入无大小预算**：几十轮工具输出直接塞 llm.stream 会超长 | §5.3 缓冲预算 + 保近期摘要远期截断 |
| G-03 | **dump 消息格式未定义**：注入的 user 消息可能被模型当成新指令执行 | §5.5 补 `<system-reminder>` 包裹 + boundary 标记（Mimo 同款） |
| G-04 | **reminder 静态注册**：agent/created 时注册一次，会话中途产生记忆则漏注入；且依赖 agent-scope section（R2 高危） | §5.1/§5.5 改为**动态判断注入**；R2 随之降级（§9）。注：第四轮（T-06）进一步降频为「首条真人消息一次 + dump 失败兜底」（解决持久消息线性累积） |
| G-05 | **session→agent 解析路径未定义**：compaction/end 只有 session 对象，注入需要 agent 对象 | §5.5 补 `agents.get(session.id)`，失败跳过 + reminder 兜底（v0.1 探针） |
| G-06 | **会话路由读取机制未定义**（writer/dream 用什么模型）："会话当前路由"没有具体 API | R15 补三个候选（sessionQuery.readSession / request/header EpochHeader / agentDefaultModel）择一，v0.1 探针固化 |
| G-07 | dream 输入无总预算，7 天窗口内多个 checkpoint 全读可能超长 | §7.2 补 `dreamInputMaxTokens`（50K），超预算从旧端截断 |
| G-08 | 校验器清单缺 filler 检测、expectedRevisions 无实现路径 | §5.2 补 filler 检测；expectedRevisions 明确列为 v2（依赖指令追踪机制） |

### P2 细节（记录，不修订）

- 写门"checkpoint-writer 系统调用白名单"表述易与 memoryFs 混淆——已澄清两层通道（§6）
- §4.3 MEMORY.md 区块命名与 Mimo（Rules/Architecture decisions/Discovered durable knowledge/Patterns/Gotchas）不完全对齐——语义对应，dream 整合时按 D18 的 Phase 4 区块输出，v1 维持中文名
- §2.10 inject 列表可精简（`agents` 是否必需待探针后定）
- 跨进程并发（两个 DSH 进程同一项目）无文件锁——v1 接受（单进程 GUI），记录
- 记忆文件被恶意编辑时的指令注入风险——verify-before-act + 文件可审查为既有缓解，不新增

### 遗留验证项（实现探针清单，进入 v0.1/v0.2）

| # | 探针 | 验证什么 | 失败兜底 |
|---|---|---|---|
| V-01 | `agent.inject()` 调用与消息格式 | 签名、source 标识、模型对 system-reminder 包裹消息的行为；**UserMessage 手工构造可行性**（`createUserMessage` 不在动态插件 builtins——需手工构造 `{id, role:'user', content, source:{kind:'plugin', plugin, form:'snapshot', sections}}`，inbox 只校验 id 重复不校验格式，但需探针确认 `source` 各字段被正确消费） | `systemPrompt.context()` 或 pre-step 消息替换 |
| V-02 | `agents.get(session.id)` | session→agent 解析对 root/subagent 的行为 | 解析失败跳过注入 |
| V-03 | 注入消息的子代理可见性（R2） | subagent 是否看到父会话注入消息 | 按 delegationDepth 过滤注入目标 |
| V-04 | `tools/pre-execute` 写门 | 瀑布能否拒绝并返回纠正文案；write/edit 的路径参数可达性 | memoryFs 单层兜底（模型写不拦截，接受降级） |
| V-05 | `agent/pre-step` 瀑布并列监听 | **持久化语义已确认**（源码：decision.messages 逐个 append user/message）；剩余验证：与 compaction listener 的相对顺序（bundle 先注册 → 我们在其后，大概率有利）、能否在瀑布内读到压缩结果 | 接受"下一轮可见"（§5.6） |
| V-06 | 会话路由读取 | request/header EpochHeader 是否含 route；sessionQuery.readSession 可行性 | agentDefaultModel 直读 |
| V-07 | 事件缓冲 | session/event 各类事件的标量字段提取成本 | 降级为 sessionQuery 按 seq 拉取 |
| V-08 | `compaction/start` 时并发写 checkpoint | 与压缩锁/表面替换的并发安全性 | 改为 compaction/end 后写 |

## 13. 功能性审查（功能范围合理性，2026-08-17）

**审查方法**：站在实际使用角度做双重校验——「功能 > 实用」检查（每项机制问：用户真的需要吗？有没有更简单的等价物？砍掉会损失什么？）与「不够用」检查（每项核心价值问：最小可用闭环是否成立？缺了哪一环用户就用不起来？）。**6 项发现（F-01~F-06）全部已修订入文**。

### 过度设计（已砍/简化）

| # | 原设计 | 判断 | 修订 |
|---|---|---|---|
| F-01 | `memory_search`（FTS+BM25+scope 过滤）/ `memory_read` / `notes_append` 三个记忆专用工具 | **砍**：记忆文件在项目内、数量少（每会话 2 个文件），DSH 原生 read/grep/glob 已覆盖"读+搜"；FTS 索引是 Mimo 的 data 目录布局（文件在 SQLite 之外、量大）的配套，我们不需要；写门已覆盖"写"的约束 | 工具面精简为 3 个（history_search/history_around/dream_now），记忆读写走原生工具（§6，D22）；reminder 文案补路径与工具指引（F-04） |
| F-02 | 校验失败的多轮反射重试 + 最终阈值精确 recovery gate 步进 | **简化**：失败是小概率事件；多次重试的收益 < 复杂度（每次重试 = 一次 llm 调用 + 状态管理） | 校验重试限 1 次，仍失败隔离 + 下次阈值自然重试；最终阈值重试简化为"每跨 5% 或每 20 turns"（§5.2，D23） |
| F-03 | spillover 主题拆分（超预算拆文件 + 索引行） | **简化**：预算超限是小概率事件（Mimo 实测 11K/10K 预算下偶发），截断 + `truncated` 标记 + History 兜底已够用 | v1 截断标记；spillover 留 v2（§5.2，D23） |
| F-04 | （隐含）模型只能靠专用工具发现记忆 | 补：砍掉 memory_search 后必须让模型知道**查什么、怎么查**，否则记忆等于不存在 | reminder 文案含具体路径（MEMORY.md / .dsh-memory/sessions/*/checkpoint.md）+ 工具指引（read/grep/history_search）（§5.5） |

### 功能不足（已补）

| # | 缺口 | 影响 | 修订 |
|---|---|---|---|
| F-05 | 测量链路无兜底 | tokenMeter 不可用 → 自动压缩静默失效 | `fallbackTurnInterval`（20 turns）按 turn 计数触发（§5.2/§8） |
| F-06 | 用户交互路径未定义 | 可审查性是第一原则，但"用户怎么审查/修正/禁用/清理"没有落地方案 | §4.5 交互表：审查（直接开文件）、修正（编辑文件）、禁用（disable_write）、清理（删目录） |
| F-07 | v0.1 无压缩功能 | 迭代初期用户看不到核心价值 | 迭代路径重排：v0.1 含最简 checkpoint（阈值+提取+单次校验+watermark），第一版即可用（§11） |

### 保留的功能与理由（不砍的）

- **写门（tools/pre-execute）**：安全关键，无法用更简单方案替代（R1 的唯一强制边界）
- **dump + recall reminder 注入协议**：跨会话记忆的核心载体（R4 的彻底解法），不可砍
- **checkpoint 阈值阶梯 + watermark**：自动压缩的核心（40/60/80% + 失败=更旧），已是最简形态
- **事件缓冲 + 提取预算**：checkpoint 输入的唯一来源，必须有界（G-01/G-02）
- **history_search/history_around**：模型访问 History 层的唯一通道（sessionQuery 对模型不可见），薄封装成本低
- **dream（手动 + opt-in auto）**：记忆整理的唯一维护机制；默认手动已是最低成本形态
- **写后校验（1 次重试）**：提取质量的保底（topic/结构/预算/filler），实现成本低
- **verify-before-act + [unverified] + 来源标记**：R9 防线（provisional 因无内容改写通道砍除，T-05），均为文案级/标记级成本

### v1 最终功能面（交付清单）

**交付**：① 跨会话项目记忆（MEMORY.md 读写 + 写门约束 + 用户可审查）② 自动压缩（阈值阶梯 checkpoint + 压缩联动 + 压缩后 dump 注入 + recall reminder）③ Dream 记忆整合（手动 + opt-in 自动）④ History 回溯（search/around）⑤ 配置（settings）⑥ 机制探针结论回填。
**不交付（v2）**：spillover、memory_search FTS、Distill、GUI 面板、Global 层、系统会话形态 dream、expectedRevisions、指令追踪。
**明确不做**（非 v1/v2）：向量数据库、跨设备记忆同步、多进程文件锁（单进程 GUI 场景不需要）。

**结论**：v1 功能面 = Mimo 记忆系统的最小可用闭环（写入约束 → 结构化提取 → 注入召回 → 维护整合 → 历史兜底），每项机制都有不可替代的职责或明确的砍除理由；不再有"为了对齐 Mimo 而存在"的功能。

## 14. 深度审查（第三轮：机制源码复核 + 时序推演，2026-08-17）

**审查方法**：把文档中"已确认/已设计"的机制逐一回到 DSH 源码复核（`dsh-agent` inbox/runtime、`dsh-tools` 决策类型、`dsh-compaction-basic` 事件路径、`dsh-llm` 消息类型、`dsh-session` 事件定义），再对关键流程做时间线推演（注入循环、checkpoint↔compaction 时序、写入通道能力边界）。**5 项发现（T-01~T-05）全部已修订入文**。

### 机制复核结论（源码证据）

| # | 机制 | 复核结论 | 证据 |
|---|---|---|---|
| M-01 | `agent.inject` 不唤醒 agent | ✅ 确认：inject = "Queue model-facing context for the next pre-step **without waking the driver**"；idle 时挂起直到被唤醒——dump/reminder 不会打断会话 | dsh-agent runtime-types inject |
| M-02 | 注入消息会持久化并回流为事件 | ✅ 确认：inbox.append "durably record the insertion"；`user/message` 事件定义明确包含 "a synthetic `agent.inject()` context"，`source` 是唯一区分依据 | dsh-agent inbox.d.ts / dsh-session types |
| M-03 | 插件注入的官方 source 形态 | ✅ 确认：`MessageSourceMap` 含 `plugin{kind:'plugin', plugin} & ContextFormed`；`form:'snapshot'`+sections 的语义（后到者取代先者）正好承载 dump 的多块结构 | dsh-llm message.d.ts |
| M-04 | `tools/pre-execute` 可拒绝并给模型纠正文案 | ✅ 确认：`PreToolDecision = allow \| deny(reason) \| ask`——deny 的 reason 即模型可见的纠正消息 | dsh-tools index.d.ts |
| M-05 | `agent/pre-step` 可替换进入 step 的消息 | ✅ 确认：`PreStepDecision = reject \| enter{messages}`——§5.6 的同步注入方案机制成立（持久化语义留 V-05 探针） | dsh-agent runtime-types |
| M-06 | compaction 事件在自动路径同样发出 | ✅ 确认：`compaction/start`→`summary`→`end` 由统一事务路径 append（auto pressure / overflow 与手动共用），监听成立；压缩期间有 surface 稳定性断言（assertStable），插件只写文件不触 surface，无冲突 | dsh-compaction-basic |
| M-07 | 真人消息的过滤依据 | ✅ 确认：真人 = `source.kind === 'user'`；插件注入用 `'plugin'`——循环防护的判别式成立 | dsh-llm MessageSourceMap |
| M-08 | `createUserMessage` 不可用 | ⚠️ 动态插件 builtins 无 `createUserMessage`（dsh-llm 导出但插件无法 import）——需手工构造 UserMessage；inbox 仅校验 id 重复不校验格式，`source` 各字段消费行为留 V-01 探针 | dsh-llm / cordis-host-runner builtins |

### 时序与通道推演发现（已修订）

| # | 发现 | 场景推演 | 修订 |
|---|---|---|---|
| T-01 | **注入循环（必须修）** | reminder 注入的消息自身以 synthetic user/message 事件回流 → 若监听不区分来源，会无限自我注入 | §5.5：注入 source 用 `kind:'plugin'`；监听器**只对 `source.kind === 'user'` 触发**（M-02/M-07 证据） |
| T-02 | **注入消息的官方形态未用** | 文档只说"合成用户消息"，未利用 `MessageSourceMap` 的 plugin+ContextFormed 通道 | §5.5：注入消息改用 `{kind:'plugin', plugin, form:'snapshot', sections}`——dump 多块结构与官方语义对齐（M-03） |
| T-03 | **dump 可能读到旧 checkpoint（时序）** | compaction/end 后立即 dump，而异步 checkpoint writer（llm 调用）可能尚未完成 → dump 内容落后 | §5.2/§5.5：dump **不等 writer**，直接用压缩前最近一次成功的 checkpoint——这正是 Mimo rebuild 语义（"一路记下来的结构化记录变现"）；compaction/start 的并发写降级为 watermark 落后检查兜底 |
| T-04 | **compaction/start 并发写是冗余路径** | 阈值阶梯正常时（40/60/80% 在压缩前触发），压缩发生时 checkpoint 已最新；并发写只在阈值链路故障时有价值 | §5.2：改为"watermark 落后才写"的兜底，减少无谓的并发 llm 调用 |
| T-05 | **provisional 无落地通道（必须修）** | 写门只能 allow/deny，**无法改写模型写入的 MEMORY.md 内容**——"标记（待复查）"没有执行点 | D12/R9 修订：v1 砍除 provisional，靠 verify-before-act + dream 验证 + [unverified]（Mimo 同款）；内容改写通道列 v2 |

### 复核确认无问题的设计

- 事件缓冲字段提取（tool/result 的 `message.content[0]` 为 ToolResultBlock，含 text 与调用元数据——可提取）
- checkpoint 写入与 compaction 锁无冲突（插件只写文件，不触 surface；assertStable 只盯 surface）
- reminder 每用户消息一次（inject 进 next-step，单个 step 消费一次，不累积）
- pre-step 替换 messages 的机制成立（M-05），持久化语义留探针
- `SessionStartSource` 含 `'compact'`（压缩可触发 session lifecycle 事件）——不影响本设计，V 探针留意

## 15. 深度审查（第四轮：写面核查 + 直调模式机制弱点 + FMEA，2026-08-17）

**审查方法**：① 用 `Tool.listTools` 核实当前部署真实工具面，核对写门拦截面是否完整；② 对照 Mimo（writer=子代理）与我们的（writer=Host 直调）执行载体差异，检查移植机制在直调模式下是否失效；③ 走 agent-loop 源码确认 pre-step 替换的持久化语义；④ FMEA 式枚举失败模式。**5 项发现（W-01、T-06~T-09）已修订入文**。

### 写面核查（W-01）

- **核实**：当前部署模型工具面中能写文件的 = `write`、`edit`（`bash` 也能写但属已知盲区）。无 str_replace_editor/apply_patch/run_code 等额外写工具。
- **风险**：未来部署新增写类工具时，静态名单会漏网。
- **修订**：拦截面 = `write`/`edit` 静态名单 + **动态发现**（实现时遍历 `tools.schemas()` 检测写语义参数并入名单）（§6）。
- **bash 盲区的审批兜底**：bash 的 `sandbox_permissions` 升级（workspace-write/danger-full-access）会触发用户审批（工具描述确认）——盲区不是完全无界，用户在场时可见。

### 直调模式机制弱点（vs Mimo 子代理执行）

| # | 弱点 | 推演 | 修订 |
|---|---|---|---|
| T-07 | **覆盖式重写的信息保留**：Mimo writer 是子代理、用 Edit 只改变化节；我们若要求"输出完整新 checkpoint"，模型漏写任何一节 = 内容级静默丢失（校验器只能查结构，查不出"某条观察消失了"） | 直调输出改为**逐节更新 + KEEP 语义**：`{sections: {"§1": 新内容\|"KEEP", ...}}`，未提及节由插件保留原文 | §5.3：KEEP 协议（漏写降级为保持原样，同时省 token） |
| T-08 | **dream 验证的"材料边界"**：Mimo dream 子代理可自主跑 SQL/读文件；直调模式模型只能基于插件预取的材料"验证"——可能编造"验证通过" | prompt 硬约束"只基于提供的材料验证；材料未覆盖的候选一律标 [unverified]" | §7.2 验证阶段补此约束（本节记录，§7.2 已含 [unverified] 语义） |

### 时序/累积推演（agent-loop 源码核实）

| # | 发现 | 证据与推演 | 修订 |
|---|---|---|---|
| T-06 | **reminder 线性累积** | pre-step 返回的 messages 会被逐个 `session.append("user/message", ...)` **持久化**（agent-loop 源码：`for (const message of decision.messages) this.session.append(...)`）——无论 inject 还是 pre-step 方案，每条 reminder 都是一条持久消息：N 条用户消息 = N×120 token 累积。Mimo 每条提醒的语境是频繁 rebuild，我们无此频率（dump 已带路径信息） | §5.5：reminder 降频为**首条真人消息一次 + dump 失败兜底** |
| T-09 | **pre-step 方案的持久化语义** | pre-step 替换的 messages 会 append 持久化（同上）——意味着：① pre-step 注入同样产生回流事件（source 过滤对两种方案都适用）；② dump/reminder 持久化后可审查（与 Mimo boundary 消息一致） | §5.5 记录：两种注入载体均需 source 过滤；持久化是特性（可审查）非缺陷 |

### FMEA 失败模式清单（新增，进入测试计划）

| 组件 | 失败模式 | 用户感知 | 恢复路径 |
|---|---|---|---|
| llm.stream（writer/dream） | 挂起无超时 | checkpoint 队列卡死、后续阈值不触发 | **调用必须带超时**（`GenerateOptions.signal` + 插件侧 timeout，默认 120s）；超时按失败处理（R6 降级） |
| 事件缓冲 | 进程崩溃丢失 | 重启后提取退化（无重启窗口细节） | §5.3 已定义降级语义（可接受） |
| index.json | 损坏/半写 | dream 时间丢失 | 原子写 + 损坏时按"从未 dream"处理（重跑无害） |
| 写门 | 误伤正常项目文件写 | 模型写项目代码被拒 | 白名单精确到记忆树路径（resolve 后 containment）；测试覆盖"非记忆路径放行" |
| agent.inject | agent 已 disposed 后调用 | 抛错/静默失败 | 调用前 agents.get 判活 + try/catch 静默跳过 |
| dump 注入 | 与压缩竞争（事件序） | dump 内容落后 | 用压缩前最近成功 checkpoint（T-03 已修）；reminder 兜底 |
| dream 并发 | 双会话同时触发 | 双跑烧 token | 进程内 gap + per-project 锁（R11） |
| 测量不可用 | tokenMeter 失败 | 自动压缩静默失效 | fallbackTurnInterval 兜底（F-05） |
| 记忆文件被外部删除 | 用户清理 | checkpoint 丢失 | 下次写入重建模板（模板仅缺失时写）——不崩溃 |

### 与 model-router 插件的共存确认（W-02）

- 写门用 `tools/pre-execute`（全局瀑布）；model-router 用 `agent/request` 瀑布（模型路由）+ dispatch 工具（子代理工具面）——**无共享钩子，无冲突**。
- model-router 的 dispatch 子代理可能看不到我们的 `history_search` 等工具（其 toolFilter 决定）——可接受：记忆查询是主会话职责，子代理有项目工具即可。
- 两个插件的 `agent/created` 监听各自独立，无耦合。

**结论**：第四轮确认写门拦截面完整（含动态发现）、注入协议在两种载体下的持久化语义清晰（source 过滤是共同前提）、reminder 累积问题通过降频解决、writer 信息保留通过 KEEP 协议解决、失败模式全部有恢复路径。与既有插件（model-router）无冲突。

## 16. 深度审查（第五轮：窗口依赖 + 端到端走查 + 格式规格，2026-08-17）

**审查方法**：① 追踪 checkpoint 阈值的**分母依赖**（百分比相对什么窗口）到源码；② 对四个真实场景做端到端走查（首次会话/第二个会话/resume/多项目并行）；③ 补文件格式精确规范（从设计到实现规格的差距）；④ 配置项全量一致性核对；⑤ 注入内容安全边界确认。

### 窗口依赖核查（W-04，消除悬空依赖）

- **发现**：阈值是相对"模型窗口"的百分比（40/60/80%），但文档从未定义**窗口从哪来**——悬空依赖。
- **核查**：DSH 压缩自身用 `llm.resolveModelInfo(provider, model).context.contextWindow`（compaction-basic 源码：`const context = (await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal)).context`）。返回结构 `LlmResolvedModelInfo.context?: LlmModelContext {contextWindow: number}`。
- **结论**：checkpoint 阈值阶梯的分母**与 compaction 同源**——两条链路在同一标尺上取不同刻度（我们 40/60/80%，压缩 thresholdRatio），语义天然一致；`resolveModelInfo` 失败/无 contextWindow 时（无此容量信息的模型）→ 走 `fallbackTurnInterval` 兜底（F-05）。

### 端到端场景走查

**场景 1：新项目首次会话** → 锚点（无 workspace/无 .git → cwd 兜底）→ 首条真人消息：无记忆文件 → reminder 不注入（零开销）→ 40% 阈值 → writer（KEEP 协议）→ checkpoint.md 建立 → 压缩发生 → dump 注入（MEMORY.md 不存在则 dump 只含 checkpoint 部分）→ 会话结束最终 checkpoint。**发现（已修）**：dump/reminder 文案必须按文件实际存在性动态生成，否则提醒模型读不存在的 MEMORY.md（W-03，§5.5 动态文案）。

**场景 2：第二个会话（同项目）** → 首条真人消息：有 checkpoint → reminder 注入（含 MEMORY.md 路径 + **最新 checkpoint 精确路径**）→ 模型 read 恢复上下文 → 新会话独立 checkpoint 文件。**确认**：跨会话连续性 = MEMORY.md 提升（dream 负责），checkpoint 不跨会话串联——符合设计意图（Mimo 同款）。

**场景 3：resume（重启/续接）** → 同 sessionId → 缓冲空（进程重启，降级语义 §5.3）→ reminder（含自己 checkpoint 路径）→ 模型 read 恢复 → watermark 从 checkpoint 头读回。**闭环 ✓**。

**场景 4：多项目并行** → per-session 缓冲、per-project 锁、锚点各自解析、dream 各查各的 index.json；dump 注入时 `agents.get(session.id)` 解析到正确项目会话。**闭环 ✓**。

### 格式规格与配置核对（已修订）

- **FMT-01**：checkpoint/MEMORY/notes/index.json 的精确格式规范补入 §4.6（标题行/斜体说明行不可改、Topic 行、watermark 头、区块清单、index schema）——消除实现期歧义。
- **CFG-01**：`allowOutsideWorkspace`（R1 缓解引用但 §8 缺失）→ 补入配置。
- **CFG-02**：dream 输入预算命名不一致（§7.2 `dreamInputMaxTokens` vs §8 `inputMaxTokens`）→ 统一为 `inputMaxTokens`。
- **CFG-03**：FMEA 发现的 writer/dream llm 调用超时 → 补 `writerTimeoutMs`（默认 120s）。

### 注入内容安全边界（SEC-01，已知限制记录）

- 记忆文件内容（MEMORY.md/checkpoint）经 dump/reminder 进入模型上下文——若项目内文件被恶意内容污染（git 冲突合并、恶意 PR），注入携带指令。威胁模型：文件在项目内、用户自持、可审查（§4.5）；verify-before-act 文案部分缓解；Mimo 同样暴露此面（其 cc_index 注释亦明示注入风险）。**接受为已知限制**，不做额外对抗（防注入的完整方案超出记忆系统范畴）。

**结论**：第五轮消除窗口分母悬空依赖（与 compaction 同源）、四场景走查确认闭环并修一处文案动态化、文件格式达到实现规格、配置全量对齐、注入安全边界明确。

## 17. v0.1 实现记录（2026-08-17）

**探针结论（V 系列，全部验证）**：V-01 ✅ `agent.inject` 调用成功（消息持久化 + 下一 step 对模型可见——reminder 已被当前会话模型实际收到）；V-02 ✅ `agents.get(sessionId)` 全解析成功（root agent 上 sessionId === agent.id）；V-04 ✅ `tools/pre-execute` 参数在 `exec.arguments.file_path`（非 `exec.args`），`exec.agent.session.header.cwd` 可读；V-06 ✅ 路由 `agentDefaultModel.currentSelection()` + 窗口 `llm.resolveModelInfo().context.contextWindow`（实测 1M）；W-04 ✅ 与 compaction 同源。

**实现发现（IM 系列）**：

| # | 发现 | 处理 |
|---|---|---|
| IM-01 | **阈值必须窗口自适应**：固定 40/60/80% 在 1M 窗口下（=400K/600K/800K）短会话永远不触发；Mimo `defaultThresholdsFor` 对 >500K 窗口用 5% 阶梯 | 实现照抄 Mimo 逻辑（≤200K→4 档；≤500K→9 档；>500K→18 档 5%） |
| IM-02 | **validateCkpt 正则 bug**：`Topic:` 在文件第二行（`# Session checkpoint` 之后），`/^Topic:/` 永远匹配失败 → 所有正常输出被误 quarantine | 修复为 `/^Topic:/m` |
| IM-03 | **writer 间歇空输出**：llm.stream 单发与并发 4 发均正常（chunk 含 text-delta/reasoning-delta/usage/finish），主插件却多次 `length=0`——嫌疑集中在并发 writer 的 `id: 'mem-writer-' + Date.now()` 同毫秒冲突 + 输入结构不清晰 | 修复：id 加 sid 前缀；writer prompt 用 `<<<INSTRUCTION>>>` 强分隔 + 明确"只输出 JSON"；模型曾把指令文本当 §1 内容（.invalid 现场） |
| IM-04 | **writer 全局并发上限缺失**：多会话同时越阈值 → 多个 llm 调用并行（成本 + 限流风险） | v0.1 提前落地：全局同时 1 个 writer，其余跳过等下次阈值（v0.2 完整队列化） |
| IM-05 | `delegationDepth` 对部分 root agent 为 `undefined`（非 0） | 判定用 `(depth || 0) === 0` |
| IM-06 | 触发链路端到端验证通过：其他会话（不同项目/同项目）的 turn/end → 测量 → 阈值 → writer 全部跑通（日志可见 threshold-5/10/20/25） | 无 |
| IM-07 | **压缩失败时误注入 dump**：`compaction/end` 带 `error` 字段（压缩器找不到可压缩 span，"could not produce a useful summary"）时仍注入了 dump——上下文未变，注入造成"已压缩"误解 | 修复：`event.data.error` 存在时跳过注入（v0.2-fix1）；DSH 压缩失败本身是部署侧行为，checkpoint 兜底不受影响 |

**v0.1 验证状态**：写门拦截/放行 ✅、reminder 注入端到端 ✅（模型实际收到）、checkpoint 触发链路 ✅、writer 输出质量（修复后待验证）、KEEP 协议（第二次触发待验证）、agent/disposed 最终 checkpoint（待验证）。

**v0.2 验证状态（2026-08-17 补）**：
- **dump 注入端到端 ✅（用户实测）**：压缩命令触发 `compaction/end` → 插件注入完整 dump（Session checkpoint 11 节 + Project memory + CLAIMS 文案 + already-loaded 头）→ 模型下一 step 实际收到——"压缩后结构化状态注入"链路完整
- pre-step 探针（V-05 部分）✅：并列 listener 正常，payload 结构确认（`{turn, step, messages, agent}`），不干扰主流程；"压缩结果可读性"待真实压缩时观察
- compaction/start 兜底、校验反射重试、空输出重试、测量兜底、写门 CONFIG 化：代码就绪，随使用验证
- **KEEP 协议 ✅**：threshold-5 与 threshold-10 两次连续写入，第二次完整保留第一次的 §1/§2（日志 `checkpoint written` ×2 确认）
- 偶发空输出（threshold-15）：v0.2 加单次重试，待观察

**v0.3 Dream 实现记录（2026-08-17）**：`dream_now` 模型工具 + `/dream` 人类命令 + `runDream`（collectRecentCheckpoints 7 天窗口 → buildDreamInput（DREAM-INSTRUCTION + MEMORY.md + checkpoints + notes）→ llm.stream（reasoningEffort off）→ JSON {memory, paths, deleted, merged, health} → 路径 fs.stat 验证 → 快照比对（R5 写回前重读，不一致放弃）→ 原子写回 → index.json（lastDreamAt/dreamCount）→ dream.log 追加）。

- **端到端 ✅（用户 `/dream` + 模型 `dream_now` 均实测成功）**：`inputCkpts: 4`、deleted/merged 摘要、paths 存在性验证、MEMORY.md 16→20 行实质性整合（新增用户规则/技术事实/项目状态章节，来源标记 [ses_xxx]）
- **IM-08**：`FsInfo` 无 `mtimeMs`（只有 version/type/size）→ collectRecentCheckpoints 窗口过滤恒失败（inputCkpts=0）| 修复：checkpoint 写入时加 `<!-- ckpt-at: ISO -->` 内容时间戳行，dream 解析该行过滤，旧格式无戳全收兜底
- **IM-09**：`harness.defineTool` 输出 schema 校验严格（`value.project` must be string）| 修复：`project: result.project || ''`；成功路径 error 不能用 undefined/null（lossless JSON 校验 + schema 不支持联合类型）→ 单类型 `string` + 空字符串
- **IM-10（根因）**：deepseek-v4-flash（推理模型）对 dream 长任务**推理 32-117 秒后输出空文本块**（chunk 序列只有 reasoning-delta + finish，无 text block）→ `invalid dream output` | 修复：`reasoningEffort: 'off'` 关闭思考直接输出 JSON（Dream 只需结构化输出，无需推理）；同时 collectStreamText 优先 `block-end` 组装块、maxTokens 4096→16384 兜底
- 探针验证：`llm_probe`/`llm_probe2` 证明工具上下文内 llm.stream 正常、dream 输入本身可被模型正常处理（排除输入/上下文因素，锁定 reasoning 空输出）
- 待办：history_search/history_around 工具、真实项目试用（Super-Resolution-Simulation 跨项目隔离）、settings 配置化（v1.0）
- **IM-11（2026-08-17 用户变更）**：MEMORY.md 从项目根移至 `.dsh-memory/MEMORY.md` | `pathsFor.memory` 改指新路径；`ensureMemoryMigrated`（每个项目一次）在新路径不存在时复制根文件内容过去；写门白名单改放行 `.dsh-memory/MEMORY.md`（原根 MEMORY.md 无特殊规则）；fs 服务无删除 API，根旧文件由用户手动删除。迁移后 dream/reminder/dump 均自动走新路径（实测：迁移 + dream 在新路径整合成功，inputCkpts 5）
- **IM-12**：本部署 `sessionQuery` 索引配置 `openAt: "never"`（searchSessions/searchEvents/readEvent 全部抛 "session search is disabled"）| history 工具双路径：sessionQuery 优先，索引禁用时退化到 `sessionPersistence`（list + readFrom）顺序扫描（仅最近 30 会话、事件子串匹配 + snippet 定位）；实测 scan 路径跨会话命中 5 条、around 锚点窗口 6 条全部正确
- **IM-13**：工具输出 schema 校验严格要求所有声明字段为 lossless JSON——`hint: undefined`（有结果时）与 `project: null`/`error: undefined` 均触发拒绝 | 统一规则：声明字段永远给字符串（无值给 ''），布尔/数字给真实值，数组给 []
- **history 工具已实现（v0.3-history）**：`history_search(query, sessionId?, kind?, limit?)`（index/scan 双后端，snippet ≤400 字符，0 结果给引导文案）+ `history_around(sessionId, seq, before?, after?)`（seq 锚点，事件文本 ≤600 字符，总 20KB 上限）。参数按 DSH 事件模型以 `seq` 定位（设计稿的 message_id 概念对应实现为 seq）。实测：搜索命中用户首条消息原文、around 窗口含 runtime context/skill 注入事件

**v1.0 settings 配置化（2026-08-17）**：
- **机制**：DSH `settings` 服务的 `register` 需要 schemastery `z` schema（沙箱无 import，不可用）→ 改用**项目内 `.dsh-memory/settings.json`**（随项目走、可审查、per-project 独立），插件启动/项目初始化时解析合并 DEFAULTS（per-project 缓存）
- **配置项**：`memory.dirName`（写门目录名配置化——用户早期明确要求）、`memory.disableWrite`（负向开关：写全关/注入停/dream 拒，读保留）、`checkpoint.writerRetryOnce`、`checkpoint.fallbackTurnInterval`、`dream.windowDays/inputMaxTokens/maxLines/maxKB`（带范围校验）
- **入口**：`memory_config` 模型工具（get/set，点路径 key）+ `/dshmem-config` 人类命令（`/dshmem-config set dream.windowDays 14`）
- **验证 ✅**：get 返回默认配置；set windowDays 7→14→7 落盘生效；disableWrite=true 时 dream_now 被拒（错误文案明确）→ false 恢复；全部 CONFIG 引用改 per-project（写门 memDir 动态化、dream/writer/reminder 用 st.config）
- 注意：`dirName` 修改后新目录从零开始（旧 `.dsh-memory/` 数据不自动迁移，v1 文档说明）

**v1.0-budget（2026-08-17）**：checkpoint 11K 字符预算 + MEMORY.md 行数/KB 预算落地（设计 §8 budgets）——`applyBudget`（按行保留头部 + `⚠️ truncated` 标记行）/`applyMemoryBudget`（行数或 KB 超限截断，标记去重）；writer 写前截断（dbgLog 记录 before->after）；dump 注入检测标记附"完整细节用 history_search"提示；writer prompt 规则 6 明示 11K 上限。纯函数 6 项边界测试全过（不超限不变/超限截断带标记/空/边界/行数/KB/标记不重复）。

**建包（2026-08-17，dsh-memory v0.1.0）**：
- **包名：`dsh-memory`**（与文件夹同名；若 npm 被占用改 `@oh-my-dsh/dsh-memory`，改 package.json name + bundles 引用即可）
- **结构**：`dsh-memory/package.json`（type:module、peerDependencies @deepseek-ai/dsh-tools、`dsh.bundle.patch`）+ `cordis.patch.yml`（insert 插件行 `{id: dsh-memory, name: 'dsh-memory'}`）+ `lib/index.js`（ESM 具名导出 `{name, inject, apply}`；工具注册改用 `ctx.tools.register(defineTool(...))`——parameters 用 map 格式、output.schema 字段级 required）
- **挂载**：profile `package.json` dependencies（file: 本地路径）+ `dsh.profile.bundles` 加 `dsh-memory`；flat symlink `~/.dsh/profiles/node_modules/dsh-memory`（bundle 解析机制：healProfilesModuleFallback 维护的父目录 walk fallback，`dsh-app-boot` 源码核实）；包内 `node_modules/@deepseek-ai/dsh-tools` symlink 指向安装闭包（symlink-follow 从真实目录解析依赖）
- **验证 ✅**：`node --check` 语法；`import('dsh-memory')` 从 profile 目录解析成功（exports: apply/inject/name、inject 全列表、apply 函数）；**生效需重启 dsh 进程**（动态插件 dshmem-22 不持久，重启后自然消失，正式包接管；启用后若需修改直接改 `lib/index.js` + 重启，无需 cordis_define 迭代）
