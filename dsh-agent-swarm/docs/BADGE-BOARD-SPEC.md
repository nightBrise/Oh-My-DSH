# 子代理工牌 · 右侧栏方案（方案 B）Spec v0.2.3（定稿）

> 状态：**定稿 v0.2.12 → 已固化 v0.1.0（2026-08-17）**（v0.2.6 修复胶囊 overflow 裁剪与网格列宽解析；v0.2.7 头像高对比 + 职·级角标；v0.2.8 胶囊回归纯头像、职位职级移入 hover 卡；v0.2.9 放大尺寸；v0.2.10 滚动扩展 + hover 卡提升到滚动区外；v0.2.11 成员点击跳转子代理（目录推导地址）；v0.2.12 重启自愈——成员数据改目录 entries 优先 + 目录未就绪自动 refreshSubagents（修复重启后胶囊消失）；已固化入 `dsh-badgeboard` 包，实现状态见 §8）
> 关联：[BADGE-BOARD.md](./BADGE-BOARD.md)（v0.1 草案）· [DESIGN.md](./DESIGN.md)（swarm 包设计）· dsh-webui-enhance（Web GUI 增强包）· DSH 原生 `subagent-catalog`（dsh-client-ui-subagent）
> 审查记录：美学（5×P1 已吸收）、UX/a11y（8×P1 已吸收）、架构（4×P1 因方案收缩消解大半）、深度审查 v0.2.2（P1×2/P2×5）、多智能体 UI 调研（在场头像栈 + hover 展开，v0.2.3）
> 日期：2026-08-17

---

## 1. 背景与决策记录

**动机**：Kimi OK Computer 的核心是"可观察性"（实时看着 Agent 干活）。DSH 对话流范式下，可观察性的最佳形态是"指派后弹出团队视图"。

**原生能力核实**（决定本项目范围）：DSH 原生已有 `subagent-catalog`（会话头部按钮，树形子代理目录：label/mode/运行状态/活跃耗时/统计/打开续接/@提及，数据源 client `sessions.list` 快照）。**本项目不做与其重复的能力**。

| # | 决策（用户拍板） | 结论 |
|---|---|---|
| D1 | 定位 | **工牌增强层**：只做原生没有的——工牌身份可视化（type 职位/tier 职级/任务）+ 在场可见性 |
| D2 | 出现方式 | **A+B 双路径**：常驻**在场头像栈**（中栏右缘，hover 展开横条）+ **指派后自动弹右侧栏**（团队分段，详情/操作）；触屏/点击走弹栏 |
| D3 | 头像 | **随机线稿漫画脸**（SVG 手绘，种子 = subagent_id，不绑定 type，同人同脸）——竖条 30px 简化线稿（v0.2.4 弃 symbol 密度：26px 下只剩单路径 = 大灰圆）、hover 信息卡 40px 简化线稿、详情 48px 全要素；全部 `vector-effect: non-scaling-stroke` 恒定屏幕描边 |
| D4 | 美学风格 | 拟物工牌（A）为主：圆角描边卡 + tier tint 底 + 色环；按美学审查修正 token 问题（见 §7.4） |
| D5 | 与原生分工 | 打开/续接/树形/耗时/@提及 → 原生 catalog；工牌详情提供「在目录中打开」跳转 |
| D6 | 数据 | 状态/标题/mode = client `sessions.list` 快照（原生实时）；type/tier/persona = Host `tools/result` 捕获档案；按 childId 合并 |
| D7 | 触发 | `sessions.list` 订阅检测新增 child（parentId = 当前会话）→ `layout.openDetails()`（幂等）；竖条常驻不依赖触发 |
| D8 | 语言 | 中英双语键表（client `locale` 服务） |
| D9 | 退役语义 | v1 不造退役机制：已完成/已离职由 sessions 状态驱动灰化展示；完整退役标记 v2 |
| D10 | 生命周期 | v1 为动态插件（会话级）；固化标准见 §10 |

---

## 2. 目标

1. 用户 dispatch 派出子代理 → **右侧栏自动弹出**，显示团队工牌列表。
2. 工牌表达身份：**随机线稿脸（唯一） + 名字（任务短标题） + 职位·职级（type/tier） + 状态行**。
3. 与 webui-enhance 产物预览共存于同一右侧栏（「产物 | 团队」分段），零通信联动。
4. 不重复原生 `subagent-catalog`：打开/续接等操作跳原生。
5. 视觉与 DSH 原生美学严格一致（token 驱动、线性图标语言、克制动效）。

