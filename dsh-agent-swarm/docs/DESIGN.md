# model-router 设计讨论（v2：dispatch 主通道架构）

> 状态：定稿（v3 终稿 + 官方架构审查 O1-O9 修正，2026-08-17）。实现按动态插件迭代（swrmd-23 系列），稳定后建包挂 swarm preset。
> 参与：用户 + 开发 agent + pro 咨询顾问（deepseek-v4-pro，2026-08-15 晚）+ DSH 官方文档/源码审查（2026-08-17，见 ARCHITECTURE-REVIEW.md §0.5）

## 目标（v2）

一个 DSH 插件：实现 **agent swarm**——主 agent（root）自由编排不同**档位**（模型）+ 不同**工具边界** + 不同**人设**的 subagent。
**团队形态（D28 拍板）**：星型团队——root 带领 subagent 干活，**无多层结构**；成员不扩编（deny 五工具 + maxDepth=3）；档位分工：lite 做明确小任务 / standard 做较难任务 / ultra 做咨询与审查。

- **唯一入口：自定义 `dispatch` 工具**——`dispatch(type, prompt, { tier?, persona?, run_in_background?, output_schema? })`
  - `type` 决定工具边界（toolFilter 强制）+ 角色/输出约定 + **默认档位**（封闭白名单，未知类型硬失败）
  - `tier` 覆盖档位（成本轴自由，默认压成本）
  - `persona` 人设库 key 或自由文本（身份轴自由，插件确定性落地）
  - `output_schema` 结构化返回（仅前台 one-shot）
- **dispatch 即唯一路由权威（R13）**：模型在创建时由 dispatch 解析 tier → provider/model 写入 agentOptions 钉死；**无 agent/request 路由监听器、无 routing 表、无 label 匹配**（子代理无 selection 层，创建后模型不再被改写）；冷恢复由 descriptor 固化的 agentProvider/agentModel 权威重建
- **不用 DSH 内置 workflow（D14 + R12）**：部署形态 = 复制 standard 建 swarm preset，**preset 组成省略/disable 原生 `tool-subagent`/`tool-subagent-fork`/`tool-workflow`/`tool-ralph` 四行**（能力层硬关闭的唯一可行手段——`tools.restrict` 只过滤继承面，碰不到 scope 自己层的 preset 工具）
- **preset 保留白名单（M4 + D26）**：删四行时**必须保留** `tool-subagent-report`（continuable 子代理回报父级的唯一通道——`report` 由 runtime 装进子代理 own 层，**不得进 deny 名单**，restrict 对 scope-local 名抛错）与 `tool-subagent-control`（含独立行 `tool-subagent-list-agents`：`send_message`/`interrupt_agent`/`list_agents`——续接、退役、协调、枚举的基础）；**一并删 `workflow-worker-thread`**（删 workflow 后的孤儿行，无消费者；isolate 空域声明可留可删）
- 插件挂载 **preset 平面**（R9/Q1）：与 subagent/workflow/ralph 同 standing 层，不泄漏到未装插件的 preset
- 供应商接入复用 DSH 自带（`llm-pi-ai` + GUI Models 页），插件不管理供应商/key
- root 模型由用户 GUI 控制（不路由）；子代理按需分档
- 配置 settings.yaml 热加载；形态：动态插件迭代 → 稳定后建包

## 已确认的机制事实（源码验证，v2 修正）

1. `agent/request` 瀑布：payload `{agent, turn, step, signal}`，`next()` 拿建议配置，返回改写
2. **子代理无 selection 层**（v2 关键修正）：`installModelSelection`（`picked ?? logged ?? defaults`）
   **只在顶层 Web agent / headless 调用**；子代理创建链（`applyChildComposition`）不调用它。
   → 子代理的 `agent/request` 瀑布上**只有我们的路由插件一个改写者**
3. root 有 selection 层（最外层覆盖）→ root 不路由（D2），用户 GUI 控制
4. subagent label 持久化于 `subagent/descriptor`（version 2），是兜底路由 key
5. **`renderPrompt` 过滤空串**：text provider 返回 `""` 的 section 整段丢弃——条件注入（仅 root/仅 subagent）的官方手法（原生 `tool-subagent` 同款）
6. **子代理可靠判据**：`session.header.delegationDepth > 0` / `parentSession`（弃用 `origin`——presentation metadata，非证明，D17-5）
7. **AgentOptions 是 merge-extensible**：`assertAgentOptions` 只校验 maxTokens，自定义字段（如 `swarmRoute`）可穿透进 `agent.options`
8. `systemPrompt` 两种注入：`section()`（system 消息前缀，cache 友好，空串丢弃）vs `context()`（user-role 运行时快照，增量重发，`subagent:delegation` 即 context order 120）
9. 原生 subagent 工具参数仅 `description/prompt/run_in_background`（无 model/persona/toolFilter）——dispatch 是 `ctx.subagents` 的带糖 facade
10. `ctx.subagents.start()`（one-shot，支持 outputSchema）vs `startContinuable()`（常驻，无 outputSchema，需 sessionPersistence）
11. 降级：`agent/request-error` 返回 `{kind:'retry'}`；DSH 自带 llm-retry（重试），跨供应商降级由我们管

## 架构总览（v3：dispatch 唯一路由权威）

