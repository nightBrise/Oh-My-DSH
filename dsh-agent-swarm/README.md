# dsh-agent-swarm

面向 DeepSeek Harness（DSH）的 **星型团队子代理编排** 插件：主 agent（root）通过唯一入口 `dispatch` 自由编排不同**档位**（模型）、不同**工具边界**、不同**人设**的 subagent，成员不扩编。

Agent swarm orchestration for DeepSeek Harness (DSH): the root agent orchestrates subagents through the single `dispatch` entry with model-tier routing, tool-boundary filtering, and persona injection. Star-team topology: members never spawn their own subagents.

[English README](README.en.md) | [设计文档 docs/DESIGN.md](docs/DESIGN.md)

---

## 核心能力（Features）

| 能力 | 说明 |
|---|---|
| `dispatch(type, prompt, options?)` | 唯一委派入口，type 封闭白名单硬失败；同轮 fan-out 可并行调用（isConcurrencySafe） |
| 档位路由（tier） | lite / standard / pro / ultra → provider/model 创建时钉死（零运行时漂移）；type 定默认档，tier 显式覆盖 |
| 工具边界 | explore/write/review 用 allow 白名单（fail-closed）；review 另含**只读 bash**（仅限 git 检视 `git status`/`git diff HEAD`）；code 全工具；全类型统一 deny 五委派工具（dispatch/subagent/subagent_fork/workflow/ralph，防递归 + 星型团队）；allow 滤空 fail-loud |
| 人设库 | 10 个内置 persona（key→全文注入，或自由文本转义）；目录 section 仅 root 可见 |
| 协议注入 | Delegation entry + 委托决策指南（何时委派 / 长驻 vs 一次性 / 成员复用）+ 档位决策规则（成本优先）+ 并行与复用纪律 + 验收闭环（maker/checker 分离）+ EARS 验收标准 + Dispatch failure handling + 团队协议骨架，仅注入 root（delegationDepth 过滤） |
| 并发与深度上限 | maxActive=8（事件配对记账 + execute 同步计数双检）+ maxTeam=16（派发时惰性权威计数）+ maxDepth=3 |
| 熔断 | agent/request-error 计数（仅子代理失败 delegationDepth>0），tripCodes 命中 → 冷却；tier 解析时查熔断，命中报错列出可用 tier 与冷却剩余 |
| 结构化输出 | output_schema 仅前台（与 run_in_background 冲突即报错）；校验失败重试一次→null |
| 超时 | 前台默认无/上限 1h，后台默认 15min；timer 级联 dispose/interrupt |
| 摘要续写 | 前台输出 <200 字自动追加补充请求重试一次 |
| 标签与追溯 | label = type + 任务摘要；每次 dispatch 落地 {type, label, tier, subagent_id, 起止时间, 成本} 审计行（subagent_id/summary_len/stop/elapsed_ms） |
| 常驻成员 | run_in_background=true → continuable 子代理，send_message 续接、list_agents 枚举；达 maxTeam 上限需 interrupt_agent 退役成员 |

## 安装（Installation）

本地包（不上 npm），挂载为 swarm preset 的一行：

```bash
# 1. 把本目录放到你的仓库（如 /path/to/dsh-agent-swarm）
# 2. 在 swarm preset 的 agent.cordis.yml 增加一行：
#    - id: dsh-agent-swarm
#      name: '/path/to/dsh-agent-swarm/lib/index.js'
# 3. 新开一个 swarm preset 会话即可使用 dispatch
```

preset 行支持**绝对路径**（自动转 file: URL 导入）或相对路径（相对 preset 目录解析）。

## 配置（Configuration）

**二选一优先**（每次 dispatch 现读热加载，无需重启）：

- **有 `model-router.local.yaml`**（本地私有，`.gitignore` 排除不上传）→ **只用它**——你的完整私有配置（私有供应商、本地人设）放这里
- **没有 local 文件** → 用 **`config.yaml`**（上传模板）——普通用户 clone 后**直接改 config.yaml 即可**实现模型路由和人设池更新

未配置的字段回退 `lib/index.js` 内置模板。

**默认档位模板**（无配置时）：

| 档位 | provider | model |
|---|---|---|
| lite / standard | deepseek-official | deepseek-v4-flash |
| pro / ultra | deepseek-official | deepseek-v4-pro |

**成员类型（types）**（封闭白名单 4 个内置；type 决定工具边界 + 默认档 + role，role 拼进子代理 prompt）：