---

## 3. 架构总览

```
┌─ 中栏对话 ──────────────────────┬─ 竖条 ─┬─ 右 details ──────────┐
│  dispatch(...)                 │  👥     │  [📦产物][👥团队]       │
│  · 工牌单卡 …（v1.1）            │  ◉●    │  工牌列表…              │
│  · …                            │ ╭──────────────╮ │            │
│                                 │ │◉ 短标题       │ │  ← hover 横条 │
│                                 │ │研究员·Lite●正在│ │      (向左)   │
│                                 │ ╰──────────────╯ │            │
│                                 │  ◉○    │        │            │
└─────────────────────────────────┴────────┴────────┴────────────┘
   竖条（v0.2.5 悬浮胶囊）：shell.overlay 条目，frame 内 absolute，垂直居中（避开头部按钮与 ✕）
   right = 实测 frame 网格第 3 列（details）宽 + 12px —— MutationObserver/ResizeObserver 跟随开合与拖拽

dispatch(...) 派出子代理
      │
      ▼  Client: sessions.list 订阅（parentId === 当前会话 && 新增 child）
      ▼  layout.openDetails()（幂等）→ webui-enhance 栏 → view 规则 → 「团队」分段
      ▼
details.produced.team 子座位 ← badgeboard 注册的团队工牌面板
      │
      ├─ 状态/标题/mode ← sessions.list 快照（原生实时，订阅驱动重渲染）
      └─ type/tier/persona ← Host 半部 tools/result 捕获 → harness.handle('badge-team/roster') RPC
```

**座位分配**：

| 座位 | 所有者 | 内容 |
|---|---|---|
| `details`（single，session） | webui-enhance（priority -1） | 栏壳 + 「产物\|团队」分段 + 产物页签 |
| `details.produced.team`（single，session） | webui-enhance 声明 / **badgeboard 注册** | 团队工牌面板 |
| `shell.overlay`（list，additive） | badgeboard | **在场头像栈**（悬浮胶囊，hover 信息卡） |
| （头部按钮、dispatch 单卡——v1 不做） | — | — |

---

## 4. 跨包契约

### 4.1 webui-enhance 侧（已改 7 处，1 处待修）

1. 注册 `details` 时声明子座位：`children: { 'details.produced.team': { kind: 'single', scope: 'session' } }` ✅
2. 分段 UI「📦 产物」「👥 团队」✅
3. view 规则（零通信联动）：`view = (pane==='team' || tabs.length===0) ? 'team' : 'produced'` ✅
4. 团队视图 `renderSlot('details.produced.team', {})` + 占位文案 ✅
5. 右缘留白：closeBtn `marginRight:44`、body `paddingRight:54`——**v0.2.5 起可回退**：胶囊位于 details 栏左侧（中栏右缘），栏内留白不再需要；列入 §8 回退候选
6. ~~v0.2.3 变量机制（`frame.dataset.dshDetailsOpen` + `--dsh-details-px`）~~ —— **v0.2.5 弃用**：badgeboard 直接实测 frame 网格 `gridTemplateColumns` 第 3 列（ResizeObserver + MutationObserver 跟 style/data-details-collapsed），不依赖 webui-enhance 版本；保留 webui-enhance 的变量设置代码不影响正确性
7. **待修（UX 审查 P1 + 深度审查 P2）**：文件 tab onClick 需补 `setPane('produced')`（否则团队分段下点 tab 静默无响应）；分段加 `aria-pressed`；文件 tab 与关闭按钮改语义化 button（键盘可达）。Esc 关闭**不在此处做**（归属 badgeboard TeamPanel，见 §7.5）。
8. 跨包契约文档化：`details.produced.team` 为显式契约（webui-enhance 声明、badgeboard 消费，改名需同步两包）——本节即该文档。

### 4.2 badgeboard 侧（✅ 已固化：`dsh-badgeboard` 包，lib/index.js + lib/client.js + cordis.patch.yml）