```
┌────────────────────────────────────────────────────────────────┐
│ 用户 ↔ root（GUI 选模型，协议注入 order -98 + 人设目录 order -90）│
│                                                               │
│  dispatch(type, prompt, {tier?, persona?, run_in_background?}) │ ← 唯一入口/唯一路由权威
│    ├─ type    → toolFilter（工具边界，创建时强制，knownNames 过滤）│
│    │         + role 文案（拼进 prompt）                          │
│    │         + 默认档位（成本默认）                             │
│    ├─ tier    → 覆盖档位（查熔断）→ agentOptions{provider, model}│
│    ├─ persona → 人设库 key→全文 或 自由文本 → request.persona   │
│    └─ bg      → startContinuable（常驻成员，返回 subagentId）   │
│                 / start（前台一次性）                           │
│                                                               │
│  模型在创建时钉死：无 agent/request 路由监听器（R13）            │
│  冷恢复：descriptor 固化的 agentProvider/agentModel 权威重建    │
│                                                               │
│  人设库目录（swarm:persona-catalog，order -90，仅 root 摘要）    │
│  + 熔断/fallback（dispatch tier 解析时查）+ 并发上限（maxActive/│
│    maxTeam）+ 退役机制（R15）                                   │
└────────────────────────────────────────────────────────────────┘
```

**三轴设计原则**（pro 咨询结论）：
- **工具 = 安全轴**：锁死在 type（allow/deny 强制），绝不靠 prompt 自述
- **档位 = 成本轴**：type 给默认（压成本），tier 可逐次覆盖（显式说了算）
- **人设 = 身份轴**：人设库按 key 引用（确定性），自由文本仅作补充

## dispatch 工具（唯一入口）

### 参数 schema（终稿）

| 参数 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `type` | ✅ | string（enum=类型表 keys，封闭白名单） | 成员类型：工具边界 + 输出约定 + 默认档位；未知类型**硬失败** |
| `prompt` | ✅ | string | 任务描述（自包含；是否继承父对话由类型决定） |
| `tier` | 否 | string（enum=档位表 keys） | 档位覆盖；省略用 type 默认档 |
| `persona` | 否 | string | 人设库 key 或自由文本；key 由插件解析为全文写 request.persona |
| `run_in_background` | 否 | boolean | true=常驻成员（continuable）；false=前台一次性 |
| `output_schema` | 否 | object（object-rooted JSON Schema） | 结构化返回；**仅前台 one-shot**（与 run_in_background:true 冲突即报错）；校验失败重试一次→null |
| `timeout` | 否 | number（秒） | 超时（借鉴 kimi）：前台默认无/上限 1h，后台默认 15min；经 exec.signal 级联取消 |

返回：`{kind:'foreground', output}`（无 schema=文本，有 schema=校验对象/null）｜ `{kind:'continuable', subagentId}`

### 实现要点

```js
// 示意伪代码，以终稿规格为准（R13/R14/D25）
execute(args, exec) {
  const type = requireType(args.type)                    // 封闭白名单，未知硬失败（P0-1）
  if (args.output_schema && args.run_in_background) throw new Error('output_schema 仅前台可用')
  if (args.timeout > MAX_TIMEOUT) throw new Error('timeout 超上限')
  if (inFlight >= maxActive) throw new Error('maxActive 并发上限')        // R14 同步计数（L8）
  const { provider, model } = resolveTier(args.tier, type.tier)           // 唯一路由权威（查熔断，D17-9）
  const label = `${args.type} ${shortTitle(args.prompt)}`
  let promptText = type.role + '\n\n' + args.prompt                        // role 拼进 prompt（D17-1）
  if (config.injectProjectContext && !args.run_in_background) promptText = await projectContext() + '\n\n' + promptText  // D25-1（建包后）
  const request = {
    label,
    prompt: [{ type: 'text', text: promptText }],
    parent: exec.agent,
    agentOptions: { provider, model },                                    // 无 swarm/swarmRoute（R13 死元数据已删）
    persona: resolvePersona(args.persona),                                // key→全文 或 自由文本（{{}} 转义，L7）
    toolFilter: toolFilterFor(type),                                      // deny 简化 ['dispatch']（R16-4）
  }
  if (args.run_in_background) {
    // startContinuable 必须传全形参（D26）：{provider:'spawn', label, request, signal}——缺字段会 NO_PROVIDER/缺 label 报错
    return { kind: 'continuable', subagentId: (await ctx.subagents.startContinuable({
      provider: 'spawn', label, request, signal: exec.signal
    })).childId }
  }
  const run = await ctx.subagents.start(providerFor(type), { ...request, signal: exec.signal })
  try {
    const r = await run.result                                            // await 修正（F4）
    const text = textOf(r.output)
    if (!args.output_schema && text.length < SUMMARY_MIN_LENGTH) {
      // summary 续写（D25-2）：追加补充请求重试一次
      return { kind: 'foreground', output: await runWithContinuation(run, text) }
    }
    return { kind: 'foreground', output: r }
  } finally { await run.dispose() }                                      // D17-12
}
```

