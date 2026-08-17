# model-router demo 深度对比审查：dispatch v8 vs Kimi Code Swarm vs Claude Code Agent Teams

> 审查对象：swrmd-23/pkg-100（dispatch v8，运行中）
> 对比基准：Kimi Code Swarm（jishuzhan 源码解析文，2026-07）/ Claude Code Subagents & Agent Teams（官方文档）
> 方法：三方独立 explore 子代理审查（上下文/任务/工具/模型/并发/失败/生命周期/结果维度）+ 主代理汇总对照
> 日期：2026-08-17

---

## 1. 三方架构总览

| | **dispatch v8（本 demo）** | **Kimi Code Swarm** | **Claude Code Subagents/Teams** |
|---|---|---|---|
| 编排形态 | 星型：root 编排，成员不扩编（D28） | 主从式：主 Agent 拆解 + 批量派发 | ① subagent：一次性委派 ② Teams：leader + teammates 常驻 |
| 唯一入口 | `dispatch(type, prompt, {tier, persona, bg, output_schema, timeout})` | `AgentSwarm` 工具（prompt_template + items 批量） | Task/Agent 工具 + `/subtask` + `claude --team-leader` |
| 成员类型 | 5 类（explore/code/write/review/general）按 type 定边界 | subagent_type（默认 coder），**单批同型** | frontmatter 声明式（项目/用户/插件三级），可混合 |
| 模型路由 | tier 4 档钉死（lite/standard/pro/ultra） | 类型→模型固定映射 | 三级级联：调用参数→frontmatter→继承主 agent |
| 并发控制 | maxActive=8/maxTeam=16 硬上限 | 两阶段自适应（5 首发+700ms 爬坡→限速退避） | 无显式上限（Task 并行由工具层调度） |
| 状态/恢复 | continuable 常驻 + descriptor 冷恢复 | resume_agent_ids 断点续做 + agentId 上下文复用 | subagent 一次性无状态；teammate idle/active/left |
| 审计 | dispatch.log 结构化行（result/error/elapsed_ms） | 状态机 logRecord + XML 汇总 | Hooks（SubagentStop）+ 会话日志 |

---

## 2. 边界设计逐维度对比（重点）

### 2.1 定义边界（成员能力契约）

| | dispatch v8 | Kimi | Claude |
|---|---|---|---|
| 机制 | type 封闭白名单（5 类，代码内 TYPES 表），工具边界+role+默认档打包 | subagent_type 字符串（Zod 校验，默认 coder），单批统一 | frontmatter（name/description/allowedTools/model），Markdown 文件可版本控制 |
| 边界类型 | **程序级硬边界**（未知 type 硬失败） | 校验级（未知 type 运行时报错） | **声明式软边界**（描述驱动模型选择） |
| 评估 | 强：幻觉 type 无法产生无边界子代理 | 中：类型即配置，但单批同型限制编排 | 弱-中：契约清晰但依赖模型正确选择 |

**关键差异**：dispatch 的 type 是**安全轴**（决定工具边界，程序强制）；Kimi 的 subagent_type 是**能力轴**（决定模型+角色）；Claude 的 frontmatter 是**配置轴**（声明式、可审查）。dispatch 缺 Claude 的"配置即能力"可版本化特性，但换来运行时确定性。

### 2.2 上下文边界

| | dispatch v8 | Kimi | Claude |
|---|---|---|---|
| 机制 | spawn 全新会话，prompt 自包含（role+任务）；协议/人设目录仅 root | SwarmMode 提示词注入/回收（popMatchedMessage 优先回收，tool 触发不注入） | 硬隔离：全新 context window，不继承父历史；Teams 用共享 team-AGENTS.md 协调 |
| 边界类型 | 硬隔离 + 条件注入 | **软注入边界**（进入/退出管理） | 硬隔离（subagent）/ 文件协调（teams） |
| 评估 | 强：子代理零父上下文污染 | 精细：但 pop 失败时残留旧指令（栈顶限制） | 强但粒度粗：要么全给要么全不给，重复探索浪费 |

**关键差异**：Kimi 的**提示词生命周期管理**（进入注入/退出回收/兜底通知）是 dispatch 完全没有的维度——dispatch 的协议 section 是常驻的（root 永远看到），无"模式进出"概念。Kimi 的三触发源（manual/task/tool）与 autoExit 设计，值得 dispatch 借鉴为"swarm 模式开关"。

### 2.3 工具边界