1. 注册 `details.produced.team` 条目（`slots.inject` 等待声明，webui-enhance 未更新时静默等待不报错）；inject 回调触发时置 `store.seatReady = true`。
2. 触发（v0.2.2 修订，幂等无自记账）：
   - 订阅 `sessions.list`（`list.subscribe`），检测 `byId` 中新增 child（`parentId === 当前 sessionId`）
   - 触发时主动 `sessions.refreshSubagents(current)`（目录快照按需刷新，保证 `subagentsByParent` 新鲜）
   - 调 `layout.openDetails()`——**假定幂等**（栏已开则重复调用无副作用），不做开合自记账（✕ 关栏由 webui-enhance 执行，badgeboard 感知不到，自记账必然漂移）
   - **seatReady 前置检查**：inject 未就绪（webui-enhance 未更新）时**不弹栏**（避免打开无团队分段的空栏）
4. **在场头像栈（v0.2.3 新增，v0.2.4 视觉重设计，v0.2.5 定位重设计，v0.2.6 实现修正）**：`shell.overlay` 条目（id `badgeboard-rail`），**悬浮胶囊**——`position:absolute`（frame 坐标系，非 fixed），**垂直居中**（`top:50%; translateY(-50%)`），`right` = 实测 details 列宽 + 12px；实测方式：`[data-shell-overlay]` 的 parentElement 即 frame，读 `getComputedStyle(frame).gridTemplateColumns` **最后一段**（`minmax(0px, 1fr)` 含逗号空格会被拆成多段，取 `cols[cols.length-1]`；折叠时 = 0px，天然三列恒定）；触发：ResizeObserver（窗口缩放）+ MutationObserver（`data-details-collapsed` 开合 / `data-dragging` 拖拽起止；React 内联样式走 CSSOM，`style` 属性不触发）+ window `pointermove` rAF 节流（拖拽中列宽连续变化）。**胶囊不带任何 overflow**（`overflow-y:auto` 会裁剪向左伸出的 hover 信息卡）。**为何不 fixed/不靠变量**：fixed 贴视口右缘会遮中栏头部 session log 按钮、以及任何右侧面板（details 栏/轨迹详情）右上角 ✕；垂直居中 + 贴中栏右缘同时避开两者。只显示**活跃成员**（工作中+休息，已完成/离职不占位）。**v0.2.4 视觉规范**：
   - 布局（v0.2.9 放大，v0.2.10 滚动扩展）：**52px** 宽胶囊（圆角 999 + border-l2 + 投影 0 4px 20px 亮 0.12/暗 0.35），**`max-height: min(640px, calc(100% - 96px))`**（≈ 12 个头像高度封顶）；成员列表 = 独立滚动区 `.bdb-rail-list`（`overflow-y:auto` + 隐藏滚动条，`flex:1; min-height:0`），成员 >12 时**滚轮上下滚动查看全部**（列表全量渲染，无 +N 截断）；顶部竖排「团队」小字（12px）+ 计数徽章（18px），底部工作进度条（22×4 圆角，宽度 = 工作占比）+ `工作/总数` 数字（11px tabular-nums）
   - 成员项（v0.2.7 高对比，v0.2.8 回归纯头像，v0.2.9 放大）：**36px** 头像 = **tier 淡色底**（standard 蓝 16% / pro `rgba(133,100,196,.18)` / ultra 琥珀 18%，未知 = 透明；color-mix 于 token，弃实心灰圆盘）+ 简化线稿（simple 密度）+ `non-scaling-stroke` **2.1px** 恒定描边 **label-primary**（高对比）+ 职级色环 **2px** 不透明（standard 蓝 / pro 紫 / ultra 琥珀）；SVG 占位 inset 5%。**胶囊只放头像**——职位/职级信息集中在 hover 信息卡（v0.2.8 移除文字角标）
   - 状态编码：工作中 = 彩环 + 9px 呼吸状态点（右下 -2px 定位，2px 底色描边）；空闲 = 整项 `opacity .5 + grayscale .45`（hover 恢复）；列表**工作中排前**
   - hover（v0.2.10 重构）：信息卡**提升到滚动区外**（胶囊级渲染 + JS 定位，`useLayoutEffect` 计算 `item.offsetTop - scrollTop + h/2`），避免被滚动区 overflow 裁剪；JS hover/focus 状态 + 160ms 延时消失（鼠标可移入卡片）；item 滚出可视区自动关卡；**296px** 信息卡（圆角 14 + border-l2 + 投影 0 8px 28px 亮 0.14/暗 0.38 + 左侧三角箭头）：**48px** 头像（软底 bg-layer-1）+ 姓名行（14px）+ **职位·职级·模式行**（`研究员 · Pro · 常驻成员`，12px，职级用 tier 色 `bdb-pop-role-tier`）+ 状态行（12px）
   - 交互（v0.2.7，v0.2.11 修地址推导）：**成员项点击 = 跳转子代理详细界面**——`sessions.subagentAddress` 只返回「已保留」地址（目录选中过才有），新派发子代理拿不到 → **先 `refreshSubagents` 再读快照 `subagentsByParent` 推导直接父地址** `{parentSessionId, childSessionId, mode}` → `openSubagent(address)`（`selectSubagent` 会校验 catalog entry 健康）；失败静默不打开右侧栏；胶囊空白/头部/底部点击 = `openDetails()`；项聚焦 `outline 2px business-primary`
