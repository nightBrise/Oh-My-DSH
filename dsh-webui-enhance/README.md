# dsh-webui-enhance

[English](README.en.md) | 中文

DSH(DeepSeek Harness)**Web GUI 增强插件**:在不改 DSH 源码的前提下,为 `dsh web` 增加一组实用的会话与统计功能。

> 本包从动态插件 `demo-3` 固化而来,功能线已由用户逐项验收。

## ✨ 功能

| 功能 | 说明 |
| --- | --- |
| **Token 用量** | 对话页顶部新增「Token 用量」Tab:双环形图(供应商/模型占比)、供应商明细表(含合计行)、当前工作区会话用量表(点击行打开对应会话)、当前会话上下文测量(上下文/压力 tokens)、余额/配额卡片(DeepSeek 实时查询,服务端 55s 缓存、前端每 60s 刷新;小米/通义跳转控制台)、近 30 天/当月每日用量堆叠图(悬停某天时明细表、环形图与会话表联动切换为当天数据,附悬浮窗);用量每 10s、余额每 60s 自动刷新 |
| **产物标签预览** | 点击对话尾部产物 chip(内部派发 `dsh:produced-open` 事件)→ 右侧面板以**浏览器式标签卡片**打开:可同时开多个产物、点击卡片切换、单个关闭;渲染:**图片**(base64)、**Markdown**(标题/表格/图片/列表/代码块/引用)、**HTML**(iframe 沙箱)、**代码/日志**(等宽文本)。面板默认占除侧栏外一半宽度,拖动分隔条可调(无壳层 520px 上限) |
| **详情栏分段(产物 / 团队)** | 右侧栏面板带「📦 产物 / 👥 团队」两个分段(均带 `aria-pressed`):竖条开栏默认显示团队,打开产物时自动切到产物分段并开栏,点击产物 tab 可切回预览。**团队分段渲染子座位 `details.produced.team`**(配套插件 dsh-badgeboard 注入内容,未安装时显示占位提示) |
| **图片自动识别** | 文字模型对话中,用户发送的图片自动调用配置的视觉模型(**结构化描述**:总体/文字转录/图表数据/界面布局/关键细节/结论要点),以文本注入对话;同图短时缓存,不重复调用;识别失败降级提示不阻塞对话 |
| **Deep 文案池** | 生成状态行文案从 60 条 "Deep xxx…" 均匀随机(避免连续重复),每个状态元素独立固定一个文案(换元素/会话时换词),带渐变 shimmer 动画 |
| **@文件提及** | 输入框 `@` 触发工作区文件模糊搜索(前缀/包含/模糊匹配,忽略 `node_modules`、`.git` 与点开头条目,目录遍历深度 ≤ 5),选择后插入 `@路径 `,模型自行读取 |
| **会话删除** | 会话头部 🗑️ 按钮,两段确认,删除后物理清理 `~/.dsh` 下的会话日志文件(运行中会话延迟到结束后自动清理;清理不可用时仅从列表移除、日志保留) |
| **宽度自适应** | 对话消息列、输入框、用户气泡随窗口宽度自适应(上限 1280px) |

## 📦 安装

环境要求:已安装 DeepSeek Harness 且 `dsh web` 可启动;需要 pnpm(`corepack enable` 启用)。

从 GitHub 安装(本包通过 GitHub 分发,未发布到 npm):

```bash
# 方式一:GitHub 简写(推荐)
dsh plugin --profile web add <你的GitHub用户名>/dsh-webui-enhance

# 方式二:完整 git URL
dsh plugin --profile web add git+https://github.com/<你的GitHub用户名>/dsh-webui-enhance.git

# 安装后重启
dsh web
```

本包自带 `dsh.bundle.patch`(cordis.patch.yml),安装后自动把插件行 `webui-enhance` 插入 profile,无需手改配置。

若你的环境无法自动应用 bundle patch,可手动在 `~/.dsh/profiles/web/cordis.patch.yml` 追加:

```yaml
- insert:
    - id: webui-enhance
      name: 'dsh-webui-enhance'
```

## 🔄 更新

```bash
dsh plugin --profile web update dsh-webui-enhance
```

## ❌ 卸载

```bash
dsh plugin --profile web remove dsh-webui-enhance
```

## 🗂 数据

- **用量记录**:持久化在 `~/.dsh/dsh-usage/usage-records.json`(上限 5 万条,2 秒去抖写入)。通过监听 `llm/stream` 采集,subagent 调用也计入总量(无 sessionId 的不入会话表)。卸载后如不需要,可手动删除该文件。
- 会话日志删除只清理 `~/.dsh` 下对应 sessionId 的日志目录(带路径校验:目录名须等于 sessionId 且位于 `/sessions/` 下),不影响工作区文件。

## 🏗 包结构

```
dsh-webui-enhance/
├── package.json        # ESM;main=lib/index.js(host);exports ./client
├── cordis.patch.yml    # bundle patch:自动插入插件行
├── LICENSE             # MIT
├── lib/
│   ├── index.js        # host 半:用量采集/持久化、HTTP RPC 路由(/dsh-webui-enhance/*)
│   └── client.js       # client 半:ModuleLoader 格式,React 组件与 fetch RPC
├── README.md           # 中文文档
└── README.en.md        # English
```

