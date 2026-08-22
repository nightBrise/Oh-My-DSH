// dsh-memory: project-level cross-session memory plugin for DSH.
// Packaged form of the iterated dynamic plugin (v0.1 -> v1.0-budget).
// Registration: profile bundle via cordis.patch.yml (dsh.bundle.patch).
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-memory'

export const inject = ['fs', 'agents', 'tokenMeter', 'llm', 'agentDefaultModel', 'workspaceRegistry', 'timer', 'commands', 'sessionQuery', 'sessionPersistence', 'tools']

const DEFAULTS = { memDir: '.dsh-memory', disableWrite: false, fallbackTurnInterval: 20, dreamWindowDays: 7, dreamInputMaxTokens: 50000, dreamMaxLines: 200, dreamMaxKB: 10, dreamAuto: false, dreamIntervalDays: 7 }
const CKPT_MAX_CHARS = 11000
// dump 各区块预算（mimo rebuild dump 对应物）：checkpoint 11K / memory 10K / notes 6K / 最近用户原话 16K
const DUMP_BUDGET = { checkpoint: 11000, memory: 10000, notes: 6000, recentUser: 16000 }

// ④c 协议段（D30）：常驻系统提示词护栏。AssembleContext 无会话信息 → 文本自条件化
// （"若上下文出现 dump 则……"），由模型侧判定适用性；无记忆项目的代价为固定 ~250 tokens。
const MEMORY_PROTOCOL_TEXT = [
  '## 项目记忆协议（dsh-memory）',
  '本项目的 .dsh-memory/ 目录是插件维护的记忆系统，可能包含：',
  '- MEMORY.md：项目级持久记忆（用户规则、架构决策、技术事实）。任务涉及项目规则/决策/既往状态时先读它；记忆里已有的事不要问用户。',
  '- sessions/<会话id>/checkpoint.md：会话 checkpoint（11 节）；上下文压缩后若注入，会出现在 "Session checkpoint" 区块。',
  '规则：',
  '1) 若上下文中出现记忆 dump（"Session checkpoint"/"Project memory" 区块）：把它当作写入时点的事实快照（CLAIMS），行动前用代码/工具验证具体名称；不要整文件重读，细节用 grep 或 history_search 定位；直接接续上一个任务，不要致谢/复述/声明"我将继续"。',
  '2) 你被允许修改：MEMORY.md（记录 durable 结论，每条 1-3 行）与系统提示中给出的本会话 notes.md 路径（便签/草稿）。其他 .dsh-memory/ 路径（checkpoint.md、index.json、dream.log、settings.json）由插件维护，写入会被拒绝。',
  '3) 检索历史会话原文用 history_search 工具；命中后用 history_around 拉取上下文。',
].join('\n')

