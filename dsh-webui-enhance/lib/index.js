const handlers = {}
export const inject = ['webServer']
export async function apply(ctx, config = {}) {
    ctx.effect(() => () => { if (writeTimer !== null) { clearTimeout(writeTimer); writeTimer = null } }, 'dsh-webui-enhance: persist-timer')
    const fs = ctx.get('fs')
    const sessions = ctx.get('sessions')
    const agents = ctx.get('agents')
    const workspaceRegistry = ctx.get('workspaceRegistry')
    const sessionPersistence = ctx.get('sessionPersistence')
    const sandboxPolicy = ctx.get('sandboxPolicy')
    const shell = ctx.get('shell')
    const llm = ctx.get('llm')
    const tokenMeter = ctx.get('tokenMeter')
    const credentials = ctx.get('credentials')

    const ledger = new Map()
    const records = []
    const MAX_RECORDS = 50000
    let seq = 0
    let dataFile = null
    let writeTimer = null
    const bump = (entry, usage) => {
      if (!usage) return
      entry.input += usage.inputTokens || 0
      entry.output += usage.outputTokens || 0
      entry.cacheRead += usage.cacheReadTokens || 0
      entry.reasoning += usage.reasoningTokens || 0
    }
    const ensureFile = async () => {
      if (dataFile) return dataFile
      if (!shell || !sandboxPolicy) return null
      try {
        const run = await shell.run(shell.resolve({ command: 'echo "$HOME/.dsh/dsh-usage"', timeoutMs: 5000 }))
        const dir = run && run.stdout ? String(typeof run.stdout === 'string' ? run.stdout : (run.stdout.text || '')).trim() : ''
        if (!dir) return null
        const policy = sandboxPolicy.resolve({ mode: 'danger-full-access' })
        const escaped = dir.replace(/'/g, "'\\''")
        await shell.run(shell.resolve({ command: "mkdir -p '" + escaped + "'", timeoutMs: 5000, sandboxPolicy: policy }))
        dataFile = dir + '/usage-records.json'
        return dataFile
      } catch (err) {
        return null
      }
    }
    const persist = async () => {
      const file = await ensureFile()
      if (!file || !fs) return
      try {
        const target = await fs.resolve(file)
        const policy = sandboxPolicy.resolve({ mode: 'danger-full-access' })
        await fs.writeText(target, JSON.stringify({ seq, records: records.slice(-MAX_RECORDS) }), undefined, undefined, policy)
      } catch (err) {
      }
    }
    const schedulePersist = () => {
      if (writeTimer !== null) return
      writeTimer = setTimeout(() => {
        writeTimer = null
        persist().catch(() => {})
      }, 2000)
    }
    const loadRecords = async () => {
      const file = await ensureFile()
      if (!file || !fs) return
      try {
        const target = await fs.resolve(file)
        const text = await fs.readText(target)
        if (!text) return
        const parsed = JSON.parse(text)
        if (parsed && Array.isArray(parsed.records)) {
          for (const r of parsed.records) {
            if (!r || typeof r.provider !== 'string' || typeof r.at !== 'number') continue
            records.push(r)
            const k = r.provider + '\u0000' + (r.model || '?')
            let entry = ledger.get(k)
            if (!entry) {
              entry = { provider: r.provider, model: r.model || '?', calls: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0, lastAt: 0 }
              ledger.set(k, entry)
            }
            entry.calls++
            entry.input += r.input || 0
            entry.output += r.output || 0
            entry.cacheRead += r.cacheRead || 0
            entry.reasoning += r.reasoning || 0
            if (r.at > entry.lastAt) entry.lastAt = r.at
          }
          seq = typeof parsed.seq === 'number' ? parsed.seq : records.length
        }
      } catch (err) {
      }
    }
    await loadRecords()

    if (llm !== undefined) {
      ctx.on('llm/stream', (options, next) => {
        const provider = (options && options.provider) || '?'
        const model = (options && options.model) || '?'
        const key = provider + '\u0000' + model
        let entry = ledger.get(key)
        if (!entry) {
          entry = { provider, model, calls: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0, lastAt: 0 }
          ledger.set(key, entry)
        }
        entry.calls++
        entry.lastAt = Date.now()
        let ws = null
        if (sessions && options && typeof options.sessionId === 'string') {
          const session = sessions.get(options.sessionId)
          if (session && session.header && typeof session.header.cwd === 'string') ws = session.header.cwd
        }
        const rec = {
          seq: seq++,
          at: entry.lastAt,
          ws,
          sessionId: (options && typeof options.sessionId === 'string') ? options.sessionId : null,
          provider,
          model,
          input: 0, output: 0, cacheRead: 0, reasoning: 0, finish: null,
        }
        records.push(rec)
        if (records.length > MAX_RECORDS) records.shift()
        schedulePersist()
        return (async function* () {
          const stream = await next()
          for await (const chunk of stream) {
            if (chunk && chunk.type === 'usage') {
              bump(entry, chunk.usage)
              bump(rec, chunk.usage)
            } else if (chunk && chunk.type === 'finish') {
              rec.finish = (chunk.reason && typeof chunk.reason.kind === 'string') ? chunk.reason.kind : 'unknown'
            }
            yield chunk
          }
        })()
      })
    }

    const CONSOLE_LINKS = {
      'xiaomi-token-plan-cn': 'https://platform.xiaomimimo.com/#/console/usage',
      'qwen-token-plan-cn': 'https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan',
    }
    const balanceCache = new Map()
    handlers['tokens-balance'] = async () => {
      const items = []
      if (!llm || !shell || !credentials) return { items, at: Date.now() }
      let providers = []
      try {
        providers = llm.listProviders()
      } catch (err) {
        return { items, at: Date.now() }
      }
      for (const p of providers) {
        const id = p.id
        const cached = balanceCache.get(id)
        if (cached && Date.now() - cached.at < 55000) {
          items.push(cached.result)
          continue
        }
        let result = null
        const consoleUrl = CONSOLE_LINKS[id]
        if (consoleUrl) {
          result = { provider: id, console: true, url: consoleUrl }
        } else if (id === 'deepseek-official' || id.indexOf('deepseek') !== -1) {
          try {
            const hit = await credentials.resolve('DEEPSEEK_API_KEY')
            const key = hit && typeof hit.value === 'string' ? hit.value : null
            if (!key) {
              result = { provider: id, error: 'no-api-key' }
            } else {
              const spec = shell.resolve({
                command: "curl -s --max-time 15 -H 'Authorization: Bearer " + key + "' https://api.deepseek.com/user/balance",
                timeoutMs: 20000,
                stdoutMaxBytes: 65536,
              })
              const run = await shell.run(spec)
              const text = run && run.stdout ? (typeof run.stdout === 'string' ? run.stdout : (run.stdout.text || '')) : ''
              if (!run || run.exitCode !== 0 || !text) {
                result = { provider: id, error: 'http-failed' }
              } else {
                const parsed = JSON.parse(text)
                result = {
                  provider: id,
                  available: parsed.is_available !== false,
                  balances: Array.isArray(parsed.balance_infos)
                    ? parsed.balance_infos.map((b) => ({
                        currency: b.currency || '?',
                        total: b.total_balance,
                        granted: b.granted_balance,
                        toppedUp: b.topped_up_balance,
                      }))
                    : [],
                }
              }
            }
          } catch (err) {
            result = { provider: id, error: String((err && err.message) || err) }
          }
        } else {
          result = { provider: id, unsupported: true }
        }
        balanceCache.set(id, { at: Date.now(), result })
        items.push(result)
      }
      return { items, at: Date.now() }
    }

    const dateKeyOf = (at) => {
      const d = new Date(at)
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    }
    handlers['tokens-usage'] = async (args) => {
      const a = (args && typeof args === 'object') ? args : {}
      const provider = typeof a.provider === 'string' && a.provider ? a.provider : null
      const rangeDays = Number(a.rangeDays) > 0 ? Math.min(Math.floor(Number(a.rangeDays)), 365) : 0
      const day = typeof a.day === 'string' && a.day ? a.day : null
      const chartWindow = a.window === 'month' ? 'month' : '30d'
      const sessionIds = Array.isArray(a.sessionIds) ? a.sessionIds.filter((x) => typeof x === 'string') : null
      const now = Date.now()
      const cutoff = rangeDays > 0 ? now - rangeDays * 86400000 : 0
      const agg = new Map()
      const totals = { calls: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0 }
      const sessionAgg = sessionIds ? new Map() : null
      const nowD = new Date(now)
      const monthKey = nowD.getFullYear() + '-' + (nowD.getMonth() + 1)
      const daysInMonth = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate()
      const startOfToday = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate())
      // daily: default last-30d, switchable to current month
      const daily = []
      if (chartWindow === 'month') {
        for (let d = 1; d <= daysInMonth; d++) daily.push({ label: (nowD.getMonth() + 1) + '-' + d, total: 0, input: 0, output: 0, calls: 0, cacheRead: 0, reasoning: 0, models: {}, sessions: {} })
      } else {
        for (let i = 29; i >= 0; i--) {
          const dt = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate() - i)
          daily.push({ label: (dt.getMonth() + 1) + '-' + dt.getDate(), total: 0, input: 0, output: 0, calls: 0, cacheRead: 0, reasoning: 0, models: {}, sessions: {} })
        }
      }
      const bucketOf = (at) => {
        const d = new Date(at)
        if (chartWindow === 'month') {
          if (d.getFullYear() + '-' + (d.getMonth() + 1) !== monthKey) return -1
          return d.getDate() - 1
        }
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate())
        const daysAgo = Math.round((startOfToday - dayStart) / 86400000)
        if (daysAgo < 0 || daysAgo > 29) return -1
        return 29 - daysAgo
      }
      for (const rec of records) {
        if (provider && rec.provider !== provider) continue
        const bi = bucketOf(rec.at)
        if (bi >= 0 && bi < daily.length) {
          const b = daily[bi]
          b.total += rec.input + rec.output
          b.input += rec.input
          b.output += rec.output
          b.calls++
          b.cacheRead += rec.cacheRead
          b.reasoning += rec.reasoning
          const mk = rec.provider + '/' + (rec.model || '?')
          const e = b.models[mk] || (b.models[mk] = { total: 0, input: 0, output: 0, calls: 0, cacheRead: 0, reasoning: 0 })
          e.total += rec.input + rec.output
          e.input += rec.input
          e.output += rec.output
          e.calls++
          e.cacheRead += rec.cacheRead
          e.reasoning += rec.reasoning
          if (sessionAgg && rec.sessionId && sessionIds.includes(rec.sessionId)) {
            let srow = b.sessions[rec.sessionId] || (b.sessions[rec.sessionId] = { calls: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0 })
            srow.calls++
            srow.input += rec.input
            srow.output += rec.output
            srow.cacheRead += rec.cacheRead
            srow.reasoning += rec.reasoning
          }
        }
        if (cutoff && rec.at < cutoff) continue
        if (day && dateKeyOf(rec.at) !== day) continue
        totals.calls++
        totals.input += rec.input
        totals.output += rec.output
        totals.cacheRead += rec.cacheRead
        totals.reasoning += rec.reasoning
        const k = rec.provider + '\u0000' + (rec.model || '?')
        let row = agg.get(k)
        if (!row) {
          row = { provider: rec.provider, model: rec.model || '?', calls: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0 }
          agg.set(k, row)
        }
        row.calls++
        row.input += rec.input
        row.output += rec.output
        row.cacheRead += rec.cacheRead
        row.reasoning += rec.reasoning
        if (sessionAgg && rec.sessionId && sessionIds.includes(rec.sessionId)) {
          let srow = sessionAgg.get(rec.sessionId)
          if (!srow) {
            srow = { sessionId: rec.sessionId, calls: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0 }
            sessionAgg.set(rec.sessionId, srow)
          }
          srow.calls++
          srow.input += rec.input
          srow.output += rec.output
          srow.cacheRead += rec.cacheRead
          srow.reasoning += rec.reasoning
        }
      }
      const hitRate = (row) => row.input + row.cacheRead > 0 ? Math.round((row.cacheRead / (row.input + row.cacheRead)) * 1000) / 10 : 0
      const rows = [...agg.values()].map((r) => ({ ...r, hitRate: hitRate(r) }))
      rows.sort((x, y) => (y.input + y.output) - (x.input + x.output) || y.calls - x.calls)
      const sessionRows = sessionAgg
        ? [...sessionAgg.values()].map((r) => ({ ...r, hitRate: hitRate(r) })).sort((x, y) => (y.input + y.output) - (x.input + x.output) || y.calls - x.calls)
        : []
      let providers = []
      if (llm !== undefined) {
        try {
          providers = llm.listProviders().map((p) => ({ id: p.id, name: p.name }))
        } catch (err) {
          providers = []
        }
      }
      return {
        providers,
        rows,
        sessionRows,
        totals: { ...totals, hitRate: hitRate(totals) },
        daily,
        filter: { provider, rangeDays, day, window: chartWindow },
      }
    }

    handlers['tokens-measure'] = async (args) => {
      const sessionId = (args && typeof args.sessionId === 'string') ? args.sessionId : ''
      if (!tokenMeter || !sessions || !sessionId) return { error: 'unavailable' }
      const session = sessions.get(sessionId)
      if (!session) return { error: 'session-not-live' }
      try {
        const m = tokenMeter.measure(session)
        return {
          logRevision: m.logRevision,
          totalTokens: m.totalTokens,
          surfaceTokens: m.surfaceTokens,
          surfaceDeltaTokens: m.surfaceDeltaTokens,
          baselineKind: m.baseline && m.baseline.kind,
          baselineTokens: m.baseline ? m.baseline.tokens : 0,
        }
      } catch (err) {
        return { error: String((err && err.message) || err) }
      }
    }

    handlers['file-search'] = async (args) => {
      const input = (args && typeof args === 'object') ? args : {}
      const query = typeof input.query === 'string' ? input.query.trim() : ''
      const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100)
      if (!fs) return { root: null, items: [] }
      let root = null
      if (sessions && typeof input.sessionId === 'string') {
        const session = sessions.get(input.sessionId)
        if (session && session.header && typeof session.header.cwd === 'string') root = session.header.cwd
      }
      if (!root && sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string') root = sandboxPolicy.workspaceRoot
      if (!root) return { root: null, items: [] }
      const SEP = new Set(['/', '-', '_', '.', ' ', '\\'])
      const fuzzyMatch = (q, s, originalS) => {
        if (q === '') return 0
        let qi = 0
        let first = -1
        let prev = -1
        let gapSum = 0
        let boundaryCount = 0
        let adjacent = 0
        for (let i = 0; i < s.length && qi < q.length; i++) {
          if (s[i] !== q[qi]) continue
          if (first === -1) {
            first = i
          } else {
            const gap = i - prev - 1
            gapSum += gap
            if (gap === 0) adjacent++
          }
          const isBoundary = i === 0 || SEP.has(s[i - 1]) ||
            (originalS[i] !== originalS[i - 1] && originalS[i] === originalS[i].toUpperCase() && originalS[i - 1] === originalS[i - 1].toLowerCase())
          if (isBoundary) boundaryCount++
          prev = i
          qi++
        }
        if (qi < q.length) return null
        return first + gapSum - boundaryCount * 3 - adjacent * 2
      }
      const q = query.toLowerCase()
      const MAX_DEPTH = 5
      const MAX_VISITS = 4000
      const MAX_COLLECT = limit * 10
      const found = []
      let visits = 0
      const visit = async (dirTarget, rel, depth) => {
        if (visits >= MAX_VISITS || found.length >= MAX_COLLECT) return
        let entries = []
        try {
          entries = await fs.listDir(dirTarget)
        } catch (err) {
          return
        }
        visits += entries.length
        for (const entry of entries) {
          if (found.length >= MAX_COLLECT) return
          const name = entry.name
          if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue
          const childRel = rel ? rel + '/' + name : name
          if (entry.type === 'directory') {
            if (depth < MAX_DEPTH) await visit(entry.target, childRel, depth + 1)
            if (depth <= 2) found.push({ path: childRel, size: undefined, depth, type: 'directory' })
          } else if (entry.type === 'file') {
            found.push({ path: childRel, size: typeof entry.size === 'number' ? entry.size : undefined, depth, type: 'file' })
          }
        }
      }
      try {
        const rootTarget = await fs.resolve(root)
        await visit(rootTarget, '', 0)
      } catch (err) {
        return { root, items: [] }
      }
      const ranked = []
      for (const it of found) {
        const lower = it.path.toLowerCase()
        const base = lower.split('/').pop() || lower
        const originalBase = it.path.split('/').pop() || it.path
        let score = null
        let quality = 0
        let exact = false
        if (q === '') {
          score = it.depth
          exact = true
        } else if (base.startsWith(q)) {
          score = 0
          exact = true
        } else if (lower.startsWith(q)) {
          score = 1
          exact = true
        } else if (base.includes(q)) {
          score = 2
          exact = true
        } else if (lower.includes(q)) {
          score = 3
          exact = true
        } else {
          const bm = fuzzyMatch(q, base, originalBase)
          if (bm !== null) {
            score = 2 + Math.max(0, Math.min(bm, 9))
            quality = bm
          } else {
            const pm = fuzzyMatch(q, lower, it.path)
            if (pm !== null) {
              score = 3 + Math.max(0, Math.min(pm, 9))
              quality = pm
            }
          }
        }
        if (score !== null) ranked.push({ path: it.path, size: it.size, score, quality, exact, baseLen: base.length, type: it.type })
      }
      ranked.sort((a, b) => a.score - b.score || (a.type === 'file' ? 0 : 1) - (b.type === 'file' ? 0 : 1) || (a.exact ? 0 : 1) - (b.exact ? 0 : 1) || a.quality - b.quality || a.baseLen - b.baseLen || a.path.localeCompare(b.path))
      return {
        root,
        items: ranked.slice(0, limit).map((it) => ({ path: it.path, size: typeof it.size === 'number' ? it.size : null, type: it.type })),
      }
    }

    handlers['produced-open'] = async (args) => {
      const input = (args && typeof args === 'object') ? args : {}
      const rawPath = typeof input.path === 'string' ? input.path.trim() : ''
      if (!rawPath) return { error: 'invalid-path' }
      if (!fs || !shell || !sandboxPolicy) return { error: 'unavailable' }
      const isAbs = rawPath.startsWith('/')
      const safeRel = String(rawPath).replace(/\.\./g, '').replace(/^\/+/, '')
      const roots = []
      const pushRoot = (r) => {
        if (typeof r === 'string' && r && !roots.includes(r)) roots.push(r)
      }
      if (sandboxPolicy) pushRoot(sandboxPolicy.workspaceRoot)
      if (sessions) {
        try {
          const ids = typeof sessions.list === 'function' ? sessions.list() : []
          for (const id of ids) {
            try {
              const s = sessions.get(id)
              if (s) pushRoot(s.header && s.header.cwd)
            } catch (err) {
            }
          }
        } catch (err) {
        }
      }
      if (sessionPersistence) {
        try {
          const headers = await sessionPersistence.list()
          for (const h of headers || []) pushRoot(h && h.cwd)
        } catch (err) {
        }
      }
      let target = null
      if (isAbs) {
        target = rawPath
      } else {
        for (const r of roots) {
          const t = r + '/' + safeRel
          try {
            const info = await fs.lstat(t)
            if (info && info.type === 'file') {
              target = t
              break
            }
          } catch (err) {
          }
        }
      }
      if (!target) {
        if (!isAbs) {
          for (const r of roots) {
            const t = r + '/' + safeRel
            try {
              const info = await fs.lstat(t)
              if (info) return { error: info.type === 'file' ? 'not-found' : 'not-a-file' }
            } catch (err) {
            }
          }
        }
        return { error: 'not-found' }
      }
      let info = null
      try {
        info = await fs.lstat(target)
      } catch (err) {
        return { error: 'not-found' }
      }
      if (!info || info.type !== 'file') return { error: 'not-a-file' }
      const size = typeof info.size === 'number' ? info.size : 0
      const ext = (rawPath.split('.').pop() || '').toLowerCase()
      const IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon' }
      const CODE = new Set(['c', 'cc', 'cpp', 'h', 'hpp', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'rb', 'php', 'cs', 'sql', 'sh', 'bash', 'zsh', 'fish', 'html', 'htm', 'css', 'scss', 'less', 'vue', 'svelte', 'toml', 'ini', 'conf', 'cfg', 'env', 'gitignore', 'dockerfile', 'makefile', 'txt', 'text', 'xml', 'yaml', 'yml', 'json', 'log', 'md', 'markdown'])
      if (IMG[ext]) {
        if (size > 2 * 1024 * 1024) return { kind: 'image', path: rawPath, error: 'too-large' }
        try {
          const policy = sandboxPolicy.resolve({ mode: 'danger-full-access' })
          const escaped = target.replace(/'/g, "'\\''")
          const run = await shell.run(shell.resolve({ command: "base64 -w0 '" + escaped + "'", timeoutMs: 15000, stdoutMaxBytes: 3 * 1024 * 1024, sandboxPolicy: policy }))
          const data = run && run.exitCode === 0 && run.stdout ? (typeof run.stdout === 'string' ? run.stdout : (run.stdout.text || '')) : ''
          if (!data) return { kind: 'image', path: rawPath, error: 'read-failed' }
          return { kind: 'image', path: rawPath, mime: IMG[ext], data }
        } catch (err) {
          return { kind: 'image', path: rawPath, error: String((err && err.message) || err) }
        }
      }
      if (CODE.has(ext)) {
        if (size > 1024 * 1024) return { kind: 'code', path: rawPath, error: 'too-large' }
        try {
          const resolved = await fs.resolve(target)
          const text = await fs.readText(resolved)
          const kind = (ext === 'md' || ext === 'markdown') ? 'md' : (ext === 'html' || ext === 'htm') ? 'html' : ext === 'log' ? 'log' : 'code'
          return { kind, path: rawPath, ext, text }
        } catch (err) {
          return { kind: 'code', path: rawPath, error: String((err && err.message) || err) }
        }
      }
      return { kind: 'unsupported', path: rawPath, ext }
    }

    const pendingDeletes = new Set()
    const cleanupSession = async (sessionId) => {
      if (!sessionPersistence || !fs || !shell || !sandboxPolicy) return { removed: false, reason: 'cleanup-unavailable' }
      const headers = await sessionPersistence.list()
      const header = headers.find((h) => h.id === sessionId)
      if (!header) return { removed: false, reason: 'no-log' }
      const loc = sessionPersistence.locate(header)
      if (!loc || typeof loc.path !== 'string' || !loc.path) return { removed: false, reason: 'no-log' }
      const parts = loc.path.split('/').filter(Boolean)
      const dirParts = parts.slice(0, -1)
      const dirPath = '/' + dirParts.join('/')
      const dirName = dirParts[dirParts.length - 1]
      if (dirName !== sessionId || dirPath.indexOf('/sessions/') === -1) return { removed: false, reason: 'path-rejected' }
      const info = await fs.lstat(dirPath)
      if (!info || info.type !== 'directory') return { removed: false, reason: 'no-log' }
      const policy = sandboxPolicy.resolve({ mode: 'danger-full-access' })
      const escaped = dirPath.replace(/'/g, "'\\''")
      const spec = shell.resolve({ command: "rm -rf -- '" + escaped + "'", timeoutMs: 10000, sandboxPolicy: policy })
      const run = await shell.run(spec)
      return run && run.exitCode === 0 ? { removed: true } : { removed: false, reason: 'remove-failed' }
    }
    if (agents !== undefined) {
      ctx.on('agent/disposed', (payload) => {
        const id = payload && payload.agent && payload.agent.id
        if (!id || !pendingDeletes.has(id)) return
        pendingDeletes.delete(id)
        const agent = payload.agent
        if (agent && agent.session && sessions) {
          sessions.flush(agent.session).catch(() => {})
        }
        cleanupSession(id).catch(() => {})
      })
    }
    handlers['delete-session'] = async (args) => {
      const sessionId = (args && typeof args.sessionId === 'string') ? args.sessionId : ''
      if (!sessionId) return { ok: false, error: 'invalid-session-id' }
      const result = { ok: true, archived: false, logRemoved: false, deferred: false, reason: null }
      if (!workspaceRegistry) return { ok: false, error: 'workspace-registry-unavailable' }
      try {
        await workspaceRegistry.archiveSession(sessionId)
        result.archived = true
      } catch (err) {
        return { ok: false, error: String((err && err.message) || err), ...result }
      }
      if (!sessions) {
        result.reason = 'cleanup-unavailable'
        return result
      }
      const agent = agents ? agents.get(sessionId) : undefined
      if (!agent) {
        const out = await cleanupSession(sessionId)
        result.logRemoved = out.removed
        result.reason = out.reason || null
        return result
      }
      if (agent.status === 'idle') {
        try {
          await sessions.flush(agent.session)
        } catch (err) {
        }
        const out = await cleanupSession(sessionId)
        result.logRemoved = out.removed
        result.reason = out.reason || null
        return result
      }
      result.deferred = true
      result.reason = 'session-running'
      pendingDeletes.add(sessionId)
      return result
    }

  // ---- 图片自动识别(agent/pre-step):文字模型下的图片描述注入 ----
  const visionCfg = (() => {
    const v = (config && config.vision) || (config && config.provider) || {}
    return {
      baseUrl: typeof v.baseUrl === 'string' && v.baseUrl ? String(v.baseUrl).replace(/\/+$/, '') : '',
      model: typeof v.model === 'string' && v.model ? v.model : 'mimo-v2.5',
      credential: typeof v.credential === 'string' && v.credential ? v.credential : 'XIAOMI_TOKEN_PLAN_CN_API_KEY',
      timeoutMs: Number(v.timeoutMs) > 0 ? Number(v.timeoutMs) : 20000,
    }
  })()
  const STRUCTURED_PROMPT = [
    '\u8BF7\u4ED4\u7EC6\u5206\u6790\u8FD9\u5F20\u56FE\u7247,\u8F93\u51FA\u4E00\u4EFD\u5B8C\u6574\u3001\u7ED3\u6784\u5316\u7684\u63CF\u8FF0(\u4F7F\u7528\u7B80\u4F53\u4E2D\u6587),\u5FC5\u987B\u5305\u542B\u4EE5\u4E0B\u5168\u90E8\u5C0F\u8282,\u4E0D\u8981\u7701\u7565\u4EFB\u4F55\u5C0F\u8282:',
    '1. \u3010\u603B\u4F53\u6982\u8FF0\u3011\u4E00\u53E5\u8BDD\u6982\u62EC\u56FE\u7247\u4E3B\u9898\u4E0E\u5185\u5BB9\u3002',
    '2. \u3010\u6587\u5B57\u5185\u5BB9\u3011\u9010\u5B57\u8F6C\u5F55\u56FE\u4E2D\u6240\u6709\u53EF\u89C1\u6587\u5B57,\u4FDD\u7559\u539F\u6587;\u82E5\u65E0\u6587\u5B57\u8BF7\u660E\u786E\u5199\u201C\u65E0\u201D\u3002',
    '3. \u3010\u56FE\u8868\u4E0E\u6570\u636E\u3011\u82E5\u5305\u542B\u8868\u683C\u3001\u56FE\u8868\u3001\u4EE3\u7801\u6216\u6570\u636E,\u63D0\u53D6\u5176\u7ED3\u6784\u4E0E\u5173\u952E\u5185\u5BB9;\u82E5\u65E0\u8BF7\u660E\u786E\u5199\u201C\u65E0\u201D\u3002',
    '4. \u3010\u754C\u9762\u4E0E\u5E03\u5C40\u3011\u82E5\u4E3A\u754C\u9762\u3001\u622A\u56FE\u6216\u6587\u6863,\u63CF\u8FF0\u4E3B\u8981\u533A\u57DF\u3001\u63A7\u4EF6\u3001\u5E03\u5C40\u987A\u5E8F\u4E0E\u72B6\u6001\u3002',
    '5. \u3010\u5173\u952E\u7EC6\u8282\u3011\u5BF9\u7406\u89E3\u56FE\u7247\u91CD\u8981\u4F46\u672A\u88AB\u4EE5\u4E0A\u5C0F\u8282\u8986\u76D6\u7684\u4FE1\u606F\u3002',
    '6. \u3010\u7ED3\u8BBA\u8981\u70B9\u3011\u7528 2-3 \u6761\u603B\u7ED3\u7528\u6237\u6700\u53EF\u80FD\u9700\u8981\u7684\u4FE1\u606F\u3002',
    '\u8981\u6C42:\u4E00\u6B21\u63CF\u8FF0\u5B8C\u6574,\u8986\u76D6\u6240\u6709\u53EF\u89C1\u4FE1\u606F;\u65E0\u76F8\u5173\u5185\u5BB9\u7684\u5C0F\u8282\u5FC5\u987B\u660E\u786E\u5199\u201C\u65E0\u201D\u3002',
  ].join('\n')
  const visionCache = new Map()
  const fnv1a = (s) => {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
    return h.toString(36)
  }
  const describeImage = async (base64, mime, apiKey) => {
    const payload = {
      model: visionCfg.model,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + base64 } },
        { type: 'text', text: STRUCTURED_PROMPT },
      ] }],
      max_tokens: 2048,
    }
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), visionCfg.timeoutMs)
    try {
      const res = await fetch(visionCfg.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + apiKey },
        body: JSON.stringify(payload),
        signal: ac.signal,
      })
      if (!res.ok) throw new Error('vision http ' + res.status)
      const data = await res.json()
      const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
      if (typeof text !== 'string' || !text) throw new Error('vision empty response')
      return text.trim()
    } finally {
      clearTimeout(timer)
    }
  }
  const describeBlock = async (ref, signal) => {
    const cacheKey = 'v:' + String(ref.attachmentId) + ':' + fnv1a(visionCfg.baseUrl + '|' + visionCfg.model)
    const hit = visionCache.get(cacheKey)
    if (hit && Date.now() - hit.at < 600000) return hit.text
    try {
      const attachments = ctx.attachments || ctx.get('attachments')
      if (!attachments || typeof attachments.readImage !== 'function') throw new Error('attachment service unavailable')
      const stored = await attachments.readImage(ref, signal)
      const bytes = stored && stored.data ? stored.data : null
      if (!bytes) throw new Error('attachment read failed')
      const base64 = typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : btoa(String.fromCharCode.apply(null, bytes))
      let apiKey = ''
      if (credentials) {
        try {
          const hitCred = await credentials.resolve(visionCfg.credential)
          if (hitCred && typeof hitCred.value === 'string') apiKey = hitCred.value
        } catch (err) {
        }
      }
      if (!apiKey) throw new Error('vision api key missing')
      const text = '[\u56FE\u7247\u8BC6\u522B]\n' + await describeImage(base64, ref.mediaType || 'image/png', apiKey)
      visionCache.set(cacheKey, { at: Date.now(), text })
      if (visionCache.size > 200) { const first = visionCache.keys().next().value; visionCache.delete(first) }
      return text
    } catch (err) {
      return '[\u56FE\u7247\u8BC6\u522B\u5931\u8D25: ' + String((err && err.message) || err) + ']'
    }
  }
  ctx.on('agent/pre-step', async (payload, next) => {
    if (!visionCfg.baseUrl) return next()
    const msgs = payload && Array.isArray(payload.messages) ? payload.messages : []
    let changed = false
    const nextMessages = []
    for (const msg of msgs) {
      if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) { nextMessages.push(msg); continue }
      let hasImage = false
      const content = []
      for (const block of msg.content) {
        if (block && block.type === 'image' && block.attachment && block.attachment.attachmentId) {
          hasImage = true
          content.push({ type: 'text', text: await describeBlock(block.attachment, payload.signal) })
        } else {
          content.push(block)
        }
      }
      nextMessages.push(hasImage ? { ...msg, content } : msg)
      if (hasImage) changed = true
    }
    if (!changed) return next()
    return { kind: 'enter', messages: nextMessages }
  })

  // ---- HTTP RPC 层(静态包通信,替代动态 harness.handle) ----
  const json = (res, body, status) => {
    res.writeHead(status || 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const readBody = (req) => new Promise((resolve) => {
    let buf = ''
    req.on('data', (c) => { buf += c; if (buf.length > 8388608) { req.destroy(); resolve(null) } })
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}) } catch (err) { resolve(null) } })
  })
  const webServer = ctx.webServer || ctx.get('webServer')
  if (webServer && typeof webServer.register === 'function') {
    webServer.register({
      kind: 'prefix',
      path: '/dsh-webui-enhance',
      handler: async (req, res) => {
        const urlPath = new URL(req.url ?? '/', 'http://x').pathname
        const name = urlPath.replace(/^\/dsh-webui-enhance\//, '')
        const fn = handlers[name]
        if (!fn || typeof fn !== 'function') { json(res, { ok: false, error: 'not-found' }, 404); return }
        try {
          const args = await readBody(req)
          if (args === null) { json(res, { ok: false, error: 'bad-body' }, 400); return }
          const value = await fn(args || {})
          json(res, { ok: true, value })
        } catch (err) {
          json(res, { ok: false, error: String((err && err.message) || err) }, 500)
        }
      },
    })
  }
}
