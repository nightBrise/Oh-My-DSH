# model-router 架构级问题审查报告

> 审查对象：swrmd-23/pkg-71（dispatch v5，动态插件迭代版）
> 审查基准：DESIGN.md（v3 终稿）+ **DSH 官方架构文档/源码（本轮新增）** + 实测证据
> 日期：2026-08-17
> 方法：源码核读（pkg-71 host 源码）+ 运行时实证（3 项派发实测 + 会话记录核验）+ 服务目录对照（systemPrompt/tools/subagents/agents）+ **官方 README 与 dsh-* 包源码对照（本轮）**

---

## 0. 实证发现（本次审查新增证据）

| # | 实证 | 方法 | 结论 |
|---|---|---|---|
| E1 | **递归控制缺口实锤**：code 类型子代理（cordis preset 继承面）工具目录包含 `subagent`/`subagent_fork`/`workflow`/`ralph`，仅 `dispatch` 被 deny | 派发 code 子代理自查工具目录 | v5 的 deny 简化 `['dispatch']` 在 cordis preset 下**不成立**，code/general 子代理可借原生工具绕过 dispatch 递归委派 |
| E2 | **swarm preset 无 dispatch 行**：agent.cordis.yml（223 行）无 model-router/dispatch 静态行；当前 dispatch 完全来自 host 平面动态插件注册 | grep + 文件核读 | 部署形态与 R9/Q1"preset 平面挂载"终态不符；进程重启 → dispatch 消失 |
| E3 | **root 无协议注入**：root 会话系统提示无 Delegation entry、无人设库目录 | 会话记录 request/header 核验 | D26"必须做对"项未实现；root 无任何协议引导，完全依赖用户口头交代 |

---

## 0.5 DSH 官方架构规定（本轮源码/文档对照，决定性）

