# dispatch 插件维护路线图（对标 Kimi Code / Claude Code 成熟实践）

> 依据：COMPARISON-REVIEW.md 三方边界对比 + ARCHITECTURE-REVIEW.md A1-A8 + Kimi 源码解析文（jishuzhan）+ Claude 官方文档
> 原则：**维护的本质 = 把"实验可用"变成"可长期演进"**。Kimi/Claude 的代码揭示的共性：配置可调、分层清晰、契约严格、测试完备、部署定型。
> 日期：2026-08-17

---

## 一、维护优先级矩阵（先做什么）

| 优先级 | 领域 | 为什么 | 对标 |
|---|---|---|---|
| **P0-1** | 部署形态定型 | 动态插件进程重启即失 + global 泄漏所有 preset（A1）——不解决，其他维护全是沙上建塔 | Claude/Kimi 均为产品内置形态 |
| **P0-2** | 配置热加载 | 改档位/类型/人设要改代码 = 每次迭代重发版；settings.yaml 一处改全生效 | Kimi 环境变量 `KIMI_CODE_AGENT_SWARM_MAX_CONCURRENCY`；Claude 声明式 frontmatter |
| **P1-1** | 代码分层 | 单函数 8 块职责（类型表/档位表/人设/熔断/并发/过滤/协议/工具）→ 不可单测、不可审阅 | Kimi 四层：TUI / SwarmMode / AgentSwarm 工具 / SubagentBatch 调度 |
| **P1-2** | 测试体系 | 熔断/并发计数/toolFilter 纯逻辑零测试，回归只能靠手测 | 成熟产品均有契约测试 |
| **P1-3** | 批量协议 | `dispatch.batch`（template+items+去重+汇总）是最大功能差距 | Kimi AgentSwarm 工具 |
| **P2** | 可观测性 / 模式开关 / 恢复协议 | 审计缺 token、协议常驻、无 resume | Kimi XML 汇总 + resume_hint |

---

## 二、逐项维护方案

### P0-1 部署形态定型（建包 + preset 挂载 + 恢复 SOP）

**现状**：动态插件进程内存、global 层注册、无恢复脚本。

**Kimi/Claude 做法**：功能随产品发布，配置随仓库版本化，无"重启即失"概念。

**维护动作**：
1. 建包：`model-router/` 目录产出独立 npm 包（或 dsh.bundle 本地包），`lib/` 提交产物
2. swarm preset 静态挂载：agent.cordis.yml 加一行 `model-router`（preset 平面 isolate，O1 官方路径）
3. 恢复 SOP：`docs/recovery.md`——重启后如何重新激活（未来建包后仅需 preset 行，自动恢复）
4. 双环境验收矩阵落地（cordis 已测 + swarm 复核）

### P0-2 配置热加载（settings.yaml 声明式）

**现状**：TIERS/TYPES/PERSONAS/limits 全部硬编码在 apply() 内——**每改一个档位就要重新 define 一个 Package**。

**Kimi 做法**：常量集中 + 环境变量覆盖（`KIMI_CODE_AGENT_SWARM_MAX_CONCURRENCY`）。
**Claude 做法**：frontmatter 声明式 + 三级层级（项目/用户/插件）+ 环境变量全局覆盖（`CLAUDE_CODE_SUBAGENT_MODEL`）。

**维护动作**（DESIGN.md D26-10 早已要求，一直未做）：
```yaml
# settings.yaml（用户可直接编辑，热加载生效）
model-router:
  tiers:
    lite:     { provider: xiaomi-token-plan-cn, model: mimo-v2.5-pro }
    standard: { provider: deepseek-official, model: deepseek-v4-flash }
    pro:      { provider: deepseek-official, model: deepseek-v4-pro }
    ultra:    { provider: qwen-token-plan-cn, model: qwen3.8-max-preview }
  types:      # 用户可增删类型、调默认档、改工具边界
  personas:   # 用户可添加自己的专业人设（accelerator/plasma/optics...）
  limits:     # maxActive/maxTeam/maxDepth
```
- execute 内 `ctx.settings.get('model-router')` **现读**（勿在 apply 快照）
- 类型/人设目录 section 动态渲染 settings 内容（D17-11 热更新）
- **收益**：加一个专业人设、调一个档位模型，改 yaml 即可，无需动代码

### P1-1 代码分层（建包时重构）

