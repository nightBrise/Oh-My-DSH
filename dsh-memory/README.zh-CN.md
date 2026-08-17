# dsh-memory

[English](README.md) | [简体中文](README.zh-CN.md)

DSH 项目级跨会话记忆插件（动态插件迭代 → 正式包，设计文档见 `DESIGN.md`）。

## 功能

- **会话 checkpoint**：事件采集（USER / TOOL_CALL / TOOL_RESULT / ASSISTANT）→ 窗口自适应阈值阶梯自动触发 → 模型 writer 按 KEEP 协议增量更新 11 节快照（未变化的节返回 `KEEP` 保留原文；`<!-- ckpt-at -->` 时间戳；11K 字符预算，超限截断 + `⚠️ truncated` 标记）。阈值阶梯随上下文窗口自适应：25K 以下不设自动阈值（退化为轮次触发，见 `checkpoint.fallbackTurnInterval`）；≤200K 为 20/40/60/80%；≤500K 为 10%~90%；更大窗口为 5%~90%；末档阈值在压力回升后会再次触发。校验失败先重试一次（`checkpoint.writerRetryOnce`）；仍无效则隔离写入 `checkpoint.md.invalid`，降级输出回退为模板；agent 销毁时补写最终 checkpoint。
- **压缩联动**：`compaction/start` 时若缓冲非空先补写一次 checkpoint（backstop）；`compaction/end` 后注入记忆 dump（checkpoint + MEMORY.md）为系统提醒；压缩失败时两者都跳过。
- **跨会话召回**：首条真人消息后（若项目确有记忆文件）注入 reminder（MEMORY.md 与最近会话 checkpoint 的精确路径），指示 agent 用 grep 定位记忆目录、用 `history_search` 查原文，不要重复询问。
- **Dream 整合**：`/dream` 命令或 `dream_now` 工具 → 收集窗口内 checkpoint（`dream.windowDays`）→ llm 整合（`reasoningEffort: off`）→ 原子写回 `<memDir>/MEMORY.md`（快照比对防并发覆盖、路径存在性验证、行数/KB 预算）；每次运行摘要追加到 `dream.log`，`index.json` 更新 `lastDreamAt`/`dreamCount`。
- **History 回溯**：`history_search`（sessionQuery 索引，禁用时退化为持久化日志扫描；支持 `sessionId`/`kind` 过滤；`limit` 10~50）+ `history_around`（seq 锚点上下文，`before`/`after` 5~20，20KB 输出上限）。
- **每项目配置**：`.dsh-memory/settings.json`（`memory_config` 工具 / `/dshmem-config` 命令）。
- **写门保护**：agent 对 `.dsh-memory/` 的 `write`/`edit` 被拒绝，仅 `MEMORY.md` 与 `sessions/<sid>/notes.md` 可写（插件自有路径对 agent 只读）。
- **旧版迁移**：首次触碰时，项目根下的 `MEMORY.md`（若存在）一次性复制到 `<memDir>/MEMORY.md`。

## 工具与命令

| 名称 | 类型 | 说明 |
|---|---|---|
| `memory_config` | 工具 | 查看/修改 `.dsh-memory/settings.json`（`action=get` 默认；`action=set` 需 `key` + `value`，值为字符串，数字/布尔自动转换） |
| `dream_now` | 工具 | 手动触发当前项目的 dream 整合（`reason` 可选，写入 `dream.log`） |
| `history_search` | 工具 | 历史事件全文检索（`query` 必填；`sessionId` 限定会话；`kind` 事件类型过滤；`limit` 默认 10，最大 50） |
| `history_around` | 工具 | 以 `history_search` 命中为锚拉取上下文（`sessionId` + `seq` 必填；`before`/`after` 默认 5，最大 20；20KB 上限） |
| `/dream` | 命令 | 手动触发当前项目的 dream |
| `/dshmem-config` | 命令 | 查看配置，或 `set <key> <value>`（如 `set dream.windowDays 14`） |

## 安装（profile bundle）

1. 本地包（或 npm 发布后改名依赖）：
   ```json
   // ~/.dsh/profiles/web/package.json
   { "dependencies": { "dsh-memory": "file:/path/to/dsh-memory" },
     "dsh": { "profile": { "bundles": [..., "dsh-memory"] } } }
   ```
2. 建 flat symlink（bundle 解析机制：`$DSH_HOME/profiles/node_modules`）：
   ```bash
   ln -sfn /path/to/dsh-memory ~/.dsh/profiles/node_modules/dsh-memory
   ```
3. 包内依赖链接（peer `@deepseek-ai/dsh-tools` 从安装闭包解析）：
   ```bash
   mkdir -p /path/to/dsh-memory/node_modules/@deepseek-ai
   ln -sfn <dsh-install>/node_modules/@deepseek-ai/dsh-tools /path/to/dsh-memory/node_modules/@deepseek-ai/dsh-tools
   ```
4. 重启 dsh 进程生效（动态插件版本随进程消失，勿与正式包并存）。

> bundle 行由 `cordis.patch.yml` 声明（经 `dsh.bundle.patch` 接入）；后续 profile patch 层可按 id 处理（如 `- id: dsh-memory` 加 `disabled: true`）。

## 配置（`.dsh-memory/settings.json`）

```json
{ "memory": { "dirName": ".dsh-memory", "disableWrite": false },
  "checkpoint": { "writerRetryOnce": true, "fallbackTurnInterval": 20 },
  "dream": { "windowDays": 7, "inputMaxTokens": 50000, "maxLines": 200, "maxKB": 10 } }
```

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `memory.dirName` | `.dsh-memory` | 项目根下记忆目录名 |
| `memory.disableWrite` | `false` | 一键冻结写：checkpoint/注入/dream 停，读保留 |
| `checkpoint.writerRetryOnce` | `true` | checkpoint 校验失败时模型 writer 重试一次 |
| `checkpoint.fallbackTurnInterval` | `20` | 无法测得上下文窗口时的轮次兜底触发（1~1000） |
| `dream.windowDays` | `7` | dream 收集 checkpoint 的时间窗口（1~365） |
| `dream.inputMaxTokens` | `50000` | 喂给 dream 输入的 checkpoint 文本预算（1000~500000） |
| `dream.maxLines` | `200` | 整合后 MEMORY.md 行数预算（10~1000） |
| `dream.maxKB` | `10` | 整合后 MEMORY.md 大小预算 KB（1~100） |

`memory.disableWrite: true` 一键冻结写（checkpoint 停、注入停、dream 拒；读保留）。

## 布局

```
<项目>/.dsh-memory/
├── MEMORY.md / settings.json / index.json / dream.log
└── sessions/<sid>/{checkpoint.md, notes.md}
```

- `MEMORY.md` — 项目级持久知识（dream 写回；agent 可经写门编辑）
- `settings.json` — 每项目配置（见上）
- `index.json` — 元数据（`version`、`lastDreamAt`、`dreamCount`）
- `dream.log` — dream 运行记录（JSON 行）
- `sessions/<sid>/checkpoint.md` — 11 节会话 checkpoint（校验失败隔离为 `checkpoint.md.invalid`）
- `sessions/<sid>/notes.md` — agent 自由 scratchpad（checkpoint writer / dream 读取；可经写门写入）

## 协议

MIT © 2026 zhangny