**toolFilterFor(type) 终稿**（D17-2 + R11）：所有类型统一附加 `deny: ['dispatch','subagent','subagent_fork','workflow','ralph']`；只读/写作类型在此基础上叠加 allow 白名单（allow+deny AND 语义）；全工具类型（code/general）= `{ deny: [五工具] }`。
**动态过滤（R11-v4 修正，官方 O3/O4）**：名单在派发时用 `exec.agent.ctx.tools.view(parent).restrictableNames` **过滤不存在的名字**（fail-safe 剔除 + 日志）——**必须用 restrictableNames（= global + preset ancestors，含 preset 层；不含 own 层）而非 knownNames（含 own 层）**：restrict() 的校验集就是 restrictableNames，own 层名（如 `report`）进名单会被 restrict 抛 "unknown global tool"；R11 原结论"knownNames 防 preset 工具被误剔"已被官方源码推翻（restrictableNames 本来就含 preset 层工具）；**allow 过滤后为空 → fail-loud 拒绝 dispatch**（不静默产出零工具子代理，给出未知名清单）。**实现注意**：`view()` 返回的 `knownNames`/`restrictableNames` 是 **Set**（用 `.has()` 不是数组 filter）；`view()` 非契约化公开 API（Inspect 清单无），降级可用 `schemas(scope)` 枚举兜底。
**deny 名单（R16-4-v4）**：**统一写五工具** `['dispatch','subagent','subagent_fork','workflow','ralph']`，restrictableNames 过滤自动处理环境差异——swarm preset 下四名不存在被剔除 → 实际 deny 只剩 `dispatch`（R16-4 原语义不变）；cordis/standard 等含原生委派工具的 preset 下四名被真正 deny（补上递归缺口，O4：preset 层工具可被 restrict 过滤）；**`report` 不得进 deny**（own 层名，restrict 抛错）。

### 模型钉死（R13 + R16-2：只删 agent/request 监听器）

- dispatch 解析 tier → `agentOptions = { provider, model }` 写入 → 子代理创建时**模型已钉死**
- **删除的仅 `agent/request` 路由瀑布监听器**（R13 核心：无 routing 表、无 label 匹配）
- **保留的监听器（R16-2 修正）**：
  - `agent/request-error`（熔断计数）——瀑布监听器，**必须 `{global:true}` + `return next()` 直通**（否则吞掉 DSH 内置 llm-retry / 上下文溢出压缩）；只在判定为子代理失败（`delegationDepth > 0`）时计数
  - `subagent/start` / `subagent/end`（maxActive 计数）——同需 `{global:true}` + `next()` 直通
- 冷恢复：descriptor 固化的 `agentProvider/agentModel` **权威重建**（不降级、不重路由）
- 保留的只有 dispatch 内 tier 解析时的**熔断/fallback 检查**

### P0 安全/成本硬约束（v1 实现清单）

1. **type 封闭白名单 + 未知类型硬失败**（typo/幻觉 type 禁止产生无边界子代理）
2. **并发双上限（R14 + R16-1/R16-3/R16-8）**：
   - `maxActive`（默认 8）：并发"干活中"子代理数——`subagent/start`/`end` 配对计数（runId 配对，R3），continuable idle 时被 dispose 不计数；**监听器内按 `info.id` 反查 `agents.get(id).session.header.parentSession === 本 root` 过滤**（事件无 parent id，防跨会话泄漏，M3）；**必须 `return next()` 直通**；若要硬限同轮批量，execute 内同步 `in-flight++`/`finally --`（L8）
   - `maxTeam`（默认 16）：常驻 continuable 成员总数——**派发时惰性权威计数**（每次 dispatch `bg=true` 时用 `listChildren(rootSessionId)` 实时数 continuable 数，含 cold；不做进程内自记账 Set，防退役漂移，R16-1）；**退役语义**：interrupt 停当前 turn + 归档标记（durable 载体 v2；v1 接受"退役只释放 resident 资源、不释放 maxTeam 名额"，maxTeam 实为"历史创建总数上限"，文档明确）
   - 二者正交，`maxTeam ≥ maxActive`；协议 fan-out ≤8 为软指导
3. **递归控制**：子代理 toolFilter deny 五工具（R16-4-v4：swarm 下自动退化为 dispatch；`report` 不得进 deny——own 层名）；**第二道防线 `maxDepth`（官方默认 3，服务层强制，O6）**——D28 星型团队下成员不扩编，深度天然 ≤1，maxDepth 是兜底而非主防线
4. **取消/中断级联**：前台 one-shot 由 `exec.signal` 原生级联；后台 continuable 在父 dispose 时由原生 drain 兜底；"父 interrupt（非 dispose）→ 孤儿窗口"v1 文档化接受，可选自建级联（interrupt 子代理）
5. **幂等/去重**：`subagent_id` 即唯一任务键（D20），审计记录供派发后核对；协议教"同轮不重复派发同一任务"
6. **失败协议**：重试一次 → 改写 prompt 重派 → 显式记录失败继续，绝不静默丢弃
7. **退役机制（R15 + R16-1）**：退役 = interrupt 停当前 turn + 归档标记（durable 载体 v2；v1 接受"只释放 resident 资源"）；maxTeam 用惰性权威计数（派发时 listChildren 实时数），无需进程内 Set 重建

### 深审修订清单（15 项，pro 顾问 2026-08-15）