| type | 默认档 | 工具边界（allow 白名单） | role |
|---|---|---|---|
| explore | lite | read / glob / grep / web_search / skill / list_agents / job_list / job_output / get_goal | 只读调研：定位代码、理解模式、收集事实 |
| code | lite | 全工具（统一 deny 五委派工具） | 实现：编辑、构建、自测；报告改动与验证证据 |
| write | standard | read / glob / grep / web_search / write / edit / skill / todo_write / list_agents / job_list / job_output | 文档写作：论文、笔记、README |
| review | pro | read / glob / grep / web_search / skill / list_agents / job_list / job_output / get_goal / bash（仅只读 git） | 独立审查**最近的更改**：先 `git status` / `git diff HEAD` 看清实际改动再审查，报告优先级问题与具体修复（file:line 引用） |

**1. 配置模型档位**——编辑 `config.yaml` 的 `model-router.tiers`（或本地片段放 `model-router.local.yaml`）：
```yaml
model-router:
  tiers:
    lite:     { provider: deepseek-official, model: deepseek-v4-flash }
    standard: { provider: deepseek-official, model: deepseek-v4-flash }
    pro:      { provider: deepseek-official, model: deepseek-v4-pro }
    ultra:    { provider: deepseek-official, model: deepseek-v4-pro }
```
（自己的供应商：先在 `~/.dsh/settings.yaml` 的 `llm-pi-ai.providers` 配 API key 环境变量，再把 provider 换成你的供应商名——**私有配置放 `model-router.local.yaml`**，不要进 `config.yaml`）

**2. 编辑人设池**——编辑 `model-router.personas`（内置 10 个：physics / ml / data / research / docs / backend / reviewer / statistician / planner / consultant，可覆盖/增删）：
```yaml
model-router:
  personas:
    accelerator:
      text: "For this task you act as an accelerator physicist: ..."
```
新条目自动出现在 root 的人设目录 section，`dispatch(persona="accelerator")` 立即可用。

**3. 上限与熔断**——`config.yaml` 内 `limits`/`circuit` 注释齐全；默认值：

| 配置项 | 默认 | 说明 |
|---|---|---|
| limits.maxActive | 8 | 并发"干活中"子代理数（全局 in-flight + 每会话活跃子代理双检） |
| limits.maxTeam | 16 | 常驻 continuable 成员总数上限（派发时惰性计数；超限需 interrupt_agent 退役） |
| limits.maxDepth | 3 | 委派深度上限（服务层强制，星型团队兜底防线） |
| circuit.tripCodes | RATE_LIMIT / QUOTA / TIMEOUT / TRANSPORT / SERVER / EMPTY_RESPONSE | 命中即计数 |
| circuit.threshold / cooldownMs | 2 次 / 60000ms | 连续失败阈值与冷却时长 |

**4. 其他开关**——`protocolSection`（root 协议注入开关）/ `personaCatalogSection`（root 人设目录开关）/ `logPath`（审计日志路径，默认 `./dispatch.log`）。

**本地私有配置**：有 `model-router.local.yaml` 时**只用它**（.gitignore 排除，不上传）——结构与 `config.yaml` 相同（`model-router:` 顶层键），把私有供应商/本地人设写进去即可；没有 local 文件时直接改 `config.yaml`。

## 用法示例（Usage）

```
dispatch(type="explore", prompt="分析 src/ 下模块依赖，报告风险")
dispatch(type="code", prompt="实现 xxx，附验证证据", tier="standard")
dispatch(type="write", prompt="为 utils/ 写一份 README，匹配仓库风格", persona="docs")
dispatch(type="review", prompt="审查 PR 质量，给结构化意见", output_schema={...})
dispatch(type="review", prompt="审查 PR 质量", tier="ultra", timeout=600)
dispatch(type="explore", prompt="持续调研 xxx", run_in_background=true)  # → send_message 续接
```

## 文档（Docs）

- `docs/DESIGN.md` — 设计终稿（v3 + 官方审查 O1-O9 修正，D1-D28 决策记录）
- `docs/ARCHITECTURE-REVIEW.md` — 官方架构对照（O1-O9）+ A1-A8 问题
- `docs/COMPARISON-REVIEW.md` — 与 Kimi Code Swarm / Claude Code Agent Teams 三方边界对比
- `docs/MAINTENANCE-ROADMAP.md` — 维护路线图（P0-P2）
- `docs/BADGE-BOARD.md` — 工牌面板设计草案（讨论中）
- `docs/BADGE-BOARD-SPEC.md` — 子代理工牌右侧栏方案 Spec（v0.2.12 定稿，已固化入 `dsh-badgeboard` 包）
- `docs/NOTES.md` — model-router 迭代笔记（v1-v8 动态插件迭代记录）
- `docs/PACKAGE-NAMING.md` — 命名决策记录

## License

MIT
