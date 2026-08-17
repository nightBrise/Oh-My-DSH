# model-router 迭代笔记

> 目标：按工作类型把请求路由到不同供应商/模型（用户自有多个供应商 API）。
> 形态：先动态插件迭代（router-1），稳定后固化为独立 npm 包（dsh.bundle）。
> 状态：DESIGN.md 已定稿（v3 终稿 + 官方审查 O1-O9 修正，D27/D28 落盘，2026-08-17）。

## v1（2026-08-15 晚，动态插件 router-1/pkg-1）

**机制**（全部基于 cordis_inspect + 源码验证过的接缝）：
- `agent/request` 瀑布：`await next()` 拿建议配置 → 规则匹配 → 改写 provider/model/reasoningEffort/maxTokens
- `agent/request-error` 瀑布：可服务性失败码 → 挂起降级目标 → 返回 `{kind:'retry'}`
- 规则维度：agent 身份（root/subagent）、subagent label（正则）、上下文压力（usage/contextWindow）
- 目标可用性预检：`llm.resolveModelInfo`（成功才缓存）
- 用户选择优先：**不做 isUserSelection 启发式**——harness 的 per-session 选择监听器（agent 作用域、后注册、next() 后覆盖）结构性保证

**v1 默认规则（占位，待用户供应商清单调整）**：
| id | match | route |
|---|---|---|
| root | agent: root | deepseek-official/deepseek-v4-pro (high) |
| explore | subagent, label 调研类 | deepseek-official/deepseek-v4-flash |
| implement | subagent, label 实现类 | deepseek-official/deepseek-v4-flash |
| escalate | contextUsage ≥ 0.7 | deepseek-official/deepseek-v4-pro |

**降级链**：deepseek-v4-flash（跨 provider 时可扩展）

**上一轮验证发现的 4 个坑，v1 全部规避**：
- ✅ 无 isUserSelection 启发式（不再锁死规则）
- ✅ contextUsage = tokens / `info.context.contextWindow`（修复除对象 bug）
- ✅ 不用 `ctx.on('dispose')`（fiber effect 自动清理）
- ✅ descriptor 折叠内联 + try/catch（不再炸瀑布）

**动态环境限制**：无 import、无 z（schemastery）→ 配置硬编码；descriptor/usage 折叠内联。
**建包时迁移**：schemastery Config + `settings.register('router', …)` 热加载；内联折叠换 `@deepseek-ai/dsh-subagent` 官方函数；lib/ 产物提交 + dsh.bundle。

## v2（同日，router-1/pkg-2）——作用域修复 + 探针

**v1 失败原因**：动态插件的 ctx 不在 agent carrier 的 scope 准入链上（session scope ≠ agent
scope），`ctx.on('agent/request')` 收不到任何瀑布事件（v1 未加 global）。

**v2 修复**：监听器注册加 `{ global: true }`（Cordis dispatch filter：global hook 总是被调用），
等价于 host 平面注册；并加 fs 探针（`fs.resolve/writeText` 写 router.log，动态环境无 import
时的日志手段）。

**探针实测结果（turn 4 step 18，root 会话请求）**：
```
agent/request CALLED agent=session-37e3f4a1… turn=4 step=18
  proposed=deepseek-official/deepseek-v4-flash effort=max
  identity: root
  contextUsage=0.193 (tokens=193424, window=1000000)   ← 除法修复生效
  RULE root -> deepseek-official/deepseek-v4-pro effort=high
```
- root 识别、contextUsage 计算、规则改写全部正确 ✅
- 待确认：request/header 落盘（checkpoint flush 后验证 change 事件）

## v3（同日，router-1/pkg-3）——selection 层对抗（关键架构认知）

**v2 的隐藏 bug**：探针显示改写成功，但 request/header 从未 change——实际请求仍是 v4-flash/max。
**根因**：dsh 的模型选择是「静态每会话模型」——`installModelSelection`（dsh-host-apiproxy）
在 agent 创建时注册 `agent/request` 监听器（早于动态插件 → 瀑布外层），其 `selection.current`
getter 是 `picked ?? requestHeader.logged ?? agentDefaultModel.currentSelection()`。settings.yaml
的 `agent-default-model`（v4-flash/max）就是 selection 来源，**在瀑布外层覆盖一切改写**。

**v3 破局**：
- `ctx.on('agent/request', …, { global: true, prepend: true })` → 我们成为瀑布最外层，返回值为最终配置
- 用户显式选择检测（双基准，防锁死）：`after-inner` 结果既不等于 `agentDefaultModel.currentSelection()`
  也不等于「我们上次路由目标」→ 判定为用户显式选择，放行；否则应用规则。
- 防锁死关键：`lastRouted` 记录我们上次路由的目标，避免「自己上次的路由结果被 selection follow 后
  误判为用户选择」（上一轮 isUserSelection 锁死 bug 的现代版，已被双基准消解）。

**header 落盘确认**（v3 生效后）：
```
5528 change -> deepseek-official/deepseek-v4-pro effort: high
5565 change -> deepseek-official/deepseek-v4-pro effort: high
```
→ 路由真正生效，root 会话模型已从 v4-flash 切到 v4-pro ✅

**完整链路验证清单**：作用域(global) → selection 层对抗(prepend) → 用户选择双基准 → root 规则 →
subagent label 规则 → contextUsage 除法 → header change 落盘，全部通过。

## v4 实测（2026-08-17 11:01，swrmd-16/pkg-64）——dispatch 首真实调用