| | dispatch v8 | Kimi | Claude |
|---|---|---|---|
| 机制 | allow 白名单（只读类型）+ deny 五工具（restrictableNames 过滤）+ maxDepth=3 服务层兜底 | 子代理类型自带工具策略 | allowedTools/disallowedTools frontmatter + skills 绑定 |
| 边界类型 | **程序级强制**（tools.restrict 硬过滤） | 未明确（类型定义内） | **声明式建议**（文档明示非沙箱，模型可能绕过） |
| 评估 | 最强：三层防线（白名单+deny+深度），官方机制背书 | 中 | 弱-中：GitHub Issue #68880 指出 disallowedTools 的 MCP 级限制缺失 |

**关键差异**：dispatch 是三方中唯一**程序级强制工具边界**的（官方 tools.restrict 机制，own 层豁免 report 工具）。Claude 明确承认"白名单是建议性而非强制性"。这正是 DESIGN.md"工具=安全轴，绝不靠 prompt 自述"原则的体现。

### 2.4 模型/成本边界

| | dispatch v8 | Kimi | Claude |
|---|---|---|---|
| 机制 | tier 4 档钉死 agentOptions（创建时写死，无路由监听器）+ 熔断（threshold=2/cooldown 60s） | 类型→默认模型映射 | 三级级联（参数→frontmatter→继承），CLAUDE_CODE_SUBAGENT_MODEL 全局覆盖 |
| 边界类型 | 成本轴硬约束 + 有界降级 | 静态映射 | 灵活级联（默认继承） |
| 评估 | 强：零运行时漂移；弱：**4 档实际只有 2 个模型**（lite=standard 同 flash，pro=ultra 同 pro），名存实亡；fallback 链仅 1 条 | 中：映射固定但不可运行时调整 | 弱-中：继承语义简单但换模型后工具能力差异可能致失败 |

**关键差异**：Claude 的级联解析是 dispatch 没有的维度——dispatch 是"显式档位"，Claude 是"默认继承+可选覆盖"。Kimi 文章未提熔断，其限流处理在调度层（并发退避）而非模型层。**dispatch 的熔断是三方唯一的前置成本防护**（Kimi 是事后退避，Claude 无）。

### 2.5 任务/批量派发边界

| | dispatch v8 | Kimi | Claude |
|---|---|---|---|
| 机制 | 单次单任务（fan-out 靠协议教 root 并行调用，isConcurrencySafe） | **AgentSwarm 批量**：prompt_template + items（≤128）+ 去重校验 + resume_agent_ids | Task 工具单任务；teams 按成员派发 |
| 边界类型 | 无批量协议（依赖编排者自律） | **模板化批量协议**（强） | 单任务协议 |
| 评估 | **最弱**：dispatch 缺 Kimi 的模板+items 批量参数、去重校验、resume 恢复协议。128 上限、模板占位符、批量去重都是 DESIGN.md 未覆盖的 | 最强：主 Agent 一次声明整批任务 | 中 |

**关键差异**：这是三方中 dispatch 差距最大的一维。Kimi 的 `prompt_template + items + resume_agent_ids` 是**确定性的批量协议**——主 Agent 只需给模板和条目，调度层负责展开、去重、恢复。dispatch 的 fan-out 完全依赖 root 在协议约束下"同一批调用"（软指导），无批量校验（如两任务 prompt 相同不拦截）、无批量结果汇总（XML summary）、无断点恢复协议（resume_hint）。**DESIGN.md P1 里的 `dispatch.batch(items[])` 正是为此预留，但未实现**。

### 2.6 并发边界

| | dispatch v8 | Kimi | Claude |
|---|---|---|---|
| 机制 | maxActive=8（事件配对计数）+ maxTeam=16（惰性计数）+ isConcurrencySafe | 两阶段：5 首发+700ms 爬坡 → 限速后容量收缩/指数退避（3s/6s/12s）/3min 恢复 | 无显式并发上限 |
| 边界类型 | 静态硬上限 | **自适应动态边界**（探测服务商限流阈值） | 无 |
| 评估 | 强：确定性防失控；弱：静态上限不感知供应商实际限流（8 对低配额供应商仍可能限流） | **最强**：不预知阈值，反馈驱动动态调整；弱：700ms/5 个为经验值、3min 恢复偏慢 | 弱：无防护 |