### 通信架构

静态插件不依赖动态 runner 的 `harness.handle` / `host.call`,改为:

- **host 半**通过 `ctx.webServer.register({ kind: 'prefix', path: '/dsh-webui-enhance', handler })` 注册 JSON RPC(方法:`tokens-usage` / `tokens-balance` / `tokens-measure` / `file-search` / `produced-open` / `delete-session`);
- **client 半**用 `fetch('/dsh-webui-enhance/<method>')` POST JSON 调用,信封 `{ ok, value }` / `{ ok: false, error }`;
- **client 半**还通过 `ctx.get('slots')` 注册 `details`(产物面板)、`conversation.view`(Token 用量)、`conversation.session.header.actions`(会话删除)、`tool.view.cordis`(调试面板)等槽位,并用 `inputTriggers` 注册 `@` 文件触发源、`ctx.get('layout')` 开合右侧栏。

> 该通信模式与社区 @linxin666/dsh-client-ui-aionui-panel 一致(经 `dsh-host-webserver` 注册前缀路由),是 DSH 静态 UI 插件在 host/client 之间传数据的标准做法。

### 跨包契约(配套 dsh-badgeboard)

- **details 子座位声明**:产物面板注册 `details` 槽(id `produced`,priority -1)时声明子座位 `details.produced.team`(`{ kind: 'single', scope: 'session' }`);「团队」分段通过 `renderSlot('details.produced.team', {})` 渲染,配套插件 dsh-badgeboard 以 `slots.inject('details.produced.team')` + `slots.register` 注入团队工牌面板。
- **details 开合与宽度暴露**:产物面板开栏时在壳层 frame(`[data-shell-overlay]` 的父元素)上设置 `data-dsh-wide`、`data-dsh-details-open` 及 CSS 变量 `--dsh-sidebar-px` / `--dsh-details-px` / `--dsh-handle-left`,拖拽分隔条时同步打 `data-dragging`;配套插件(如 dsh-badgeboard 的中栏 rail)据此感知 details 开合状态与宽度。

## 🛠 开发

```bash
# 语法检查(本包为手写 ESM/浏览器代码,无需构建)
node --check lib/index.js
node --check lib/client.js

# 本地联调:发布到 GitHub 前,可在 profile 里先 file: 引用
dsh plugin --profile web add /path/to/dsh-webui-enhance
```

修改后重启 `dsh web` 生效。发布流程:推到 GitHub 仓库 → 使用者按上文「安装」执行。

Cordis 工具页的「Web UI 改造 Demo」调试面板(`tool.view.cordis` 槽,key `self`)展示插件状态与 `@` 文件搜索源注册情况,可输入关键词直接测试 `file-search`(limit 5)与列宽接管。

## 🗄 图片自动识别配置

图片识别使用哪些视觉模型由你自己管理(本包不预设任何模型):在 profile 的 `cordis.patch.yml` 中为 `webui-enhance` 行配置模型列表与默认选择。

```yaml
- id: webui-enhance
  name: 'dsh-webui-enhance'
  config:
    vision:
      defaultModel: mimo-v2.5          # 默认使用哪个模型(id)
      timeoutMs: 20000
      models:                          # 你可用的视觉模型列表
        - id: mimo-v2.5
          label: 小米 MiMo V2.5
          baseUrl: https://token-plan-cn.xiaomimimo.com/v1
          credential: XIAOMI_TOKEN_PLAN_CN_API_KEY   # DSH credentials 中的 key 名
          model: mimo-v2.5
        - id: qwen-vl
          label: 通义千问 VL
          baseUrl: https://dashscope.aliyuncs.com/compatible-mode/v1
          credential: DASHSCOPE_API_KEY
          model: qwen-vl-plus
```

要点:
- **未配置任何模型**时该功能关闭,图片原样交给模型;
- 单模型简写:`vision.baseUrl / vision.credential / vision.model` 直接配置即可;
- credential 未配时回退读环境变量 `VISION_API_KEY`;
- 识别结果以「[图片识别]」标记的结构化文本替代原图片进入模型;`attachmentId` 为内容寻址,同图在 10 分钟内自动命中缓存,不重复调用视觉 API。

## ⚠️ 注意事项

- 右侧栏 `details` 槽原被壳层「工具详情面板」占用,本插件(槽 id `produced`)注册后由「产物 / 团队」分段面板替代;竖条开栏默认显示团队分段,打开产物时自动切到产物分段;
- 产物文件读取基于 `workspaceRoot` + 全部活跃会话 `cwd` + 持久化会话头 `cwd` 多根回退,跨工作区可用;`..` 路径穿越被拦截;
- 面板列宽由 CSS 变量 + `!important` 接管(`data-dsh-wide` / `data-dsh-details-open` 暴露开合状态),关闭面板时自动恢复壳层默认;拖拽接管无 520px 上限;
- 「团队」分段内容由配套插件 dsh-badgeboard 提供,未安装时显示"团队工牌面板未加载(badgeboard 插件未运行)"占位提示;
- 余额查询需要配置 `DEEPSEEK_API_KEY`(credentials),否则余额卡片显示"未配置 API Key"。

## 📄 License

MIT
