window.__ModuleLoader__.load({
  id: 'dsh-webui-enhance',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const rpc = (method, args) => fetch('/dsh-webui-enhance/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args || {}),
    }).then(async (res) => {
      let data = null
      try { data = await res.json() } catch (err) { data = null }
      if (!data || data.ok === false) throw new Error((data && data.error) || ('rpc ' + method + ' failed ' + res.status))
      return data.value
    })
    const injectStyles = (css) => {
      try {
        const el = document.createElement('style')
        el.setAttribute('data-plugin', 'dsh-webui-enhance')
        el.textContent = css
        document.head.appendChild(el)
        return () => { el.remove() }
      } catch (err) {
        return () => {}
      }
    }
    function apply(ctx) {
        ctx.effect(() => injectStyles(':has(> [data-conversation-scroll]){--dsh-chat-content-width:min(1280px,100%);}[data-time-hover-root] > div{max-width:min(1280px,82%);}[data-time-hover-root] :is(.p-xYUq_timeStart,.p-xYUq_timeEnd){opacity:1!important}[role="status"][aria-live="polite"]{font-size:0}[role="status"][aria-live="polite"]::before{content:var(--dsh-deep-text,\'Deep thinking\u2026\');font-size:14px;font-weight:600;background:linear-gradient(90deg,var(--dsw-static-deepseek-500) 0%,var(--dsw-static-deepseek-500) 40%,var(--dsw-static-deepseek-200) 50%,var(--dsw-static-deepseek-500) 60%,var(--dsw-static-deepseek-500) 100%);background-size:250% 100%;background-position:100% 0;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;animation:dyn-deep-shimmer 1.8s linear infinite}@keyframes dyn-deep-shimmer{to{background-position:0 0}}@media (prefers-reduced-motion:reduce){[role="status"][aria-live="polite"]::before{animation:none;background-position:0 0}}[role="status"][aria-live="polite"] > span{font-size:13px;color:var(--dsw-alias-label-caption,#999);-webkit-text-fill-color:var(--dsw-alias-label-caption,#999)}:has(> [data-shell-overlay])[data-dsh-wide]{grid-template-columns:var(--dsh-sidebar-px,280px) minmax(0,1fr) var(--dsh-details-px,640px)!important}[data-dsh-wide] [data-side="details"]{left:var(--dsh-handle-left,auto)!important}'), 'dsh-webui-enhance: styles')

    if (typeof document !== 'undefined' && typeof MutationObserver === 'function') {
      const DEEP_PHRASES = [
        'Deep thinking\u2026', 'Deep reasoning\u2026', 'Deep analyzing\u2026', 'Deep planning\u2026', 'Deep researching\u2026',
        'Deep studying\u2026', 'Deep pondering\u2026', 'Deep contemplating\u2026', 'Deep comprehending\u2026', 'Deep strategizing\u2026',
        'Deep deliberating\u2026', 'Deep reflecting\u2026', 'Deep evaluating\u2026', 'Deep synthesizing\u2026', 'Deep architecting\u2026',
        'Deep designing\u2026', 'Deep structuring\u2026', 'Deep formulating\u2026', 'Deep envisioning\u2026', 'Deep modeling\u2026',
        'Deep searching\u2026', 'Deep reading\u2026', 'Deep scanning\u2026', 'Deep probing\u2026', 'Deep digging\u2026',
        'Deep diving\u2026', 'Deep mining\u2026', 'Deep drilling\u2026', 'Deep tracing\u2026', 'Deep exploring\u2026',
        'Deep debugging\u2026', 'Deep drafting\u2026', 'Deep editing\u2026', 'Deep reviewing\u2026', 'Deep refactoring\u2026',
        'Deep refining\u2026', 'Deep optimizing\u2026', 'Deep testing\u2026', 'Deep verifying\u2026', 'Deep hunting\u2026',
        'Deep seeking\u2026', 'Deep learning\u2026', 'Deep frying\u2026', 'Deep freezing\u2026', 'Deep brewing\u2026',
        'Deep stewing\u2026', 'Deep marinating\u2026', 'Deep dreaming\u2026', 'Deep sleeping\u2026', 'Deep breathing\u2026',
        'Deep meditating\u2026', 'Deep copying\u2026', 'Deep humming\u2026', 'Deep shimmering\u2026', 'Deep savoring\u2026',
        'Deep gazing\u2026', 'Deep stargazing\u2026', 'Deep voyaging\u2026', 'Deep resonating\u2026', 'Deep whispering\u2026',
      ]
      const phraseByEl = new WeakMap()
      let lastPhrase = ''
      const pick = () => {
        let p = DEEP_PHRASES[Math.floor(Math.random() * DEEP_PHRASES.length)]
        if (p === lastPhrase) {
          const i = DEEP_PHRASES.indexOf(p)
          p = DEEP_PHRASES[(i + 1 + Math.floor(Math.random() * (DEEP_PHRASES.length - 1))) % DEEP_PHRASES.length]
        }
        lastPhrase = p
        return p
      }
      const applyDeep = () => {
        const els = document.querySelectorAll('[role="status"][aria-live="polite"]')
        for (const el of els) {
          if (!phraseByEl.has(el)) phraseByEl.set(el, pick())
          el.style.setProperty('--dsh-deep-text', JSON.stringify(phraseByEl.get(el)))
        }
      }
      const observer = new MutationObserver(applyDeep)
      ctx.effect(() => {
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })
        applyDeep()
        return () => observer.disconnect()
      }, 'demo: deep phrase randomizer')
    }
    if (typeof document !== 'undefined') {
      ctx.effect(() => {
        const onDocClick = (e) => {
          const t = e.target
          if (!t || typeof t.closest !== 'function') return
          const chip = t.closest('[data-produced-files-row] button')
          if (!chip) return
          const path = chip.getAttribute('title')
          if (!path || path === '.') return
          e.preventDefault()
          e.stopPropagation()
          try {
            window.dispatchEvent(new CustomEvent('dsh:produced-open', { detail: path }))
          } catch (err) {
          }
        }
        document.addEventListener('click', onDocClick, true)
        return () => document.removeEventListener('click', onDocClick, true)
      }, 'demo: produced chip capture')
    }
    const inputTriggers = ctx.get('inputTriggers')
    const fileSourceReady = inputTriggers !== undefined
    if (inputTriggers !== undefined) {
      const formatPath = (path) => {
        if (path.length <= 48) return path
        return path.slice(0, 12) + '\u2026' + path.slice(-28)
      }
      const source = {
        trigger: '@',
        name: 'file',
        order: 1,
        async candidates(session, req) {
          try {
            const res = await rpc('file-search', {
              sessionId: (session && session.sessionId) || '',
              query: req.query,
              limit: 20,
            })
            if (req.signal.aborted || !res || !Array.isArray(res.items)) return []
            return res.items.map((it) => {
              const isDir = it.type === 'directory'
              const candidate = {
                name: it.path.split('/').pop() || it.path,
                description: formatPath(it.path),
                icon: isDir ? '\uD83D\uDCC1' : '\uD83D\uDCC4',
              }
              candidate.fullPath = it.path
              return candidate
            })
          } catch (err) {
            console.error('file-search failed', String((err && err.message) || err))
            return []
          }
        },
        onPick(pick) {
          const path = (pick.candidate && pick.candidate.fullPath) || pick.candidate.name
          return { text: '@' + path + ' ' }
        },
      }
      ctx.effect(() => inputTriggers.registerSource(source), 'demo: @file source')
    }

    const slots = ctx.get('slots')
    if (slots === undefined) return
    const workspacesSvc = ctx.get('workspaces')
    const sessionsSvc = ctx.get('sessions')

    const fmt = (n) => {
      if (typeof n !== 'number' || !isFinite(n)) return '0'
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
      return String(n)
    }
    const cell = { padding: '5px 8px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid rgba(128,128,128,0.12)' }
    const cellL = { ...cell, textAlign: 'left' }
    const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1']
    const SOFT = ['#2f66c9', '#4d9a74', '#d1933a', '#c25a5a', '#8564c4', '#4f93ad', '#c05f8c', '#87a85a', '#c97643', '#5d72c2']
    const smoothPath = (pts) => {
      if (!pts || pts.length === 0) return ''
      if (pts.length === 1) return 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1)
      let d = 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1)
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)]
        const p1 = pts[i]
        const p2 = pts[i + 1]
        const p3 = pts[Math.min(pts.length - 1, i + 2)]
        const c1x = p1.x + (p2.x - p0.x) / 6
        const c1y = p1.y + (p2.y - p0.y) / 6
        const c2x = p2.x - (p3.x - p1.x) / 6
        const c2y = p2.y - (p3.y - p1.y) / 6
        d += ' C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ',' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ',' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1)
      }
      return d
    }
    const buildDonut = (segs) => {
      let total = 0
      const map = new Map()
      for (const s of segs) {
        map.set(s.key, (map.get(s.key) || 0) + s.v)
        total += s.v
      }
      const items = [...map.entries()]
        .map(([name, v]) => ({ name, v, pct: total > 0 ? (v / total) * 100 : 0 }))
        .sort((a, b) => b.v - a.v)
      const R = 54
      const C = 2 * Math.PI * R
      let offset = 0
      const arcs = items.map((s, i) => {
        const len = total > 0 ? (s.v / total) * C : 0
        const el = React.createElement('circle', {
          key: s.name,
          cx: 70, cy: 70, r: R, fill: 'none',
          stroke: SOFT[i % SOFT.length],
          strokeWidth: 20,
          strokeDasharray: len + ' ' + (C - len),
          strokeDashoffset: -offset,
          transform: 'rotate(-90 70 70)',
        })
        offset += len
        return el
      })
      return { total, items, arcs }
    }
    const renderDonut = (title, total, items, arcs) =>
      React.createElement('div', {
        style: { flex: '1 1 300px', border: '1px solid rgba(128,128,128,0.25)', borderRadius: 10, padding: '10px 12px' },
      },
        React.createElement('h3', { style: { fontSize: 13, fontWeight: 600, margin: '0 0 6px' } }, title),
        items.length === 0
          ? React.createElement('p', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #999)', margin: 0 } }, '\u65E0\u6570\u636E')
          : React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' } },
              React.createElement('svg', { width: 130, height: 130, viewBox: '0 0 140 140' },
                arcs,
                React.createElement('text', { x: 70, y: 66, textAnchor: 'middle', fontSize: 13, fontWeight: 700, fill: 'var(--dsw-alias-label-primary, #ddd)' }, fmt(total)),
                React.createElement('text', { x: 70, y: 82, textAnchor: 'middle', fontSize: 9, fill: 'var(--dsw-alias-label-tertiary, #999)' }, 'tokens'),
              ),
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                items.map((s, i) => React.createElement('div', { key: s.name, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 } },
                  React.createElement('span', { style: { width: 9, height: 9, borderRadius: 2, background: SOFT[i % SOFT.length], display: 'inline-block', flex: 'none' } }),
                  React.createElement('span', { style: { maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.name),
                  React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary, #999)', whiteSpace: 'nowrap' } }, s.pct.toFixed(1) + '%'),
                )),
              ),
            ),
      )
    const mdCodeStyle = { background: 'rgba(128,128,128,0.12)', borderRadius: 6, padding: '10px 12px', overflowX: 'auto', fontSize: 14, lineHeight: 1.6, margin: '6px 0' }
    const miniMarkdown = (text) => {
      const lines = String(text).split(/\r?\n/)
      const els = []
      let inCode = false
      let codeBuf = []
      let listBuf = []
      let key = 0
      const flushList = () => {
        if (listBuf.length) {
          els.push(React.createElement('ul', { key: 'l' + key++, style: { margin: '4px 0', paddingLeft: 20, fontSize: 15, lineHeight: 1.7 } }, listBuf.map((li, i) => React.createElement('li', { key: i }, li))))
          listBuf = []
        }
      }
      const inline = (s) => {
        const out = []
        const re = /(\*\*([^*]+)\*\*|`([^`]+)`|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\))/g
        let last = 0
        let m = null
        let k = 0
        while ((m = re.exec(s))) {
          if (m.index > last) out.push(s.slice(last, m.index))
          if (m[2] !== undefined) out.push(React.createElement('strong', { key: k++ }, m[2]))
          else if (m[3] !== undefined) out.push(React.createElement('code', { key: k++, style: { background: 'rgba(128,128,128,0.15)', borderRadius: 3, padding: '1px 4px', fontSize: 14 } }, m[3]))
          else if (m[4] !== undefined) out.push(React.createElement('img', { key: k++, src: m[5], alt: m[4] || '', style: { maxWidth: '100%', borderRadius: 6, margin: '4px 0', display: 'block' } }))
          else out.push(React.createElement('a', { key: k++, href: m[7], target: '_blank', rel: 'noreferrer', style: { color: '#3b82f6' } }, m[6]))
          last = m.index + m[0].length
        }
        if (last < s.length) out.push(s.slice(last))
        return out
      }
      const cells = (row) => {
        let parts = String(row).split('|')
        if (parts.length && parts[0].trim() === '') parts.shift()
        if (parts.length && parts[parts.length - 1].trim() === '') parts.pop()
        return parts.map((p) => p.trim())
      }
      const isTableSep = (line) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')
      let i = 0
      while (i < lines.length) {
        const raw = lines[i]
        const t = raw.trim()
        if (t.startsWith('```')) {
          if (inCode) {
            els.push(React.createElement('pre', { key: key++, style: mdCodeStyle }, codeBuf.join('\n')))
            codeBuf = []
            inCode = false
          } else {
            flushList()
            inCode = true
          }
          i++
          continue
        }
        if (inCode) {
          codeBuf.push(raw)
          i++
          continue
        }
        if (raw.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
          flushList()
          const header = cells(raw)
          const data = []
          let j = i + 2
          while (j < lines.length && lines[j].includes('|')) {
            data.push(cells(lines[j]))
            j++
          }
          const cellStyle = { border: '1px solid rgba(128,128,128,0.3)', padding: '5px 10px', fontSize: 14, lineHeight: 1.6 }
          els.push(React.createElement('table', {
            key: key++, style: { borderCollapse: 'collapse', margin: '8px 0', width: '100%' },
          },
            React.createElement('thead', null, React.createElement('tr', null, header.map((c, ci) => React.createElement('th', { key: ci, style: { ...cellStyle, textAlign: 'left', fontWeight: 600 } }, inline(c))))),
            React.createElement('tbody', null, data.map((row, ri) => React.createElement('tr', { key: ri }, row.map((c, ci) => React.createElement('td', { key: ci, style: cellStyle }, inline(c)))))),
          ))
          i = j
          continue
        }
        const h = t.match(/^(#{1,6})\s+(.*)$/)
        if (h) {
          flushList()
          els.push(React.createElement('h' + h[1].length, { key: key++, style: { margin: '12px 0 5px', fontSize: 20 - h[1].length, fontWeight: 700, lineHeight: 1.4 } }, inline(h[2])))
          i++
          continue
        }
        if (/^[-*]\s+/.test(t) || /^\d+\.\s+/.test(t)) {
          listBuf.push(inline(t.replace(/^([-*]|\d+\.)\s+/, '')))
          i++
          continue
        }
        flushList()
        if (t.startsWith('>')) {
          els.push(React.createElement('div', { key: key++, style: { borderLeft: '3px solid rgba(128,128,128,0.4)', paddingLeft: 12, color: 'var(--dsw-alias-label-secondary,#bbb)', margin: '6px 0', fontSize: 15, lineHeight: 1.7 } }, inline(t.replace(/^>\s?/, ''))))
          i++
          continue
        }
        if (/^---+\s*$/.test(t)) {
          els.push(React.createElement('hr', { key: key++, style: { border: 'none', borderTop: '1px solid rgba(128,128,128,0.25)', margin: '12px 0' } }))
          i++
          continue
        }
        if (t === '') {
          els.push(React.createElement('div', { key: key++, style: { height: 8 } }))
          i++
          continue
        }
        els.push(React.createElement('p', { key: key++, style: { margin: '5px 0', fontSize: 15, lineHeight: 1.7 } }, inline(raw)))
        i++
      }
      if (inCode && codeBuf.length) {
        els.push(React.createElement('pre', { key: key++, style: mdCodeStyle }, codeBuf.join('\n')))
      }
      flushList()
      return els
    }
    const ProducedPanel = (props) => {
      const renderSlot = props && props.renderSlot
      const [tabs, setTabs] = React.useState([])
      const [active, setActive] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [pane, setPane] = React.useState('team')
      React.useEffect(() => {
        const applyWide = () => {
          try {
            const overlay = document.querySelector('[data-shell-overlay]')
            const frame = overlay && overlay.parentElement
            if (!frame) return
            const cs = getComputedStyle(frame)
            const cols = cs.gridTemplateColumns.split(' ')
            const sidebarW = parseFloat(cols[0])
            const detailsW = parseFloat(cols[2])
            if (!isFinite(sidebarW) || !isFinite(detailsW)) return
            const total = frame.getBoundingClientRect().width
            const half = Math.max(300, Math.floor((total - sidebarW) / 2))
            frame.dataset.dshWide = '1'
            frame.style.setProperty('--dsh-sidebar-px', sidebarW + 'px')
            frame.style.setProperty('--dsh-details-px', half + 'px')
            frame.style.setProperty('--dsh-handle-left', (total - half) + 'px')
          } catch (err) {
          }
        }
        const onOpen = (e) => {
          const path = e && e.detail
          if (typeof path !== 'string' || !path) return
          setBusy(true)
          setPane('produced')
          const layout = ctx.get('layout')
          if (layout && typeof layout.openDetails === 'function') {
            try {
              layout.openDetails()
            } catch (err) {
            }
          }
          try {
            window.requestAnimationFrame(() => { window.requestAnimationFrame(applyWide) })
          } catch (err) {
          }
          const addTab = (file) => {
            setTabs((prev) => {
              const hit = prev.find((t) => t.path === path)
              if (hit) {
                setActive(hit.key)
                return prev.map((t) => (t.path === path ? { ...t, file } : t))
              }
              const key = String(Date.now()) + '-' + Math.floor(Math.random() * 1000000)
              setActive(key)
              return [...prev, { key, path, file }]
            })
          }
          rpc('produced-open', { path }).then((res) => {
            setBusy(false)
            addTab(res || { error: 'no-data' })
          }).catch((err) => {
            setBusy(false)
            addTab({ error: String((err && err.message) || err) })
          })
        }
        window.addEventListener('dsh:produced-open', onOpen)
        return () => window.removeEventListener('dsh:produced-open', onOpen)
      }, [])
      React.useEffect(() => {
        if (typeof document === 'undefined') return
        let dragging = false
        let startX = 0
        let startW = 0
        let frame = null
        const onDown = (e) => {
          const t = e.target
          if (!t || typeof t.closest !== 'function') return
          const handle = t.closest('[data-side="details"]')
          if (!handle) return
          const f = handle.closest('[data-dsh-wide]')
          if (!f) return
          e.preventDefault()
          e.stopPropagation()
          dragging = true
          frame = f
          startX = e.clientX
          const cur = parseFloat(f.style.getPropertyValue('--dsh-details-px'))
          startW = isFinite(cur) ? cur : 520
          f.dataset.dragging = 'true'
          handle.setAttribute('data-dragging', 'true')
        }
        const onMove = (e) => {
          if (!dragging || !frame) return
          let sidebarW = 280
          try {
            const cs = getComputedStyle(frame)
            sidebarW = parseFloat(cs.gridTemplateColumns.split(' ')[0])
          } catch (err) {
          }
          const total = frame.getBoundingClientRect().width
          const w = Math.max(300, Math.min(startW + (startX - e.clientX), total - sidebarW - 320))
          frame.style.setProperty('--dsh-details-px', w + 'px')
          frame.style.setProperty('--dsh-handle-left', (total - w) + 'px')
        }
        const onUp = () => {
          if (!dragging) return
          dragging = false
          if (frame) {
            delete frame.dataset.dragging
            const h = frame.querySelector('[data-side="details"]')
            if (h) h.removeAttribute('data-dragging')
          }
          frame = null
        }
        document.addEventListener('pointerdown', onDown, true)
        document.addEventListener('pointermove', onMove, true)
        document.addEventListener('pointerup', onUp, true)
        return () => {
          document.removeEventListener('pointerdown', onDown, true)
          document.removeEventListener('pointermove', onMove, true)
          document.removeEventListener('pointerup', onUp, true)
        }
      }, [])

      const layout = ctx.get('layout')
      const closeTab = (key) => {
        setTabs((prev) => {
          const idx = prev.findIndex((t) => t.key === key)
          if (idx === -1) return prev
          const next = prev.filter((t) => t.key !== key)
          if (active === key) {
            const nxt = next[Math.min(idx, next.length - 1)]
            setActive(nxt ? nxt.key : null)
          }
          return next
        })
      }
      const current = tabs.find((t) => t.key === active) || null
      const file = current ? current.file : null
      // 视图规则：显式切到"团队"或没有任何产物 tab 时显示团队分段（竖条开栏默认即团队）
      const view = (pane === 'team' || tabs.length === 0) ? 'team' : 'produced'
      const base = String((current && current.path) || '')
      const name = base.split('/').pop() || base
      const head = {
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 0',
        borderBottom: '1px solid rgba(128,128,128,0.2)', flex: 'none', minWidth: 0,
      }
      const tabbar = { display: 'flex', gap: 6, overflowX: 'auto', flex: 1, minWidth: 0, paddingBottom: 10 }
      const tabBase = {
        display: 'inline-flex', alignItems: 'center', gap: 5, flex: 'none',
        maxWidth: 170, minWidth: 0, padding: '4px 8px', borderRadius: 6,
        border: '1px solid rgba(128,128,128,0.3)', fontSize: 13, cursor: 'pointer',
        background: 'transparent', color: 'var(--dsw-alias-label-secondary, #bbb)',
        whiteSpace: 'nowrap',
      }
      const tabActive = {
        ...tabBase,
        background: 'rgba(47,102,201,0.3)',
        color: 'var(--dsw-alias-label-primary, #eee)',
        borderColor: 'rgba(59,130,246,0.65)',
      }
      const tabName = { overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }
      const tabClose = {
        border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer',
        fontSize: 12, padding: '0 2px', flex: 'none', opacity: 0.75, lineHeight: 1,
      }
      const body = {
        flex: 1, overflow: 'auto', padding: '14px 54px 14px 18px', fontSize: 15, lineHeight: 1.7, minWidth: 0,
      }
      const closeBtn = {
        border: '1px solid rgba(128,128,128,0.4)', background: 'transparent', color: 'inherit',
        borderRadius: 6, cursor: 'pointer', fontSize: 14, padding: '3px 10px', flex: 'none',
        marginRight: 44,
      }
      let content = null
      if (view === 'team') {
        // 团队分段：渲染 badgeboard 插件注册的 details.produced.team 子座位
        let node = null
        try {
          node = typeof renderSlot === 'function' ? renderSlot('details.produced.team', {}) : null
        } catch (err) {
          node = null
        }
        content = React.createElement('div', { style: { height: '100%', minWidth: 0 } },
          node === null || node === undefined
            ? React.createElement('p', { style: { color: 'var(--dsw-alias-label-tertiary,#999)', fontSize: 14 } }, '\u56E2\u961F\u5DE5\u724C\u9762\u677F\u672A\u52A0\u8F7D\uFF08badgeboard \u63D2\u4EF6\u672A\u8FD0\u884C\uFF09')
            : node,
        )
      } else if (busy && !current) {
        content = React.createElement('p', { style: { color: 'var(--dsw-alias-label-tertiary,#999)', fontSize: 15 } }, '\u52A0\u8F7D\u4E2D\u2026')
      } else if (!current) {
        content = React.createElement('p', { style: { color: 'var(--dsw-alias-label-tertiary,#999)', fontSize: 15 } }, '\u70B9\u51FB\u5BF9\u8BDD\u4E2D\u7684\u4EA7\u7269\u4EE5\u5728\u6B64\u9884\u89C8')
      } else if (file && file.error) {
        content = React.createElement('p', { style: { color: '#c0392b', fontSize: 15 } }, '\u8BFB\u53D6\u5931\u8D25: ' + String(file.error))
      } else if (file && file.kind === 'image') {
        content = React.createElement('img', {
          src: 'data:' + file.mime + ';base64,' + file.data,
          style: { maxWidth: '100%', borderRadius: 6, display: 'block' },
        })
      } else if (file && file.kind === 'md') {
        content = React.createElement('div', null, miniMarkdown(file.text))
      } else if (file && file.kind === 'html') {
        content = React.createElement('iframe', {
          srcDoc: file.text,
          sandbox: '',
          style: { width: '100%', flex: 1, border: 'none', background: '#fff', borderRadius: 6, minHeight: 400 },
        })
      } else if (file && (file.kind === 'code' || file.kind === 'log')) {
        content = React.createElement('pre', {
          style: {
            margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontSize: 15, lineHeight: 1.65,
            fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
          },
        }, file.text)
      } else {
        content = React.createElement('p', { style: { color: 'var(--dsw-alias-label-tertiary,#999)', fontSize: 15 } },
          '\u4E0D\u652F\u6301\u9884\u89C8\u8BE5\u7C7B\u578B' + (file && file.ext ? ' (.' + file.ext + ')' : ''))
      }
      const doClose = () => {
        setTabs([])
        setActive(null)
        try {
          const overlay = document.querySelector('[data-shell-overlay]')
          const f = overlay && overlay.parentElement
          if (f) {
            delete f.dataset.dshWide
            delete f.dataset.dragging
            f.style.removeProperty('--dsh-sidebar-px')
            f.style.removeProperty('--dsh-details-px')
            f.style.removeProperty('--dsh-handle-left')
          }
        } catch (err) {
        }
        if (layout && typeof layout.closeDetails === 'function') {
          try {
            layout.closeDetails()
          } catch (err) {
          }
        }
      }
      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 } },
        React.createElement('div', { style: head },
          React.createElement('div', { style: { display: 'flex', gap: 6, flex: 'none', paddingBottom: 10 } },
            React.createElement('button', {
              onClick: () => { if (tabs.length > 0) setPane('produced') },
              style: view === 'produced' ? tabActive : tabBase,
              title: '\u5207\u6362\u5230\u4EA7\u7269\u9884\u89C8',
            }, '\uD83D\uDCE6 \u4EA7\u7269'),
            React.createElement('button', {
              onClick: () => setPane('team'),
              style: view === 'team' ? tabActive : tabBase,
              title: '\u5207\u6362\u5230\u56E2\u961F\u5DE5\u724C\u9762\u677F',
            }, '\uD83D\uDC65 \u56E2\u961F'),
          ),
          React.createElement('div', { style: tabbar },
            tabs.length === 0
              ? null
              : tabs.map((t) => {
                  const tn = String(t.path).split('/').pop() || t.path
                  const isActive = t.key === active
                  return React.createElement('div', {
                    key: t.key,
                    onClick: () => setActive(t.key),
                    style: isActive ? tabActive : tabBase,
                    title: t.path,
                  },
                    React.createElement('span', { style: tabName }, (t.file && t.file.error ? '\u26A0 ' : '\uD83D\uDCC4 ') + tn),
                    React.createElement('button', {
                      onClick: (ev) => { ev.stopPropagation(); closeTab(t.key) },
                      style: tabClose,
                    }, '\u2715'),
                  )
                }),
          ),
          React.createElement('button', { onClick: doClose, style: closeBtn }, '\u2715'),
        ),
        React.createElement('div', { style: body }, content),
      )
    }
    ctx.effect(() => slots.register(
      { name: 'details', id: 'produced', priority: -1, children: { 'details.produced.team': { kind: 'single', scope: 'session' } } },
      ProducedPanel,
    ), 'dsh-webui-enhance: details')

    ctx.effect(() => slots.register(
      { name: 'conversation.view', id: 'tokens', order: 20, label: () => 'Token \u7528\u91CF' },
      (props) => {
        const [provider, setProvider] = React.useState('')
        const [range, setRange] = React.useState(0)
        const [chartWindow, setChartWindow] = React.useState('30d')
        const [hoverIdx, setHoverIdx] = React.useState(null)
        const [data, setData] = React.useState(null)
        const [balance, setBalance] = React.useState(null)
        const [measure, setMeasure] = React.useState(null)
        const [error, setError] = React.useState(null)
        const wsItems = props.useWorkspaces((s) => s.items)
        const wsRecent = props.useWorkspaces((s) => s.recentWorkspaceId)
        const wsArchived = props.useWorkspaces((s) => s.archivedSessionIds)
        const sessionsById = props.useSessions((s) => s.byId)
        const currentWs = wsItems.find((w) => w.workspaceId === wsRecent)
        const wsSessions = currentWs ? currentWs.sessionIds.filter((id) => !wsArchived.includes(id)) : []
        const refresh = async () => {
          try {
            const d = await rpc('tokens-usage', { provider: provider || null, rangeDays: range, sessionIds: wsSessions, window: chartWindow })
            setData(d)
            let m = null
            try {
              m = await rpc('tokens-measure', { sessionId: props.sessionId })
            } catch (err) {
              m = { error: String((err && err.message) || err) }
            }
            setMeasure(m)
            setError(null)
          } catch (err) {
            setError(String((err && err.message) || err))
          }
        }
        const refreshBalance = async () => {
          try {
            const b = await rpc('tokens-balance', {})
            setBalance(b)
          } catch (err) {
            setBalance({ items: [], error: String((err && err.message) || err) })
          }
        }
        React.useEffect(() => {
          refresh()
          const id = setInterval(() => refresh(), 10000)
          return () => clearInterval(id)
        }, [provider, range, chartWindow, wsSessions.join(',')])
        React.useEffect(() => {
          refreshBalance()
          const id = setInterval(() => refreshBalance(), 60000)
          return () => clearInterval(id)
        }, [])

        const rows = (data && data.rows) || []
        const providers = (data && data.providers) || []
        const sessionRows = (data && data.sessionRows) || []
        const totals = (data && data.totals) || { calls: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0, hitRate: 0 }
        const daily = (data && data.daily) || []
        const balanceItems = (balance && balance.items) || []
        const now = new Date()
        const month = now.getMonth()
        const donutByProvider = buildDonut(rows.map((r) => ({ key: r.provider, v: r.input + r.output })))
        const donutByModel = buildDonut(rows.map((r) => ({ key: r.provider + '/' + r.model, v: r.input + r.output })))
        let maxDay = 0
        let windowTotal = 0
        for (const b of daily) {
          windowTotal += b.total
          if (b.total > maxDay) maxDay = b.total
        }
        const modelTotals = new Map()
        for (const b of daily) {
          for (const k of Object.keys(b.models || {})) {
            const cur = modelTotals.get(k) || { total: 0, input: 0, output: 0 }
            cur.total += b.models[k].total || 0
            cur.input += b.models[k].input || 0
            cur.output += b.models[k].output || 0
            modelTotals.set(k, cur)
          }
        }
        const modelKeys = [...modelTotals.entries()].sort((a, b) => b[1].total - a[1].total).map((e) => e[0])
        const modelColor = (k) => SOFT[Math.max(0, modelKeys.indexOf(k)) % SOFT.length]
        const AX = 36, AY = 8, AW = 400 - 36 - 8, AH = 120 - 20 - AY
        const dayW = daily.length > 0 ? AW / daily.length : AW / 30
        const barEls = []
        for (let i = 0; i < daily.length; i++) {
          const b = daily[i]
          const x = AX + i * dayW
          let y = AY + AH
          const segs = []
          for (const k of modelKeys) {
            const v = (b.models && b.models[k] && b.models[k].total) || 0
            if (v <= 0) continue
            const h = maxDay > 0 ? Math.max(1, (v / maxDay) * AH) : 0
            y -= h
            segs.push(React.createElement('rect', {
              key: k,
              x: x + 0.5, y: y, width: Math.max(1, dayW - 1), height: h,
              fill: modelColor(k),
              rx: 1,
            }))
          }
          barEls.push(React.createElement('g', { key: i }, segs))
        }
        const axisEls = [
          React.createElement('line', { key: 'y0', x1: AX, y1: AY + AH, x2: AX + AW, y2: AY + AH, stroke: 'rgba(128,128,128,0.4)', strokeWidth: 1 }),
          React.createElement('text', { key: 'ymax', x: 34, y: AY + 8, textAnchor: 'end', fontSize: 6.5, fill: 'var(--dsw-alias-label-tertiary, #999)' }, fmt(maxDay)),
        ]
        const GRID_N = 3
        for (let g = 1; g <= GRID_N; g++) {
          const gy = AY + AH - (g / (GRID_N + 1)) * AH
          axisEls.push(React.createElement('line', { key: 'grid' + g, x1: AX, y1: gy, x2: AX + AW, y2: gy, stroke: 'rgba(128,128,128,0.15)', strokeWidth: 1, strokeDasharray: '2 4' }))
          axisEls.push(React.createElement('text', { key: 'gridv' + g, x: AX - 4, y: gy + 2.5, textAnchor: 'end', fontSize: 6, fill: 'var(--dsw-alias-label-tertiary, #999)' }, fmt(maxDay * g / (GRID_N + 1))))
        }
        const labelEvery = daily.length > 20 ? 5 : 3
        for (let i = 0; i < daily.length; i++) {
          if (i % labelEvery === 0 || i === daily.length - 1) {
            axisEls.push(React.createElement('text', {
              key: 'x' + i,
              x: AX + i * dayW + dayW / 2,
              y: 120 - 6,
              textAnchor: 'middle',
              fontSize: 6.5,
              fill: 'var(--dsw-alias-label-tertiary, #999)',
            }, daily[i].label))
          }
        }
        const linePts = daily.map((b, i) => {
          const x = AX + i * dayW + dayW / 2
          const y = maxDay > 0 ? AY + AH - (b.total / maxDay) * AH : AY + AH
          return { i, x, y }
        })
        const smoothLine = linePts.length > 0 ? smoothPath(linePts) : ''
        const areaPath = linePts.length > 0
          ? smoothLine + ' L' + linePts[linePts.length - 1].x.toFixed(1) + ' ' + (AY + AH) + ' L' + AX + ' ' + (AY + AH) + ' Z'
          : ''
        const hoverX = hoverIdx !== null ? AX + hoverIdx * dayW + dayW / 2 : 0
        const hoverTipPct = hoverIdx !== null ? (hoverX / 400) * 100 : 10
        const tipPos = hoverTipPct < 30
          ? { left: 8 }
          : hoverTipPct > 62
            ? { right: 8 }
            : { left: hoverTipPct + '%' }
        const tipXform = hoverTipPct >= 30 && hoverTipPct <= 62 ? 'translateX(-50%)' : 'none'
        const labelOf = (l) => {
          const p = String(l).split('-')
          return (Number(p[0]) || 0) + '\u6708' + (Number(p[1]) || 0) + '\u65E5'
        }
        const hitRate = (row) => row.input + row.cacheRead > 0 ? Math.round((row.cacheRead / (row.input + row.cacheRead)) * 1000) / 10 : 0
        const hovered = hoverIdx !== null && daily[hoverIdx] ? daily[hoverIdx] : null
        const viewRows = hovered
          ? Object.keys(hovered.models || {}).map((mk) => {
              const i = mk.indexOf('/')
              const e = hovered.models[mk] || {}
              const row = {
                provider: i > 0 ? mk.slice(0, i) : mk,
                model: i > 0 ? mk.slice(i + 1) : '?',
                calls: e.calls || 0,
                input: e.input || 0,
                output: e.output || 0,
                cacheRead: e.cacheRead || 0,
                reasoning: e.reasoning || 0,
              }
              row.hitRate = hitRate(row)
              return row
            }).sort((x, y) => (y.input + y.output) - (x.input + x.output) || y.calls - x.calls)
          : rows
        const viewTotals = hovered
          ? {
              calls: hovered.calls || 0,
              input: hovered.input || 0,
              output: hovered.output || 0,
              cacheRead: hovered.cacheRead || 0,
              reasoning: hovered.reasoning || 0,
            }
          : totals
        viewTotals.hitRate = hitRate(viewTotals)
        const viewDonutByProvider = buildDonut(viewRows.map((r) => ({ key: r.provider, v: r.input + r.output })))
        const viewDonutByModel = buildDonut(viewRows.map((r) => ({ key: r.provider + '/' + r.model, v: r.input + r.output })))
        const viewSessionRows = hovered && hovered.sessions
          ? Object.keys(hovered.sessions).map((sid) => {
              const e = hovered.sessions[sid] || {}
              const row = {
                sessionId: sid,
                calls: e.calls || 0,
                input: e.input || 0,
                output: e.output || 0,
                cacheRead: e.cacheRead || 0,
                reasoning: e.reasoning || 0,
              }
              row.hitRate = hitRate(row)
              return row
            }).sort((x, y) => (y.input + y.output) - (x.input + x.output) || y.calls - x.calls)
          : sessionRows
        let tipTitle = '', tipLines = []
        if (hoverIdx !== null && daily[hoverIdx]) {
          const b = daily[hoverIdx]
          const items = Object.keys(b.models || {}).sort((a, c) => (b.models[c].total || 0) - (b.models[a].total || 0))
          tipTitle = labelOf(b.label)
          tipLines = [
            '\u603B\u91CF ' + fmt(b.total) + '  |  \u8F93\u5165 ' + fmt(b.input) + '  \u8F93\u51FA ' + fmt(b.output),
            ...items.map((k) => {
              const e = b.models[k] || {}
              return k + ': \u603B ' + fmt(e.total || 0) + ' (\u8F93\u5165 ' + fmt(e.input || 0) + ' / \u8F93\u51FA ' + fmt(e.output || 0) + ')'
            }),
          ]
        }
        const onChartMove = (e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          if (!rect || rect.width === 0 || daily.length === 0) return
          const svgX = ((e.clientX - rect.left) / rect.width) * 400
          const i = Math.floor((svgX - AX) / dayW)
          setHoverIdx(Math.max(0, Math.min(daily.length - 1, i)))
        }
        const segBtn = (active) => ({
          border: '1px solid rgba(128,128,128,0.4)',
          background: active ? 'rgba(59,130,246,0.25)' : 'transparent',
          color: active ? '#3b82f6' : 'var(--dsw-alias-label-secondary, #bbb)',
          borderRadius: 4,
          fontSize: 11,
          cursor: 'pointer',
          padding: '1px 8px',
        })
        const selectStyle = { fontSize: 12, padding: '3px 8px', background: 'var(--dsw-specific-menu, #1e1e28)', color: 'var(--dsw-alias-label-primary, #ddd)', border: '1px solid rgba(128,128,128,0.4)', borderRadius: 6, colorScheme: 'dark' }
        const optStyle = { color: 'var(--dsw-alias-label-primary, #ddd)', background: 'var(--dsw-specific-menu, #1e1e28)' }
        const page = {
          width: '100%',
          maxWidth: 1400,
          margin: '0 auto', padding: '20px 24px',
          fontSize: 13, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 16,
        }
        const h2 = { fontSize: 16, fontWeight: 700, margin: 0 }
        const h3 = { fontSize: 13, fontWeight: 600, margin: '0 0 6px' }
        const sub = { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #999)', margin: 0 }
        const statCard = { display: 'flex', flexDirection: 'column', gap: 2, border: '1px solid rgba(128,128,128,0.25)', borderRadius: 8, padding: '8px 14px', minWidth: 88 }
        return React.createElement('div', { style: page },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            React.createElement('h2', { style: h2 }, '\u26A1 Token \u7528\u91CF'),
            React.createElement('span', { style: sub }, '\u8BB0\u5F55\u6301\u4E45\u5316: ~/.dsh/dsh-usage/usage-records.json' ),
          ),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            React.createElement('select', { value: provider, onChange: (e) => setProvider(e.target.value), style: selectStyle, title: '\u4F9B\u5E94\u5546' },
              React.createElement('option', { value: '', style: optStyle }, '\u5168\u90E8\u4F9B\u5E94\u5546'),
              providers.map((p) => React.createElement('option', { key: p.id, value: p.id, style: optStyle }, p.name || p.id)),
            ),
            React.createElement('select', { value: String(range), onChange: (e) => setRange(Number(e.target.value)), style: selectStyle, title: '\u65F6\u95F4\u8303\u56F4' },
              React.createElement('option', { value: '0', style: optStyle }, '\u5168\u90E8\u65F6\u95F4'),
              React.createElement('option', { value: '1', style: optStyle }, '\u4ECA\u5929'),
              React.createElement('option', { value: '7', style: optStyle }, '\u8FD17\u5929'),
              React.createElement('option', { value: '30', style: optStyle }, '\u8FD130\u5929'),
            ),
            React.createElement('span', { style: { flex: 1 } }),
            measure !== null && !measure.error && React.createElement('span', { style: sub },
              '\u5F53\u524D\u4F1A\u8BDD\u4E0A\u4E0B\u6587: ' + fmt(measure.surfaceTokens) + ' / \u538B\u529B ' + fmt(measure.totalTokens),
            ),
          ),
          hovered && React.createElement('div', { style: { fontSize: 12, color: '#f59e0b' } },
            '\uD83D\uDCC5 ' + labelOf(hovered.label) + ' \u5F53\u5929\u6570\u636E(\u60AC\u505C\u4E2D;\u79FB\u5F00\u56FE\u8868\u6062\u590D\u5168\u5C40)'
          ),
          React.createElement('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
            React.createElement('div', { style: statCard },
              React.createElement('span', { style: sub }, '\u8C03\u7528\u6B21\u6570'),
              React.createElement('span', { style: { fontSize: 18, fontWeight: 700 } }, viewTotals.calls),
            ),
            React.createElement('div', { style: statCard },
              React.createElement('span', { style: sub }, '\u8F93\u5165 tokens'),
              React.createElement('span', { style: { fontSize: 18, fontWeight: 700 } }, fmt(viewTotals.input)),
            ),
            React.createElement('div', { style: statCard },
              React.createElement('span', { style: sub }, '\u8F93\u51FA tokens'),
              React.createElement('span', { style: { fontSize: 18, fontWeight: 700 } }, fmt(viewTotals.output)),
            ),
            React.createElement('div', { style: statCard },
              React.createElement('span', { style: sub }, '\u7F13\u5B58\u8BFB'),
              React.createElement('span', { style: { fontSize: 18, fontWeight: 700 } }, fmt(viewTotals.cacheRead)),
            ),
            React.createElement('div', { style: statCard },
              React.createElement('span', { style: sub }, '\u63A8\u7406 tokens'),
              React.createElement('span', { style: { fontSize: 18, fontWeight: 700 } }, fmt(viewTotals.reasoning)),
            ),
            React.createElement('div', { style: statCard },
              React.createElement('span', { style: sub }, '\u7F13\u5B58\u547D\u4E2D\u7387'),
              React.createElement('span', { style: { fontSize: 18, fontWeight: 700 } }, viewTotals.hitRate + '%'),
            ),
          ),
          React.createElement('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
            renderDonut(hovered ? '\u4F9B\u5E94\u5546\u5360\u6BD4(' + labelOf(hovered.label) + ')' : '\u4F9B\u5E94\u5546\u5360\u6BD4', viewDonutByProvider.total, viewDonutByProvider.items, viewDonutByProvider.arcs),
            renderDonut(hovered ? '\u6A21\u578B\u5360\u6BD4(' + labelOf(hovered.label) + ')' : '\u6A21\u578B\u5360\u6BD4(\u8DE8\u4F9B\u5E94\u5546)', viewDonutByModel.total, viewDonutByModel.items, viewDonutByModel.arcs),
          ),
          React.createElement('div', null,
            React.createElement('h3', { style: h3 }, hovered ? '\u4F9B\u5E94\u5546\u660E\u7EC6(' + labelOf(hovered.label) + ')' : '\u4F9B\u5E94\u5546\u660E\u7EC6'),
            viewRows.length === 0
              ? React.createElement('p', { style: sub }, hovered ? '\u5F53\u5929\u65E0\u8BB0\u5F55' : '\u8FD8\u6CA1\u6709\u8BB0\u5F55')
              : React.createElement('table', { style: { borderCollapse: 'collapse', width: '100%' } },
                  React.createElement('thead', null,
                    React.createElement('tr', null,
                      React.createElement('th', { style: cellL }, '\u4F9B\u5E94\u5546'),
                      React.createElement('th', { style: cellL }, '\u6A21\u578B'),
                      React.createElement('th', { style: cell }, '\u6B21\u6570'),
                      React.createElement('th', { style: cell }, '\u8F93\u5165'),
                      React.createElement('th', { style: cell }, '\u8F93\u51FA'),
                      React.createElement('th', { style: cell }, '\u7F13\u5B58\u8BFB'),
                      React.createElement('th', { style: cell }, '\u63A8\u7406'),
                      React.createElement('th', { style: cell }, '\u547D\u4E2D\u7387'),
                    ),
                  ),
                  React.createElement('tbody', null,
                    viewRows.map((r) => React.createElement('tr', { key: r.provider + '::' + r.model },
                      React.createElement('td', { style: { ...cellL, fontWeight: 600 } }, r.provider),
                      React.createElement('td', { style: cellL }, r.model),
                      React.createElement('td', { style: cell }, r.calls),
                      React.createElement('td', { style: cell }, fmt(r.input)),
                      React.createElement('td', { style: cell }, fmt(r.output)),
                      React.createElement('td', { style: cell }, fmt(r.cacheRead)),
                      React.createElement('td', { style: cell }, fmt(r.reasoning)),
                      React.createElement('td', { style: cell }, r.hitRate + '%'),
                    )),
                    React.createElement('tr', { key: '__total' },
                      React.createElement('td', { style: { ...cellL, fontWeight: 700 } }, '\u5408\u8BA1'),
                      React.createElement('td', { style: cellL }),
                      React.createElement('td', { style: { ...cell, fontWeight: 700 } }, viewTotals.calls),
                      React.createElement('td', { style: { ...cell, fontWeight: 700 } }, fmt(viewTotals.input)),
                      React.createElement('td', { style: { ...cell, fontWeight: 700 } }, fmt(viewTotals.output)),
                      React.createElement('td', { style: { ...cell, fontWeight: 700 } }, fmt(viewTotals.cacheRead)),
                      React.createElement('td', { style: { ...cell, fontWeight: 700 } }, fmt(viewTotals.reasoning)),
                      React.createElement('td', { style: { ...cell, fontWeight: 700 } }, viewTotals.hitRate + '%'),
                    ),
                  ),
                ),
          ),
          React.createElement('div', null,
            React.createElement('h3', { style: h3 }, hovered ? '\u5F53\u524D\u5DE5\u4F5C\u533A\u4F1A\u8BDD\u7528\u91CF(' + labelOf(hovered.label) + ')' : '\u5F53\u524D\u5DE5\u4F5C\u533A\u4F1A\u8BDD\u7528\u91CF' + (currentWs ? ' (' + currentWs.title + ')' : '')),
            viewSessionRows.length === 0
              ? React.createElement('p', { style: sub }, hovered ? '\u5F53\u5929\u8BE5\u5DE5\u4F5C\u533A\u65E0\u8BB0\u5F55' : '\u672C\u5DE5\u4F5C\u533A\u4F1A\u8BDD\u6682\u65E0\u8BB0\u5F55')
              : React.createElement('table', { style: { borderCollapse: 'collapse', width: '100%' } },
                  React.createElement('thead', null,
                    React.createElement('tr', null,
                      React.createElement('th', { style: cellL }, '\u4F1A\u8BDD'),
                      React.createElement('th', { style: cell }, '\u6B21\u6570'),
                      React.createElement('th', { style: cell }, '\u8F93\u5165'),
                      React.createElement('th', { style: cell }, '\u8F93\u51FA'),
                      React.createElement('th', { style: cell }, '\u7F13\u5B58\u8BFB'),
                      React.createElement('th', { style: cell }, '\u63A8\u7406'),
                      React.createElement('th', { style: cell }, '\u547D\u4E2D\u7387'),
                    ),
                  ),
                  React.createElement('tbody', null,
                    viewSessionRows.map((r) => {
                      const sum = sessionsById[r.sessionId]
                      const title = (sum && sum.displayTitle) || r.sessionId
                      return React.createElement('tr', {
                        key: r.sessionId,
                        onClick: () => { if (sessionsSvc) sessionsSvc.open(r.sessionId) },
                        style: { cursor: 'pointer' },
                      },
                        React.createElement('td', { style: { ...cellL, fontWeight: 600 } }, title),
                        React.createElement('td', { style: cell }, r.calls),
                        React.createElement('td', { style: cell }, fmt(r.input)),
                        React.createElement('td', { style: cell }, fmt(r.output)),
                        React.createElement('td', { style: cell }, fmt(r.cacheRead)),
                        React.createElement('td', { style: cell }, fmt(r.reasoning)),
                        React.createElement('td', { style: cell }, r.hitRate + '%'),
                      )
                    }),
                  ),
                ),
          ),
          React.createElement('div', { style: { border: '1px solid rgba(128,128,128,0.25)', borderRadius: 10, padding: '10px 12px' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } },
              React.createElement('h3', { style: { ...h3, margin: 0 } }, chartWindow === '30d' ? '\u8FD130\u5929\u6BCF\u65E5\u7528\u91CF' : (month + 1) + '\u6708\u6BCF\u65E5\u7528\u91CF'),
              React.createElement('span', { style: { flex: 1 } }),
              React.createElement('button', { onClick: () => setChartWindow('30d'), style: segBtn(chartWindow === '30d') }, '\u8FD130\u5929'),
              React.createElement('button', { onClick: () => setChartWindow('month'), style: segBtn(chartWindow === 'month') }, '\u5F53\u6708'),
            ),
            React.createElement('div', { style: { position: 'relative' } },
              React.createElement('svg', {
                width: '100%',
                viewBox: '0 0 400 120',
                style: { display: 'block' },
                onMouseMove: onChartMove,
                onMouseLeave: () => setHoverIdx(null),
              },
                React.createElement('defs', { key: 'defs' },
                  React.createElement('linearGradient', { id: 'dynAreaGrad', x1: 0, y1: 0, x2: 0, y2: 1 },
                    React.createElement('stop', { offset: '0%', stopColor: 'rgba(47,102,201,0.35)' }),
                    React.createElement('stop', { offset: '100%', stopColor: 'rgba(47,102,201,0.02)' }),
                  ),
                  React.createElement('linearGradient', { id: 'dynLineGrad', x1: 0, y1: 0, x2: 1, y2: 0 },
                    React.createElement('stop', { offset: '0%', stopColor: '#d1933a' }),
                    React.createElement('stop', { offset: '100%', stopColor: '#e6b958' }),
                  ),
                ),
                axisEls,
                hoverIdx !== null && React.createElement('rect', {
                  key: 'hoverband',
                  x: AX + hoverIdx * dayW,
                  y: AY,
                  width: dayW,
                  height: AH,
                  fill: 'rgba(47,102,201,0.12)',
                }),
                barEls,
                React.createElement('path', { d: areaPath, fill: 'url(#dynAreaGrad)', stroke: 'none' }),
                React.createElement('path', { d: smoothLine, fill: 'none', stroke: 'url(#dynLineGrad)', strokeWidth: 1.3, strokeLinejoin: 'round', strokeLinecap: 'round' }),
              ),
              hoverIdx !== null && daily[hoverIdx] && React.createElement('div', {
                style: {
                  position: 'absolute',
                  top: 0,
                  width: 340,
                  maxWidth: 380,
                  ...tipPos,
                  transform: tipXform,
                  pointerEvents: 'none',
                  zIndex: 5,
                  background: 'var(--dsw-specific-menu, #1e1e28)',
                  border: '1px solid rgba(128,128,128,0.4)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 12,
                  lineHeight: 1.7,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                },
              },
                React.createElement('div', { style: { fontWeight: 600 } }, tipTitle),
                tipLines.map((l, i) => React.createElement('div', { key: i, style: { color: 'var(--dsw-alias-label-secondary, #bbb)', wordBreak: 'break-word' } }, l)),
              ),
            ),
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 } },
              modelKeys.map((k) => React.createElement('span', { key: k, style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--dsw-alias-label-secondary, #bbb)' } },
                React.createElement('span', { style: { width: 8, height: 8, borderRadius: 2, background: modelColor(k), display: 'inline-block' } }),
                k,
              )),
            ),
          ),
          React.createElement('div', null,
            React.createElement('h3', { style: h3 }, '\u4F59\u989D / \u914D\u989D(\u6BCF 60 \u79D2\u5237\u65B0)'),
            balanceItems.length === 0
              ? React.createElement('p', { style: sub }, '\u52A0\u8F7D\u4E2D\u2026')
              : React.createElement('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
                  balanceItems.map((b) => React.createElement('div', {
                    key: b.provider,
                    style: { border: '1px solid rgba(128,128,128,0.25)', borderRadius: 8, padding: '8px 12px', minWidth: 220, fontSize: 12, maxWidth: 340 },
                  },
                    React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, b.provider),
                    b.console
                      ? React.createElement(React.Fragment, null,
                          React.createElement('div', { style: sub }, '\u4F59\u91CF\u9700\u5728\u63A7\u5236\u53F0\u67E5\u770B(\u672A\u5F00\u653E API)'),
                          React.createElement('a', {
                            href: b.url,
                            target: '_blank',
                            rel: 'noreferrer',
                            style: { color: '#3b82f6', textDecoration: 'none', fontSize: 12 },
                          }, '\u6253\u5F00\u63A7\u5236\u53F0 \u2197'),
                        )
                      : b.error
                        ? React.createElement('span', { style: { color: '#c0392b' } }, b.error === 'no-api-key' ? '\u672A\u914D\u7F6E API Key' : '\u67E5\u8BE2\u5931\u8D25: ' + b.error)
                        : React.createElement(React.Fragment, null,
                            React.createElement('div', { style: { color: b.available === false ? '#c0392b' : '#2e9e5b' } }, b.available === false ? '\u8D26\u6237\u4E0D\u53EF\u7528' : '\u8D26\u6237\u53EF\u7528'),
                            (b.balances || []).map((bl, i) => React.createElement('div', { key: i, style: { color: 'var(--dsw-alias-label-secondary, #bbb)', marginTop: 2 } },
                              bl.currency + ' \u603B\u4F59\u989D ' + bl.total +
                              (bl.granted ? ' (\u8D60\u9001 ' + bl.granted + ')' : '') +
                              (bl.toppedUp ? ' (\u5145\u503C ' + bl.toppedUp + ')' : ''),
                            )),
                          ),
                  )),
                ),
          ),
          error !== null && React.createElement('p', { style: { fontSize: 12, color: '#c0392b' } }, '\u9519\u8BEF: ' + error),
        )
      },
    ), 'dsh-webui-enhance: tokens')

    ctx.effect(() => slots.register(
      { name: 'conversation.session.header.actions', id: 'delete-session', order: 20 },
      (props) => {
        const [arm, setArm] = React.useState(false)
        const [busy, setBusy] = React.useState(false)
        const [status, setStatus] = React.useState(null)
        React.useEffect(() => {
          if (!arm) return
          const id = setTimeout(() => setArm(false), 4000)
          return () => clearTimeout(id)
        }, [arm])
        const doDelete = async () => {
          if (!arm) {
            setArm(true)
            setStatus(null)
            return
          }
          setBusy(true)
          try {
            const res = await rpc('delete-session', { sessionId: props.sessionId })
            if (res && res.ok && res.archived) {
              let text
              if (res.logRemoved) text = '\u5DF2\u5220\u9664(\u542B\u65E5\u5FD7\u6587\u4EF6)'
              else if (res.deferred) text = '\u5DF2\u5220\u9664(\u8FD0\u884C\u4E2D,\u7ED3\u675F\u540E\u81EA\u52A8\u6E05\u7406\u65E5\u5FD7)'
              else text = '\u5DF2\u4ECE\u5217\u8868\u79FB\u9664(\u65E5\u5FD7\u4FDD\u7559)'
              setStatus({ kind: 'ok', text })
              if (workspacesSvc) workspacesSvc.startSession()
            } else {
              const why = (res && res.error) || (res && res.reason) || '\u672A\u77E5\u9519\u8BEF'
              setStatus({ kind: 'error', text: '\u5220\u9664\u5931\u8D25: ' + String(why) })
            }
          } catch (err) {
            setStatus({ kind: 'error', text: '\u5220\u9664\u5931\u8D25: ' + String((err && err.message) || err) })
          } finally {
            setBusy(false)
            setArm(false)
          }
        }
        const base = {
          border: 'none',
          borderRadius: 6,
          padding: '3px 8px',
          fontSize: 13,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: arm ? '#c0392b' : 'transparent',
        }
        const iconStyle = { color: arm ? '#fff' : '#e5484d', fontSize: 14, lineHeight: 1 }
        return React.createElement(React.Fragment, null,
          React.createElement('button', {
            onClick: doDelete,
            disabled: busy,
            title: '\u5220\u9664\u5F53\u524D\u4F1A\u8BDD',
            style: base,
          },
            arm
              ? React.createElement('span', { style: { color: '#fff', fontSize: 12 } }, busy ? '\u5220\u9664\u4E2D\u2026' : '\u786E\u8BA4\u5220\u9664?')
              : React.createElement('span', { style: iconStyle }, '\uD83D\uDDD1\uFE0E'),
          ),
          status !== null
            ? React.createElement('span', {
                style: {
                  fontSize: 12,
                  color: status.kind === 'ok' ? '#2e9e5b' : '#c0392b',
                  marginLeft: 6,
                },
              }, status.text)
            : null,
        )
      },
    ), 'dsh-webui-enhance: delete-session')

    ctx.effect(() => slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      (props) => {
        const [search, setSearch] = React.useState(null)
        const [testQuery, setTestQuery] = React.useState('xiapro')
        const [searching, setSearching] = React.useState(false)
        const runSearch = async (query) => {
          setSearching(true)
          try {
            const res = await rpc('file-search', { sessionId: props.sessionId, query, limit: 5 })
            setSearch(res)
          } catch (err) {
            setSearch({ error: String((err && err.message) || err) })
          } finally {
            setSearching(false)
          }
        }
        const box = {
          border: '1px dashed rgba(128,128,128,0.4)',
          borderRadius: 8,
          padding: '10px 12px',
          margin: '8px 0',
          fontSize: 13,
          lineHeight: 1.6,
        }
        const row = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }
        const code = { fontSize: 12, wordBreak: 'break-all' }
        const status = fileSourceReady
          ? '\u2705 @\u6587\u4EF6\u63D0\u53CA\u6E90\u5DF2\u6CE8\u518C'
          : '\u26A0\uFE0F inputTriggers \u670D\u52A1\u4E0D\u53EF\u7528'
        return React.createElement('div', { style: box },
          React.createElement('div', { style: { fontWeight: 600 } }, 'Web UI \u6539\u9020 Demo \u2014 v49 \u5BBD\u5EA6\u63A7\u5236\u63A5\u7BA1'),
          React.createElement('div', null, '插件: dsh-webui-enhance'),
          React.createElement('div', { style: { color: fileSourceReady ? '#2e9e5b' : '#c0392b' } }, status),
          React.createElement('div', null, '\u26A1 CSS \u53D8\u91CF\u63A7\u5236\u5217\u5BBD + \u62D6\u62FD\u63A5\u7BA1(\u65E0 520 \u4E0A\u9650)'),
          React.createElement('div', { style: row },
            React.createElement('input', {
              value: testQuery,
              onChange: (e) => setTestQuery(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') runSearch(testQuery) },
              placeholder: '\u8F93\u5165\u67E5\u8BE2\u8BCD(\u6A21\u7CCA\u641C\u7D22\u6D4B\u8BD5)\u2026',
              style: { width: 160, fontSize: 12, padding: '2px 6px' },
            }),
            React.createElement('button', { onClick: () => runSearch(testQuery), disabled: searching }, searching ? '\u641C\u7D22\u4E2D\u2026' : '\u641C\u7D22'),
          ),
          search !== null
            ? React.createElement('code', { style: code },
                'root: ' + String((search && search.root) || 'null') + ' \u2014 ' + String((search && search.items && search.items.length) || 0) + ' \u9879: ' +
                (search && Array.isArray(search.items) ? search.items.map((it) => it.path).join(' | ') : JSON.stringify(search)),
              )
            : null,
        )
      },
    ), 'dsh-webui-enhance: tool')
  }
    module.exports = { apply }
    return module.exports
  },
})