**关键差异**：Kimi 的**自适应两阶段调度**是 dispatch 静态上限的进化方向——dispatch 的 maxActive=8 是"我们自己定的天花板"，Kimi 的容量是"服务商限流反馈出来的实际能力"。二者哲学不同：dispatch 控成本（硬上限），Kimi 控效率（动态适配）。**理想是二者结合：dispatch 硬上限内套 Kimi 自适应调度**。

### 2.7 失败/重试/恢复边界

| | dispatch v8 | Kimi | Claude |
|---|---|---|---|
| 机制 | 失败协议（重试一次→改写→记录）+ summary 续写 + timeout + 熔断 | 限流重入队（保留 agentId 复用上下文）+ 单任务超时隔离 + 取消分级（aborted/started vs not_started）+ resume_hint | subagent 失败返回错误文本；无内置重试协议 |
| 边界类型 | 有限重试 + 显式记录 | **故障隔离 + 断点恢复**（最强） | 无 |
| 评估 | 强：绝不静默丢弃；弱：**无恢复协议**（子代理失败后无 agentId 续做概念，只能整单重派） | 最强：agentId 上下文复用 + resume_agent_ids + 取消分级状态 | 弱 |

**关键差异**：Kimi 的**恢复边界**是 dispatch 最大的结构性差距之一——dispatch 的一次性子代理失败后即弃（无上下文保留），Kimi 限流重入队保留 agentId 使同 Agent 上下文复用，取消时区分 started/not_started 供精确恢复。dispatch 的 continuable 模式（bg=true）其实具备恢复基础（send_message 续接），但**前台一次性的失败恢复协议缺失**（失败后没有"带原上下文的 resume"工具，只能重派新子代理）。Kimi 的 `<resume_hint>` 结构化引导也是 dispatch 没有的。

### 2.8 生命周期边界

| | dispatch v8 | Kimi | Claude |
|---|---|---|---|
| 机制 | 前台一次性（dispose）+ 后台 continuable（startContinuable/descriptor 冷恢复）+ maxTeam 惰性计数 | SwarmMode 三触发源（manual 持久/task 单轮/tool 工具内）+ shouldAutoExit | subagent 一次性无状态；teammate idle/active/left + 复用 |
| 边界类型 | 双形态（一次性+常驻） | **模式生命周期**（进出自动管理） | 一次性（subagent）/ 有状态（teams） |
| 评估 | 强：continuable 常驻+冷恢复是三方最完整的持久化；弱：**退役机制缺失**（只释放资源不释放 maxTeam 名额，长期会话撞上限）；进程重启即失（动态插件形态） | 中：模式开关精细但无成员级持久化 | 中：teammate 生命周期清晰但无冷恢复（进程重启成员即失？） |

### 2.9 结果/信息回传边界

| | dispatch v8 | Kimi | Claude |
|---|---|---|---|
| 机制 | 前台文本/structured 对象回传 + summary 续写（<200 字补充重试） | **XML 结构化汇总**：summary 统计 + 每子代理 agent_id/item/outcome + resume_hint | 自然语言最终回复（SubagentStop hook 可截获） |
| 边界类型 | 文本/JSON 双形态 | **结构化汇总协议**（最强） | 纯文本摘要（弱） |
| 评估 | 强：output_schema 服务层校验是三方唯一结构化契约；弱：无批量汇总视图（单任务视图） | 最强：批量统计+逐项明细+恢复引导一体 | 弱：摘要可能丢细节、无结构化 |

**关键差异**：Kimi 的 XML 汇总（`<summary>completed: 2, failed: 1</summary>` + 逐项 `<subagent>` + `<resume_hint>`）是**面向批量编排的聚合边界**；dispatch 的 output_schema 是**面向单任务的结构化边界**（更严谨——服务层 enforce 校验，Kimi 无 schema 校验）。二者互补：dispatch 缺批量聚合视图，Kimi 缺 schema 级校验。

### 2.10 部署/进程边界

| | dispatch v8 | Kimi | Claude |
|---|---|---|---|
| 机制 | 动态插件进程内存（重启即失）+ global 层注册（泄漏所有 preset，A1） | 内置产品功能（随 Kimi Code 发布） | 内置产品功能（随 Claude Code 发布） |
| 边界类型 | 实验形态（官方 O7 明示动态插件是实验） | 产品形态 | 产品形态 |
| 评估 | **最弱**：A1 是最大架构缺口——进程重启 dispatch 消失、无恢复 SOP、泄漏面超设计 | 强 | 强（Teams 需 git 环境，worktree 隔离是边界也是约束） |

---