1. **role 归属**：role（任务边界+输出约定）拼进 `request.prompt`；仅 persona 进 `request.persona`（persona 槽位走严格 `{{}}` 插值，role 含 `{{` 会炸；role 是任务指令不是身份）
2. **子代理 toolFilter**：全类型 deny 统一 `['dispatch','subagent','subagent_fork','workflow','ralph']`（防递归 + 防借原生工具绕过治理）
3. **root 屏蔽时机**：启动时枚举 `agents.list()/roots()` 立即 restrict 存量 root + 监听 `agent/created` 覆盖增量（agent/created 只覆盖未来创建的 agent）
4. **restrict 调用方式**：`agent.ctx.tools.restrict(...)`（全局 ctx 会抛"requires scoped context"）；try/catch 防 emit 抛错 veto agent 创建；先验证工具名存在；**失败时显式 `logger.error`（可观测，不静默吞错——P1-3/R8）**
5. **子代理判据**：`delegationDepth` / `parentSession`（弃用 `origin`——presentation metadata，非证明）
6. **并发记账**：`subagent/start` + `subagent/end` 配对、按 provider 过滤；语义 = 运行中任务数（常驻 idle 不计）
7. **路由元数据**：dispatch 写入 `agentOptions.swarm = {type, tier, label, swarmRoute}`，路由瀑布单点读取（label 不在 agent.options，必须打包）
8. **冷恢复**：descriptor 只存 agentProvider/agentModel；swarmRoute/tier 标记丢失 → 显式 tier 退化回类型默认（通常一致）。**v1 文档化接受（选项 A），重启后如需重分档重新 dispatch**
9. **熔断 × 显式 tier**：dispatch execute 解析 tier 时**查熔断**，命中硬失败或明确降级（不静默放行）
10. **熔断信号**：用 `agent/request-error`（waterfall，带 failure/retryPolicy）计数连续失败
11. **schema 热更新**：type/tier 目录进协议 section（text 函数动态注入，永远最新）；工具 description 保持通用（不写死 enum）
12. **前台清理**：`result` 后必 `dispose()`；`start()`/`result` 基础设施故障走 finally 释放计数
13. **bg + output_schema**：硬拒绝（continuable 类型层 Omit outputSchema，冲突即报错）
14. **中断文档**：前台 signal 原生级联；后台 dispose 时 drain 兜底；孤儿窗口接受（见 #4）
15. **maxDepth**：官方标配（tool-subagent 默认 3，服务层 enforce）——D17-15 从"可选第二道防线"升级为"官方 O6 标配"；dispatch 派发时传 `maxDepth: 3`（可配置）

### P1 建议（v1.1+）

- `dispatch.batch(items[])`：补 workflow parallel 的确定性 fan-out（不遗漏/不串行/barrier）——**B 方案的需求 A 也能满足**
- 审计落盘：每次 dispatch 记 `{type, label, tier, subagent_id, 起止, 成本}`（**subagent_id 即唯一任务键**，幂等核对按 id 对账；label 只用于续接定位，不用于幂等——两次相似任务会撞 label）；**格式借鉴 kimi output.py 结构化记录**：`[stage]/[tool]/[tool_result]/[summary]/[error]` 统一前台/后台
- 后台子代理 stall/超时与收集语义：**dispatch 加 `timeout` 参数**（前台默认无/最大 1h、后台默认 15min，借鉴 kimi Agent 工具）→ AbortController 级联
- 成本统计面板（projection）
- fork 支持（v2 候选）：v1 固定 spawn provider；需要继承主对话时在 prompt 的 Context 带摘要（Prompt structure 段已教）

### kimi code 源码借鉴（2026-08-15 调研，4 项）

1. **项目上下文注入**（借鉴 `prepare_soul` 的 git-context）：dispatch 创建子代理时自动附加项目状态——git 仓库的 remote/branch/dirty 文件（前 20）/最近 3 条提交（kimi 的 `<git-context>` 块）。**实现**：建包后可用 Node child_process 跑 git；动态迭代期跳过（无 import）；可配置开关 `injectProjectContext: true/false`
2. **summary 续写**（借鉴 runner 的 `SUMMARY_MIN_LENGTH=200` + 续写一次）：前台 one-shot 输出 <200 字 → 自动追加"请提供更完整摘要（技术细节/发现/父代理须知）"重试一次，防子代理敷衍
3. **timeout 参数**：dispatch 加 `timeout`（前台默认无/上限 1h，后台默认 15min）→ exec.signal 级联取消
4. **结构化审计格式**：`[stage]/[tool]/[tool_result]/[summary]/[error]`（同 output.py）

### 实现细节澄清