5. Host：`tools/result`（session-scoped，过滤 `exec.name==='dispatch'`）捕获 `{type, tier, persona}` 存档；`harness.handle('badge-team/roster')` 返回档案表；`harness.handle('badge-team/status')` 返回 `{seatReady, rosterSize}` 健康信号。
6. 档案 join（v0.2.2 修订，见 §6）：continuable 用 `result.value.subagentId` 精确 join；前台 one-shot 无 subagentId，best-effort 时序匹配。

### 4.3 与原生 subagent-catalog 的分工（契约）

| 能力 | 归属 |
|---|---|
| 打开子代理、续接、树形、活跃耗时、@提及 | 原生 catalog（我们不实现） |
| 工牌身份视图（职位/职级/任务/随机脸） | 本项目 |
| 指派后自动弹栏 | 本项目（原生无此触发） |
| 详情「在目录中打开」 | 本项目调 `sessions.openSubagent(address)` 跳原生 |

### 4.4 生效条件

- webui-enhance 为旧式 client module（bundle = lib/client.js，rev = 内容 sha1，无 HMR watcher）→ **改后需重启 `dsh web`**。
- badgeboard 静态包（`dsh-badgeboard`）→ 随 `dsh web` 启动加载（bundle patch 自动挂插件行）；动态插件 bdgbd-1 仅作开发期验证，重启后自然消失。

---

## 5. 交互规则

| 操作 | 行为 |
|---|---|
| dispatch 派出新子代理 | 右侧栏自动弹出（检测 byId 新增 child，parentId=当前会话；`openDetails()` 幂等，栏已开不重弹不干扰），显示「团队」分段 |
| 栏内「产物\|团队」分段 | 手动切换；无产物 tab 时强制团队视图 |
| 点对话产物 chip | 自动切「产物」分段并打开 tab |
| 关掉全部产物 tab | 自动回「团队」分段 |
| 点成员行 | 展开详情（工牌大图 + 字段网格 + 「在目录中打开」） |
| Esc（面板内焦点）/ ✕ | 关闭右侧栏；无残留状态，下次指派再弹 |
| 空态 | `暂无团队 —— 使用 dispatch 创建子代理后自动出现` |
| 降级（webui-enhance 未更新/卸载） | 不弹栏（seatReady 前置检查）；团队分段占位文案由 webui-enhance 渲染 |

**已知限制（v1 接受）**：
- 触发依赖 `sessions.list` 快照：新 child 出现的延迟取决于 Host list 投影的实时性（原生订阅，框架保证）。
- 多会话语义：档案归属"定义该插件的 root 会话"；触发仅在当前会话发生；跨会话查看时团队分段显示"该会话无团队"占位。
- 轮询不引入（v1）：sessions 快照订阅即实时；Host 档案仅派发时刻捕获，无持续状态流。

---

## 6. 数据流（v1 定稿，v0.2.2 三层模型）

```
数据源三层（按优先级合并，主键 = childId）：

① 目录层（权威，订阅实时）：sessions.list.getSnapshot().subagentsByParent[current].entries
   SubagentListEntry{ id, label, activity:'running'|'inactive', mode, hasChildren }
   —— state:'loading' 时等待 ready（显示骨架/轻占位）；state:'error' 时显示错误降级
   —— 快照按需刷新：触发弹栏时先 sessions.refreshSubagents(current)

② 会话层（补充）：byId[id]{ displayTitle, running, completed, parentId, blank }
   —— 标题兜底（one-shot 无 label 时）、已完成标记、面包屑来源过滤

③ 档案层（Host 捕获，仅派发时刻）：tools/result 过滤 exec.name==='dispatch'
   —— exec.arguments{ type, tier, persona } + prompt 短标题
   —— continuable：result.value.subagentId 精确 join（{kind:'continuable', subagentId}）
   —— 前台 one-shot：result.value 无 subagentId → best-effort 时序匹配
     （dispatch 时间 ≈ 新 child 出现时间，取窗口内最近者）；匹配失败 → 降级"职级未知"
   —— 事件顺序不敏感（档案 enrich 与状态无关）

合并：TeamPanel 以 childId 为主键 join ①②③
   —— 档案缺失 → 工牌显示"职级未知"（不编造），状态/标题照常

冷恢复：刷新页面后 ①② 由快照重建（实时）；Host 重启后档案层丢失
   —— 不硬反推 provider/model（listChildren 无此字段）→ 职级显示"未知"，文档化接受
```