**现状**：v8 的 apply() 单函数内含 8 块职责——维护者改熔断阈值要通读全部。

**Kimi 四层启示**：
| Kimi 层 | 职责 | dispatch 对应模块 |
|---|---|---|
| TUI 命令层 | 用户入口 | （无——dispatch 即入口） |
| SwarmMode 状态机 | 模式生命周期 | protocol/catalog section 管理 |
| AgentSwarm 工具 | 协议层 | dispatch 工具（execute 只做编排） |
| SubagentBatch 调度 | 并发/限流/取消 | limits + circuit + batch |

**维护动作**：拆 `lib/` 模块（每个可独立单测）：
- `config.ts`（类型/档位/人设解析 + settings 绑定）
- `toolfilter.ts`（restrictableNames 过滤 + 降级）
- `circuit.ts`（熔断状态机，纯函数）
- `limits.ts`（maxActive/maxTeam 记账）
- `audit.ts`（dispatch.log 结构化写入）
- `protocol.ts`（协议/人设目录 section 文本）
- `tool.ts`（defineTool 组装，只做编排）

### P1-2 测试体系

**现状**：熔断阈值、并发配对、toolFilter 过滤、summary 续写——**全部逻辑零测试**，v6 修 deny 缺口前无任何测试能拦住回归。

**Kimi 启示**：调度合约注释详尽（正常阶段/限速阶段/取消语义逐条列出）→ 可测性是一等公民。

**维护动作**：
- `circuit.test.ts`：threshold=2 连续失败→open→cooldown 到期→半开
- `limits.test.ts`：start/end 配对计数、parentSession 过滤、maxTeam 惰性计数
- `toolfilter.test.ts`：restrictableNames 过滤、allow 滤空 fail-loud、降级兜底
- `protocol.test.ts`：delegationDepth 过滤（root 有/子代理无）
- `config.test.ts`：settings 解析、tier 引用校验、limits.maxTeam ≥ maxActive

### P1-3 批量协议 dispatch.batch

**现状**：fan-out 靠 root 自律（协议软指导），无批量校验/汇总/恢复。

**Kimi AgentSwarm 参数**：`description + prompt_template + items(≤128) + resume_agent_ids` + Zod strict + 去重校验 + XML 汇总 + resume_hint。

**维护动作**：
```js
dispatch.batch({
  type: 'explore',
  prompt_template: '分析 {item} 的架构，报告依赖与风险',
  items: ['src/a.ts', 'src/b.ts', 'src/c.ts'],  // ≤128，去重
  tier: 'lite',  // 可选覆盖
})
```
- 返回批量汇总：`{completed, failed, aborted}` + 逐项 `{item, subagent_id, outcome, output}` + resume 提示
- 复用现有单任务 dispatch 内部逻辑（分层后 execute 可被 batch 调用）

### P2 可观测性 / 模式开关 / 恢复协议

1. **审计补 token 用量**（A8）：result 行加 `tokens`（子代理 usage 事件或 tokenMeter 估算）——成本面板的基础
2. **SwarmMode 开关**（Kimi 三触发源/autoExit）：协议 section 从常驻 → 可进出（manual/task/tool），省常驻 token
3. **前台失败恢复**：一次性失败保留 session id 供 send_message 续做（continuable 机制已具备基础）
4. **取消分级**：started/not_started 状态（Kimi 语义）

---

## 三、维护节奏建议

| 阶段 | 内容 | 触发条件 |
|---|---|---|
| **本周** | P0-1（建包+挂载+SOP） | 当前迭代功能已全部实测 |
| **本周** | P0-2（settings 热加载） | 建包时一并迁移（DESIGN.md D26-10） |
| **两周内** | P1-1 分层 + P1-2 测试 | 建包重构时落地 |
| **按需** | P1-3 batch | 用户实际 fan-out 场景出现后 |
| **持续** | P2 各项 | 观察 dispatch.log 运行数据后定 |

---

## 四、一句话总结

**维护的核心不是加功能，而是把 v8 的"验证成果"固化成可演进的产品形态**：settings 声明式（Kimi/Claude 共性）、代码分层（Kimi 四层）、测试兜底、建包定型（O1 官方路径）。Kimi/Claude 最值得学的不是某个功能，而是**"配置与逻辑分离、逻辑与测试绑定、形态随产品发布"**这三个工程习惯。