1. **label 生成**：`${type} ${shortTitle(prompt)}`，shortTitle = 前 ~40 字符去换行（中英文通用）
2. **role 拼接**：`prompt = type.role + '\n\n' + 用户 prompt`（role 前置，任务边界先读）
3. **子代理工具一致性**：swarm preset 删四行后，所有子代理必经 dispatch 创建 → 全部带 deny `['dispatch']`（无旁路）
4. **dispatch 工具 schema**：type/tier 用宽松字符串 + execute 时查动态白名单（enum 热更新过期问题，I3/D17-11）
5. **挂载平面（R9/Q1）**：model-router 挂载在 **preset 平面**（复制 standard 建 swarm preset + model-router 行）——dispatch/协议/路由监听随 preset 走，不泄漏到未装插件的 preset 的 agent；dispatch 可见范围 = 本 preset 的 root + 其子代理（子代理已 deny）
6. **渲染 try/catch（R7）**：协议/人设目录 section 的 text 函数包 try/catch——渲染失败返回空串（整段丢弃）+ `logger.warn`，**绝不外抛打断模型请求**（否则热编辑引入非法状态会让会话瘫痪）
7. **熔断错误信息（R6）**：dispatch 熔断硬失败时错误信息列出可用 tier + cooldown 剩余（可执行指引）
8. **persona 转义（L7/R16-7）**：`resolvePersona` 对自由文本做 `{{`/`}}` 转义或拒绝（persona 槽位走严格 `{{}}` 插值——interpolate 遇畸形变量直接 throw，会打断请求；必须落实）；key 解析路径不受影响
9. **改档语义（L6/R16-6）**：settings 改 tier 只影响**新 dispatch**；已驻留 continuable 成员沿用创建时模型（descriptor 固化）——协议/文档写明"改档需重新 dispatch 才生效"
10. **settings 现读（D26）**：dispatch 的 execute 内 `ctx.settings.get('model-router')` **现读**（勿在 apply 快照——否则热加载失效）
11. **isConcurrencySafe（D26）**：dispatch 定义加 `isConcurrencySafe: () => true`（fan-out ≤8 依赖同轮多个 dispatch 并行调用）
12. **timeout 实现（D26）**：用 `timer` 服务 + 子 AbortController 与 `exec.signal` 联动

## 配置 schema（v2 终稿）

```yaml
model-router:
  enabled: true                              # 总开关（false = 全停）
  tiers:                                     # 档位：成本轴（换供应商只改这里）
    lite:     { provider: deepseek-official, model: deepseek-v4-flash }
    standard: { provider: deepseek-official, model: deepseek-v4-flash }
    pro:      { provider: deepseek-official, model: deepseek-v4-pro }
    ultra:    { provider: deepseek-official, model: deepseek-v4-pro }
  types:                                     # 类型：工具边界 + 输出约定 + 默认档（封闭白名单）
    explore:
      tools:                                 # 只读 → allow 白名单（fail-closed，安全轴）
        allow: [read, read_image, glob, grep, web_search, skill, list_agents, job_list, job_output, get_goal]
      tier: lite                             # 默认档位（可被派发覆盖）
      role: "read-only research: locate code, understand patterns, gather facts; report findings with concrete locations and conclusions."
    code:
      # 全工具 → deny 五工具（D17-2）
      tier: standard
      role: "implementation: edit, build, self-test a well-specified change; report change summary and verification evidence."
    write:
      # 写作 → 文件读写 + 搜索白名单（禁 bash/委派——写作不需要 shell，防乱跑命令；web_search 查引用）
      tools:
        allow: [read, read_image, glob, grep, web_search, write, edit, skill, todo_write, list_agents, job_list, job_output]
      tier: standard
      role: "writing: produce clear, well-structured documents (papers, notes, README) matching the project conventions; report what was written and where."
      # 注：禁 bash → 无法编译 LaTeX/运行 formatter；编译等操作由主 agent 或另派 code 类型处理（v1 接受）
    review:
      tools:
        allow: [read, read_image, glob, grep, web_search, skill, list_agents, job_list, job_output, get_goal]
      tier: ultra                            # 判断力重活，默认 ultra
      role: "independent review: quality/security/performance/edge cases; report prioritized issues with concrete fixes."
    general:
      # 全工具 → deny 五工具（D17-2）
      tier: lite                             # 兜底必须最便宜
      role: "miscellaneous self-contained tasks; report directly."
      # 注：白名单未列 cordis_inspect_*（standard preset 未挂载 dsh-tool-cordis，R1）
  personas:                                  # 人设库（用户可编辑：settings.yaml 直接增删改）★
    physics: { description: "computational physics, simulation, beam dynamics", text: "For this task you act as a computational physicist...", when_to_use: "physics modeling, simulation code" }
    ml:      { description: "machine learning: training, evaluation, tuning", text: "For this task you act as an applied ML engineer...", when_to_use: "surrogate models, training, eval" }
    data:    { description: "data analysis and visualization", text: "For this task you act as a data analyst...", when_to_use: "datasets, statistics, plots" }
    research: { description: "literature and approach research", text: "For this task you act as a research agent...", when_to_use: "literature survey, approach comparison" }
    docs:    { description: "documentation and writing", text: "For this task you act as a technical writer...", when_to_use: "docs, papers, README" }
    backend: { description: "general engineering implementation", text: "For this task you act as a backend engineer...", when_to_use: "python code, refactor, tooling" }
    reviewer: { description: "journal reviewer simulation: methodology, statistics, novelty, coverage", text: "For this task you act as a rigorous journal reviewer: assess methodology soundness, statistical correctness, novelty, literature coverage, and writing quality; produce a structured review report with major/minor comments.", when_to_use: "pre-submission review, reviewer simulation, adversarial critique" }
    statistician: { description: "statistical rigor: methods, hypothesis testing, uncertainty", text: "For this task you act as a statistician: choose appropriate statistical methods, validate assumptions, quantify uncertainty, and flag statistical pitfalls in the analysis.", when_to_use: "statistical analysis, significance testing, uncertainty quantification" }
    # ↑ 用户直接在 settings.yaml 添加自己的专业人设（如 accelerator/plasma/optics），
    #   目录 section 自动渲染新条目，dispatch 立即可用——热加载，无需重启
  limits:                                    # 并发双上限（R14）+ 深度（O6）
    maxActive: 8                             # 并发"干活中"子代理数（start/end 配对计数）
    maxTeam: 16                              # 常驻 continuable 成员总数（dispatch 自记账）
    maxDepth: 3                              # 委派深度上限（官方默认 3，服务层 enforce）
  fallback:                                  # 跨供应商降级链（熔断时跳过已熔断目标）
    - { provider: deepseek-official, model: deepseek-v4-flash }
  circuit:                                   # 简化熔断
    tripCodes: [RATE_LIMIT, QUOTA, TIMEOUT, TRANSPORT, SERVER, EMPTY_RESPONSE]
    threshold: 2
    cooldownMs: 60000
    probeMaxTokens: 8
```

