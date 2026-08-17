/**
 * dsh-badgeboard — host 半部
 *
 * 子代理工牌板（Badge Board）：派发时刻捕获 dispatch 档案
 * {type, tier, persona}，通过 webServer HTTP 路由暴露给 client 半部：
 *
 *   POST /dsh-badgeboard/badge-team/roster  → { members: [{id,type,tier,persona}], pending: [...] }
 *   POST /dsh-badgeboard/badge-team/status   → { rosterSize }
 *
 * 数据模型（详见 dsh-agent-swarm/docs/BADGE-BOARD-SPEC.md §6）：
 *   - 三层目录：① sessions.list 快照 subagentsByParent（权威，client 读）
 *               ② byId 会话层（client 读）
 *               ③ 本模块 tools/result 档案（type/tier/persona，此处捕获）
 *   - continuable 子代理用 result.value.subagentId 精确 join；
 *     前台 one-shot 无 subagentId → 按时间序暂存 pending，client best-effort 匹配（60s 窗口）。
 */
const json = (res, obj, status) => {
  const body = JSON.stringify(obj)
  res.writeHead(status || 200, { 'content-type': 'application/json' })
  res.end(body)
}
const readBody = (req) => new Promise((resolve) => {
  let buf = ''
  req.on('data', (c) => {
    buf += c
    if (buf.length > 8388608) { req.destroy(); resolve(null) }
  })
  req.on('end', () => {
    try { resolve(buf ? JSON.parse(buf) : {}) } catch (err) { resolve(null) }
  })
})

export const inject = ['webServer']

export function apply(ctx) {
  // 档案表：childId → {type, tier, persona}（仅派发时刻捕获，事件顺序不敏感）
  const roster = new Map()
  // 前台 one-shot 无 subagentId：按时间顺序暂存，client best-effort 匹配
  const pending = []
  const MAX = 100
  const trimPending = () => { if (pending.length > MAX) pending.splice(0, pending.length - MAX) }

  ctx.on('tools/result', (exec, result) => {
    try {
      if (!exec || exec.name !== 'dispatch') return
      const args = (exec.arguments && typeof exec.arguments === 'object') ? exec.arguments : {}
      const rec = { type: args.type, tier: args.tier, persona: args.persona, prompt: args.prompt }
      const value = (result && result.isError === false) ? result.value : null
      const subagentId = value && typeof value === 'object' ? value.subagentId : null
      if (typeof subagentId === 'string' && subagentId) {
        roster.set(subagentId, rec)
        if (roster.size > MAX) {
          const first = roster.keys().next().value
          if (first !== undefined) roster.delete(first)
        }
      } else {
        pending.push({ ts: Date.now(), type: rec.type, tier: rec.tier, persona: rec.persona, prompt: rec.prompt })
        trimPending()
      }
    } catch (e) {
      console.error('badgeboard: roster capture failed', e)
    }
  })

  const handlers = {
    'badge-team/roster': async () => ({
      members: Array.from(roster.entries()).map(([id, r]) => ({ id, type: r.type, tier: r.tier, persona: r.persona })),
      pending: pending.slice(-10).map((p) => ({ ts: p.ts, type: p.type, tier: p.tier, persona: p.persona })),
    }),
    'badge-team/status': async () => ({ rosterSize: roster.size }),
  }

  const webServer = ctx.webServer || ctx.get('webServer')
  if (webServer && typeof webServer.register === 'function') {
    webServer.register({
      kind: 'prefix',
      path: '/dsh-badgeboard',
      handler: async (req, res) => {
        const urlPath = new URL(req.url ?? '/', 'http://x').pathname
        const name = urlPath.replace(/^\/dsh-badgeboard\//, '')
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
