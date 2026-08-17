# dsh-webui-enhance

[English](README.en.md) | 中文

DSH(DeepSeek Harness)**Web GUI 增强插件**:在不改 DSH 源码的前提下,为 `dsh web` 增加一组实用的会话与统计功能。

> 本包从动态插件 `demo-3` 固化而来,功能线已由用户逐项验收。

## ✨ 功能

| 功能 | 说明 |
| --- | --- |
| **Token 用量** | 对话页顶部新增「Token 用量」Tab:双环形图(供应商/模型占比)、供应商明细表、当前工作区会话用量表、余额/配额卡片(DeepSeek 实时查询,60s 缓存;小米/通义跳转控制台)、近 30 天/当月每日用量堆叠图(悬停联动悬浮窗) |
| **产物标签预览** | 点击对话尾部产物 chip → 右侧面板以**浏览器式标签卡片**打开:可同时开多个产物、点击卡片切换、单个关闭;渲染:**图片**(base64)、**Markdown**(标题/表格/图片/列表/代码块/引用)、**HTML**(iframe 沙箱)、**代码/日志**(等宽文本)。面板默认占除侧栏外一半宽度,拖动分隔条可调(无壳层 520px 上限) |
| **Deep 文案池** | 生成状态行文案从 60 条 "Deep xxx…" 均匀随机,**每个会话独立换词**,带渐变 shimmer 动画 |
| **@文件提及** | 输入框 `@` 触发工作区文件模糊搜索(前缀/包含/模糊匹配,目录深度限制),选择后插入 `@路径 `,模型自行读取 |
| **会话删除** | 会话头部 🗑️ 按钮,两段确认,删除后物理清理 `~/.dsh` 下的会话日志文件(运行中会话延迟到结束后清理) |
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
- 会话日志删除只清理 `~/.dsh` 下对应 sessionId 的日志目录,不影响工作区文件。

## 🏗 包结构

```
dsh-webui-enhance/
├── package.json        # ESM;main=lib/index.js(host);exports ./client
├── cordis.patch.yml    # bundle patch:自动插入插件行
├── LICENSE             # MIT
├── lib/
│   ├── index.js        # host 半:用量采集/持久化、HTTP RPC 路由(/dsh-webui-enhance/*)
│   └── client.js       # client 半:ModuleLoader 格式,React 组件与 fetch RPC
└── README.md
```

### 通信架构

静态插件不依赖动态 runner 的 `harness.handle` / `host.call`,改为:

- **host 半**通过 `ctx.webServer.register({ kind: 'prefix', path: '/dsh-webui-enhance', handler })` 注册 JSON RPC(方法:`tokens-usage` / `tokens-balance` / `tokens-measure` / `file-search` / `produced-open` / `delete-session`);
- **client 半**用 `fetch('/dsh-webui-enhance/<method>')` POST JSON 调用,信封 `{ ok, value }` / `{ ok: false, error }`。

> 该通信模式与社区 @linxin666/dsh-client-ui-aionui-panel 一致(经 `dsh-host-webserver` 注册前缀路由),是 DSH 静态 UI 插件在 host/client 之间传数据的标准做法。

## 🛠 开发

```bash
# 语法检查(本包为手写 ESM/浏览器代码,无需构建)
node --check lib/index.js
node --check lib/client.js

# 本地联调:发布到 GitHub 前,可在 profile 里先 file: 引用
dsh plugin --profile web add /path/to/dsh-webui-enhance
```

修改后重启 `dsh web` 生效。发布流程:推到 GitHub 仓库 → 使用者按上文「安装」执行。

## ⚠️ 注意事项

- 右侧栏 `details` 槽原被壳层「工具详情面板」占用,本插件注册后由产物预览面板替代;
- 产物文件读取基于 `workspaceRoot` + 全部活跃会话 `cwd` 多根回退,跨工作区可用;`..` 路径穿越被拦截;
- 面板样式使用 CSS 变量 + `!important` 接管列宽,关闭面板时自动恢复壳层默认;
- 余额查询需要配置 `DEEPSEEK_API_KEY`(credentials),否则余额卡片显示"未配置 API Key"。

## 📄 License

MIT