**校验**：tier 引用必须存在；persona key 必须存在（自由文本放行）；type.tools 名单在派发时用 restrictableNames 动态过滤（R11-v4）；只读/写作类型 allow 白名单不含写工具（explore/review）或仅含文件写（write）；类型词与任务词零重叠；limits.maxTeam ≥ limits.maxActive ≥ 1。

## 人设库机制

- **目录 section**：`swarm:persona-catalog`，order **-90**（身份 -100/-99 之后、persona 0 之前），仅 root（`session.header.delegationDepth > 0` 返回空串，D17-5 判据）——**只放摘要**：`key + 一句话描述 + when-to-use`（每条约 30-60 token）
- **按需取全文**：`get_persona(key)` 只读工具（可选，库大时用）
- **注入**：dispatch 的 `persona` 参数收 key → 插件解析全文 → `request.persona`（覆盖 `deployment:persona` 槽位，真正身份注入，零漂移）
- **名字冲突**：`swarm:` 前缀与原生（`harness:`/`deployment:`/`plan:`/`tool:`/`subagent:`）零相交
- **顺序语义**：身份 → 人设目录（可选谁）→ 实际人设 → 工具指引

## 协议文本（v2：dispatch 唯一入口 + 团队协议）

注入 root（order -98），核心为 **Delegation entry 段（终稿，pro 顾问提供）** + 团队协议骨架。
**注入实现（必须做对，D26）**：`systemPrompt.section({ name: 'model-router:protocol', order: -98, text: (context) => context.scope?.session?.header?.delegationDepth > 0 ? '' : PROTOCOL })`——**协议 section 与人设目录同款 delegationDepth 过滤**（子代理经 composeFrom 继承父 preset 会看到协议；若不过滤，子代理会看到"你是编排者必须用 dispatch"而它已被 deny dispatch——自相矛盾指令）。

```text
### Delegation entry
你是编排者。所有子代理委派——一次性研究、分析、实施，或持续协作者——必须且只能
通过 dispatch(type, prompt, options?) 发起。本会话已屏蔽原生 subagent/subagent_fork
及 workflow 工具；若误触发，立即放弃该调用并改用 dispatch。

- type：必须是已注册的子代理类型（封闭白名单）。它决定 toolFilter 边界、输出约定、
  成本档位。未知类型会硬失败，不要猜测或拼凑类型名。
- prompt：自包含的完整任务，含全部上下文与验收标准（子代理看不到你的对话）。
- options：tier（成本档位，省略用 type 默认）、persona（人设库 key，非必要不用）、
  run_in_background（true=常驻成员返回 id 供续接；false=前台一次性）、
  output_schema（仅前台一次性，结构化返回）。

并行 fan-out（需同时展开多项独立子任务时）：
1. 先把全部子任务一次性列全——明确 N 项、每项的 type 与 prompt 要点——再落笔调用。
   禁止边派发边等待，禁止"先派一个看结果再决定下一个"。
2. 在同一轮（同一批 tool_calls）内一次性发出全部 N 次 dispatch，然后停止并等待全部
   结果回来，再进入下一轮汇总。只有子任务之间存在数据依赖时才允许分批/串行，且必须
   在思考里说明依赖关系。
3. 派发后逐项核对回执：缺一项就补派；多一项（重复派发）就忽略并说明；失败或空结果
   不静默丢弃——重试一次，或改写 prompt 重派，或显式记录该项失败后继续。
4. 每次 fan-out 默认不超过 8 个并发子代理；接近上限或预算时说明取舍，绝不无上限展开。

结构化返回：需要可机读结果（合并/计算/入库）时，前台一次性模式用 output_schema 给出
object-rooted JSON Schema；返回值为校验通过的对象，失败为 null。continuable 模式不支持
output_schema，改用自然语言 + 续接提问。

成本与可追溯：每次 dispatch 落地 {type, label, tier, subagent_id, 起止时间, 成本} 记录；
label = type + 任务摘要 是续接与审计的唯一钥匙。续接已存在的后台子代理，按 label/id
定位，绝不新开子代理去"找回"旧任务。

### Dispatch failure handling（R6）
当 dispatch 报错时，按错误类型应对：
- 未知 type / 并发上限 / 参数冲突 → 读错误信息修正后重试（换合法 type、分批、调整参数）
- **熔断命中（tier 目标不可用）** → 错误信息会列出可用 tier 与冷却剩余；换一个可用 tier 重试，
  或等待冷却（先做其他任务），**绝不用同一 tier 反复重试**
- 子代理运行失败（error/refusal/max-tokens）→ 按失败协议：重试一次 → 改写 prompt 重派 → 显式记录
- 任何 dispatch 失败都不得静默忽略：要么解决、要么显式记录并告知用户

### 团队协议骨架（沿用 v4.1）
Delegation rhythm（防串行崩溃/虚假并行）/ Roles / Prompt structure（四要素+结论化）/
Task assignment / Coordination（压缩后 list_agents 重枚举）/ Acceptance（审证据不重做；
review 按需 consult）/ Team lifecycle（常驻复用）/ Labeling（type 词开头）
```

