# 子代理工牌面板（Badge Board）设计讨论

> 状态：讨论中（v0.1 草案）
> 目标：为每个 subagent 生成一张**工牌**（头像/名字/职位/职级/状态区），形成可视化面板
> 参考：Kimi 状态徽章机制（processing/idle/awaiting + subagent 保活）、DSH Slot 树、主题 token
> 日期：2026-08-17

---

## 1. 需求还原

用户原话拆解：
- 每张工牌含：**头像、名字、职位、职级（lite/standard/pro/ultra）**
- 状态区三种语义：
  - 工作中 → "正在 xxx"
  - 暂停等下一轮 → 休息态文案
  - 不再使用 → "已离职"
- 形态参照 Kimi 的 subagent 工牌

## 2. 数据来源（工牌显示什么）

工牌信息 = 静态档案 + 动态状态，两个来源：

| 字段 | 来源 | 类型 |
|---|---|---|
| 名字 | dispatch label（type + shortTitle） | 静态（创建时确定） |
| 职位 | type（explore/code/write/review/general） | 静态 |
| 职级 | tier（lite/standard/pro/ultra） | 静态 |
| 头像 | 由 type/tier 派生（见 §5） | 派生 |
| 状态 | subagent 生命周期事件 | **动态（需监听）** |

**动态状态的事件源**（全部已确认存在）：
- `subagent/start` / `subagent/end`（emit，runId 配对）→ 工作/结束
- `agent/status`（emit，idle ⇄ running）→ 干活中 vs 等待
- `subagent/descriptor`（会话事件）→ label/mode 固化
- `listChildren()` → 冷恢复枚举（进程重启后重建工牌墙）
- 退役：interrupt + 归档标记 → "已离职"

**状态机**：
```
            start               turn开始(agent/status running)
  [未入职] ──────→ [工作中] ──────────────→ [工作中·干活中]
      ↑              │                            │
      │              │ turn结束(idle)             │ turn结束(idle)
      │              ▼                            ▼
      │         [休息·等下一轮] ←────────── [休息·等下一轮]
      │              │
      │              │ interrupt + 归档
      │              ▼
      └──────── [已离职]（历史保留，灰化）
```

## 3. 放哪里（Slot 候选分析）

DSH 的 Slot 树勘察结果，候选挂载点按侵入度排序：

| 候选 | Slot | 侵入度 | 优劣 |
|---|---|---|---|
| **A. 会话头部按钮 + 弹出面板** | `conversation.session.header.utilities`（list）+ `shell.overlay`（list） | 低（additive） | **推荐**：一个按钮打开/关闭工牌面板，不占会话主区；overlay 全屏浮层适合展示"墙" |
| B. 会话头部 tab | `conversation.view`（list，view ring） | 中 | 像 trajectory/waterfall 一样成为视图 tab——但工牌不是"会话视图"，语义不合 |
| C. 侧栏页 | `sidebar.footer.action` 或 settings.section | 中 | 常驻但离会话上下文远，且侧栏已有 workspace 浏览 |
| D. composer 下方横条 | `conversation.composer.dock`（list） | 低 | 适合迷你状态条（一行小头像+状态点），可作为 A 的**常驻迷你版** |
| E. 对话流内卡片 | `tool.view.cordis`（keyed，self） | 低 | 每次 dispatch 的 Run 卡片内嵌工牌——**但这是单卡不是面板**，可作 A 的补充（每个 dispatch 结果卡自带工牌） |

**推荐方案：A（主面板）+ D（迷你条）+ E（单卡工牌）三层组合**：
- A：`conversation.session.header.utilities` 加"团队"按钮 → `shell.overlay` 渲染工牌墙
- D：`conversation.composer.dock` 常驻一行迷你工牌（头像+状态点），点击任一跳到 overlay 面板聚焦该成员
- E：`tool.view.cordis`（key 'self'）在每次 cordis_run 卡片内显示该次 dispatch 的工牌（与面板联动）

## 4. 面板布局（工牌墙）

**overlay 面板结构**（全屏浮层，可拖拽/缩放）：
```
┌──────────────────────────────────────────────────────┐
│ 🏢 团队 · 5 名成员 [全部|工作中|休息|已离职] [▦网格|▤列表]  ✕ │  ← 顶栏：统计+筛选+视图切换
├──────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│ │  [头像]  │ │  [头像]  │ │  [头像]  │                │  ← 工牌网格（响应式）
│ │ 名字     │ │ 名字     │ │ 名字     │                │
│ │ 职位·职级│ │ 职位·职级│ │ 职位·职级│                │
│ │ 正在xxx  │ │ 休息中   │ │ 已离职   │                │
│ └──────────┘ └──────────┘ └──────────┘                │
└──────────────────────────────────────────────────────┘
```