以下事实来自 DSH 官方 README 与 dsh-* 包源码（lib/*.js），**优先于 DESIGN.md 的推断**：

| # | 官方事实 | 出处 | 对 model-router 的意义 |
|---|---|---|---|
| O1 | **模型面工具必须注册在 agent 平面（preset 层）**："Every model-facing row lives on the agent plane, so the tool registry's **global layer is empty** and a child that joins nothing reaches the model with no tools at all" | dsh-agent-presets/README.md §Composing a child agent | **A1 定性**：dispatch 注册在 root realm（global 层）违反官方架构原则——官方要求 global 层留空，模型面工具随 preset 平面走 |
| O2 | **tools.register 的层 = 调用 ctx 的 scope**："a plain plugin context registers globally; an agent's `agent.ctx` registers for that agent alone, shadowing a same-named global tool there" | dsh-tools/README.md §Public API | 动态插件 ctx 无 scope → dispatch 进 global 层，所有会话可见（A1 泄漏面确认） |
| O3 | **restrict 校验 restrictableNames（仅继承面）**，own 层名（如子代理自己的 report/structured-output 工具）在名单中**抛错**："Unknown, local, or reserved names and empty filters reject" | dsh-tools/lib/index.js `restrict()` + `view()` | **R16-4 官方依据**：`report` 不得进 deny；**修正 R11**：restrictableNames 含 preset 层工具（ancestors），不含 own 层——不是"仅 global" |
| O4 | **restrict 只过滤继承面（global + preset ancestors），不碰 own 层**："A restriction filters what a scope inherits — the global layer and every ancestor layer on its chain — and never what its OWN layer registers" | dsh-tools/lib/index.js `view()` | 子代理 own 层工具（report 等）天然豁免；**A2 修复成立**：deny 加 `subagent` 等名在 cordis preset 下是 ancestors 贡献，可被过滤 |
| O5 | **子代理组合 = composeFrom(父 preset) + persona section(order 0) + toolFilter restrict**："join the parent's agent-preset composition before applying the child's own persona and tool filter" | dsh-subagent/lib/types/child-agent.js `applyChildComposition()` | dispatch 的 persona/toolFilter 走官方 `request.persona`/`request.toolFilter` → 服务层落 `systemPrompt.section` + `tools.restrict`，**无需自建机制**（v5 已走对） |
| O6 | **maxDepth 官方默认 3**（tool-subagent config），服务层 enforce（`resolveChildDepth` 抛 `SubagentDepthError`） | dsh-tool-subagent/README.md §Config + dsh-subagent/lib/index.js | **dispatch 未传 maxDepth → 无深度防线**（A2 第二缺口）；应传 `maxDepth`（默认 3，DESIGN.md D17-15 可选防线 → 官方标配） |
| O7 | **动态插件跨会话泄漏官方确认**："Dynamic packages ... may affect other sessions in that process"; "To keep an experiment, ask the Agent to implement a normal local, project, or repository Plugin through the regular development workflow" | dsh-tool-cordis/README.md | A1 持久性/泄漏面官方确认；官方明确动态插件是实验形态，**终态必须转为常规插件/preset 行** |
| O8 | **subagent/start-end 事件配对、runId 共享、scope 到 delegating parent、监听器独立容错** | dsh-subagent/README.md §Lifecycle events | R14 maxActive 计数的官方事件契约确认（`subagent/start` 先于 `subagent/end` 保证，断连时只发 start） |
| O9 | **系统提示 section：order 分带（-100 identity / 0 persona / 100-199 工具指引），空串丢弃，{{}} 严格插值** | dsh-system-prompt/README.md | 协议 section（order -98）与人设目录（order -90）在官方 order 带内合法；renderPrompt 空串丢弃确认 D17-5；persona 转义必要性的官方依据（未知变量抛错） |

**O3/O4 推翻 DESIGN.md 的两处假设**：
1. **R11 需修正**："必须用 knownNames（含 own 层）而非 restrictableNames（仅继承面），否则 preset 工具全被误剔" —— 源码证明 restrictableNames = global + ancestors（**含 preset 层**），仅不含 own 层。正确过滤集是 **restrictableNames**（与 restrict() 校验一致）；用 knownNames 过滤若名单含 own 层名会**放行后被 restrict 抛错**（v5 当前名单无 own 名所以未炸，属侥幸）。
2. **R16-4 成立但有官方依据**：deny 简化 `['dispatch']` 的前提（swarm 下其余四名不存在）成立，但**非 swarm 环境（cordis/standard）下缺口真实**——deny 应统一写五工具，restrictableNames 过滤自动剔除不存在的（O4 保证 preset 层的 subagent 等可被过滤）。

---

## 1. 架构级问题清单（按严重度排序）

### A1【架构级·最严重】部署形态：dispatch 注册在 host 平面 root realm，而非 preset 平面

**现状**：dispatch 工具由动态插件 `harness.registerTool(ctx, tool)` 注册。动态插件跑在 `rootCtx.plugin()` 组（dsh-cordis-host-runner 的 `requireGroup()`），工具进入 root realm（scope=undefined）→ **所有 preset 的会话都可见**。

**证据**：E2 + 本会话（cordis preset）能看到 dispatch；旧 swrmd-16 插件对象已不可查但工具注册残留（说明注册是进程级 root realm，插件对象按会话隔离）。**官方 O1/O2/O7 确认**：global 层应为空、模型面工具应随 preset 平面、动态插件跨会话可见且是实验形态。

**后果**：
1. **泄漏面超设计**：standard/code/minimal 等未装 swarm preset 的会话也看得到 dispatch（R9/Q1 要求"不泄漏到未装插件的 preset"被违反）。
2. **持久性脆弱**：动态插件定义不持久。进程重启 → dispatch 消失，swarm preset 会话失去唯一委派入口，且无恢复清单（DESIGN.md D17-8 选项 A 的"重启后重新 dispatch"只有文档化接受，没有落地脚本）。
3. **跨会话冲突**：任何会话 cordis_define 注册同名 dispatch 都会撞 "already registered"（本次已实际遇到），动态插件迭代模式的工具名是进程全局单点。

**解决方案**（终态）：建包后挂 swarm preset 静态行（`name: '@deepseek-ai/dsh-model-router'` + preset 平面 isolate，O1/O7 官方路径）。**迭代期缓解**：
- 明确"dispatch 可用性依赖动态插件进程存活"，写恢复 SOP（重启后重新 define+run 的命令清单）。
- 验收测试必须在 swarm preset 会话进行（见 A8）。

### A2【架构级·安全】递归控制缺口：deny 名单与运行环境脱钩 + 无深度防线

**现状**：`toolFilterFor` 的 deny 硬编码 `['dispatch']`（R16-4 简化，前提是"swarm preset 已删四行，其余四名过滤后不存在"）；**未传 maxDepth**。

**证据**：E1 实测——code 类型子代理工具目录含 subagent/subagent_fork/workflow/ralph。explore/write/review 因 allow 白名单幸免，**code/general（全工具类型）存在绕过路径**：子代理可调原生 subagent 开新的子代理，新子代理继承同一 preset（仍是 cordis），且无 deny 链 → 无类型边界、无档位钉死、无审计、无最大深度限制。官方 O4/O6：preset 层工具可被 restrict 过滤（修复可行）；maxDepth 官方默认 3 是服务层强制防线（dispatch 缺失）。

**风险场景**：任何非 swarm preset 部署（或未来有人把 model-router 挂到 standard 类 preset），递归治理立即失效；且即使 swarm 下 deny 正确，**无 maxDepth 时多层链式递归也无服务层兜底**（子代理再派子代理不限深）。

**解决方案**（零成本，立即可做）：
1. **deny 名单改回五工具** `['dispatch','subagent','subagent_fork','workflow','ralph']`（O4 保证 cordis 下 preset 层四名可被过滤；swarm 下 restrictableNames 过滤自动剔除不存在的，等效 deny ['dispatch']，R16-4 语义不变）
2. **过滤集改用 restrictableNames**（O3/O4：与 restrict() 校验一致，own 层名自动剔除——修正 R11 的 knownNames 用法）
3. **补 maxDepth**：`request.maxDepth`（默认 3，官方 O6 服务层 enforce），DESIGN.md D17-15 从"可选"升级为"官方标配"

### A3【架构级·功能缺失】协议与人设目录未注入（D26"必须做对"项）

**现状**：插件 apply 无 `systemPrompt.section` 调用。

**证据**：E3——root 系统提示无协议、无人设目录。官方 O9 确认 section 机制与 order 带合法。

**后果**：
1. root 不知道"唯一入口是 dispatch"、不知道 type 封闭白名单、不知道 tier 默认档、不知道人设库可选用 → 协议形同虚设，全凭用户口头。
2. 人设库（8 个 persona）没有任何发现机制 → persona 参数实际不可达。
3. 子代理若继承协议会自相矛盾（当前因未注入而无此问题，但协议一旦注入就必须带 delegationDepth 过滤——D26）。

**解决方案**（v6，中成本）：
```js
// 协议 section（仅 root）
ctx.systemPrompt.section({
  name: 'model-router:protocol',
  order: -98,
  text: (context) => context.scope?.session?.header?.delegationDepth > 0 ? '' : PROTOCOL,
})
// 人设库目录（仅 root）
ctx.systemPrompt.section({
  name: 'swarm:persona-catalog',
  order: -90,
  text: (context) => context.scope?.session?.header?.delegationDepth > 0 ? '' : CATALOG_TEXT,
})
```
- text 函数返回空串 → 整段丢弃（O9/D17-5：renderPrompt 丢空串，官方确认）
- 渲染 try/catch（R7）：异常返回空串 + logger.warn，绝不外抛
- 协议文本用 DESIGN.md「协议文本（v2）」终稿原文
- **注意**：动态插件（A1 现状）下 section 注册在 root realm 也会泄漏到所有 preset——协议注入的**正确落点同样是 preset 平面**（建包后）；迭代期可接受泄漏，或仅在验证环境确认

### A4【架构级·P0 硬约束缺失】并发双上限未实现（R14）

**现状**：v5 无任何并发记账——无 `subagent/start`/`end` 监听、execute 无 in-flight 计数、无 maxTeam 惰性计数。

**证据**：官方 O8 确认 `subagent/start`/`end` 事件契约（配对、runId 共享、scope 到 delegating parent、监听器独立容错、断连只发 start）——R14 计数方案与官方事件语义完全兼容。

**后果**：fan-out 无上限，成本与资源失控（P0-2 明确要求 maxActive=8/maxTeam=16）。

**解决方案**（v7）：
- `ctx.on('subagent/start'/'subagent/end', { global: true })` 配对计数（按 `info.id` 反查 `agents.get(id).session.header.parentSession === 本 root` 过滤，`return next()` 直通——R16-1/M3，官方 O8 事件语义支持）
- maxActive 同步计数：execute 内 `in-flight++`/`finally --`（L8）
- maxTeam 惰性权威计数：每次 `bg=true` 派发时 `subagents.listChildren(rootSessionId)` 实时数（R16-1）

### A5【架构级·P0 硬约束缺失】熔断/fallback 未实现（R6/D3）

**现状**：无 `agent/request-error` 监听；dispatch tier 解析不查熔断；无 fallback 链。

**证据**：v5 源码无任何 error 监听。官方 dsh 自带 llm-retry（同 provider 重试），跨供应商降级由我们管（DESIGN.md 机制事实 11）。

**后果**：供应商故障（限流/配额/超时）时子代理直接失败，无降级、无冷却（P0-1）。

**解决方案**（v7）：
- `ctx.on('agent/request-error', { global: true, prepend: false })`：delegationDepth>0 时按 tripCodes 计数，`return next()` 直通（R16-2）
- dispatch execute 解析 tier 时查熔断：命中 → 错误信息列出可用 tier + cooldown 剩余（R6），或按 fallback 链降级（D3）

### A6【功能缺失】output_schema 形同虚设（D16）

**现状**：参数 schema 已声明 `output_schema`，但 execute 只透传，无校验、无重试。

**证据**：v5 源码 execute 无校验逻辑。官方：`outputSchema` 是 provider capability（dsh-subagent），`SubagentRun.result.structured` 承载结构化结果（官方契约）。

**后果**：结构化返回不可信——模型以为拿到校验过的对象，实际是未校验原文。

**解决方案**（v7）：execute 内用 `validateJsonSchemaValue`（dsh-tools 导出）校验 `result.structured ?? result.output`；失败重试一次（改写 prompt 强调 schema）→ 仍失败返回 null。官方 `outputSchema` capability 若 provider 支持可直接透传 `request.outputSchema`（服务层校验）。

### A7【方法问题】测试环境 ≠ 部署环境

**现状**：所有实测都在 cordis preset 会话进行（子代理继承 cordis，含原生四工具；root 无协议）。

**证据**：两次实测子代理会话 `agentPreset: cordis`（E1 同源）。

**后果**：验证结果不能代表 swarm preset 部署行为——A2 缺口在 swarm 下自动消失（四行不存在），A3 协议在 swarm 下同样缺失但 root 行为依赖更强。**在 cordis 下测出的"通过"不能当作 swarm 下的"通过"。**

**解决方案**：建立**双环境验收矩阵**：
| 验证项 | cordis 环境 | swarm 环境 |
|---|---|---|
| 递归控制 | A2 修复后 deny 五工具 | deny 自动简化为 dispatch |
| 协议注入 | root 有协议 | root 有协议 |
| 原生工具存在 | 存在（可绕过风险） | 不存在（设计前提成立） |
- 关键验收（协议可见性、deny 链、重启恢复）必须切 swarm preset 会话执行。

### A8【审计不足】dispatch.log 无结果/成本/失败记录

**现状**：v5 日志只有派发行（type/tier/provider/model/persona/bg/label），无 `[stage]/[tool]/[tool_result]/[summary]/[error]` 结构（D25-4），无子代理结果回写、无成本（token 用量）。

**证据**：dispatch.log 第 5/6 行仅派发参数。

**后果**：无法核对"派发是否成功、成本多少、失败原因"，D20 幂等核对（subagent_id 对账）缺数据基础。

**解决方案**（v8）：execute 完成后追加结果行 `{stage: 'result', subagent_id, tokens, summary_len}`；失败追加 `{stage:'error', reason}`；label 仍只用于续接定位（D20）。

---

## 2. 解决方案路线图

| 版本 | 内容 | 成本 | 对应问题 |
|---|---|---|---|
| **v6（立即可做）** | deny 五工具 + **restrictableNames 过滤（修正 R11）** + **maxDepth=3（官方 O6）** + 协议 section + 人设库目录 + 工具描述修正 | 低-中 | A2, A3 |
| **v7** | 并发双上限（官方 O8 事件）+ 熔断 + output_schema 校验（官方 structured 契约） | 中-高 | A4, A5, A6 |
| **v8** | timeout + summary 续写 + 审计升级 | 中 | A8, D25 余项 |
| **终态（建包）** | swarm preset 静态挂载（O1/O7 官方路径）+ 恢复 SOP + 验收矩阵 | 高 | A1, A7 |

**v6 工具描述修正**：当前 description 写死 "Native subagent tools are disabled in this preset"——在 cordis 环境失真（原生工具存在）。改为中性表述："Delegation is governed by this tool; native subagent/workflow tools may be restricted by preset composition."（协议 section 才是"唯一入口"指令的权威载体）。

---

## 3. 与 DESIGN.md 对照总表（含官方修正）

| DESIGN.md 要求 | 官方规定 | 状态 | 版本 |
|---|---|---|---|
| type 封闭白名单 + 硬失败 | — | ✅ | v4+ |
| tier → provider/model 钉死（R13） | agentOptions 官方支持 | ✅ | v4+ |
| persona key→全文 + 转义（L7） | request.persona → section(order 0)（O5） | ✅ | v4+ |
| toolFilter knownNames 过滤 + allow 滤空 fail-loud（R11） | **restrictableNames（O3/O4），R11 需修正** | ⚠️ 用错过滤集（侥幸未炸） | **v6** |
| deny 名单（R16-4） | preset 层可过滤（O4） | ⚠️ 简化过度 → 五工具 | **v6** |
| maxDepth（D17-15"可选"） | **官方默认 3，服务层强制（O6）** | ❌ 缺失 | **v6** |
| 协议 section 注入（D26 必须做对） | section order 带合法（O9） | ❌ | **v6** |
| 人设库目录 section（order -90） | — | ❌ | **v6** |
| 并发双上限 maxActive/maxTeam（R14） | start/end 事件契约（O8） | ❌ | v7 |
| 熔断/fallback（R6/D3） | llm-retry 互补 | ❌ | v7 |
| output_schema 校验（D16） | outputSchema capability + structured（O5 相关） | ❌ | v7 |
| timeout / summary 续写（D25-2/3） | timeoutMs 声明式（官方已知局限） | ❌ | v8 |
| 结构化审计（D25-4/D20） | — | ⚠️ 派发行仅 | v8 |
| preset 平面挂载（R9/Q1） | **官方架构要求（O1/O2/O7）** | ❌ host 平面 | 终态 |
| 协议 delegationDepth 过滤（D26） | 空串丢弃（O9） | ❌（随协议注入） | **v6** |
| isConcurrencySafe（D26-11） | 官方并行契约 | ✅ | v4+ |
| 前台 dispose（D17-12） | 官方 run 所有权契约 | ✅ | v4+ |
| startContinuable 全形参（D26） | 官方 spec 契约 | ✅ | v4+ |
