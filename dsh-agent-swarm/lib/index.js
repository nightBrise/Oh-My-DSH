// dsh-agent-swarm: star-team subagent orchestration for DeepSeek Harness.
// Packaged form of the iterated dynamic plugin (v4 -> v8).
// Configuration: package-root `config.yaml` (user-editable, hot-reloaded per
// dispatch; unset fields fall back to the built-in template below).
// Mount: preset row (`swarm/agent.cordis.yml` -> `name: '/abs/path/to/dsh-agent-swarm/lib/index.js'`).
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-agent-swarm'

export const inject = ['tools', 'fs', 'agents', 'subagents', 'systemPrompt', 'timer']

// 包根目录（config.yaml 所在处，用户 clone 后直接编辑）
const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))

// ── 内置模板默认值（config.yaml 覆盖；未配置字段回退此处） ──
const DEFAULT_TIERS = {
  lite:     { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  standard: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  pro:      { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
  ultra:    { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
}
const DEFAULT_TYPES = {
  explore: {
    tier: 'lite',
    tools: { allow: ['read', 'glob', 'grep', 'web_search', 'skill', 'list_agents', 'job_list', 'job_output', 'get_goal'] },
    role: 'read-only research: locate code, understand patterns, gather facts; report findings with concrete locations and conclusions.',
  },
  code: {
    tier: 'lite',
    tools: undefined,
    role: 'implementation: edit, build, self-test a well-specified change; report change summary and verification evidence.',
  },
  write: {
    tier: 'standard',
    tools: { allow: ['read', 'glob', 'grep', 'web_search', 'write', 'edit', 'skill', 'todo_write', 'list_agents', 'job_list', 'job_output'] },
    role: 'writing: produce clear, well-structured documents (papers, notes, README) matching the project conventions; report what was written and where.',
  },
  review: {
    tier: 'pro',
    tools: { allow: ['read', 'glob', 'grep', 'web_search', 'skill', 'list_agents', 'job_list', 'job_output', 'get_goal'] },
    role: 'independent review: quality/security/performance/edge cases; report prioritized issues with concrete fixes.',
  },
}
const DEFAULT_PERSONAS = {
  physics:    { text: 'For this task you act as a computational physicist specializing in accelerator and beam physics. Work from the governing equations, keep simulation code numerically sound, and verify against known physics cases.' },
  ml:         { text: 'For this task you act as an applied machine learning engineer. Build, train, and evaluate models rigorously: clean data, split correctly, report metrics with uncertainty.' },
  data:       { text: 'For this task you act as a data analyst. Inspect data before modeling, choose appropriate statistics, and present findings as clear summaries and plots.' },
  research:   { text: 'For this task you act as a research agent. Survey literature and existing code, compare approaches on concrete criteria, and report a recommendation with sources.' },
  docs:       { text: 'For this task you act as a technical writer. Produce clear, accurate, well-structured documentation in English, matching the codebase conventions.' },
  backend:    { text: 'For this task you act as a backend engineer. Own correctness, API design, and performance of the Python codebase; refactor and extend existing modules safely.' },
  reviewer:   { text: 'For this task you act as a rigorous journal reviewer: assess methodology soundness, statistical correctness, novelty, literature coverage, and writing quality; produce a structured review report with major/minor comments.' },
  statistician: { text: 'For this task you act as a statistician: choose appropriate statistical methods, validate assumptions, quantify uncertainty, and flag statistical pitfalls in the analysis.' },
}
const DEFAULT_LIMITS = {
  maxActive: 8,
  maxTeam: 16,
  maxDepth: 3,
  timeoutForegroundMaxS: 3600,
  timeoutBackgroundDefaultS: 900,
  summaryMinLength: 200,
}
const DEFAULT_CIRCUIT = {
  tripCodes: ['RATE_LIMIT', 'QUOTA', 'TIMEOUT', 'TRANSPORT', 'SERVER', 'EMPTY_RESPONSE'],
  threshold: 2,
  cooldownMs: 60000,
}

const DEFAULTS = {
  tiers: DEFAULT_TIERS,
  types: DEFAULT_TYPES,
  personas: DEFAULT_PERSONAS,
  limits: DEFAULT_LIMITS,
  circuit: DEFAULT_CIRCUIT,
  logPath: PKG_ROOT + 'dispatch.log',
  protocolSection: true,
  personaCatalogSection: true,
}

function deepMerge(base, patch) {
  if (patch === undefined || patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch
  const out = { ...base }
  for (const key of Object.keys(patch)) {
    const b = base && typeof base === 'object' ? base[key] : undefined
    out[key] = deepMerge(b, patch[key])
  }
  return out
}

export function apply(ctx) {
  const PLUGIN = 'dsh-agent-swarm'
  const logLine = (...a) => { try { console.log('[' + PLUGIN + ']', ...a) } catch (e) {} }

  // ── 配置读取（二选一优先）：
  //   有 model-router.local.yaml → 只用它（本地私有配置，最高优先）
  //   无 local → 用 config.yaml（上传模板，用户直接改它即可）
  // 每次 dispatch 现读热加载。
  function deepMerge(base, patch) {
    if (patch === undefined || patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch
    const out = { ...base }
    for (const key of Object.keys(patch)) {
      const b = base && typeof base === 'object' ? base[key] : undefined
      out[key] = deepMerge(b, patch[key])
    }
    return out
  }
  async function readYamlFile(name) {
    try {
      const t = await ctx.fs.resolve(PKG_ROOT + name)
      const text = await ctx.fs.readText(t)
      const parsed = parseYaml(text)
      return parsed && typeof parsed === 'object' ? (parsed['model-router'] || parsed) : undefined
    } catch (e) { return undefined }
  }
  async function loadConfig() {
    try {
      // 优先本地私有配置
      const local = await readYamlFile('model-router.local.yaml')
      if (local) {
        logLine('using model-router.local.yaml (local override)')
        return deepMerge(DEFAULTS, local)
      }
      // 无 local → 用上传模板 config.yaml
      const template = await readYamlFile('config.yaml')
      if (template) return deepMerge(DEFAULTS, template)
    } catch (e) { logLine('config read failed (using defaults): ' + String(e)) }
    return DEFAULTS
  }
  let cfgCache = DEFAULTS
  async function refreshConfig() {
    cfgCache = await loadConfig()
    return cfgCache
  }
  function cfg() { return cfgCache }

  async function log(msg) {
    try {
      let path = cfg().logPath
      if (typeof path === 'string' && path.startsWith('./')) path = PKG_ROOT + path.slice(2)
      const t = await ctx.fs.resolve(path)
      const prev = await ctx.fs.readText(t).catch(() => '')
      await ctx.fs.writeText(t, prev + new Date().toISOString() + ' ' + msg + '\n')
    } catch (e) { logLine('dispatch log fail: ' + String(e)) }
  }

  // ── 熔断状态（R6/D3） ──
  const circuit = new Map()
  ctx.on('agent/request-error', (payload, next) => {
    try {
      const c = cfg().circuit
      const depth = payload && payload.agent && payload.agent.session && payload.agent.session.header ? payload.agent.session.header.delegationDepth : 0
      const code = payload && payload.failure ? payload.failure.code : ''
      if (depth > 0 && payload.provider && c.tripCodes.includes(code)) {
        const key = payload.provider
        const st = circuit.get(key) || { failures: 0, until: 0 }
        if (Date.now() > st.until) st.failures = 0
        st.failures += 1
        if (st.failures >= c.threshold) {
          st.until = Date.now() + c.cooldownMs
          st.failures = 0
          logLine('circuit opened for provider ' + key + ' (code=' + code + ')')
        }
        circuit.set(key, st)
      }
    } catch (e) { logLine('circuit listener error: ' + String(e)) }
    return next()
  }, { global: true })

  // ── maxActive 记账（R14） ──
  const activeRuns = new Map()
  ctx.on('subagent/start', (info) => {
    try {
      const agent = ctx.agents && info && info.id ? ctx.agents.get(info.id) : undefined
      const parent = agent && agent.session && agent.session.header ? agent.session.header.parentSession : undefined
      activeRuns.set(info.runId, parent || null)
    } catch (e) { logLine('start listener error: ' + String(e)) }
  }, { global: true })
  ctx.on('subagent/end', (info) => {
    try { activeRuns.delete(info.runId) } catch (e) { logLine('end listener error: ' + String(e)) }
  }, { global: true })
  let inFlight = 0

  function tiers() { return cfg().tiers }
  function types() { return cfg().types }
  function personas() { return cfg().personas }
  function limits() { return cfg().limits }

  function circuitOpenFor(tierKey) {
    const t = tiers()[tierKey]
    const st = t ? circuit.get(t.provider) : undefined
    return st && st.until > Date.now() ? { provider: t.provider, until: st.until } : undefined
  }
  function availableTiers() {
    return Object.keys(tiers()).filter((k) => !circuitOpenFor(k))
  }
  function assertCircuit(tierKey) {
    const hit = circuitOpenFor(tierKey)
    if (hit) {
      const left = Math.ceil((hit.until - Date.now()) / 1000)
      const avail = availableTiers()
      throw new Error('dispatch: tier "' + tierKey + '" provider ' + hit.provider + ' is circuit-open (cooldown ' + left + 's left); available tiers: ' + (avail.length ? avail.join('/') : '(none)') + ' — wait for cooldown or pick another tier')
    }
  }

  // R11-v4：restrictableNames 过滤（与 tools.restrict() 校验集一致）
  async function toolFilterFor(typeKey, agent) {
    const def = types()[typeKey]
    const deny = ['dispatch', 'subagent', 'subagent_fork', 'workflow', 'ralph']
    const tools = agent && agent.ctx ? agent.ctx.get('tools') : ctx.get('tools')
    let restrictable = null
    if (tools && typeof tools.view === 'function') {
      try {
        const view = tools.view(agent)
        restrictable = view && view.restrictableNames ? view.restrictableNames : null
      } catch { restrictable = null }
    }
    if (restrictable) {
      const d = deny.filter((n) => restrictable.has(n))
      const a = def.tools && def.tools.allow ? def.tools.allow.filter((n) => restrictable.has(n)) : undefined
      if (def.tools && def.tools.allow && a.length === 0) throw new Error('dispatch: allow list emptied by restrictableNames filter: ' + def.tools.allow.join(','))
      const filter = {}
      if (d.length > 0) filter.deny = d
      if (a) filter.allow = a
      return Object.keys(filter).length > 0 ? filter : undefined
    }
    const a = def.tools && def.tools.allow ? def.tools.allow : undefined
    return { deny, ...(a ? { allow: a } : {}) }
  }
  function schemasFallbackFilter(typeKey, agent) {
    const def = types()[typeKey]
    const tools = agent && agent.ctx ? agent.ctx.get('tools') : ctx.get('tools')
    try {
      const schemas = tools && typeof tools.schemas === 'function' ? tools.schemas(agent) : []
      const names = new Set((schemas || []).map((s) => s && s.name).filter(Boolean))
      const d = ['dispatch', 'subagent', 'subagent_fork', 'workflow', 'ralph'].filter((n) => names.has(n))
      const a = def.tools && def.tools.allow ? def.tools.allow.filter((n) => names.has(n)) : undefined
      if (def.tools && def.tools.allow && a.length === 0) throw new Error('dispatch: allow list emptied by schema filter: ' + def.tools.allow.join(','))
      const filter = {}
      if (d.length > 0) filter.deny = d
      if (a) filter.allow = a
      return Object.keys(filter).length > 0 ? filter : undefined
    } catch (e) {
      return { deny: ['dispatch', 'subagent', 'subagent_fork', 'workflow', 'ralph'], ...(def.tools && def.tools.allow ? { allow: def.tools.allow } : {}) }
    }
  }

  function shortTitle(prompt) {
    const s = String(prompt).replace(/\s+/g, ' ').trim()
    return s.length > 40 ? s.slice(0, 40) + '...' : s
  }
  function escapeBraces(text) {
    return String(text).replace(/\{\{/g, '{ {').replace(/\}\}/g, '} }')
  }
  function textOf(blocks) {
    if (!Array.isArray(blocks)) return ''
    return blocks.filter((b) => b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
  }

  // ── 协议 section（D26/O9）：order -98，仅 root；type 清单从配置动态生成 ──
  function protocolText() {
    const c = cfg()
    const typeList = Object.keys(c.types).join('/')
    const tierList = Object.keys(c.tiers).join('/')
    const personaList = Object.keys(c.personas).join('/')
    return [
      '### Delegation entry',
      '你是编排者。所有子代理委派——一次性研究、分析、实施，或持续协作者——必须且只能',
      '通过 dispatch(type, prompt, options?) 发起。本会话已屏蔽原生 subagent/subagent_fork',
      '及 workflow 工具；若误触发，立即放弃该调用并改用 dispatch。',
      '',
      '- type：必须是已注册的子代理类型（封闭白名单：' + typeList + '）。它决定 toolFilter 边界、',
      '  输出约定、成本档位。未知类型会硬失败，不要猜测或拼凑类型名。',
      '- prompt：自包含的完整任务，含全部上下文与验收标准（子代理看不到你的对话）。',
      '- options：tier（成本档位 ' + tierList + '，省略用 type 默认）、persona（人设库 key：' + personaList + '，非必要不用）、',
      '  run_in_background（true=常驻成员返回 id 供续接；false=前台一次性）、',
      '  output_schema（仅前台一次性，结构化返回）、timeout（秒；前台默认无/上限 1h，后台默认 15min）。',
      '',
      '并行 fan-out（需同时展开多项独立子任务时）：',
      '1. 先把全部子任务一次性列全——明确 N 项、每项的 type 与 prompt 要点——再落笔调用。',
      '   禁止边派发边等待，禁止"先派一个看结果再决定下一个"。',
      '2. 在同一轮（同一批 tool_calls）内一次性发出全部 N 次 dispatch，然后停止并等待全部',
      '   结果回来，再进入下一轮汇总。只有子任务之间存在数据依赖时才允许分批/串行，且必须',
      '   在思考里说明依赖关系。',
      '3. 派发后逐项核对回执：缺一项就补派；多一项（重复派发）就忽略并说明；失败或空结果',
      '   不静默丢弃——重试一次，或改写 prompt 重派，或显式记录该项失败后继续。',
      '4. 每次 fan-out 默认不超过 ' + c.limits.maxActive + ' 个并发子代理；接近上限或预算时说明取舍，绝不无上限展开。',
      '',
      '结构化返回：需要可机读结果（合并/计算/入库）时，前台一次性模式用 output_schema 给出',
      'object-rooted JSON Schema；返回值为校验通过的对象，失败为 null。continuable 模式不支持',
      'output_schema，改用自然语言 + 续接提问。',
      '',
      '成本与可追溯：每次 dispatch 落地 {type, label, tier, subagent_id, 起止时间, 成本} 记录；',
      'label = type + 任务摘要 是续接与审计的唯一钥匙。续接已存在的后台子代理，按 label/id',
      '定位，绝不新开子代理去"找回"旧任务。',
      '',
      '### Dispatch failure handling（R6）',
      '当 dispatch 报错时，按错误类型应对：',
      '- 未知 type / 并发上限 / 参数冲突 → 读错误信息修正后重试（换合法 type、分批、调整参数）',
      '- 熔断命中（tier 目标不可用）→ 错误信息会列出可用 tier 与冷却剩余；换一个可用 tier 重试，',
      '  或等待冷却（先做其他任务），绝不用同一 tier 反复重试',
      '- 子代理运行失败（error/refusal/max-tokens）→ 按失败协议：重试一次 → 改写 prompt 重派 → 显式记录',
      '- 任何 dispatch 失败都不得静默忽略：要么解决、要么显式记录并告知用户',
      '',
      '### 团队协议骨架（D28 星型团队）',
      'Delegation rhythm（防串行崩溃/虚假并行）/ Roles / Prompt structure（四要素+结论化）',
      '/ Task assignment / Coordination（压缩后 list_agents 重枚举）/ Acceptance（审证据不重做）',
      '/ Team lifecycle（常驻复用）/ Labeling（type 词开头）',
    ].join('\n')
  }

  if (cfg().protocolSection) {
    ctx.systemPrompt.section({
      name: 'model-router:protocol',
      order: -98,
      text: (assemble) => {
        try {
          const agent = assemble && assemble.agent
          const depth = agent && agent.session && agent.session.header ? agent.session.header.delegationDepth : 0
          return depth > 0 ? '' : protocolText()
        } catch (e) {
          logLine('protocol section render failed: ' + String(e))
          return ''
        }
      },
    })
  }
  if (cfg().personaCatalogSection) {
    ctx.systemPrompt.section({
      name: 'swarm:persona-catalog',
      order: -90,
      text: (assemble) => {
        try {
          const agent = assemble && assemble.agent
          const depth = agent && agent.session && agent.session.header ? agent.session.header.delegationDepth : 0
          if (depth > 0) return ''
          const p = personas()
          const lines = Object.keys(p).map((key) => '- ' + key + ': ' + String(p[key].text).split(/[.。]/)[0] + '.')
          return '### Persona catalog (可选：dispatch 的 persona 参数引用以下 key 之一，非必要不用)\n' + lines.join('\n')
        } catch (e) {
          logLine('persona catalog render failed: ' + String(e))
          return ''
        }
      },
    })
  }

  async function runWithTimeout(runPromise, seconds, onTimeout) {
    if (!(seconds > 0) || !ctx.timer || typeof ctx.timer.timeout !== 'function') return runPromise
    const dispose = ctx.timer.timeout(() => { try { onTimeout() } catch (e) { logLine('timeout handler error: ' + String(e)) } }, seconds * 1000)
    try {
      return await runPromise
    } finally {
      try { if (dispose && typeof dispose === 'function') dispose() } catch (e) {}
    }
  }

  ctx.tools.register(defineTool({
    name: 'dispatch',
    description: 'Delegate a task to a subagent as the sole delegation entry. type is a closed whitelist (explore/code/write/review) deciding tool boundary, role, and default tier; tier overrides the cost tier (lite=MiMoV2.5Pro/standard=DeepSeekV4Flash/pro=DeepSeekV4Pro/ultra=Qwen3.8Max); persona is a persona-library key or free text; run_in_background true creates a persistent member returning subagentId; output_schema (foreground only) returns validated JSON or null; timeout in seconds (foreground default none / max 3600, background default 900). Delegation is governed by this tool; native subagent/workflow tools are restricted for children (D28 star team).',
    parameters: {
      type:    { type: 'string', required: true, description: 'Member type: explore | code | write | review (closed whitelist; unknown fails hard).' },
      prompt:  { type: 'string', required: true, description: 'Self-contained task (Goal/Context/Acceptance/Output); the subagent cannot see this conversation.' },
      tier:    { type: 'string', description: 'Optional tier override: lite | standard | pro | ultra. Defaults to the type tier.' },
      persona: { type: 'string', description: 'Persona library key (physics/ml/data/research/docs/backend/reviewer/statistician) or free text.' },
      run_in_background: { type: 'boolean', description: 'true = persistent continuable member (returns subagentId, follow up with send_message).' },
      output_schema: { type: 'object', additionalProperties: true, description: 'Foreground-only JSON Schema for structured output; validated result or null.' },
      timeout: { type: 'number', description: 'Optional seconds; foreground default none (max 3600), background default 900.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, value) => {
        if (!value || value.kind !== 'foreground') return [{ type: 'text', text: value && value.kind === 'continuable' ? 'started subagent ' + value.subagentId : 'dispatch returned no output' }]
        if (value.structured !== undefined) {
          return [{ type: 'text', text: 'structured: ' + JSON.stringify(value.structured) }]
        }
        const text = textOf(value.output)
        return [{ type: 'text', text: text.length > 0 ? text : '(subagent returned no text output)' }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const agent = exec.agent
      await refreshConfig()   // 每次 dispatch 现读 config.yaml（热加载）
      const L = limits()
      const typeDef = types()[args.type]
      if (!typeDef) throw new Error('dispatch: unknown type "' + args.type + '" (closed whitelist: ' + Object.keys(types()).join('/') + ')')
      if (args.output_schema && args.run_in_background) throw new Error('dispatch: output_schema is foreground-only')
      if (args.timeout !== undefined && (!Number.isFinite(args.timeout) || args.timeout <= 0 || args.timeout > L.timeoutForegroundMaxS)) throw new Error('dispatch: timeout must be 1..' + L.timeoutForegroundMaxS + ' seconds')
      const tierKey = args.tier || typeDef.tier
      const tier = tiers()[tierKey]
      if (!tier) throw new Error('dispatch: unknown tier "' + tierKey + '" (' + Object.keys(tiers()).join('/') + ')')
      assertCircuit(tierKey)
      if (inFlight >= L.maxActive) throw new Error('dispatch: maxActive=' + L.maxActive + ' concurrent dispatch limit reached (in-flight); wait for running tasks or reduce fan-out')
      const myActive = [...activeRuns.values()].filter((p) => p === agent.session.id).length
      if (myActive >= L.maxActive) throw new Error('dispatch: maxActive=' + L.maxActive + ' active children for this session; wait for running tasks or reduce fan-out')
      inFlight += 1
      const startedAt = Date.now()
      try {
        const label = args.type + ' ' + shortTitle(args.prompt)
        let promptText = typeDef.role + '\n\n' + args.prompt
        let persona
        if (args.persona !== undefined) {
          persona = personas()[args.persona] ? personas()[args.persona].text : escapeBraces(args.persona)
        }
        let toolFilter
        try {
          toolFilter = await toolFilterFor(args.type, agent)
        } catch (e) {
          toolFilter = schemasFallbackFilter(args.type, agent)
        }
        const request = {
          label,
          prompt: [{ type: 'text', text: promptText }],
          parent: agent,
          agentOptions: { provider: tier.provider, model: tier.model },
          maxDepth: L.maxDepth,
          ...(persona !== undefined ? { persona } : {}),
          ...(toolFilter !== undefined ? { toolFilter } : {}),
        }
        await log('dispatch type=' + args.type + ' tier=' + tierKey + ' provider=' + tier.provider + ' model=' + tier.model + ' persona=' + (args.persona || '-') + ' bg=' + (args.run_in_background ? 'y' : 'n') + ' maxDepth=' + L.maxDepth + (args.output_schema ? ' schema=yes' : '') + (args.timeout !== undefined ? ' timeout=' + args.timeout + 's' : '') + ' label=' + label)
        if (args.run_in_background) {
          const children = await ctx.subagents.listChildren(agent.session.id).catch(() => [])
          const continuables = (children || []).filter((c) => c && c.mode === 'continuable').length
          if (continuables >= L.maxTeam) throw new Error('dispatch: maxTeam=' + L.maxTeam + ' continuable members reached; retire a member (interrupt_agent) before adding more')
          const timeoutS = args.timeout !== undefined ? args.timeout : L.timeoutBackgroundDefaultS
          let r
          await runWithTimeout((async () => {
            r = await ctx.subagents.startContinuable({ provider: 'spawn', label, request, signal: exec.signal })
          })(), timeoutS, () => {
            try { if (ctx.subagents && typeof ctx.subagents.interrupt === 'function') ctx.subagents.interrupt(r ? r.childId : undefined, { kind: 'ancestor', agent }) } catch (e) { logLine('bg timeout interrupt error: ' + String(e)) }
          })
          await log('result subagent_id=' + r.childId + ' mode=continuable elapsed_ms=' + (Date.now() - startedAt))
          return { kind: 'continuable', subagentId: r.childId }
        }
        if (args.output_schema) request.outputSchema = args.output_schema
        const timeoutS = args.timeout !== undefined ? args.timeout : 0
        const run = await ctx.subagents.start('spawn', { ...request, signal: exec.signal })
        try {
          let r
          if (timeoutS > 0) {
            let timedOut = false
            r = await runWithTimeout(run.result, timeoutS, () => { timedOut = true; try { if (run.dispose) run.dispose() } catch (e) {} })
            if (timedOut) throw new Error('dispatch: subagent timed out after ' + timeoutS + 's (label=' + label + ')')
          } else {
            r = await run.result
          }
          const text = textOf(r && r.output ? r.output : [])
          await log('result subagent_id=' + (run.id || '-') + ' summary_len=' + text.length + ' stop=' + (r && r.stopReason || '?') + ' elapsed_ms=' + (Date.now() - startedAt))
          if (args.output_schema) {
            if (r && r.structured !== undefined) return { kind: 'foreground', output: r.output || [], structured: r.structured }
            const retryPrompt = promptText + '\n\n[dispatch retry] 你必须以结构化 JSON 输出最终结果（调用 structured_output 工具），不要以普通文本作答。'
            const run2 = await ctx.subagents.start('spawn', { ...request, prompt: [{ type: 'text', text: retryPrompt }], signal: exec.signal })
            try {
              const r2 = timeoutS > 0 ? await runWithTimeout(run2.result, timeoutS, () => { try { if (run2.dispose) run2.dispose() } catch (e) {} }) : await run2.result
              if (r2 && r2.structured !== undefined) return { kind: 'foreground', output: r2.output || [], structured: r2.structured }
              await log('result subagent_id=' + (run2.id || '-') + ' summary_len=0 stop=structured-null elapsed_ms=' + (Date.now() - startedAt))
              return { kind: 'foreground', output: r2 ? r2.output || [] : [], structured: null }
            } finally {
              if (run2.dispose) await run2.dispose()
            }
          }
          if (text.length > 0 && text.length < L.summaryMinLength) {
            const contPrompt = promptText + '\n\n[dispatch summary] 你的上轮回答过短（' + text.length + ' 字）。请提供更完整的摘要：技术细节、发现、结论，以及父代理需要知道的关键信息。'
            const run2 = await ctx.subagents.start('spawn', { ...request, prompt: [{ type: 'text', text: contPrompt }], signal: exec.signal })
            try {
              const r2 = timeoutS > 0 ? await runWithTimeout(run2.result, timeoutS, () => { try { if (run2.dispose) run2.dispose() } catch (e) {} }) : await run2.result
              const text2 = textOf(r2 && r2.output ? r2.output : [])
              await log('result subagent_id=' + (run2.id || '-') + ' summary_len=' + text2.length + ' stop=' + (r2 && r2.stopReason || '?') + ' continued=yes elapsed_ms=' + (Date.now() - startedAt))
              return { kind: 'foreground', output: r2 ? r2.output || [] : [] }
            } finally {
              if (run2.dispose) await run2.dispose()
            }
          }
          return { kind: 'foreground', output: (r && r.output) || [] }
        } finally {
          if (run.dispose) await run.dispose()
        }
      } catch (e) {
        await log('error reason=' + String(e && e.message ? e.message : e))
        throw e
      } finally {
        inFlight -= 1
      }
    },
  }))

  log('dsh-agent-swarm v0.1.0 loaded: tiers=' + Object.keys(tiers()).length + ' types=' + Object.keys(types()).length + ' personas=' + Object.keys(personas()).length)
}