- 默认网格视图（cards），可切列表（紧凑行）
- 筛选 chip：全部/工作中/休息/已离职 + 按 type/tier 过滤
- 点击工牌 → 展开详情：label 全名、subagent_id、创建时间、当前 turn 摘要、操作（续接 send_message / interrupt 退役）

## 5. 工牌设计（单卡）

```
┌──────────────┐
│   ◉ 头像     │  ← 60-72px 圆形；type 图标 + tier 色环
│              │
│  名字        │  ← label（type 词 + 短标题）
│  职位 · 职级  │  ← e.g. "工程师 · Pro"（中文职位映射）
│  ──────────  │
│  ● 正在 xxx  │  ← 状态行（动态文案 + 状态点颜色）
└──────────────┘
```

**头像派生规则**（无真实照片，用 type 图标 + tier 色环）：
| type | 图标（候选） | 职位中文 |
|---|---|---|
| explore | 🔍 / 🧭 | 研究员 |
| code | ⚙️ / 🛠️ | 工程师 |
| write | ✍️ / 📝 | 文档撰写 |
| review | 🧐 / ⚖️ | 审查官 |
| general | 🧩 / 🤖 | 通用成员 |

**职级色环**（tier → 颜色，对齐品牌色）：
- lite：灰（`--dsw-alias-label-secondary`）
- standard：蓝（brand）
- pro：紫（brand 变体）
- ultra：金/琥珀（warn）

**状态行文案与颜色**：
| 状态 | 文案模板 | 颜色 | 动画 |
|---|---|---|---|
| 工作中 | "正在 {label 摘要}…"（取当前 prompt 短标题） | brand/成功绿 | 呼吸/脉冲点 |
| 休息 | "休息中 · 等待下一轮指令" | 次级灰 | 静态 |
| 已离职 | "已离职" | 灰 + 全卡灰化 50% | 静态 |

## 6. 美术风格（讨论方向）

约束：DSH 主题 token 驱动（`--dsw-alias-*`，亮/暗双值）——不能用硬编码色。

**方向 A：拟物工牌（ID badge）**——推荐
- 圆角卡片 + 1px `border-l1` + 轻微阴影，像公司工牌/胸卡
- 头像为"证件照式"圆形图标，tier 色环如徽章边框
- 状态点用品牌色/成功色/灰，呼吸动画表示工作
- 背景用 `bg-layer-1`，overlay 用 `bg-overlay`

**方向 B：极简线条风**
- 无卡片，分隔线 + 头像 + 文字，状态只用色点
- 更像终端状态条，信息密度高但"工牌感"弱

**方向 C：毛玻璃/浮动卡**
- `bg-overlay` + backdrop-blur，卡片悬浮感强
- 与 overlay 浮层天然契合，但大量卡片时视觉噪声大

**倾向：A 为主**（工牌隐喻最贴切），状态点与动画克制；overlay 面板本身用 C 的玻璃感容器。

## 7. 技术实现要点

- **Client**：注册 `shell.overlay`（list）+ `conversation.session.header.utilities`（list）+ `conversation.composer.dock`（list）+ `tool.view.cordis`（key 'self'）
- **Host**：`harness.handle('team/list')` 暴露成员快照（label/type/tier/status/subagent_id/当前任务摘要）——Client 轮询或事件推送
- **数据**：复用 v8 已有的 `activeRuns`/listChildren/descriptor 信息；状态由 `subagent/start-end` + `agent/status` 驱动
- **退役语义**：现在"已离职"= interrupt + 归档标记（v1 接受"只释放资源不释放名额"）——工牌显示"已离职"需配套该标记落地（v2 候选）

## 8. 待定问题（需讨论）

1. 面板入口：仅 header 按钮，还是 + composer 迷你条 + Run 卡工牌（三层）？
2. 工牌墙位置：overlay 全屏 vs 侧栏固定面板？
3. 头像：type 图标 + tier 色环够吗？要不要 emoji 换 SVG 图标？
4. 状态文案：工作中显示"正在 xxx"——xxx 取自当前 prompt 短标题，还是固定"正在处理任务"？
5. 退役语义：先做"interrupt=已离职"标记（v1 妥协），还是先补完整退役机制（v2）？
6. 主题：亮/暗双模式都要适配（token 已确认双值）