**档案表保留策略**：Host 档案表（仅 type/tier/persona 记录）上限 100 条，超限按时间淘汰；只影响档案层，不影响 ①② 状态正确性。

**RPC 契约**：
- `badge-team/roster` → `{ members: [{id, type, tier, persona?}] }`（仅档案，无状态）
- `badge-team/status` → `{ seatReady, rosterSize }`

---

## 7. UI 规范

### 7.1 团队面板（details 栏内）

```
┌─ [📦产物] [👥团队] ──────────────────── ✕ ─┐
│ 👥 团队  ⚡2 💤1        [A][B][C]    ↻      │  ← 标题+统计+风格切换+刷新
├──────────────────────────────────────────┤
│ ╭─╮ 分析 src/ 模块依赖   研究员·Lite ●正在…│  ← B 风格行式工牌（默认）
│ ╰─╯ 实现 dispatch 工具   工程师·S   ●正在…│     行+0.12分隔线+状态点
│     撰写设计文档         撰写·S   ○等待…  │
│   （点击行展开）                           │
│  ┌─────────────────────────────┐         │
│  │ ╭─╮ 线稿大头像（48px）        │         │  ← A 风格详情卡（展开）
│  │ 分析 src/ 模块依赖            │         │     扁平描边卡：border-l2 +
│  │ 研究员 · Lite   ●正在…       │         │     bg-layer-2 + radius 12
│  └─────────────────────────────┘         │
│  subagent_id  sa-a1f3                     │
│  任务          分析 src/ 模块依赖          │
│  类型/职级     explore · lite             │
│  [📂 在目录中打开]                        │  ← sessions.openSubagent 跳原生
└──────────────────────────────────────────┘
```

- 头部：统计（⚡工作中 / 💤休息——原生状态色语义）+ A/B/C 风格切换 + ↻ 刷新（重新拉 roster）
- 行式工牌（B，默认主风格）：头像 34px（线稿）+ 任务短标题 + 职位·职级 chip + 状态点文案
- 详情（A 拟物卡）：线稿大头像 48px + 字段网格 + 「在目录中打开」

### 7.2 随机线稿头像生成器（D3 定稿）

**原则**：线稿、样式随机、不与 type 绑定；种子 = subagent_id，**同人同脸**（跨渲染/冷恢复稳定）。

**要素池**（每格选一，组合 = 4×8×4×4×4×7 = 14,336 种）：

| 要素 | 选项数 | 池 |
|---|---|---|
| 脸型轮廓 | 4 | 圆脸 / 方脸 / 鹅蛋脸 / 长圆脸 |
| 发型 | 8 | 短发齐耳 / 自然卷 / 中分刘海 / 丸子头 / 双马尾 / 寸头 / 波浪长发 / 光头 |
| 眼睛 | 4 | 圆点眼 / 线眼 / 弯月笑眼 / 垂眼 |
| 眉毛 | 4 | 平眉 / 挑眉 / 八字眉 / 无眉 |
| 嘴 | 4 | 微笑 / 抿嘴 / 张嘴笑 / 平线 |
| 附加特征 | 7 | 无 / 圆框眼镜 / 单片眼镜 / 头戴耳机 / 发簪 / 雀斑 / 胡茬 |

**表情与状态解耦**：脸谱随机定死 = 身份，不承担状态；状态由外部元素表达（状态点 + 文案 + 灰化）。

**颜色**：线稿恒 `label-secondary`（黑白证件照感，亮/暗自适应）；底色盘 = tier tint（lite 灰 8% / standard 蓝 10% / pro 紫 10% / ultra 琥珀 10%）+ 外圈 tier 色环 2px；Pro 紫 `#8564c4/#9d84d6` 经 `theme.overrideTokens` 双值注册（卸载回收）。

