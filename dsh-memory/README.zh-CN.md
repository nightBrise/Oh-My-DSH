# dsh-memory

[English](README.md) | [简体中文](README.zh-CN.md)

DSH 项目级跨会话记忆插件（动态插件迭代 → 正式包，设计文档见 `DESIGN.md`）。

## 功能

- **会话 checkpoint**：事件采集 → 窗口自适应阈值阶梯（5%~90%）自动触发 → 模型 writer 按 KEEP 协议增量更新 11 节快照（`<!-- ckpt-at -->` 时间戳、11K 字符预算、超限截断 + `⚠️ truncated` 标记）
- **压缩联动**：`compaction/end` 后注入记忆 dump（checkpoint + MEMORY.md）；压缩失败跳过
- **跨会话召回**：首条真人消息注入 reminder（记忆文件精确路径）
- **Dream 整合**：`/dream` 命令或 `dream_now` 工具 → 收集窗口内 checkpoint → llm 整合（reasoningEffort off）→ 原子写回 `.dsh-memory/MEMORY.md`（快照比对防并发覆盖、路径存在性验证、行数/KB 预算）
- **History 回溯**：`history_search`（sessionQuery 索引，禁用时退化为持久化日志扫描）+ `history_around`（seq 锚点上下文）
- **每项目配置**：`.dsh-memory/settings.json`（`memory_config` 工具 / `/dshmem-config` 命令）

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

## 配置（`.dsh-memory/settings.json`）

```json
{ "memory": { "dirName": ".dsh-memory", "disableWrite": false },
  "checkpoint": { "writerRetryOnce": true, "fallbackTurnInterval": 20 },
  "dream": { "windowDays": 7, "inputMaxTokens": 50000, "maxLines": 200, "maxKB": 10 } }
```

`memory.disableWrite: true` 一键冻结写（checkpoint 停、注入停、dream 拒；读保留）。

## 布局

```
<项目>/.dsh-memory/
├── MEMORY.md / settings.json / index.json / dream.log
└── sessions/<sid>/{checkpoint.md, notes.md}
```

## 协议

MIT © 2026 zhangny