## 3. 当前 demo 实现效果总评

**已达成（实测验证）**：
- 星型团队闭环：前台一次性、后台常驻（bg=y→continuable→list_agents→send_message 续接→settlement 全链路实测通过）
- 递归防护纵深：deny 五工具 + restrictableNames + maxDepth=3（官方机制背书）
- 成本轴完整：模型钉死 + 熔断 + 并发双上限 + timeout
- 输出契约：output_schema 服务层校验（三方唯一）
- 审计：结构化 result/error 行落盘

**结构性差距（对照 Kimi/Claude）**：
1. **无批量派发协议**（Kimi 的 template+items+去重+汇总，最显著差距）
2. **无恢复协议**（Kimi 的 resume_agent_ids/agentId 复用/取消分级）
3. **无模式生命周期**（Kimi 的 SwarmMode 进出/autoExit；dispatch 协议常驻无开关）
4. **无声明式成员定义**（Claude 的 frontmatter 可版本化）
5. **部署形态未定型**（A1：动态插件实验形态）

---

## 4. 边界设计评分表

| 边界维度 | dispatch v8 | Kimi | Claude | 说明 |
|---|---|---|---|---|
| 定义边界 | ★★★☆ | ★★☆☆ | ★★★☆ | dispatch 程序强制；Claude 可版本化 |
| 上下文边界 | ★★★☆ | ★★★★ | ★★★☆ | Kimi 提示词生命周期管理最优 |
| 工具边界 | ★★★★ | ★★☆☆ | ★★☆☆ | dispatch 程序级强制（三方唯一） |
| 模型/成本边界 | ★★★☆ | ★★☆☆ | ★★★☆ | dispatch 钉死+熔断；Claude 级联灵活 |
| 任务/批量边界 | ★★☆☆ | ★★★★ | ★★☆☆ | **dispatch 最大短板** |
| 并发边界 | ★★★☆ | ★★★★ | ★★☆☆ | Kimi 自适应最优 |
| 失败/恢复边界 | ★★★☆ | ★★★★ | ★★☆☆ | Kimi 断点续做最优 |
| 生命周期边界 | ★★★☆ | ★★★☆ | ★★★☆ | dispatch 冷恢复强；退役弱 |
| 结果回传边界 | ★★★☆ | ★★★★ | ★★☆☆ | Kimi 批量 XML；dispatch schema 校验强 |
| 部署边界 | ★★☆☆ | ★★★★ | ★★★★ | A1 未定型是最大风险 |

**平均**：dispatch ≈ Kimi ≈ Claude，但**短板分布不同**：dispatch 输在批量/恢复/部署，赢在工具强制/成本防护/输出契约。

---

## 5. 建议（按优先级）

**P0（当前 demo 最大风险）**：
1. **A1 部署形态定型**——建包 + swarm preset 静态挂载 + 恢复 SOP（官方 O1/O7 唯一正确路径）
2. **swarm 环境验收矩阵**——所有实测在 cordis 完成，须在 swarm preset 复核（A7）

**P1（对标 Kimi 的高价值增强）**：
3. **dispatch.batch**（DESIGN.md P1 预留）：`{type, prompt_template, items, resume_agent_ids?}` 批量协议 + 去重校验 + XML 风格批量汇总（summary + 逐项 + resume_hint）
4. **前台失败恢复**：一次性子代理失败时保留 session id 供 `send_message` 续做（借 continuable 机制），或返回 resume 提示
5. **取消分级状态**：记录 started/not_started（Kimi 取消语义），供 root 精确恢复

**P2**：
6. **SwarmMode 开关**（Kimi 三触发源/autoExit）：协议 section 从常驻改为可进出（降低常驻 token 开销）
7. **声明式类型定义**（Claude frontmatter 思路）：TYPES 表从代码硬编码 → settings.yaml 可编辑（与 D26-10 热加载合并）
8. **成本数据**：审计补 token 用量（A8）

---

## 参考来源

- Kimi Code Swarm 源码解析：https://jishuzhan.net/article/2075448969957351425
- Claude Code Subagents 官方文档：https://code.claude.com/docs/en/sub-agents
- Claude Code Agent Teams 官方文档：https://code.claude.com/docs/en/agent-teams
- Claude Code Agent SDK Subagents：https://code.claude.com/docs/en/agent-sdk/subagents
- DESIGN.md / ARCHITECTURE-REVIEW.md / NOTES.md（本仓库 model-router/ 目录）