export function apply(ctx) {
  const PLUGIN = 'dsh-memory'
  const dbg = []
  const dbgLog = (...a) => { dbg.push(a.map((x) => { try { return typeof x === 'string' ? x : JSON.stringify(x) } catch (e) { return String(x) } }).join(' ')) }
  let writerActive = 0
  const dreamLocks = new Set()
  const migratedProjects = new Set()
  const projectConfigs = new Map()

  function posixResolve(base, p) {
    const parts = String(p).split('/')
    const out = []
    for (const part of parts) {
      if (part === '' || part === '.') continue
      if (part === '..') { out.pop(); continue }
      out.push(part)
    }
    let res = String(base)
    if (!res.endsWith('/')) res += '/'
    return res + out.join('/')
  }
  const isUnder = (child, root) => child === root || child.startsWith(root + '/')
  // 子代理判定（与 DSH 原生 dsh-subagent 同字段：childSessionMeta 单一 stamp 点，spawn+fork 覆盖）
  const isSubagentSession = (session) => {
    const h = session && session.header
    return !!(h && (h.origin === 'subagent' || (h.delegationDepth || 0) > 0))
  }

  async function exists(p) {
    try { const t = await ctx.fs.resolve(p); const s = await ctx.fs.stat(t); return s !== undefined } catch (e) { return false }
  }
  async function readText(p) {
    try { const t = await ctx.fs.resolve(p); return await ctx.fs.readText(t) } catch (e) { return undefined }
  }
  async function writeText(p, content, project) {
    const t = await ctx.fs.resolve(p)
    // 显式策略（DESIGN §2.9/R1）：agentless 调用的策略回退根不一定是项目根，
    // 必须显式传 {mode:'workspace-write', workspaceRoot: projectRoot}，否则写项目记忆树会被拒。
    const root = project || t
    await ctx.fs.writeText(t, content, undefined, undefined, { mode: 'workspace-write', workspaceRoot: root })
  }

  async function resolveProject(cwd) {
    if (!cwd) return undefined
    try {
      const ws = await ctx.workspaceRegistry.resolveByPath(cwd)
      if (ws) return ws.path
    } catch (e) {}
    let dir = cwd
    for (let i = 0; i < 20; i++) {
      if (await exists(posixResolve(dir, '.git'))) return dir
      const idx = dir.lastIndexOf('/')
      if (idx <= 0) break
      dir = dir.slice(0, idx)
    }
    return cwd
  }

  // ============ settings（项目内 .dsh-memory/settings.json） ============
  function settingsPath(project) {
    return posixResolve(project, '.dsh-memory/settings.json')
  }

  async function projectConfig(project) {
    if (!project) return { ...DEFAULTS }
    const cached = projectConfigs.get(project)
    if (cached) return cached
    const cfg = { ...DEFAULTS }
    try {
      const d = await readText(settingsPath(project))
      if (d) {
        const j = JSON.parse(d)
        if (j && typeof j === 'object') {
          if (j.memory && typeof j.memory === 'object') {
            if (typeof j.memory.dirName === 'string' && /^[\w.-]+$/.test(j.memory.dirName)) cfg.memDir = j.memory.dirName
            if (typeof j.memory.disableWrite === 'boolean') cfg.disableWrite = j.memory.disableWrite
          }
          if (j.checkpoint && typeof j.checkpoint === 'object') {
            const fi = parseInt(j.checkpoint.fallbackTurnInterval)
            if (fi > 0 && fi <= 1000) cfg.fallbackTurnInterval = fi
          }
          if (j.dream && typeof j.dream === 'object') {
            const wd = parseInt(j.dream.windowDays)
            if (wd > 0 && wd <= 365) cfg.dreamWindowDays = wd
            const im = parseInt(j.dream.inputMaxTokens)
            if (im > 1000 && im <= 500000) cfg.dreamInputMaxTokens = im
            const ml = parseInt(j.dream.maxLines)
            if (ml > 10 && ml <= 1000) cfg.dreamMaxLines = ml
            const mk = parseInt(j.dream.maxKB)
            if (mk > 1 && mk <= 100) cfg.dreamMaxKB = mk
            if (typeof j.dream.auto === 'boolean') cfg.dreamAuto = j.dream.auto
            const iv = parseInt(j.dream.intervalDays)
            if (iv > 0 && iv <= 365) cfg.dreamIntervalDays = iv
          }
        }
      }
    } catch (e) { dbgLog('settings parse error:', String(e)) }
    projectConfigs.set(project, cfg)
    return cfg
  }

  const SETTING_SCHEMA = {
    'memory.dirName': { kind: 'string', re: /^[\w.-]+$/ },
    'memory.disableWrite': { kind: 'boolean' },
    'checkpoint.fallbackTurnInterval': { kind: 'int', min: 1, max: 1000 },
    'dream.windowDays': { kind: 'int', min: 1, max: 365 },
    'dream.inputMaxTokens': { kind: 'int', min: 1000, max: 500000 },
    'dream.maxLines': { kind: 'int', min: 10, max: 1000 },
    'dream.maxKB': { kind: 'int', min: 1, max: 100 },
    'dream.auto': { kind: 'boolean' },
    'dream.intervalDays': { kind: 'int', min: 1, max: 365 },
  }

  async function setProjectSetting(project, key, valueStr) {
    const spec = SETTING_SCHEMA[key]
    if (!spec) return { ok: false, error: '未知配置项：' + key + '（可用：' + Object.keys(SETTING_SCHEMA).join(', ') + '）' }
    let v
    if (spec.kind === 'boolean') {
      if (valueStr !== 'true' && valueStr !== 'false') return { ok: false, error: key + ' 需要 true/false' }
      v = valueStr === 'true'
    } else if (spec.kind === 'int') {
      v = parseInt(valueStr)
      if (Number.isNaN(v) || v < spec.min || v > spec.max) return { ok: false, error: key + ' 需要整数 ' + spec.min + '-' + spec.max }
    } else {
      v = String(valueStr)
      if (spec.re && !spec.re.test(v)) return { ok: false, error: key + ' 格式非法' }
    }
    let j = {}
    try { const d = await readText(settingsPath(project)); if (d) j = JSON.parse(d) } catch (e) {}
    const parts = key.split('.')
    let node = j
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {}
      node = node[parts[i]]
    }
    node[parts[parts.length - 1]] = v
    try {
      await writeText(settingsPath(project), JSON.stringify(j, null, 2) + '\n', project)
    } catch (e) { return { ok: false, error: '写入 settings.json 失败：' + String(e) } }
    projectConfigs.delete(project)
    const cfg = await projectConfig(project)
    return { ok: true, config: cfg }
  }

  async function ensureMemoryMigrated(project, memDir) {
    if (!project || migratedProjects.has(project)) return
    migratedProjects.add(project)
    try {
      const oldP = posixResolve(project, 'MEMORY.md')
      const newP = posixResolve(project, memDir + '/MEMORY.md')
      if (await exists(newP)) return
      const content = await readText(oldP)
      if (content === undefined) return
      await writeText(newP, content, project)
      dbgLog('memory migrated:', oldP, '->', newP)
    } catch (e) { dbgLog('migrate error:', String(e)) }
  }

  function pathsFor(project, sid, memDir) {
    const base = posixResolve(project, memDir)
    const sess = posixResolve(base, 'sessions')
    const sdir = posixResolve(sess, sid)
    return {
      memory: posixResolve(base, 'MEMORY.md'),
      sessionsDir: sess,
      checkpoint: posixResolve(sdir, 'checkpoint.md'),
      notes: posixResolve(sdir, 'notes.md'),
      index: posixResolve(base, 'index.json'),
      log: posixResolve(base, 'dream.log'),
    }
  }

  // ============ 预算：超限截断 + ⚠️ truncated 标记 ============
  function applyBudget(md, maxChars) {
    if (!md || md.length <= maxChars) return md
    const flag = '⚠️ truncated: over ' + maxChars + ' chars, tail removed (full history via history_search)'
    const budget = maxChars - flag.length - 1
    let out = ''
    for (const line of String(md).split('\n')) {
      if (out.length + line.length + 1 > budget) break
      out += line + '\n'
    }
    if (!out.trim()) out = String(md).slice(0, budget)
    return flag + '\n' + out
  }

  function applyMemoryBudget(md, maxLines, maxKB) {
    if (!md) return md
    const lines = String(md).split('\n')
    let flag = ''
    let body = lines
    if (lines.length > maxLines) {
      flag = '⚠️ truncated: over ' + maxLines + ' lines, tail removed'
      body = lines.slice(0, maxLines)
    }
    let text = body.join('\n')
    if (text.length > maxKB * 1024) {
      flag = flag || ('⚠️ truncated: over ' + maxKB + 'KB, tail removed')
      text = applyBudget(text, maxKB * 1024)
    }
    if (!flag) return text + '\n'
    return flag + '\n' + text.replace(/^⚠️ truncated:[^\n]*\n/, '') + '\n'
  }

  // 章节感知截断（mimo XtH 对应物）：超预算先按比例切 body 保骨架；结构本身超预算则只留标题。
  function sectionTruncate(md, budget) {
    const text = String(md || '')
    if (!text || text.length <= budget) return text
    const lines = text.split('\n')
    const blocks = []
    let cur = { head: null, body: [] }
    for (const line of lines) {
      if (/^#{1,3} /.test(line)) {
        if (cur.head !== null || cur.body.some((l) => l.trim() !== '')) blocks.push(cur)
        cur = { head: line, body: [] }
      } else cur.body.push(line)
    }
    if (cur.head !== null || cur.body.some((l) => l.trim() !== '')) blocks.push(cur)
    const struct = blocks.map((b) => b.head).join('\n') + '\n…（超预算：仅保留结构；细节用 history_search/history_around 检索）'
    if (struct.length > budget) return struct.slice(0, budget)
    const tailNote = '\n…（本节超预算截断）'
    const headCost = blocks.reduce((n, b) => n + b.head.length + 2, 0)
    const avail = Math.max(0, budget - headCost - 20)
    const bodyLens = blocks.map((b) => Math.max(0, b.body.join('\n').trim().length + 2))
    const bodyTotal = bodyLens.reduce((a, b) => a + b, 0) || 1
    let out = ''
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      let body = b.body.join('\n').trim()
      const share = Math.floor(avail * bodyLens[i] / bodyTotal)
      if (body.length > share) body = body.slice(0, Math.max(0, share - tailNote.length)) + tailNote
      out += b.head + '\n' + (body ? body + '\n' : '')
      if (out.length > budget) { out = out.slice(0, budget); break }
    }
    return out
  }

  const CKPT_SECTIONS = ['§1 Active intent', '§2 Next concrete action', '§3 Directives (this session)', '§4 Task tree', '§5 Current work', '§6 Files and code sections', '§7 Discovered knowledge (cross-task)', '§8 Errors and fixes', '§9 Live resources', '§10 Design decisions and discussion outcomes', '§11 Open notes']

  function stampCkpt(md) {
    return '<!-- ckpt-at: ' + new Date().toISOString() + ' -->\n' + md
  }

  function escRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function extractSection(md, title) {
    const re = new RegExp('## ' + escRe(title) + '\n([\\s\\S]*?)(?=\\n## |$)')
    const m = md.match(re)
    return m ? m[1].trim() : ''
  }

  // 纯文本 checkpoint 解析（替代 JSON 协议：本地小模型 JSON 转义/键名匹配均不可靠）。
  // 继承语义：body 为 KEEP/空 或 节标题缺失 → 继承旧内容（首写为空则 (none)）；
  // 显式 (none) 视为有效清空。garbage = 无 Topic 且无任何节标题（整体不可识别）。
  function parseCkptText(out, oldMd) {
    const garbageResult = { garbage: true, md: '', missing: CKPT_SECTIONS.slice() }
    let text = String(out || '').trim()
    if (!text) return garbageResult
    if (text.indexOf('```') === 0) text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '').trim()
    const hasTopic = /^Topic:\s*\S/m.test(text)
    const headersFound = CKPT_SECTIONS.filter((t) => new RegExp('(^|\\n)## ' + escRe(t) + '\\s*(\\n|$)').test(text))
    if (!hasTopic && headersFound.length === 0) return garbageResult
    let topic = ''
    const tm = text.match(/^Topic:\s*(.+)$/m)
    if (tm && tm[1].trim() !== 'KEEP') topic = tm[1].trim()
    if (!topic && oldMd) {
      const ot = oldMd.match(/^Topic:\s*(.+)$/m)
      if (ot && ot[1].trim() !== '(none yet)') topic = ot[1].trim()
    }
    if (!topic) topic = '(none yet)'
    const missing = CKPT_SECTIONS.filter((t) => headersFound.indexOf(t) === -1)
    let md = '# Session checkpoint\nTopic: ' + topic + '\n'
    for (const title of CKPT_SECTIONS) {
      const m = text.match(new RegExp('(^|\\n)## ' + escRe(title) + '\\n([\\s\\S]*?)(?=\\n## |$)'))
      let body = m ? m[2].trim() : ''
      if (body === 'KEEP' || body === '') body = oldMd ? extractSection(oldMd, title) : ''
      md += '\n## ' + title + '\n\n' + (body || '(none)') + '\n'
    }
    return { garbage: false, md, missing }
  }

  function defaultThresholdsFor(window) {
    if (window < 25000) return []
    if (window <= 200000) return [0.20, 0.40, 0.60, 0.80]
    if (window <= 500000) return [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90]
    const out = []
    for (let i = 5; i <= 90; i += 5) out.push(i / 100)
    return out
  }

  const states = new Map()
  function ensureState(sid, session) {
    let st = states.get(sid)
    if (st) return st
    const header = session && session.header
    st = {
      sid,
      cwd: header && header.cwd,
      // 子代理过滤（mimo servesCheckpoint 对应物）；header 字段持久化，重启不丢。
      subagent: isSubagentSession(session),
      project: undefined,
      paths: undefined,
      config: { ...DEFAULTS },
      buffer: [],
      // 独立于 buffer（checkpoint 成功后 buffer 清空；dump 仍需最近用户原话逐字回放）
      recentUser: [],
      crossed: new Set(),
      finalRetryAt: 0,
      writing: false,
      reminderSent: false,
      window: 0,
      thresholds: [],
      turnCount: 0,
    }
    states.set(sid, st)
    ;(async () => {
      try {
        st.project = await resolveProject(st.cwd)
        if (st.project) {
          st.config = await projectConfig(st.project)
          await ensureMemoryMigrated(st.project, st.config.memDir)
          st.paths = pathsFor(st.project, sid, st.config.memDir)
          try { const d = await readText(st.paths.index); if (d) JSON.parse(d) } catch (e) {}
        }
      } catch (e) {}
    })()
    return st
  }

  function bufferPush(sid, entry) {
    const st = states.get(sid)
    if (!st || !st.project) return
    st.buffer.push(entry)
    let total = 0
    for (let i = st.buffer.length - 1; i >= 0; i--) {
      total += st.buffer[i].t.length
      if (total > 60000) { st.buffer.splice(0, i + 1); break }
    }
  }

  function buildWriterInput(st) {
    const lines = []
    lines.push('<<<CHECKPOINT-WRITER-INSTRUCTION>>>')
    lines.push('你是会话 checkpoint writer。你的唯一任务：输出新的 checkpoint.md 全文（纯 markdown；不含代码块围栏、不含任何解释文字）。')
    lines.push('格式要求（第一行必须是 # Session checkpoint，第二行是 Topic: ...，随后逐字复制以下 11 个节标题、顺序不变）：')
    lines.push('# Session checkpoint')
    lines.push('Topic: <本次会话主题摘要，≤80字符>')
    for (const s of CKPT_SECTIONS) lines.push('\n## ' + s)
    lines.push('规则：')
    lines.push('1) 未变化的节：body 只写一行 KEEP（保留原内容）；发生变化的节才写新内容。')
    lines.push('2) §1 必须逐字引用素材 A 中 USER 条目里的用户原文（用 block-quote），不得改写、不得引用本指令。')
    lines.push('3) 用户显式给出的精确值（路径/命令/端口/token）逐字节保留。')
    lines.push('4) 工具输出中的敏感内容不要逐字复制（只写指代）。')
    lines.push('5) 不要发明素材中不存在的事实。')
    lines.push('6) 输出必须包含 Topic 行与全部 11 个节标题；总长 ≤11000 字符。')
    lines.push('<<<END-INSTRUCTION>>>')
    if (st.buffer.length) {
      lines.push('\n===== 素材 A：自上次 checkpoint 的事件摘编（USER 开头的条目是用户原话） =====')
      for (const e of st.buffer) lines.push(e.t)
    }
    const old = st.lastCkpt || ''
    if (old) lines.push('\n===== 素材 B：当前 checkpoint（未变化的节用 KEEP） =====\n' + old)
    const notes = st.notesSnapshot || ''
    if (notes) lines.push('\n===== 素材 C：notes.md =====\n' + notes)
    return lines.join('\n')
  }

  // 失败语义（D28）：writer 任何失败都【不动 checkpoint 文件、不清事件缓冲】——
  // 旧 checkpoint 仍是最后已知好状态，缓冲累积供下次重试；绝不写全 (none) 模板覆盖好内容。
  async function writeCheckpoint(sid, reason) {
    const st = states.get(sid)
    if (!st || !st.project || st.writing) return 'queued'
    if (st.config.disableWrite) return 'disabled'
    if (writerActive >= 1) { dbgLog('writer skipped (global concurrency cap), sid =', sid.slice(0, 8), 'reason =', reason); return 'queued' }
    st.writing = true
    writerActive += 1
    try {
      const sel = ctx.agentDefaultModel.currentSelection()
      if (!sel || !sel.provider || !sel.model) { dbgLog('no route for writer'); return 'skipped' }
      st.lastCkpt = await readText(st.paths.checkpoint)
      st.notesSnapshot = await readText(st.paths.notes)
      // 缓冲为空 = 自上次写入以来无新素材：跳过（写只会推进 ckpt-at 时间戳，造成虚假进展）
      if (!st.buffer.length) { dbgLog('writer skipped: empty buffer, sid =', sid.slice(0, 8), 'reason =', reason); return 'skipped' }
      const input = buildWriterInput(st)
      // 思考策略（D32-D34）：不传 reasoningEffort——手写声明的本地模型无 reasoning 能力声明，
      // dsh-llm 门面会拒绝任何显式 effort（含 'off'），省略参数才放行；省略后服务端按
      // Qwen3 模板默认开思考，maxTokens 16384 容纳 思考+输出。
      // 初调零文本（思考吃光预算 / 模型提前停止的统称签名）→ 重试追加 /no_think；
      // 初调有文本但格式不对 → 常规纠偏重试（思考保留）。/no_think 是 Qwen3 按请求开关，
      // 只作用于该次插件后台调用，主 agent 对话回路不受影响。
      const call = async (text, tag) => {
        const gen = ctx.llm.stream({
          provider: sel.provider,
          model: sel.model,
          maxTokens: 16384,
          messages: [{ id: 'mem-writer-' + sid.slice(0, 8) + '-' + tag, role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: PLUGIN } }],
        })
        return collectStreamText(gen)
      }
      let res
      try { res = await call(input, '1') } catch (e) { dbgLog('writer stream error:', String(e), 'sid =', sid.slice(0, 8)); return 'error' }
      let out = res.text
      let parsed = parseCkptText(out, st.lastCkpt)
      if (parsed.garbage) {
        const zeroText = !out.trim()
        dbgLog('writer output empty/unrecognized, outLen =', out.length, 'finish =', res.finishReason, 'zeroText =', zeroText, 'reason =', reason)
        try {
          // 零文本：思考失控签名 → /no_think 重试（D33）；有文本但格式错：常规纠偏重试
          const retryText = input + '\n\n（注意：上一次输出无法识别为 checkpoint。请严格按格式重新输出：第一行 # Session checkpoint，第二行 Topic: ...，随后 11 个节标题逐字不变；未变化的节 body 只写一行 KEEP。）' + (zeroText ? '\n/no_think' : '')
          res = await call(retryText, 'r')
        } catch (e) {}
        out = res.text
        parsed = parseCkptText(out, st.lastCkpt)
        if (parsed.garbage) dbgLog('writer retry failed, finish =', res.finishReason, 'outLen =', out.length)
      }
      if (parsed.garbage) {
        dbgLog('writer failed non-destructively (old checkpoint + buffer kept), sid =', sid.slice(0, 8), 'reason =', reason)
        return 'failed'
      }
      if (parsed.missing.length) dbgLog('writer sections missing (inherited from old):', parsed.missing.join(','), 'sid =', sid.slice(0, 8))
      let next = parsed.md
      const before = next.length
      next = applyBudget(next, CKPT_MAX_CHARS)
      if (next.length < before) dbgLog('checkpoint budget truncated:', before, '->', next.length, 'sid =', sid.slice(0, 8))
      await writeText(st.paths.checkpoint, stampCkpt(next), st.project)
      st.buffer = []
      dbgLog('checkpoint written, sid =', sid.slice(0, 8), 'reason =', reason)
      return 'ok'
    } catch (e) {
      dbgLog('writer error:', String(e))
      return 'error'
    } finally {
      st.writing = false
      writerActive -= 1
    }
  }

  async function maybeCheckpoint(sid, session) {
    const st = states.get(sid)
    if (!st || !st.project) return
    try {
      if (st.config.disableWrite) return
      if (!st.window) {
        const sel = ctx.agentDefaultModel.currentSelection()
        if (sel && sel.provider && sel.model) {
          const info = await ctx.llm.resolveModelInfo(sel.provider, sel.model)
          st.window = info && info.context ? info.context.contextWindow : 0
        }
      }
      if (!st.window) {
        st.turnCount = (st.turnCount || 0) + 1
        if (st.turnCount >= st.config.fallbackTurnInterval) { st.turnCount = 0; writeCheckpoint(sid, 'turn-interval') }
        return
      }
      if (!st.thresholds.length) st.thresholds = defaultThresholdsFor(st.window)
      const m = ctx.tokenMeter.measure(session)
      const now = m.totalTokens
      const maxT = st.thresholds.length ? st.thresholds[st.thresholds.length - 1] : 0
      const step = st.thresholds.length > 1 ? st.thresholds[st.thresholds.length - 1] - st.thresholds[st.thresholds.length - 2] : maxT
      for (const t of st.thresholds) {
        if (now < st.window * t) break
        if (st.crossed.has(t)) {
          if (t === maxT && st.finalRetryAt && now >= st.finalRetryAt) {
            st.finalRetryAt = 0
            writeCheckpoint(sid, 'final-retry')
          }
          continue
        }
        const r = await writeCheckpoint(sid, 'threshold-' + Math.round(t * 100))
        if (r === 'skipped' || r === 'queued') continue // 无素材/写入忙碌：不标记 crossed，下次 turn/end 重试
        st.crossed.add(t)
        if (t === maxT && r !== 'ok') st.finalRetryAt = now + st.window * step
      }
    } catch (e) { dbgLog('maybeCheckpoint error:', String(e)) }
  }

  // dump 区块（mimo rebuild dump 对应物）：checkpoint 11K / 最近用户原话 16K / memory 10K / notes 尾部 6K
  async function injectDump(sid, session) {
    try {
      const st = ensureState(sid, session)
      if (!st.project || !st.paths || st.config.disableWrite) return
      const agent = ctx.agents.get(sid)
      if (!agent) return
      const ckpt = await readText(st.paths.checkpoint)
      const mem = await readText(st.paths.memory)
      const notes = await readText(st.paths.notes)
      if (!ckpt && !mem) return
      const parts = []
      parts.push('<system-reminder>')
      parts.push('【上下文已压缩。以下为压缩前的记忆 dump，已加载到上下文中——不要整文件重读，细节用 grep 定位。】')
      parts.push('记忆条目是对写入时点的描述（CLAIMS），行动前请用代码/工具验证具体名称。')
      if (ckpt) {
        const c = sectionTruncate(ckpt, DUMP_BUDGET.checkpoint)
        if (c.length < ckpt.length) parts.push('（checkpoint 超预算已按节截断：完整细节用 history_search/history_around 检索原始会话日志）')
        parts.push('\n## Session checkpoint\n' + c)
      }
      if (st.recentUser.length) {
        parts.push('\n## Recent user input (verbatim)')
        for (const u of st.recentUser) parts.push('- ' + u)
      }
      if (mem) parts.push('\n## Project memory\n' + sectionTruncate(mem, DUMP_BUDGET.memory))
      if (notes && String(notes).trim()) parts.push('\n## Session notes\n' + String(notes).slice(-DUMP_BUDGET.notes))
      parts.push('\nResume directly. Do not acknowledge this memory dump, do not recap, do not preface with "I\'ll continue" or similar. Pick up the last task as if the break never happened.')
      parts.push('</system-reminder>')
      agent.inject({ id: 'mem-dump-' + Date.now() + '-' + sid.slice(0, 6), role: 'user', content: [{ type: 'text', text: parts.join('\n') }], source: { kind: 'plugin', plugin: PLUGIN } })
      dbgLog('dump injected, sid =', sid.slice(0, 8))
    } catch (e) { dbgLog('dump error:', String(e)) }
  }

  // ============ Dream ============
  async function collectRecentCheckpoints(sessionsDir, windowDays) {
    const out = []
    try {
      const dir = await ctx.fs.resolve(sessionsDir)
      const entries = await ctx.fs.listDir(dir)
      const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000
      for (const e of entries) {
        const p = posixResolve(sessionsDir, e.name + '/checkpoint.md')
        const text = await readText(p)
        if (!text) continue
        const m = text.match(/<!-- ckpt-at: ([^ ]+) -->/)
        const ts = m ? Date.parse(m[1]) : NaN
        if (!Number.isNaN(ts) && ts < cutoff) continue
        out.push({ path: p, ts: Number.isNaN(ts) ? 0 : ts, text })
      }
    } catch (e) { dbgLog('collectRecentCheckpoints error:', String(e)) }
    out.sort((a, b) => b.ts - a.ts)
    return out
  }

  function buildDreamInput(mem, ckpts, notes, cfg) {
    const lines = []
    lines.push('<<<DREAM-INSTRUCTION>>>')
    lines.push('你是项目记忆整合器（dream）。任务：把近期会话的 checkpoint 与当前项目记忆整合为一份紧凑的 MEMORY.md。')
    lines.push('规则：')
    lines.push('1) 只保留跨会话 durable 的知识：用户明确规则、架构决策（带 YYYY-MM-DD 日期与理由）、反复验证的技术事实。')
    lines.push('2) 合并重复条目；删除被新内容取代/过时的条目；删除只与单次会话相关的细节。')
    lines.push('3) 每条 1-3 行；保留来源标记 [ses_xxx]（素材中的会话目录名）。')
    lines.push('4) 无法基于素材验证的条目，保留但标 [unverified]。')
    lines.push('5) 引用的文件路径必须来自素材；你不确定存在性的路径不要写。')
    lines.push('6) 输出严格 JSON：{"memory": "完整新 MEMORY.md 全文（保持 # 标题与 ## 区块结构，≤' + cfg.dreamMaxLines + '行/' + cfg.dreamMaxKB + 'KB）", "paths": ["引用的文件路径"], "deleted": ["删除条目摘要"], "merged": ["合并条目摘要"], "health": {"lines": N, "kb": N}}。')
    lines.push('7) 不输出 markdown 代码块、不输出任何解释。')
    lines.push('<<<END-INSTRUCTION>>>')
    lines.push('\n===== 当前 MEMORY.md =====\n' + (mem || '(空)'))
    if (ckpts.length) {
      lines.push('\n===== 近期会话 checkpoint（按时间新→旧，可能截断） =====')
      let budget = cfg.dreamInputMaxTokens * 3
      for (const c of ckpts) {
        if (budget <= 0) { lines.push('...(已截断)'); break }
        lines.push('--- ' + c.path + ' ---')
        lines.push(c.text)
        budget -= c.text.length
      }
    }
    if (notes) lines.push('\n===== notes.md（尾部） =====\n' + notes.slice(-4000))
    return lines.join('\n')
  }

  async function updateIndex(indexPath, patch, project) {
    try {
      let idx = {}
      const d = await readText(indexPath)
      if (d) { try { idx = JSON.parse(d) } catch (e) {} }
      idx = Object.assign(idx, patch, { version: 1 })
      await writeText(indexPath, JSON.stringify(idx, null, 2), project)
    } catch (e) {}
  }

  async function appendDreamLog(logPath, entry, project) {
    try {
      const old = (await readText(logPath)) || ''
      await writeText(logPath, old + JSON.stringify(entry) + '\n', project)
    } catch (e) {}
  }

  async function collectStreamText(gen) {
    let out = ''
    let finishReason = ''
    for await (const chunk of gen) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text) out += chunk.text
      else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string' && chunk.block.text) {
        out = chunk.block.text
      } else if (chunk.type === 'finish') {
        // dsh finish chunk 的 reason 是对象 {kind, failure?}（pi-ai 适配器 mapStopReason），归一化为紧凑字符串
        const r = chunk.reason
        finishReason = r && typeof r === 'object'
          ? (String(r.kind || 'unknown') + (r.failure ? ':' + String(r.failure.code || '') : ''))
          : String(r || '')
      }
    }
    return { text: out, finishReason }
  }

  async function runDream(agent, reason) {
    const sid = agent && agent.session && agent.session.id
    const cwd = agent && agent.session && agent.session.header && agent.session.header.cwd
    if (!sid || !cwd) return { ok: false, error: 'no session/cwd' }
    if (agent.session && isSubagentSession(agent.session)) return { ok: false, error: '子代理会话不能触发 dream（请由主会话触发）' }
    const project = await resolveProject(cwd)
    if (!project) return { ok: false, error: 'no project anchor' }
    if (dreamLocks.has(project)) return { ok: false, error: 'dream already running for this project' }
    dreamLocks.add(project)
    try {
      const cfg = await projectConfig(project)
      if (cfg.disableWrite) return { ok: false, error: 'disableWrite 已开启：dream 写回被禁止（memory.disableWrite=true）' }
      await ensureMemoryMigrated(project, cfg.memDir)
      const paths = pathsFor(project, sid, cfg.memDir)
      const memBefore = (await readText(paths.memory)) || ''
      const ckpts = await collectRecentCheckpoints(paths.sessionsDir, cfg.dreamWindowDays)
      const notes = await readText(paths.notes)
      const input = buildDreamInput(memBefore, ckpts, notes, cfg)
      const sel = ctx.agentDefaultModel.currentSelection()
      if (!sel || !sel.provider || !sel.model) return { ok: false, error: 'no route' }
      const t0 = Date.now()
      let res
      try {
        const gen = ctx.llm.stream({
          provider: sel.provider,
          model: sel.model,
          maxTokens: 16384,
          // 不传 reasoningEffort（D34）：本地模型无 reasoning 能力声明，显式 effort 会被门面拒绝
          messages: [{ id: 'mem-dream-' + sid.slice(0, 8) + '-' + Date.now(), role: 'user', content: [{ type: 'text', text: input }], source: { kind: 'plugin', plugin: PLUGIN } }],
        })
        res = await collectStreamText(gen)
        dbgLog('dream stream done, outLen =', res.text.length, 'ms =', Date.now() - t0, 'inputLen =', input.length, 'finish =', res.finishReason)
      } catch (e) { dbgLog('dream stream threw:', String(e)); return { ok: false, error: 'stream: ' + String(e) } }
      const out = String(res.text).trim()
      let outClean = out
      if (outClean.indexOf('```') === 0) outClean = outClean.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '').trim()
      let parsed = null
      try { parsed = JSON.parse(outClean) } catch (e) {}
      if (!parsed || typeof parsed.memory !== 'string' || !parsed.memory.trim()) {
        dbgLog('dream output invalid, outLen =', out.length, 'head =', out.slice(0, 200).replace(/\n/g, ' '))
        return { ok: false, error: 'invalid dream output' }
      }
      const rawMem = parsed.memory.trim() + '\n'
      const newMem = applyMemoryBudget(rawMem, cfg.dreamMaxLines, cfg.dreamMaxKB)
      if (newMem !== rawMem) dbgLog('dream memory budget applied')
      const pathsCheck = []
      for (const p of (parsed.paths || []).slice(0, 20)) {
        pathsCheck.push({ path: p, exists: await exists(p) })
      }
      const memNow = (await readText(paths.memory)) || ''
      if (memNow !== memBefore) {
        dbgLog('dream aborted: MEMORY.md changed during run')
        return { ok: false, error: 'memory changed during dream, aborted' }
      }
      await writeText(paths.memory, newMem, project)
      const idx = JSON.parse((await readText(paths.index)) || '{}') || {}
      await updateIndex(paths.index, { lastDreamAt: Date.now(), dreamCount: (idx.dreamCount || 0) + 1 }, project)
      const summary = {
        ts: new Date().toISOString(),
        project,
        reason: reason || 'manual',
        inputCkpts: ckpts.length,
        deleted: parsed.deleted || [],
        merged: parsed.merged || [],
        paths: pathsCheck,
        health: parsed.health || null,
      }
      await appendDreamLog(paths.log, summary, project)
      dbgLog('dream done, project =', project, 'ckpts =', ckpts.length)
      return { ok: true, project, ckpts: ckpts.length, memBytes: newMem.length, deleted: (parsed.deleted || []).length, merged: (parsed.merged || []).length }
    } catch (e) {
      dbgLog('dream error:', String(e))
      return { ok: false, error: String(e) }
    } finally {
      dreamLocks.delete(project)
    }
  }

  // ============ History 工具 ============
  function eventTextOf(ev) {
    try {
      const d = ev && ev.data
      if (!d) return ''
      if (typeof d === 'string') return d
      const parts = []
      const pushText = (x) => { if (typeof x === 'string' && x) parts.push(x) }
      const content = d.content
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b && b.type === 'text') pushText(b.text)
          else if (b && b.type === 'tool-call') pushText((b.name || '') + ' ' + String(b.arguments || ''))
          else if (b && b.type === 'tool-result') pushText(b.content ? String(b.content) : '')
        }
      }
      pushText(d.text)
      const msg = d.message
      if (msg && msg.content && Array.isArray(msg.content)) {
        for (const b of msg.content) if (b && b.type === 'text') pushText(b.text)
      }
      if (msg && typeof msg === 'string') pushText(msg)
      pushText(d.name)
      pushText(d.query)
      pushText(d.tool_name)
      return parts.join(' ')
    } catch (e) { return '' }
  }

  function snippetAround(text, query) {
    try {
      const q = query.toLowerCase()
      const low = text.toLowerCase()
      const idx = low.indexOf(q)
      if (idx < 0) return text.slice(0, 400)
      const start = Math.max(0, idx - 120)
      return (start > 0 ? '...' : '') + text.slice(start, idx + q.length + 200) + '...'
    } catch (e) { return String(text || '').slice(0, 400) }
  }

  async function scanPersistedSearch(query, sessionId, kind, limit) {
    const p = ctx.get('sessionPersistence')
    if (!p) return { ok: false, error: 'sessionPersistence unavailable' }
    const q = query.toLowerCase()
    const matches = []
    const readSession = async (id) => {
      try {
        const snap = await p.readFrom(id, 0)
        return snap && snap.events ? snap.events : []
      } catch (e) { return [] }
    }
    if (sessionId) {
      const events = await readSession(sessionId)
      for (const ev of events) {
        if (kind && ev.type !== kind) continue
        const text = eventTextOf(ev)
        if (text.toLowerCase().indexOf(q) !== -1) {
          matches.push({ sessionId, seq: ev.seq, type: ev.type, time: ev.time, snippet: snippetAround(text, query) })
          if (matches.length >= limit) break
        }
      }
    } else {
      let headers = []
      try { headers = await p.list() } catch (e) { headers = [] }
      headers.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      for (const h of headers.slice(0, 30)) {
        if (matches.length >= limit) break
        const events = await readSession(h.id)
        for (const ev of events) {
          if (kind && ev.type !== kind) continue
          const text = eventTextOf(ev)
          if (text.toLowerCase().indexOf(q) !== -1) {
            matches.push({ sessionId: h.id, seq: ev.seq, type: ev.type, time: ev.time, snippet: snippetAround(text, query) })
            if (matches.length >= limit) break
          }
        }
      }
    }
    return { ok: true, scope: sessionId ? 'session' : 'all-sessions', backend: 'scan', count: matches.length, items: matches.map((m) => ({ sessionId: m.sessionId, seq: m.seq, type: m.type, time: m.time, snippet: String(m.snippet).slice(0, 400) })), hint: matches.length === 0 ? '无结果：换关键词；或直接 grep .dsh-memory/sessions/*/checkpoint.md' : '' }
  }

  async function runHistorySearch(args) {
    const query = String((args && args.query) || '').trim()
    if (!query) return { ok: false, error: 'query required' }
    const limit = Math.min(Math.max(parseInt((args && args.limit)) || 10, 1), 50)
    const kind = args && args.kind ? String(args.kind) : undefined
    const sessionId = args && args.sessionId ? String(args.sessionId) : undefined
    const q = ctx.get('sessionQuery')
    if (q) {
      try {
        const filters = kind ? [{ kind: 'type', values: [kind] }] : undefined
        if (sessionId) {
          const page = await q.searchEvents({ sessionId, query, filters, limit })
          const items = (page.items || []).map((h) => ({ sessionId, seq: h.seq, type: h.type, time: h.time, snippet: String(h.snippet || '').slice(0, 400) }))
          return { ok: true, scope: 'session', backend: 'index', count: items.length, items, hint: items.length === 0 ? '无结果：换关键词；或用 read/grep 直接查 .dsh-memory/sessions/ 下 checkpoint.md' : '' }
        }
        const page = await q.searchSessions({ query, eventFilters: filters, limit })
        const items = (page.items || []).map((h) => {
          const b = h.bestMatch
          return { sessionId: (h.header && h.header.id) || (b && b.sessionId) || '', seq: b ? b.seq : undefined, type: b ? b.type : undefined, time: b ? b.time : undefined, snippet: b ? String(b.snippet || '').slice(0, 400) : '' }
        })
        return { ok: true, scope: 'all-sessions', backend: 'index', count: items.length, items, hint: items.length === 0 ? '无结果：换关键词；或直接 grep .dsh-memory/sessions/*/checkpoint.md' : '' }
      } catch (e) {
        const msg = String(e && e.message || e)
        if (msg.indexOf('disabled') === -1 && msg.indexOf('openAt') === -1) {
          return { ok: false, error: msg }
        }
        dbgLog('history_search fell back to scan:', msg)
      }
    }
    return scanPersistedSearch(query, sessionId, kind, limit)
  }

  async function runHistoryAround(args) {
    const sessionId = String((args && args.sessionId) || '').trim()
    const seq = parseInt((args && args.seq))
    if (!sessionId || Number.isNaN(seq)) return { ok: false, error: 'sessionId and seq required（seq 来自 history_search 结果）' }
    const before = Math.min(Math.max(parseInt((args && args.before)) || 5, 0), 20)
    const after = Math.min(Math.max(parseInt((args && args.after)) || 5, 0), 20)
    const q = ctx.get('sessionQuery')
    if (q) {
      try {
        const win = await q.readEvent({ sessionId, seq, before, after })
        const out = []
        let bytes = 0
        for (const ev of (win.events || [])) {
          const item = { seq: ev.seq, type: ev.type, time: ev.time, text: eventTextOf(ev).slice(0, 600) }
          const line = JSON.stringify(item)
          if (bytes + line.length > 20000) { out.push({ seq: ev.seq, type: ev.type, time: ev.time, text: '[truncated 20KB]' }); break }
          out.push(item)
          bytes += line.length
        }
        return { ok: true, sessionId, targetSeq: seq, count: out.length, bytes, items: out }
      } catch (e) {
        const msg = String(e && e.message || e)
        if (msg.indexOf('disabled') === -1 && msg.indexOf('openAt') === -1) {
          return { ok: false, error: msg }
        }
      }
    }
    const p = ctx.get('sessionPersistence')
    if (!p) return { ok: false, error: 'sessionPersistence unavailable' }
    try {
      const snap = await p.readFrom(sessionId, Math.max(0, seq - before))
      const events = (snap && snap.events) || []
      let anchorIdx = -1
      for (let i = 0; i < events.length; i++) {
        if (events[i].seq === seq) { anchorIdx = i; break }
      }
      if (anchorIdx === -1) return { ok: false, error: 'seq not found in session log' }
      const start = Math.max(0, anchorIdx - before)
      const end = Math.min(events.length, anchorIdx + after + 1)
      const out = []
      let bytes = 0
      for (let i = start; i < end; i++) {
        const ev = events[i]
        const item = { seq: ev.seq, type: ev.type, time: ev.time, text: eventTextOf(ev).slice(0, 600) }
        const line = JSON.stringify(item)
        if (bytes + line.length > 20000) { out.push({ seq: ev.seq, type: ev.type, time: ev.time, text: '[truncated 20KB]' }); break }
        out.push(item)
        bytes += line.length
      }
      return { ok: true, sessionId, targetSeq: seq, backend: 'scan', count: out.length, bytes, items: out }
    } catch (e) { return { ok: false, error: String(e) } }
  }

  // ============ memory_config 工具 + /dshmem-config 命令 ============
  async function runMemoryConfig(args, agent) {
    const cwd = agent && agent.session && agent.session.header && agent.session.header.cwd
    if (!cwd) return { ok: false, error: 'no session cwd' }
    const project = await resolveProject(cwd)
    if (!project) return { ok: false, error: 'no project anchor' }
    const action = (args && args.action) || 'get'
    if (action === 'set') {
      const key = String((args && args.key) || '').trim()
      const value = String((args && args.value) || '').trim()
      if (!key || value === '') return { ok: false, error: 'set 需要 key 与 value（如 dream.windowDays 14）' }
      const r = await setProjectSetting(project, key, value)
      return r.ok ? { ok: true, project, config: r.config } : { ok: false, error: r.error }
    }
    const cfg = await projectConfig(project)
    return { ok: true, project, config: cfg, note: '可用 set 修改：' + Object.keys(SETTING_SCHEMA).join(', ') }
  }

  ctx.tools.register(defineTool({
    name: 'memory_config',
    description: '查看/修改当前项目的记忆插件配置（.dsh-memory/settings.json）。action=get 返回当前配置；action=set 需 key（如 dream.windowDays、memory.disableWrite、checkpoint.fallbackTurnInterval）与 value（字符串，数字/布尔自动转换）。',
    parameters: {
      action: { type: 'string', description: 'get（默认）或 set' },
      key: { type: 'string', description: 'set 时必填：配置项点路径' },
      value: { type: 'string', description: 'set 时必填：值（字符串形式）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
          project: { type: 'string' },
          config: { type: 'object', additionalProperties: true },
          note: { type: 'string' },
        },
      },
      render(args, value) { return [{ type: 'text', text: JSON.stringify(value) }] },
    },
    async execute(args, exec) {
      const r = await runMemoryConfig(args || {}, exec.agent)
      return r
    },
  }))

  ctx.commands.register({
    name: 'dshmem-config',
    description: '查看/修改记忆插件配置：/dshmem-config 或 /dshmem-config set <key> <value>（如 set dream.windowDays 14、set memory.disableWrite true）',
    handler: async (invocation) => {
      const agent = invocation.agent
      const parts = String(invocation.rawArgs || '').trim().split(/\s+/)
      if (parts[0] === 'set' && parts.length === 3) {
        const r = await runMemoryConfig({ action: 'set', key: parts[1], value: parts[2] }, agent)
        return r.ok ? { kind: 'success', text: '已更新 ' + parts[1] + ' = ' + parts[2] + '\n当前配置：' + JSON.stringify(r.config, null, 2) } : { kind: 'error', text: '设置失败：' + (r.error || '') }
      }
      const r = await runMemoryConfig({ action: 'get' }, agent)
      return r.ok ? { kind: 'success', text: '项目 ' + r.project + ' 配置：\n' + JSON.stringify(r.config, null, 2) } : { kind: 'error', text: '读取失败：' + (r.error || '') }
    },
  })

  // dream_now 模型工具
  ctx.tools.register(defineTool({
    name: 'dream_now',
    description: '手动触发项目记忆整合（dream）：读取近期会话 checkpoint 与 MEMORY.md（<memDir>/MEMORY.md），合并/去重/修剪为紧凑的项目记忆。后台执行，立即返回接受状态；完成后结果写入 <memDir>/dream.log。',
    parameters: {
      reason: { type: 'string', description: '触发原因（可选，写入日志）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accepted: { type: 'boolean', required: true },
          project: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render(args, value) { return [{ type: 'text', text: JSON.stringify(value) }] },
    },
    async execute(args, exec) {
      const agent = exec.agent
      const result = await runDream(agent, (args && args.reason) || 'tool')
      return { accepted: result.ok, project: result.project || '', error: result.ok ? '' : result.error }
    },
  }))

  // /dream 人类命令
  ctx.commands.register({
    name: 'dream',
    description: '手动触发项目记忆整合（dream）：合并近期 checkpoint 到 <memDir>/MEMORY.md（后台执行）',
    handler: async (invocation) => {
      const result = await runDream(invocation.agent, 'command')
      if (result.ok) {
        return { kind: 'success', text: 'Dream 完成：项目 ' + result.project + '，整合 ' + result.ckpts + ' 个 checkpoint，删除 ' + result.deleted + ' 条，合并 ' + result.merged + ' 条。详见 ' + result.project + '/.dsh-memory/dream.log' }
      }
      return { kind: 'error', text: 'Dream 失败：' + (result.error || 'unknown') }
    },
  })

  // history_search 模型工具
  ctx.tools.register(defineTool({
    name: 'history_search',
    description: '全文检索历史会话事件（sessionQuery 索引，禁用时退化为持久化日志扫描）：返回带 snippet 的命中（按会话分组或限定单会话）。query 必填；sessionId 限定单会话；kind 按事件类型过滤（如 user/message、assistant/message、tool/call、tool/result）；limit 默认 10 最大 50。0 结果时换关键词或直接 grep .dsh-memory/。',
    parameters: {
      query: { type: 'string', required: true, description: '检索词（数据解释，非 FTS 语法）' },
      sessionId: { type: 'string', description: '限定单会话（可选）；缺省跨会话检索' },
      kind: { type: 'string', description: '事件类型过滤（可选）' },
      limit: { type: 'number', description: '返回条数，默认 10，最大 50' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
          scope: { type: 'string' },
          backend: { type: 'string' },
          count: { type: 'number' },
          hint: { type: 'string' },
          items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { sessionId: { type: 'string' }, seq: { type: 'number' }, type: { type: 'string' }, time: { type: 'number' }, snippet: { type: 'string' } } } },
        },
      },
      render(args, value) { return [{ type: 'text', text: JSON.stringify(value) }] },
    },
    async execute(args) {
      const r = await runHistorySearch(args || {})
      return r
    },
  }))

  // history_around 模型工具
  ctx.tools.register(defineTool({
    name: 'history_around',
    description: '以 history_search 命中的 sessionId+seq 为锚，拉取前后事件上下文（每事件文本 ≤600 字符，输出总上限 20KB）。before/after 默认 5，最大 20。',
    parameters: {
      sessionId: { type: 'string', required: true, description: '目标会话 id' },
      seq: { type: 'number', required: true, description: '锚点事件 seq（来自 history_search 结果）' },
      before: { type: 'number', description: '锚点前事件数，默认 5，最大 20' },
      after: { type: 'number', description: '锚点后事件数，默认 5，最大 20' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
          sessionId: { type: 'string' },
          targetSeq: { type: 'number' },
          backend: { type: 'string' },
          count: { type: 'number' },
          bytes: { type: 'number' },
          items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { seq: { type: 'number' }, type: { type: 'string' }, time: { type: 'number' }, text: { type: 'string' } } } },
        },
      },
      render(args, value) { return [{ type: 'text', text: JSON.stringify(value) }] },
    },
    async execute(args) {
      const r = await runHistoryAround(args || {})
      return r
    },
  }))

  ctx.on('session/event', (session, event) => {
    try {
      const sid = session.id
      if (isSubagentSession(session)) return // 子代理会话不参与记忆（写门在 tools/pre-execute，不受此影响）
      if (event.type === 'user/message') {
        const src = event.data && event.data.source
        if (src && src.kind === 'user') {
          const st = ensureState(sid, session)
          const text = (event.data && event.data.content || []).map((b) => b.type === 'text' ? b.text : '').join('\n')
          bufferPush(sid, { t: 'USER:\n' + text.slice(0, 2000) })
          if (text.trim()) {
            st.recentUser.push(text.slice(0, 2000))
            let tot = 0
            for (let i = st.recentUser.length - 1; i >= 0; i--) { tot += st.recentUser[i].length; if (tot > DUMP_BUDGET.recentUser) { st.recentUser.splice(0, i + 1); break } }
          }
          if (!st.reminderSent && !st.config.disableWrite) {
            st.reminderSent = true
            ;(async () => {
              try {
                const memExists = st.paths ? await exists(st.paths.memory) : false
                let latest = ''
                if (st.paths) {
                  try {
                    const dir = await ctx.fs.resolve(st.paths.sessionsDir)
                    const entries = await ctx.fs.listDir(dir)
                    let best = ''
                    for (const e of entries) {
                      const t = await ctx.fs.stat(await ctx.fs.resolve(st.paths.sessionsDir + '/' + e.name + '/checkpoint.md'))
                      if (t) { best = st.paths.sessionsDir + '/' + e.name + '/checkpoint.md' }
                    }
                  } catch (e) {}
                }
                if (!memExists && !latest) return
                const agent = ctx.agents.get(sid)
                if (!agent) return
                const lines = ['<system-reminder>', '本项目有记忆。开始相关工作时先读记忆文件；细节用 grep 在 ' + st.config.memDir + '/ 下定位；历史会话原文用 history_search。不要问用户记忆里已有的事。']
                if (memExists) lines.push('- MEMORY.md（项目规则/决策/事实）：' + st.paths.memory)
                if (latest) lines.push('- 最近会话 checkpoint：' + latest)
                lines.push('</system-reminder>')
                agent.inject({ id: 'mem-reminder-' + Date.now() + '-' + sid.slice(0, 6), role: 'user', content: [{ type: 'text', text: lines.join('\n') }], source: { kind: 'plugin', plugin: PLUGIN } })
                dbgLog('reminder injected to', sid.slice(0, 8))
              } catch (e) { dbgLog('reminder error:', String(e)) }
            })()
          }
        }
      } else if (event.type === 'tool/call') {
        const d = event.data
        bufferPush(sid, { t: 'TOOL_CALL: ' + d.name + ' ' + String(d.arguments).slice(0, 400) })
      } else if (event.type === 'tool/result') {
        const d = event.data
        const text = (d.message && d.message.content || []).map((b) => b.type === 'text' ? b.text : '').join(' ').slice(0, 600)
        bufferPush(sid, { t: 'TOOL_RESULT' + (d.error ? ' (ERROR ' + d.error.code + ')' : '') + ': ' + text })
      } else if (event.type === 'assistant/message') {
        const text = (event.data.message && event.data.message.content || []).map((b) => b.type === 'text' ? b.text : '').join(' ').slice(0, 300)
        bufferPush(sid, { t: 'ASSISTANT: ' + text })
      } else if (event.type === 'turn/end') {
        const st = ensureState(sid, session)
        if (st.project) maybeCheckpoint(sid, session)
      } else if (event.type === 'compaction/start') {
        const st = ensureState(sid, session)
        if (st.project && st.buffer.length) writeCheckpoint(sid, 'compaction-backstop')
      } else if (event.type === 'compaction/end') {
        if (event.data && event.data.error) {
          dbgLog('compaction failed, skip dump inject, sid =', sid.slice(0, 8))
          return
        }
        injectDump(sid, session)
      }
    } catch (e) { dbgLog('session/event error:', String(e)) }
  })

  ctx.on('agent/pre-step', async (payload, next) => {
    try {
      dbgLog('pre-step | turn =', payload.turn, 'step =', payload.step, 'messages =', (payload.messages || []).length, 'agent =', payload.agent && payload.agent.id.slice(0, 8))
    } catch (e) {}
    return next()
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const name = exec.name
      if (name !== 'write' && name !== 'edit') return next()
      const fp = exec.arguments && exec.arguments.file_path
      if (!fp || typeof fp !== 'string') return next()
      const agent = exec.agent
      const cwd = agent && agent.session && agent.session.header && agent.session.header.cwd
      if (!cwd) return next()
      let project
      try { project = await resolveProject(cwd) } catch (e) { return next() }
      if (!project) return next()
      const cfg = await projectConfig(project)
      const memDir = cfg.memDir
      const target = await ctx.fs.resolve(fp, { cwd })
      const tPath = ctx.fs.processPath(target)
      const root = await ctx.fs.resolve(project)
      const rootPath = ctx.fs.processPath(root)
      if (!isUnder(tPath, rootPath)) return next()
      const rel = tPath.slice(rootPath.length + 1)
      if (rel === memDir + '/MEMORY.md') return next()
      if (new RegExp('^' + memDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\/sessions\\/[^/]+\\/notes\\.md$').test(rel)) return next()
      if (rel === memDir || rel.startsWith(memDir + '/')) {
        return { kind: 'deny', reason: '记忆路径受保护：' + tPath + ' 只能由插件维护。可写：' + memDir + '/MEMORY.md 与 sessions/<sid>/notes.md。不要用其他路径重试。' }
      }
      return next()
    } catch (e) { return next() }
  })

  // ⑤ dream.auto（D31）：新会话启动（source='startup'）时检查式触发；opt-in，默认关。
  // 间隔门用 index.lastDreamAt 与 dream.intervalDays；无素材（无近期 checkpoint 且 MEMORY.md 为空）跳过。
  ctx.on('agent/session-start', (payload) => {
    const p = payload || {}
    if (!p.agent || p.source !== 'startup') return
    ;(async () => {
      try {
        const agent = p.agent
        const session = agent.session
        if (!session || isSubagentSession(session)) return
        const cwd = session.header && session.header.cwd
        if (!cwd) return
        const project = await resolveProject(cwd)
        if (!project) return
        const cfg = await projectConfig(project)
        if (!cfg.dreamAuto || cfg.disableWrite) return
        const paths = pathsFor(project, 'dream-auto', cfg.memDir)
        const idx = JSON.parse((await readText(paths.index)) || '{}') || {}
        const last = idx.lastDreamAt || 0
        if (last && Date.now() - last < cfg.dreamIntervalDays * 86400000) return
        const ckpts = await collectRecentCheckpoints(paths.sessionsDir, cfg.dreamIntervalDays)
        const mem = await readText(paths.memory)
        if (!ckpts.length && !(mem && String(mem).trim())) return
        dbgLog('dream auto scheduled, project =', project, 'ckpts =', ckpts.length)
        runDream(agent, 'auto')
      } catch (e) { dbgLog('dream auto error:', String(e)) }
    })()
  })

  // ④c 协议段注册（systemPrompt 服务可选；缺失时静默跳过，其余功能不受影响）
  const sp = ctx.get('systemPrompt')
  if (sp && typeof sp.section === 'function') {
    try {
      sp.section({ name: 'dsh-memory-protocol', order: 150, text: MEMORY_PROTOCOL_TEXT })
      dbgLog('protocol section registered (order 150)')
    } catch (e) { dbgLog('protocol section register failed:', String(e)) }
  }

  ctx.on('agent/disposed', ({ agent }) => {
    const sid = agent.session && agent.session.id
    if (!sid) return
    const st = states.get(sid)
    if (st && st.project && st.buffer.length && !st.config.disableWrite) writeCheckpoint(sid, 'disposed')
    states.delete(sid)
  })

  ctx.timer.interval(async () => {
    try {
      if (!dbg.length) return
      const t = await ctx.fs.resolve('/tmp/dsh-memory.log')
      const old = await ctx.fs.readText(t).catch(() => '')
      await ctx.fs.writeText(t, old + dbg.join('\n') + '\n')
      dbg.length = 0
    } catch (e) {}
  }, 60000)
}
