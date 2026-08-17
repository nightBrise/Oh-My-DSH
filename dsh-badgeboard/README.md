# dsh-badgeboard — 子代理工牌板（Badge Board）

[English](README.en.md) | 中文

DSH Web 界面插件：把**派发出去的子代理**变成可见的「工牌团队」。

- **中栏右缘悬浮胶囊**：在线头像栈（工作中排前、空闲压暗、呼吸状态点、职级色环），hover 弹出信息卡（姓名 + 职级章 + 角色 + 状态）
- **details 栏「团队」分段**：成员列表 + 展开工牌大图（A/B/C 三种风格）+ 档案字段 + 「在目录中打开」
- **指派后自动弹右侧栏**：检测到新增子代理 → 刷新目录 + 打开详情栏（幂等）
- **随机线稿头像**：FNV-1a 种子哈希（subagent_id）→ 脸/发/眼/眉/嘴/特征 6 要素池，同人同脸、不绑定 type、零资产管道

## 功能

| 功能 | 说明 |
|---|---|
| **悬浮胶囊**（`shell.overlay` 条目 `badgeboard-rail`） | 中栏右缘 52px 圆角胶囊，`top:50%` 垂直居中，`right` = 实测 frame 网格 `gridTemplateColumns` 末段（details 列宽）+ 12px；仅显示**活跃成员**（工作中 + 休息，已完成不占位），工作中排前、空闲压暗；顶部「团队」+ 计数徽章，成员列表为独立滚动区（全量渲染，超限滚轮查看），底部工作进度条 + `工作/总数` |
| **hover 信息卡** | 胶囊级渲染 + JS 定位（`useLayoutEffect` 重算 `offsetTop - scrollTop + h/2`），**提升到滚动区外**避免被 overflow 裁剪：48px 线稿头像 + 姓名 + 职位·职级·模式行（职级 tier 色）+ 状态行；160ms 延时消失（鼠标可移入卡片），项滚出可视区自动关卡；hover/focus 均触发 |
| **胶囊交互** | 点击成员 → **跳转子代理详细界面**（先 `refreshSubagents` 再读快照 `subagentsByParent` 推导直接父地址 `{parentSessionId, childSessionId, mode}`，回退 `subagentAddress`，失败静默）；点击空白/头部/底部 → `openDetails()`；Tab + Enter/Space 键盘可达（focus/blur 同步触发信息卡） |
| **团队面板**（`details.produced.team` 子座位） | 头部统计（⚡ 工作中 / 💤 休息 / ✓ 已完成）+ **A/B/C 工牌卡风格切换**（作用于展开卡 `data-style`，默认 A，内存态）+ **↻ 刷新档案**（重拉 roster RPC）；成员行点击展开：48px 工牌大图（full 密度 + 2.6px 加重描边）+ 字段网格（subagent_id / 任务 / 类型 / 职级 / 模式）+ 「📂 在目录中打开」跳原生 catalog；面板内 **Esc 关闭右侧栏**；空态文案「暂无团队」 |
| **指派后自动弹右侧栏** | `sessions.list` 订阅检测新增 child（`parentId` = 当前会话）→ `refreshSubagents` + `openDetails()`（幂等，无开合自记账）；**`seatReady` 前置**：webui-enhance 子座位未就绪时不弹栏；会话切换时重置 child 基线，不跨会话误触发 |
| **重启自愈** | 目录**缺失或未就绪**（重启后首次 `subagentsByParent[cur]` 为 undefined / loading）→ 主动 `refreshSubagents` 自愈（修复「不派发就不显示」）；成员数据目录 entries 优先 + 会话层补充 |
| **随机线稿头像** | FNV-1a 32 位种子哈希（subagent_id，offset basis `0x811c9dc5` / prime `0x01000193`）→ 6 要素池逐项取模（脸 4 / 发 8 / 眼 4 / 眉 4 / 嘴 4 / 特征 7 = **14,336 组合**），同人同脸、跨渲染稳定、不绑定 type；密度 `full`（详情卡，含眉）/ `simple`（列表/胶囊/信息卡，省眉）/ `symbol`（模块预留，UI 未用）；职级色环 standard 蓝 / pro 紫 `#8564c4`（暗 `#9d84d6`）/ ultra 琥珀；工作态呼吸 halo（1.8s 透明度动效）；`vector-effect: non-scaling-stroke` 恒定屏幕描边 |
| **状态模型** | 三态：**工作中**（`activity === 'running'` → 呼吸 halo + 彩点 + 「正在 \<任务\>…」）/ **休息**（压暗 + 「等待下一轮」）/ **已完成**（✓ + 「已完成 ✓」）；状态点 + 文案**双编码** |
| **职级·角色表** | type → 角色：explore 研究员 / code 工程师 / write 文档撰写 / review 审查官 / general 通用成员（未知 → 「成员」）；tier → Lite / Standard / Pro / Ultra（未知 → 「职级未知」，不编造） |

