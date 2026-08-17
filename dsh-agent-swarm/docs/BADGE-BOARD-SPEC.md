# 子代理工牌 · 右侧栏方案（方案 B）Spec v0.2

> 状态：**定稿待验收**（代码已按本 spec 先行实现，见 §8）
> 关联文档：[BADGE-BOARD.md](./BADGE-BOARD.md)（v0.1 草案：全屏 overlay 工牌墙）· dsh-agent-swarm（swarm 编排包）· dsh-webui-enhance（Web GUI 增强包）
> 日期：2026-08-17

---

## 1. 背景与动机

**OK Computer 调研结论**（2026-08-17，见会话记录）：Kimi OK Computer 的核心设计是**"一块可观察的屏"**——用户实时看着 Agent 在虚拟电脑上操作（浏览器/IDE/终端），执行步骤逐条可见，分析师/工程师等角色按需召唤。对 DSH 的启示：对话流范式下，"可观察性"的最佳形态不是全屏模拟屏，而是**一个常驻、可随时展开查看团队状态的侧边栏**。

**用户新方案**（本 spec 定稿）：

```
有 subagent → 右侧边栏弹出，显示工牌与信息
中栏与侧栏交界处 → 可收起按钮
收起后 → 按钮回收到右缘，变成竖向排列的团队信息条（竖条）
```

**冲突事实**（勘察确认）：右侧栏 = `details` 座位（single，session 作用域），已被 `dsh-webui-enhance` 以 `{ name: 'details', id: 'produced', priority: -1 }` **整体独占**（产物文件预览面板：多页签 + 640px 宽栏 + 自绘拖拽把手 + `data-dsh-wide` 网格重排）。details 内部唯一的子座位 `conversation.details.tool` 是"选中工具调用输出"专用，无空位可借。

**解决路线（用户拍板：方案 B）**：不抢占 details 栏，而是**并入**——webui-enhance 的产物面板加「产物 | 团队」分段，团队分段渲染一个新声明的子座位 `details.produced.team`；工牌插件注册该子座位 + 右缘竖条。一个右侧栏、两个视图，互不遮挡。

---

## 2. 目标

1. 有 subagent 时，右缘出现**竖条**（收起态入口，竖向团队信息）；点击展开/收起右侧栏。
2. 右侧栏展开时，**无产物 tab 默认显示团队面板**（竖条点击开栏即团队）；点产物 chip 自动切到产物视图；可手动分段切换。
3. 与 webui-enhance 产物预览**共存于同一栏**，零遮挡、零通信依赖。
4. 团队面板数据来自真实生命周期事件（subagent/start·end、agent/status、agent/disposed、tools/result 捕获 dispatch 档案），冷恢复用 listChildren。
5. 工牌视觉延续 v0.1 设计语言（type 图标 + tier 色环 + 状态行），支持 A/B/C 三风格切换。

---

## 3. 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│ 中栏（对话流）   │  右侧栏 details（webui-enhance 拥有）          │
│                 │  ┌────────────────────────────────────────┐ │
│                 │  │ [📦 产物] [👥 团队]  产物tab×n      ✕   │ │ ← 分段 + 页签（右缘留白 44px）
│                 │  ├────────────────────────────────────────┤ │
│                 │  │ 团队分段 → renderSlot('details.produced.team') │ ← badgeboard 注册的团队面板
│                 │  │ 产物分段 → 现有 ProducedPanel 内容       │ │
│                 │  └────────────────────────────────────────┘ │
│                 │                                                │
└─────────────────┴──────────────────────────────────────────────┘
   ▲ 竖条（shell.overlay，贴右缘 36px 全高，盖在栏之上，点击 toggle 栏）
