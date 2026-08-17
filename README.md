# Oh-My-DSH

[English](README.en.md) | 简体中文

**Oh-My-DSH** 是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（DSH）的个人插件综合包——灵感来自 Oh-My-Zsh：把自研的、经过实战验证的 DSH 插件集中在一个仓库，随取随用。

当前包含 **3 个插件**，覆盖 agent 编排、会话记忆、Web 界面三个维度：

| 插件 | 一句话功能 |
| --- | --- |
| [dsh-agent-swarm](dsh-agent-swarm/) | 星型团队子代理编排：`dispatch` 唯一委派入口、模型档位路由、工具边界过滤、人设库、熔断与并发控制 |
| [dsh-memory](dsh-memory/) | 项目级跨会话记忆：会话 checkpoint、压缩联动、Dream 整合、历史检索 |
| [dsh-webui-enhance](dsh-webui-enhance/) | `dsh web` GUI 增强：Token 用量统计、产物预览面板、Deep 文案池、@文件提及、会话删除 |

---

## 快速开始（Quick Start）

**前提**：已安装 DeepSeek Harness，`dsh` CLI 可用。

```bash
# 1. 克隆本仓库
git clone https://github.com/nightBrise/Oh-My-DSH.git
cd Oh-My-DSH

# 2. 按需安装插件（见下方安装索引）
```

### 安装索引

三个插件采用不同的挂载方式，请按各自 README 操作：

| 插件 | 安装方式 | 详细文档 |
| --- | --- | --- |
| `dsh-agent-swarm` | swarm preset 中挂载 `lib/index.js`（一行配置） | [dsh-agent-swarm/README.md](dsh-agent-swarm/README.md) |
| `dsh-memory` | profile bundle：`package.json` 依赖 + 扁平符号链接 | [dsh-memory/README.md](dsh-memory/README.md) |
| `dsh-webui-enhance` | `dsh plugin --profile web add`（本地路径或 GitHub 源） | [dsh-webui-enhance/README.md](dsh-webui-enhance/README.md) |

> 各插件均以本地路径方式挂载即可；若个别插件后续单独发布到 GitHub，其 README 中也提供了 GitHub 安装方式。

---

## 插件详情（Plugins）

### 🐝 dsh-agent-swarm — 星型团队子代理编排

- **唯一委派入口**：`dispatch(type, prompt, options?)`，type 为封闭白名单（explore / code / write / review），未知类型硬失败
- **档位路由**：lite / standard / pro / ultra → 不同模型；provider/model 创建时钉死，零运行时漂移
- **工具边界**：explore/review 白名单 fail-closed；code 全工具 deny 五类委派工具（防递归）
- **人设库**：8 个内置 persona 全文注入，目录 section 仅 root 可见
- **稳定性**：并发双上限（maxActive / maxTeam）、熔断冷却、结构化输出、超时级联、摘要续写
- **审计**：`dispatch.log` 结构化审计行（派发 / result / error）
- **常驻成员**：`run_in_background=true` 创建可续接子代理，`send_message` 续接、`list_agents` 枚举

📄 文档：`docs/DESIGN.md`（设计终稿）、`docs/ARCHITECTURE-REVIEW.md`、`docs/COMPARISON-REVIEW.md` 等

### 🧠 dsh-memory — 项目级跨会话记忆

- **会话 checkpoint**：事件捕获 → 自适应阈值阶梯自动触发 → 模型增量更新 11 节快照（KEEP 协议）
- **压缩联动**：`compaction/end` 后注入记忆 dump，压缩失败自动跳过
- **Dream 整合**：`/dream` 或 `dream_now` 工具 → 窗口化 checkpoint 收集 → LLM 整合 → 原子写回 `MEMORY.md`
- **历史检索**：`history_search`（sessionQuery 索引，禁用时回退日志扫描）+ `history_around`（seq 锚定上下文）
- **项目级配置**：`.dsh-memory/settings.json`（`memory_config` 工具 / `/dshmem-config` 命令）

### 🖥️ dsh-webui-enhance — Web GUI 增强

- **Token 用量**：供应商/模型双环形图、明细表、余额卡片（DeepSeek 实时查询）、近 30 天堆叠图
- **产物预览**：点击产物 chip → 浏览器式标签卡片面板，支持图片 / Markdown / HTML（iframe 沙箱）/ 代码日志
- **Deep 文案池**：60 条生成状态文案随机换词，渐变 shimmer 动画
- **@文件提及**：输入框 `@` 触发工作区文件模糊搜索，插入路径后模型自行读取
- **会话删除**：两段确认，物理清理 `~/.dsh` 下会话日志
- **宽度自适应**：消息列、输入框、用户气泡随窗口自适应（上限 1280px）

---

## 仓库结构（Repository Layout）

```
Oh-My-DSH/
├── README.md               # 本文档（中文）
├── README.en.md            # English README
├── LICENSE                 # MIT © 2026 nightBrise
├── dsh-agent-swarm/        # 插件 1：星型团队子代理编排
│   ├── lib/index.js        #   插件主体（ESM）
│   ├── config.yaml         #   上传模板配置（模型档位 / 人设池 / 上限）
│   ├── model-router.local.yaml  # 本地私有配置（.gitignore 排除，不提交）
│   └── docs/               #   设计 / 架构审查 / 对比 / 维护路线图
├── dsh-memory/             # 插件 2：项目级跨会话记忆
│   ├── lib/index.js
│   ├── cordis.patch.yml    #   bundle patch：自动插入插件行
│   └── DESIGN.md
└── dsh-webui-enhance/      # 插件 3：Web GUI 增强
    ├── lib/index.js        #   host 半：用量采集 / RPC 路由
    ├── lib/client.js       #   client 半：React 组件 / fetch RPC
    └── cordis.patch.yml
```

## 开发（Development）

各插件均为手写 ESM / 浏览器代码，无需构建，修改后重启 `dsh` 生效：

```bash
# 语法检查
node --check dsh-agent-swarm/lib/index.js
node --check dsh-memory/lib/index.js
node --check dsh-webui-enhance/lib/index.js
node --check dsh-webui-enhance/lib/client.js
```

- `dsh-agent-swarm`：配置热加载（每次 dispatch 现读），改 `config.yaml` 无需重启
- `dsh-memory`：本地联调需完成 profile bundle 三步安装（依赖链接），不要与旧动态插件版本同时保留
- `dsh-webui-enhance`：本地联调可用 `dsh plugin --profile web add /path/to/dsh-webui-enhance`

## License

[MIT](LICENSE) © 2026 nightBrise