## 类型注入

- dispatch 路径（唯一）：`type.role` 由 dispatch 拼进 `request.prompt`（D17-1）；persona 走 `request.persona`（身份槽位）
- **无 label 自动注入、无 routing 表**（R13 删除——dispatch 是唯一通道，role 注入完全由 dispatch 承担）

## 决策记录（v2）

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 实现路径 | dispatch 主通道 + agent/request 兜底 ~~（A 瀑布验证保留）~~ **⚠️ superseded by R13：路由兜底已删除，dispatch 即唯一权威** |
| D2 | root 语义 | root 不路由（GUI 控制）；子代理无 selection 层（v2 修正，创建后模型不被改写） |
| D3 | 熔断降级 | 简化版合入（跳过已熔断 fallback 目标） |
| D4 | judge 直答 | 不做，留后 |
| D5 | 辅助调用 | 不纳入路由 |
| D6 | 档位格式 | 对象格式 { provider, model } |
| D7 | 协议开关 | 无独立开关（enabled 总开关） |
| D8 | 成员类型 | 升级为 types（工具边界+role+默认档）+ personas 人设库 |
| D9 | dispatch 主通道 | 显式分发（type/tier/persona），swarmRoute 标记消歧 ~~**⚠️ superseded by R13：swarmRoute 死元数据已删**~~ |
| D10 | 档位自由轴 | type 绑工具+输出+默认档；tier 可逐次覆盖（不锁进类型） |
| D11 | 人设库 | 目录 section（仅 root 摘要）+ key→全文注入 + get_persona 可选；**用户可在 settings.yaml 直接编辑/添加**（热加载） |
| D12 | 档位数量 | **4 档：lite / standard / pro / ultra**（用户拍板） |
| D13 | types 默认集 | 迭代确定：插件内置决策日志（每次 dispatch 记录 type/tier/persona 选择），边运行边观察边调整 |
| D14 | 委派入口 | **统一 dispatch，不用内置 workflow**（A 方案）~~root 工具面屏蔽~~ **⚠️ superseded by R12：preset 组成删四行（restrict 碰不到 own 层）** |
| D15 | 工具边界写法 | 只读类型（explore/review）用 **allow 白名单**（fail-closed）；全工具类型（code/general）~~不设 tools 字段~~ **⚠️ 终稿：deny ['dispatch']（R16-4）** |
| D16 | 结构输出 | `output_schema` 入 dispatch（仅前台 one-shot，与 run_in_background 冲突报错）；continuable 不支持（文档标注） |
| D17 | 深审 15 项修订 | 全部采纳（role→prompt / deny 五工具 ~~/ 存量 root restrict / agentOptions.swarm 单点 / 冷恢复文档化(A)~~ **⚠️ 部分 superseded：存量 restrict→R12 preset 删行；swarm 单点→R13 删除；冷恢复文档化→R4 权威放行**） |
| D18 | 并发语义 | ~~驻留成员数 ≤8~~ **⚠️ superseded by R14/R16-1：maxActive=8 活跃 + maxTeam=16 驻留（惰性权威计数）** |
| D19 | fork 语义 | v1 固定 spawn provider（不支持 fork）；继承主对话 → prompt Context 带摘要；fork v2 候选 |
| D20 | 幂等键 | `subagent_id` 即唯一任务键（审计记录供核对）；label 只用于续接定位，不用于幂等 |
| D21 | 团队覆盖 | 科研全流程团队池：**types 5 个**（explore/code/**write**/review/general）+ **personas 8 个**（physics/ml/data/research/docs/backend/**reviewer**/**statistician**）；协议不加科研流程段（保持通用，主 agent 自主组织） |
| D22 | 三轮回审 R1-R10 | 全部采纳：工具名单动态过滤(fail-safe) / 并发驻留语义 / runId 配对 / 冷恢复 descriptor 权威放行 / descriptor 折叠 label ~~/ 屏蔽可观测~~ **⚠️ 部分 superseded：label 折叠→R13 删除；屏蔽→R12 preset 删行** / preset 平面挂载 / explore/review 去 todo_write |
| D23 | 四轮回审 R11-R15 | 全部采纳：knownNames 过滤+allow 滤空 fail-loud / preset 组成删四行（R12，架构级）/ **删 routing 表+label 匹配+agent/request 监听器（R13，dispatch 即唯一路由权威）** / maxActive+maxTeam 双上限（R14）/ 常驻退役机制+冷恢复规模重建（R15） |
| D24 | 五轮回审 R16 | 全部采纳：maxTeam 惰性权威计数+退役语义重定义（H1）/ R13 措辞修正只删 agent/request 监听器，request-error 与 start/end 保留+global+next() 直通（H2）/ maxActive 按 parentSession 反查过滤（M3）/ preset 保留白名单 report+control，report 不得进 deny（M4）/ view() Set+非契约 API 降级（L5）/ 改档只影响新 dispatch（L6）/ persona 自由文本转义（L7）/ 双上限 sketch+同步计数（L8） |
| D25 | kimi 源码借鉴 | 4 项采纳：项目上下文注入（git 状态，建包后 child_process，可配置）/ summary 续写（<200 字自动补充重试）/ timeout 参数（前台 1h/后台 15min）/ 结构化审计格式（[stage]/[tool]/[tool_result]/[summary]/[error]） |
| D26 | 七轮终审落盘 | 必须做对 2 项：协议 section 补 delegationDepth 过滤（防子代理看到自相矛盾指令）/ startContinuable 补全形参；实现级注意 3 项：settings execute 内现读 / isConcurrencySafe / persona 转义落实；清理：删 workflow-worker-thread 孤儿行 / 伪代码形参修正 |
| D27 | 官方架构审查（2026-08-17，ARCHITECTURE-REVIEW.md §0.5 O1-O9） | 9 项全部采纳：O1 global 层留空（preset 平面唯一终态）/ O2 tools.register 层=ctx scope / O3 restrictableNames 校验集 / O4 restrict 只过滤继承面 / O5 子代理组合官方路径（persona/toolFilter 走 request 契约）/ O6 maxDepth 官方默认 3 / O7 动态插件实验形态（终态建包）/ O8 subagent start-end 事件契约 / O9 section order 带 + 空串丢弃。**连带修正**：R11 knownNames→restrictableNames（原结论被源码推翻）；R16-4 deny 简化→统一五工具；D17-15 maxDepth 可选→官方标配 |
| D28 | 团队形态（用户拍板） | **星型团队**：root 带领 subagent 干活，**无多层结构**；成员不扩编（deny 五工具 + maxDepth=3 双防线）；档位分工：lite 明确小任务 / standard 较难任务 / ultra 咨询与审查（pro 高成本用途按需，用户 4 档配置不变） |