```

**座位分配**：

| 座位 | 所有者 | 内容 |
|---|---|---|
| `details`（single） | webui-enhance（priority -1） | 栏壳 + 分段 + 产物页签 |
| `details.produced.team`（single，session） | **webui-enhance 声明**，**badgeboard 注册** | 团队面板（成员列表/详情） |
| `shell.overlay`（list，additive） | badgeboard | 右缘竖条 |

---

## 4. 跨包契约

### 4.1 webui-enhance 侧（改动已就绪）

1. **声明子座位**：注册 `details` 时带
   ```js
   children: { 'details.produced.team': { kind: 'single', scope: 'session' } }
   ```
2. **分段 UI**：栏头左侧固定分段「📦 产物」「👥 团队」（复用 tab 样式），点击切换 `pane` 状态。
3. **视图规则**（零跨插件通信的联动核心）：
   ```js
   const view = (pane === 'team' || tabs.length === 0) ? 'team' : 'produced'
   ```
   - 无产物 tab → 恒显示团队（竖条开栏即团队）✅
   - 打开产物（onOpen）→ `setPane('produced')` 自动切产物 ✅
   - 关掉全部 tab → 自动回团队 ✅
   - "产物"分段在 `tabs.length === 0` 时点击无效（灰态）
4. **团队视图渲染**：`renderSlot('details.produced.team', {})`，条目未注册时显示占位文案（"团队工牌面板未加载"），不报错。
5. **右缘留白**：栏头关闭按钮 `marginRight: 44`、body `paddingRight: 54`（竖条 36px + 间隙），保证竖条常驻时不遮挡 ✕ 与内容滚动条。

### 4.2 badgeboard 插件侧（改动已就绪：bdgbd-1/pkg-4，未运行）

1. **注册团队面板**：`slots.inject('details.produced.team', () => slots.register({ name: 'details.produced.team' }, TeamPanel))`
   - 用 `inject` 等待声明：webui-enhance 未更新时静默等待，不抛错。
2. **注册竖条**：`slots.register({ name: 'shell.overlay', id: 'badgeboard-rail' }, Rail)`（additive）。
3. **Host RPC**：`harness.handle('badge-demo/team')` 提供成员快照（演示数据；正式版替换为 §6 的事件观测 + roster）。

### 4.3 生效条件

- webui-enhance 是旧式 client module（bundle = `lib/client.js` 文件本身，rev = 内容 sha1，无 HMR watcher 运行中）→ **改后需重启 `dsh web`** 才加载新 client.js。
- badgeboard 为动态插件 → 批准运行即生效（子座位条目在 webui-enhance 声明到位后自动渲染）。

---

## 5. 交互规则

| 操作 | 行为 |
|---|---|
| 竖条出现 | 有 subagent 时（roster 非空）；竖向：👥 图标 + 前 7 个头像（emoji + 状态点）+ 超出计数 + 底部 ⚡工作数 |
| 点击竖条 | toggle 右侧栏（自记账 railOpen；`layout.openDetails()/closeDetails()`） |
| 开栏（无产物 tab） | 显示「团队」分段（view 规则保证） |
| 点击对话产物 chip | webui-enhance onOpen → 切「产物」分段并打开 tab |
| 手动切分段 | 恒可用（产物分段需 tabs 非空） |
| 团队面板 | 成员行点击展开详情（工牌卡 + id/任务/类型/职级 + 续接/退役按钮占位） |

**已知 v1 限制**：
- 竖条常驻贴右缘（36px 盖在栏右缘，已留白）；"栏开时竖条自动退让"需要布局状态订阅（client 无此事件），v2 候选。
- railOpen 为自记账，用户用其他入口开关栏时可能漂移（点竖条可纠正）。
- 续接/退役按钮为占位（演示数据无真实子代理）；正式版接 `subagents.followup` / `subagents.interrupt`。

---

## 6. 数据流与状态机（正式版）

```
Host 半部（观测者，进程内维护 roster）
  tools/result（dispatch 工具回执）→ 捕获 {type, tier, persona, prompt短标题} → 入职档案
  subagent/start / subagent/end     → runId 配对，工作/完结
  agent/status（idle ⇄ running）    → 干活中 vs 休息
  agent/disposed                    → 退役
  冷恢复：subagents.listChildren(本会话id) + agents.get() + 配置反推 tier（歧义显示模型名并标注"推断"）
      │ harness.handle('team/list' / 'team/action')（Client 轮询 1–2s，开栏时；竖条 3–5s）
      ▼
Client 半部：details.produced.team 团队面板 + shell.overlay 竖条
```

**状态机**（同 v0.1 修订版）：

```
tools/result(dispatch) → [入职] → subagent/start → [工作中] ⇄ agent/status ⇄ [休息·等待下一轮]
                        ├─ subagent/end（前台 one-shot）→ [已完成 ✓]（灰化，可筛选隐藏）
                        └─ interrupt + disposed → [已离职]（灰化保留）