## 安装

```bash
# 1. 仓库内包：本目录即包（file: 依赖）
# 2. 挂到 web profile（~/.dsh/profiles/web/package.json）：
#    dependencies 加 "dsh-badgeboard": "file:/home/zhangny/Oh-My-DSH/dsh-badgeboard"
#    dsh.profile.bundles 加 "dsh-badgeboard"
# 3. cd ~/.dsh/profiles/web && pnpm install
# 4. 重启 dsh web
```

> **改动同步**：profile 的 `node_modules` 里是 pnpm 拷贝而非符号链接，`pnpm install` 对内容变更不重拷（报 "Already up to date"）。每次改动包文件后需手动同步：
> `cp lib/client.js ~/.dsh/profiles/web/node_modules/dsh-badgeboard/lib/client.js`（host 同理），再刷新页面（client rev = 内容 sha1，自动换新）。

`cordis.patch.yml` 自动插入插件行（id `badgeboard`），无需手改 profile 组合。

## 跨包契约

| 项 | 契约 |
|---|---|
| `details.produced.team` 子座位 | webui-enhance 声明 / badgeboard 注册（改名需同步两包） |
| Host 档案 RPC | `POST /dsh-badgeboard/badge-team/roster`、`/badge-team/status` |
| 中栏右缘定位 | 实测 frame 网格 `gridTemplateColumns` 末段（details 列宽）+ 12px，跟随开合/拖拽 |
| 触发 | `sessions.list` 订阅检测新增 child（`parentId` = 当前会话）→ `layout.openDetails()`（幂等，`seatReady` 前置） |

### RPC 契约

host 侧经 `webServer.register({ kind: 'prefix', path: '/dsh-badgeboard' })` 注册，client 侧 `fetch('/dsh-badgeboard/<method>')` POST JSON；信封 `{ ok: true, value }` / `{ ok: false, error }`，未知方法 404、body 非法 400（8MB 上限）、处理异常 500。

| 方法 | 返回 `value` |
|---|---|
| `badge-team/roster` | `{ members: [{id, type, tier, persona}], pending: [{ts, type, tier, persona}] }`（pending 仅最近 10 条） |
| `badge-team/status` | `{ rosterSize }`（档案表条数） |

完整设计：`dsh-agent-swarm/docs/BADGE-BOARD-SPEC.md`（v0.2.6）。

## 数据模型（三层合并，主键 = childId）

| 层 | 来源 | 内容 |
|---|---|---|
| ① 目录层（权威，订阅实时） | `sessions.list` 快照 `subagentsByParent[cur]` | `SubagentListEntry{id, label, activity, mode, hasChildren}`；`state === 'ready'` 才取 entries |
| ② 会话层（补充） | 快照 `byId` | `displayTitle` 标题兜底、`running`、`completed`、`parentId` |
| ③ 档案层（仅派发时刻捕获） | host `tools/result`（过滤 `exec.name === 'dispatch'`） | `{type, tier, persona}`（+ `prompt` 内部使用，不随 RPC 返回） |

- **档案 join**：continuable 用 `result.value.subagentId` 精确匹配；前台 one-shot 无 subagentId → pending **60s 窗口** best-effort（从新到旧，`frontMatched` 一次性消费）；匹配失败降级「职级未知」，状态/标题照常
- **保留策略**：host 档案表上限 100 条（超限淘汰最旧），pending 上限 100（RPC 只回最近 10 条）；事件顺序不敏感
- **冷恢复**：刷新页面后 ①② 由快照重建（实时）；host 重启后档案层丢失 → 职级「未知」，文档化接受

## 文件

- `lib/index.js` — host 半部：`tools/result` 捕获 dispatch 档案 + webServer HTTP 路由（roster / status）
- `lib/client.js` — client 半部（ModuleLoader 格式）：悬浮胶囊 + hover 信息卡 + 团队面板 + 内联头像生成器
- `lib/avatar-gen.js` — 随机线稿头像生成器规范模块（client 内联其副本，保持同步）
- `package.json` — exports：`.` → host（`lib/index.js`）、`./client` → client；`dsh.bundle.patch` / `dsh.client.platform: web`；peer `react ^18.2.0`
- `cordis.patch.yml` — bundle 插件行（id `badgeboard`）

## 已知边界

- 依赖 webui-enhance 更新版（details 栏分段 + 子座位声明），未更新时胶囊照常工作、团队分段不渲染、不弹栏
- 档案 join：continuable 精确匹配 `subagentId`；前台 one-shot 走 60s 窗口 best-effort
- 头像生成器为内联副本：改 `lib/avatar-gen.js` 后需同步 client.js 内联代码
- A/B/C 风格为内存态（刷新回到默认 A），不持久化
- 多会话语义：仅当前会话（`parentId === current`）的子代理出现在面板/胶囊
- `symbol` 密度为 avatar-gen 模块预留能力，当前 UI 未使用

## License

MIT