## 内置工具盘点（防重复）

| 我们的规划 | 内置对应 | 结论 |
|---|---|---|
| dispatch 工具 | 原生 subagent/subagent_fork（无 type/tier/persona 参数） | ❌ 不重复（facade 补缺） |
| 档位路由（兜底） | 无（selection 静态，且子代理无 selection） | ❌ 不重复 |
| 人设库目录 | subagent:delegation context（权限锁，非人设） | ❌ 不重复 |
| 熔断降级 | llm-retry（同 provider 重试） | ❌ 不重复（互补） |
| 团队协议 | subagent 工具 description 无团队概念 | ❌ 不重复 |

## 调研笔记（保留，压缩）

- **dsh-model-failover**：两级熔断+探针恢复+与 llm-retry 职责分层 → 我们简化版合入
- **llm-adaptive**：自定义 adapter 分类路由（另一路径）→ 不用
- **dsh-model-router**：pre-step judge 直答 + projection 面板 → judge v2 候选
- **mimo code**：model_groups 档位 + agent→档位固定映射 + 变体（推理配置）→ 档位抽象借鉴；固定映射我们进化（档位自由轴）
- **dsh-agent-teams**：9 工具 + mailbox + 任务状态机 + UI + 快照队长模型 → 我们取 dispatch 思想（显式类型+模型），弃 mailbox/状态/UI（原生 send_message/持久化够用）
- **dsh_workflow**：可复用流程资产层 → 正交，不冲突
- **kimi-cli 开源**：SubagentStore（磁盘状态）+ AgentTypeDefinition（类型=default_model+工具策略+ROLE_ADDITIONAL）+ 继承+显式覆盖 → **印证 type 定义 + 显式覆盖设计**；我们进化（档位自由轴 + 人设库）
- **claude teams**：模型继承 leader + mailbox + 静态分工 → 模型继承理念不同（我们自由分档），mailbox 不做
- **kimi agent swarm**：指挥官+队员 + Context Sharding + 防偷懒 + 关键步骤 → 协议吸收（结论化报告/防串行崩溃）
- **"零状态"哲学**：原生状态复用（会话持久化 + list_agents 重枚举）；唯一缺口任务清单（v2 候选）

## 开放问题

- [x] D1-D16 决策（含 D14 统一 dispatch / D15 allow 白名单 / D16 output_schema）
- [x] D17-D26 决策（含官方审查 D27 / 团队形态 D28，2026-08-17 定稿）
- [ ] 包命名与发布目标
- [ ] 测试计划（matcher/熔断/dispatch 纯逻辑单测）
- [ ] types 默认集：运行时决策日志观察调整（D13）
- [ ] v1.1+：dispatch.batch、审计落盘、stall/超时、成本面板、B 方案（开放 workflow）