**背景**：v4 是动态插件 P1 迭代（swrmd-16，host 平面 root realm 注册工具），此前 dispatch.log 只有
注册记录——dispatch 是模型工具，必须由 root 在对话中主动发起调用才能执行。

**本次实测（type=explore, prompt=读取 DESIGN.md 标题）**：
```
dispatch.log 新增：dispatch type=explore tier=lite provider=xiaomi-token-plan-cn model=mimo-v2.5-pro
  persona=- bg=n label=explore 读取 /home/zhangny/Oh-My-DSH/model-router/...
子代理会话 9c83a599：delegationDepth=1, parentSession=本会话, agentPreset=cordis
  prompt 前缀 = explore.role（read-only research: …）✅ role 拼进 prompt（D17-1）
  request/header config = xiaomi-token-plan-cn/mimo-v2.5-pro ✅ lite 档钉死（R13）
  子代理仅用 read 工具（explore 白名单内）✅ toolFilter 生效
  子代理输出："该文档的标题是：**# model-router 设计讨论（v2：dispatch 主通道架构）**" ✅
```

**发现缺陷（v4 render）**：dispatch 工具返回给 root 的是固定字符串 "subagent output received"，
子代理实际输出没有透传。根因在 v4 源码的 `output.render`：
`render: (_a, value) => value.kind === 'continuable' ? 'started subagent ' + id : 'subagent output received'`
→ 前台结果被硬编码，`value.output` 被丢弃，违反 DESIGN.md 返回契约 `{kind:'foreground', output}`。
**修复版已在 swrmd-23/pkg-71 定义（render 渲染 value.output 文本）**，但激活被阻：dispatch 名已在
root realm 注册（"already registered"），而 swrmd-16 属另一会话，本会话无法 cordis_stop/undefine 它。

**修复路径（二选一）**：
1. 在 swrmd-16 所属会话（session-37e3f4a1）cordis_stop swrmd-16 → 本会话 swrmd-23 即可 run
2. 进程重启后（动态插件定义不持久）swrmd-16 注册消失 → swrmd-23 run 生效

**附带观察**：dispatch 工具注册在 host 平面 root realm（scope=undefined），对所有会话可见——与
DESIGN.md R9/Q1 的"preset 平面挂载"终态不同；当前迭代期以动态插件进程级注册工作，建包时需固化。

**修复完成（2026-08-17 12:09，swrmd-23/pkg-71/run-75）**：旧会话已 cordis_stop 全部插件 →
swrmd-23 激活成功（工具名不再冲突）。**二次实测通过**：
```
dispatch.log 第 5 行：dispatch type=explore tier=lite provider=xiaomi-token-plan-cn model=mimo-v2.5-pro …
  返回给 root 的是子代理真实输出（"# model-router 设计讨论（v2：dispatch 主通道架构）"）✅ render 修复生效
dispatch.log 第 6 行：dispatch type=explore tier=pro provider=deepseek-official model=deepseek-v4-pro
  persona=research … → request/header 确认 deepseek-v4-pro ✅ tier 覆盖生效
  system prompt 含 research persona 文本 ✅ persona key→全文注入生效
```

**已知缺口（v5 未实现，记录）**：`output_schema` 仅透传参数，未做 schema 校验/重试（DESIGN.md
要求"校验失败重试一次→null"）；`run_in_background` 路径未实测（startContinuable 已实现）；timeout
参数未实现（DESIGN.md D25-3）。均为 P1 后续迭代项。

## 待办
- [x] 修复 v4 render 缺陷（swrmd-23/pkg-71 已激活，二次实测通过）
- [x] DESIGN.md 定稿 + 官方审查 O1-O9 + D27/D28 落盘（2026-08-17）
- [x] **v6（swrmd-23/pkg-94/run-88）**：deny 五工具 + restrictableNames 过滤（R11 修正）+ maxDepth=3（O6）+ 协议/人设目录 section（O9）+ 描述修正
- [x] **v7（swrmd-23/pkg-97/run-91）**：熔断（agent/request-error 计数 + tier 解析查熔断）+ 并发双上限（maxActive=8 + maxTeam=16）+ output_schema（官方 outputSchema capability + structured + 失败重试一次）
- [x] **v8（swrmd-23/pkg-100/run-94，2026-08-17 实测通过）**：timeout（前台默认无/上限 3600s，后台默认 900s，timer 级联 dispose/interrupt）+ summary 续写（<200 字自动补充重试，continued=yes）+ 结构化审计（result/error 行落盘：subagent_id/summary_len/stop/elapsed_ms）
  - 实测：`result subagent_id=8d50937b... summary_len=456 stop=completed` ✅；`summary_len=1 → continued=yes summary_len=145` ✅；`timeout=30s → error reason=dispatch: subagent timed out after 30s` ✅；timeout>3600 硬失败 ✅；**后台常驻全链路**（bg=y → `mode=continuable` → list_agents ready → send_message 续接 → 成员回答 42 → settlement 送达）✅
- [ ] 终态：建包 → swarm preset 静态挂载（O1/O7）+ 恢复 SOP + 双环境验收矩阵
- [x] 修复作用域（global: true）
- [x] root 规则实测命中
- [x] 验证 request/header change 落盘
- [x] 实测 subagent label 路由（explore 子代理）
- [ ] 实测用户显式选择（GUI 换模型）→ 双基准放行
- [ ] 用户提供供应商/模型清单 → 重写规则表 + 配 llm-pi-ai providers
- [ ] 与 dsh-model-router 对比取舍：pre-step 简单问题直答（v2 候选）