```

**字段来源**：

| 字段 | 来源 |
|---|---|
| 名字/职位 | tools/result 捕获的 label + type |
| 职级 tier | tools/result 捕获 args.tier；冷恢复 = provider/model 反查配置，歧义时显示模型名 + "推断"标记 |
| "正在 xxx" | dispatch 时 prompt 短标题（tools/result 捕获），冷恢复退回 label 短标题 |
| 状态 | subagent/start·end + agent/status + agent/disposed（过滤：agents.isOwnedBy(childId, 本 root)） |

---

## 7. UI 规范

### 7.1 竖条（收起态）
- 36px 宽 × 全高，贴右缘，`bg-overlay` + backdrop-blur 玻璃，左边框 `border-l1`，hover 提亮
- 竖向内容：👥 图标 → 小头像 26px（emoji + tier 环 + 8px 状态点，工作中呼吸）→ 超出 +N → 底部 ⚡工作数（brand 色）
- pointer-events 自接管（overlay 基座 click-through）

### 7.2 团队面板（展开态，details 栏内）
- 头部一行：`👥 团队` + 统计（⚡工作 / 💤休息 / ✓完成 / 🕊离职）+ 风格切换 A/B/C + ↻ 刷新
- 成员行：头像 34px（tier 环 + 呼吸光环）+ 短标题 + `职位 · 职级` + 状态点文案；点击展开
- 详情展开：工牌卡（风格切换生效）+ 字段网格（subagent_id/任务/类型/职级）+ 操作（✉ 续接 / 🛑 退役，占位 disabled）
- 空态：`暂无成员 —— 使用 dispatch 创建子代理后自动出现在这里`

### 7.3 工牌卡风格（详情区切换器 A/B/C）
| 风格 | 特征 |
|---|---|
| A 拟物工牌（默认） | 172px 圆角卡 + `border-l1` + `bg-layer-1`，居中头像 + tier 色环 |
| B 极简线条 | 无卡行式：头像 + 名字 + 状态点，分隔线 |
| C 毛玻璃 | `bg-overlay` + blur + 悬浮阴影 |

### 7.4 主题映射
全部使用 `--dsw-alias-*` token（bg-layer-1/2/overlay、border-l1/l2、brand-primary、label-primary/secondary、state-success/warn）；Pro 紫为自定义色（正式版经 `theme.overrideTokens` 注册双值 token，卸载即回收）。

---

## 8. 实现清单与状态

| # | 改动 | 文件 | 状态 |
|---|---|---|---|
| 1 | ProducedPanel 解构 `renderSlot` + `pane` 状态 | dsh-webui-enhance/lib/client.js | ✅ 已改 |
| 2 | onOpen 切 produced 分段 | 同上 | ✅ 已改 |
| 3 | view 规则（无产物 → 团队） | 同上 | ✅ 已改 |
| 4 | 分段按钮 UI + tabbar 空态调整 | 同上 | ✅ 已改 |
| 5 | 团队视图 renderSlot + 占位 | 同上 | ✅ 已改 |
| 6 | 注册声明 children 子座位 | 同上 | ✅ 已改 |
| 7 | 右缘留白（closeBtn/body padding） | 同上 | ✅ 已改（node --check 通过） |
| 8 | 团队面板条目 + 竖条 + Host RPC | bdgbd-1/pkg-4（动态插件） | ✅ 已定义，未运行 |
| 9 | 重启 dsh web 使 webui-enhance 生效 | — | ⏳ 待用户执行 |
| 10 | 运行 pkg-4 验收 | — | ⏳ 待批准 |

---

## 9. 验收标准（checklist）

- [ ] 竖条出现在右缘（有成员时），竖向显示头像/状态点/计数
- [ ] 点击竖条 → 右侧栏打开，默认「团队」分段，显示成员列表
- [ ] 点击对话中产物 chip → 自动切「产物」分段并打开预览
- [ ] 关掉全部产物 tab → 自动回「团队」分段
- [ ] 手动分段切换正常；产物分段在无 tab 时不可用（灰态）
- [ ] 竖条不遮挡栏头 ✕ 与内容滚动条（右缘留白生效）
- [ ] 成员行展开详情：工牌卡 + 字段 + 操作占位；A/B/C 风格切换即时生效
- [ ] 亮/暗主题下颜色正常（token 驱动）
- [ ] webui-enhance 未更新（旧 bundle）时插件不报错（inject 等待声明）

---

## 10. 迭代计划（v1.1+）

- 真实数据：tools/result/subagent 事件观测 → roster；轮询替代为事件驱动（若 client 侧出现推送通道）
- 真实操作：续接 = `subagents.followup`、退役 = `subagents.interrupt` + 归档标记（durable v2）
- 单卡工牌：`tool.call.toolview` key=`dispatch`（swarm preset 会话）
- 竖条退让：details 栏开合状态订阅（layout 服务补查询/事件后）
- 冷恢复职级"推断"标记的 UI 呈现（🛈 tooltip）