**尺寸降级**：

| 尺寸 | 用途 | 线稿密度 |
|---|---|---|
| 48px | 详情卡大图 | 全要素（轮廓+发+眼+眉+嘴+特征），`--lg` 2.5px 加重描边（手稿感） |
| 40px | hover 信息卡 | 简化（轮廓+发+眼+嘴+特征，省眉） |
| 34px | 列表行 | 简化（轮廓+发+眼+嘴+特征，省眉） |
| 30px | 竖条工牌项 | 简化（轮廓+发+眼+嘴+特征，省眉）——v0.2.4 起弃 symbol 密度 |

**实现**：SVG path 表（5 组要素池手绘）+ 种子 hash 纯函数（**FNV-1a 类稳定字符串 hash**，subagent_id → 各要素索引，保证跨渲染/进程稳定）；动态插件内联 `React.createElement('svg', …)`，零资产管道。

### 7.3 工牌卡风格（A/B/C 切换器）

| 风格 | 特征 | 定位（默认） |
|---|---|---|
| B 极简线条 | 行式：0.12 分隔线 + 原生状态点 + 线稿小头像 | **列表默认主风格**（信息密度匹配 640px 栏） |
| A 拟物工牌 | 描边卡：`border-l2` + `bg-layer-2` + radius 12 + 48px 头像 | **详情卡默认**（用户偏好，保留工牌隐喻） |
| C 浮层卡 | `bg-layer-3` + `border-l2` + 轻阴影 `0 2px 8px rgba(0,0,0,.12)`（暗 0.2） | 差异化选项（弃用毛玻璃） |

### 7.4 主题与美学约束（美学审查 P1 修正全部吸收）

| 项 | 修正 |
|---|---|
| 玻璃质感 | **弃用** backdrop-blur（DSH 无此语言）；竖条/浮层一律 token 分层 + 边框 |
| 可见边框 | `border-l2`（浅 0.10/暗 0.12）；行分隔 `rgba(128,128,128,0.12)`（样本级）；`border-l1` 仅弱分割 |
| 蓝色 | `--dsw-alias-state-business-primary`（= deepseek-500/450 系），**禁用** `--dsw-alias-brand-primary`（反差色 token，非品牌蓝） |
| 危险色 | `--dsw-alias-state-error-primary`；hover 填充 `--dsw-alias-interactive-bg-hover-danger` |
| 阴影 | `0 2px 8px rgba(0,0,0,.12)`（暗 .2），禁大扩散高透明 |
| 动效 | 仅透明度动画（无缩放/位移）；周期 ≤1.8s；全部包 `@media (prefers-reduced-motion: reduce)` 关闭 |
| 状态点 | 对齐原生结构：实心点 + 10% 光环（非自定义辉光） |
| 灰化 | 文字色 token 降级（label-tertiary）+ opacity ≤0.55（对比度 ≥4.5:1） |
| 值级 | 圆角：tab/按钮 6、统计 chip 6、卡 10、A 卡 12（上限）；字号：栏头/成员 13、副题/状态 12、统计 13-18；间距：栏内 padding 14、行高 1.6-1.7 |

### 7.5 可访问性（UX 审查 P1 吸收）

- 分段按钮：语义化 button + `aria-pressed`；文件 tab：语义化 button（可 Tab 聚焦）
- 图标按钮（✕/↻/风格切换）：`aria-label`；成员行：button 语义或 `role=button` + tabIndex
- Esc 关闭：**badgeboard TeamPanel 根挂 React `onKeyDown`**（不需要 document 监听，不改 webui-enhance）
- 状态双编码：点 + 文案（不纯靠颜色）；色盲可辨
- 长标题截断：`max-width + ellipsis`（状态文案 ≤130px）

---

## 8. 实现清单与状态

| # | 改动 | 归属 | 状态 |
|---|---|---|---|
| 1 | 子座位声明 + 分段 + view 规则 + 留白（7 处） | webui-enhance | ✅ 已改（node --check 通过） |
| 2 | tab 联动 bug（onClick 补 setPane）+ aria/键盘 | webui-enhance | ⏳ 待修 |
| 3 | **留白回退**（v0.2.2：body paddingRight 54→18、closeBtn marginRight 44→0） | webui-enhance | ⏳ 待修 |
| 4 | 团队面板条目（三层数据合并 + 随机线稿头像 + A/B/C + Esc） | badgeboard（已固化 `dsh-badgeboard`） | ✅ 已实现（pkg-8 定稿） |
| 5 | 自动弹栏触发（byId 检测 + refreshSubagents + openDetails 幂等 + seatReady 前置） | badgeboard（已固化） | ✅ 已实现 |
| 6 | Host 档案捕获（tools/result 过滤 dispatch + 前台 best-effort join + roster/status RPC） | badgeboard（已固化） | ✅ 已实现 |
| 7 | 重启 dsh web 使 webui-enhance + dsh-badgeboard 生效 | 用户 | ⏳ |
| 8 | 重启后验收（胶囊/信息卡/团队面板 + 真实 dispatch） | 用户 | ⏳ |

---

## 9. 验收标准

### 9.1 功能
- [ ] dispatch 派出子代理 → 右侧栏自动弹出，默认「团队」分段（无产物 tab 时）
- [ ] 栏已开时不重复弹出（去抖合并 fan-out）
- [ ] 团队成员行：随机线稿头像（同人同脸）+ 短标题 + 职位·职级 + 状态行
- [ ] 点产物 chip → 自动切「产物」；关全部 tab → 自动回「团队」
- [ ] 详情展开：大图头像 + 字段 + 「在目录中打开」跳原生 catalog
- [ ] 空态/降级占位文案正确
- [ ] 风格切换 A/B/C 即时生效

### 9.2 视觉（§7.4 逐项）
- [ ] 无 backdrop-blur；可见边框全 l2 级；蓝色全 state-business 系
- [ ] 动效仅透明度、≤1.8s、reduced-motion 关闭
- [ ] 亮/暗主题 token 驱动无硬编码（Pro 紫除外，经 overrideTokens）

### 9.3 可访问性（§7.5 逐项）
- [ ] 键盘可达：分段/tab/成员行/图标按钮均可 Tab + Enter 激活
- [ ] aria-label/aria-pressed 齐全；Esc 关闭
- [ ] 状态点 + 文案双编码；灰化对比度 ≥4.5:1

### 9.4 架构
- [ ] webui-enhance 单独升级（子座位改名）→ 不弹栏（seatReady 前置）、团队分段占位提示、无崩溃
- [ ] badgeboard 单独 stop → 面板/触发/订阅/RPC 全部消退
- [ ] 多会话：另一会话的子代理不出现；当前会话无团队时占位
- [ ] 冷恢复：刷新后 ①② 层重建；Host 重启后档案降级"职级未知"不崩溃
- [ ] 目录快照 state 分支：loading 骨架 / error 降级提示
- [ ] 前台 one-shot 与后台 continuable 两种 dispatch 的档案 join 均正确（或前台降级"职级未知"）
- [ ] 幂等弹栏：栏已开时再 dispatch 不抖动、不重复弹出
- [ ] 真实端到端冒烟：swarm preset 会话中真实 dispatch 1 个后台子代理 → 面板出现且状态正确（**注意：动态插件会话隔离，需在目标会话中重新挂载插件**）

---

## 10. 迭代计划（v1.1+）

- 竖条（常驻状态可见性）：恢复候选；需 layout 状态订阅或 DOM 属性总线（webui-enhance `data-dsh-wide` 同款模式），不做框架 API
- dispatch 单卡工牌：`tool.call.toolview` key=`dispatch`（swarm preset 会话）
- 真实续接/退役：`subagents.followup` / `interrupt`（权限：root handle 由 Host `agents.get(定义会话 id)` 解析，RPC 参数最小化）
- 完整退役语义：durable 归档标记（v2）
- **固化标准（D10）**：§6 数据管线真实落地 + 连续跨 ≥2 次 `dsh web` 重启仍在使用 → 固化为静态 web 包（host+client 双半部 + `cordis.patch.yml`），同时消除审批摩擦、文档化跨包契约 —— **✅ 已固化（2026-08-17，`dsh-badgeboard` v0.1.0）**：lib/index.js（host）+ lib/client.js（client，模块加载器格式）+ cordis.patch.yml（插件行 id `badgeboard`）；已挂入 web profile bundles 并 pnpm 链接；待验收项 = 重启后胶囊/信息卡/团队面板照常 + dispatch 真实验证 + 动态插件 bdgbd-1 随重启自然消失
- 成本面板（swarm DESIGN P1 候选）可复用 details 栏分段模式
