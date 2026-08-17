window.__ModuleLoader__.load({
  id: 'dsh-badgeboard',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const rpc = (method, args) => fetch('/dsh-badgeboard/' + method, {
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
        el.setAttribute('data-plugin', 'dsh-badgeboard')
        el.textContent = css
        document.head.appendChild(el)
        return () => { el.remove() }
      } catch (err) {
        return () => {}
      }
    }
    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      ctx.effect(() => injectStyles(`/* ===== 头像（随机线稿） ===== */\n.bdb-ava { position: relative; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--dsw-alias-bg-layer-2); flex: none; }\n.bdb-ava svg { position: absolute; inset: 12%; width: 76%; height: 76%; }\n.bdb-ava path { fill: none; stroke: var(--dsw-alias-label-primary); stroke-width: 2.1; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }\n.bdb-ava--lg path { stroke-width: 2.6; }\n.bdb-ava-ring { position: absolute; inset: -1px; border-radius: 50%; border: 2px solid var(--dsw-alias-label-primary); opacity: 1; pointer-events: none; }\n.bdb-ava[data-tier='standard'] .bdb-ava-ring { border-color: var(--dsw-alias-state-business-primary); }\n.bdb-ava[data-tier='pro'] .bdb-ava-ring { border-color: #8564c4; }\n.bdb-ava[data-tier='ultra'] .bdb-ava-ring { border-color: var(--dsw-alias-state-warn-primary); }\n@media (prefers-color-scheme: dark) { .bdb-ava[data-tier='pro'] .bdb-ava-ring { border-color: #9d84d6; } }\n.bdb-ava-halo { position: absolute; inset: -6px; border-radius: 50%; border: 1px solid var(--dsw-alias-state-business-primary); opacity: 0.6; animation: bdb-breathe 1.8s ease-in-out infinite; pointer-events: none; }\n@keyframes bdb-breathe { 0%, 100% { opacity: 0.6; } 50% { opacity: 0.15; } }\n\n/* ===== 中栏右缘悬浮胶囊（贴中栏右缘 + 垂直居中，避开头部按钮与右上角关闭钮） ===== */\n.bdb-rail { position: absolute; top: 50%; transform: translateY(-50%); width: 52px; max-height: min(640px, calc(100% - 96px)); z-index: 5; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 0 10px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12); pointer-events: auto; -webkit-user-select: none; user-select: none; }\n@media (prefers-color-scheme: dark) { .bdb-rail { box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35); } }\n.bdb-rail-list { overflow-y: auto; scrollbar-width: none; min-height: 0; flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; }\n.bdb-rail-list::-webkit-scrollbar { display: none; }\n.bdb-rail-head { display: flex; flex-direction: column; align-items: center; gap: 6px; }\n.bdb-rail-head-txt { writing-mode: vertical-rl; font-size: 12px; letter-spacing: 4px; line-height: 16px; color: var(--dsw-alias-label-secondary); }\n.bdb-rail-count { font-size: 11px; font-weight: 700; line-height: 18px; min-width: 18px; padding: 0 4px; text-align: center; border-radius: 999px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-border-l2); }\n.bdb-rail-item { position: relative; width: 36px; height: 36px; flex: none; cursor: pointer; border-radius: 50%; }\n.bdb-rail-item:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }\n.bdb-rail-ava { position: absolute; inset: 0; border-radius: 50%; transition: transform 0.15s ease; }\n.bdb-rail-ava .bdb-ava { background: transparent; }\n.bdb-rail-ava .bdb-ava[data-tier='standard'] { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent); }\n.bdb-rail-ava .bdb-ava[data-tier='pro'] { background: rgba(133, 100, 196, 0.18); }\n.bdb-rail-ava .bdb-ava[data-tier='ultra'] { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 18%, transparent); }\n.bdb-rail-ava svg { inset: 5%; width: 90%; height: 90%; }\n.bdb-rail-item:hover .bdb-rail-ava { transform: scale(1.08); }\n.bdb-rail-item[data-st='resting'] .bdb-rail-ava { opacity: 0.5; filter: grayscale(0.45); }\n.bdb-rail-item[data-st='resting']:hover .bdb-rail-ava { opacity: 0.85; filter: none; }\n.bdb-rail-dot { position: absolute; right: -2px; bottom: -2px; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--dsw-alias-bg-layer-1); background: var(--dsw-alias-label-secondary); }\n.bdb-dot-working { background: var(--dsw-alias-state-business-primary); animation: bdb-blink 1.2s ease-in-out infinite; }\n.bdb-dot-done { background: var(--dsw-alias-state-success-primary); }\n@keyframes bdb-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }\n.bdb-pop-role-tier { color: var(--dsw-alias-label-secondary); font-weight: 600; }\n.bdb-pop-role-tier[data-tier='standard'] { color: var(--dsw-alias-state-business-primary); }\n.bdb-pop-role-tier[data-tier='pro'] { color: #8564c4; }\n.bdb-pop-role-tier[data-tier='ultra'] { color: var(--dsw-alias-state-warn-primary); }\n@media (prefers-color-scheme: dark) { .bdb-pop-role-tier[data-tier='pro'] { color: #9d84d6; } }\n.bdb-rail-foot { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 4px; }\n.bdb-rail-prog { width: 22px; height: 4px; border-radius: 2px; background: var(--dsw-alias-border-l2); overflow: hidden; }\n.bdb-rail-prog i { display: block; height: 100%; border-radius: 2px; background: var(--dsw-alias-state-business-primary); transition: width 0.3s ease; }\n.bdb-rail-foot span { font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }\n\n/* ===== hover 横条（信息卡） ===== */\n.bdb-rail-pop { position: absolute; right: calc(100% + 8px); top: 50%; transform: translateY(-50%); width: 296px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; padding: 12px 14px; display: flex; align-items: center; gap: 14px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14); opacity: 0; visibility: hidden; pointer-events: none; z-index: 5; transition: opacity 0.15s ease 0.15s, visibility 0s linear 0.32s; }\n@media (prefers-color-scheme: dark) { .bdb-rail-pop { box-shadow: 0 8px 28px rgba(0, 0, 0, 0.38); } }\n.bdb-rail-pop[data-open='1'] { opacity: 1; visibility: visible; pointer-events: auto; transition: opacity 0.12s ease 0.05s, visibility 0s; }\n.bdb-rail-pop::before, .bdb-rail-pop::after { content: ''; position: absolute; top: 50%; transform: translateY(-50%); border: 7px solid transparent; }\n.bdb-rail-pop::before { left: 100%; border-left-color: var(--dsw-alias-border-l2); }\n.bdb-rail-pop::after { left: calc(100% - 1px); border-width: 6px; border-left-color: var(--dsw-alias-bg-layer-2); }\n.bdb-rail-pop .bdb-ava { background: var(--dsw-alias-bg-layer-1); }\n.bdb-rail-pop-info { min-width: 0; flex: 1; }\n.bdb-rail-pop-name { display: flex; align-items: center; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.bdb-rail-pop-role { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.bdb-rail-pop-status { display: flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; margin-top: 4px; }\n.bdb-st-working { color: var(--dsw-alias-state-business-primary); }\n.bdb-st-working .bdb-dot { background: var(--dsw-alias-state-business-primary); animation: bdb-blink 1.2s ease-in-out infinite; }\n.bdb-st-resting { color: var(--dsw-alias-label-secondary); }\n.bdb-st-resting .bdb-dot { background: var(--dsw-alias-label-secondary); }\n.bdb-st-done { color: var(--dsw-alias-state-success-primary); }\n.bdb-st-done .bdb-dot { background: var(--dsw-alias-state-success-primary); }\n@media (prefers-reduced-motion: reduce) { .bdb-dot-working { animation: none; } .bdb-st-working .bdb-dot { animation: none; } .bdb-ava-halo { animation: none; } }\n\n/* ===== 团队面板（details 栏内） ===== */\n.bdb-team { height: 100%; display: flex; flex-direction: column; min-width: 0; }\n.bdb-team-head { display: flex; align-items: center; gap: 8px; padding: 0 0 8px; border-bottom: 1px dashed var(--dsw-alias-border-l1); flex-wrap: wrap; }\n.bdb-team-title { font-weight: 700; font-size: 14px; }\n.bdb-team-stats { display: flex; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.bdb-stat-working { color: var(--dsw-alias-state-business-primary); }\n.bdb-stat-done { color: var(--dsw-alias-state-success-primary); }\n.bdb-refresh { margin-left: auto; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 12px; }\n.bdb-stylebar { display: flex; gap: 4px; }\n.bdb-style-chip { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 999px; padding: 1px 7px; font-size: 11px; cursor: pointer; }\n.bdb-style-on { border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-state-business-primary); }\n.bdb-team-list { flex: 1; overflow: auto; padding: 6px 0 0; display: flex; flex-direction: column; gap: 4px; }\n.bdb-team-empty { color: var(--dsw-alias-label-secondary); font-size: 13px; padding: 12px 4px; }\n.bdb-row { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }\n.bdb-row-main { display: flex; align-items: center; gap: 10px; padding: 8px 10px; cursor: pointer; min-width: 0; }\n.bdb-row-open { border-color: var(--dsw-alias-state-business-primary); }\n.bdb-row-info { flex: 1; min-width: 0; }\n.bdb-row-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.bdb-row-role { font-size: 11px; color: var(--dsw-alias-label-secondary); }\n.bdb-row-status { display: flex; align-items: center; gap: 5px; font-size: 11px; white-space: nowrap; flex: none; }\n.bdb-row-status-text { max-width: 130px; overflow: hidden; text-overflow: ellipsis; }\n.bdb-row-detail { border-top: 1px dashed var(--dsw-alias-border-l1); padding: 10px; display: flex; flex-direction: column; align-items: center; gap: 8px; }\n.bdb-detail-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; font-size: 12px; color: var(--dsw-alias-label-secondary); width: 100%; }\n.bdb-detail-grid code { font-size: 11px; word-break: break-all; color: var(--dsw-alias-label-primary); }\n.bdb-btn { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; }\n.bdb-btn:disabled { opacity: 0.45; cursor: not-allowed; }\n\n/* ===== 工牌卡（详情，A/B/C 风格） ===== */\n.bdb-card { width: 172px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); padding: 14px 12px 10px; text-align: center; position: relative; }\n.bdb-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.bdb-role { font-size: 12px; color: var(--dsw-alias-label-secondary); margin: 2px 0 8px; }\n.bdb-tier { display: inline-block; margin-left: 4px; padding: 0 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); font-size: 11px; line-height: 16px; }\n.bdb-status { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; border-top: 1px dashed var(--dsw-alias-border-l1); padding-top: 8px; white-space: nowrap; }\n.bdb-detail-wrap[data-style='B'] .bdb-card { width: auto; display: flex; align-items: center; gap: 12px; text-align: left; border: none; border-bottom: 1px dashed var(--dsw-alias-border-l1); border-radius: 0; background: transparent; padding: 8px 4px; }\n.bdb-detail-wrap[data-style='B'] .bdb-ava { width: 34px !important; height: 34px !important; }\n.bdb-detail-wrap[data-style='B'] .bdb-ava-halo { display: none; }\n.bdb-detail-wrap[data-style='B'] .bdb-role { margin: 0; }\n.bdb-detail-wrap[data-style='B'] .bdb-status { border-top: none; padding-top: 0; }\n.bdb-detail-wrap[data-style='C'] .bdb-card { background: var(--dsw-alias-bg-layer-3); box-shadow: 0 2px 8px rgba(0,0,0,0.12); }\n@media (prefers-color-scheme: dark) { .bdb-detail-wrap[data-style='C'] .bdb-card { box-shadow: 0 2px 8px rgba(0,0,0,0.2); } }\n`), 'dsh-badgeboard: styles')

      // ================= 随机线稿头像生成器（内联自 lib/avatar-gen.js，去 module.exports） =================
      function fnv1a(str) {
        var hash = 0x811c9dc5
        for (var i = 0; i < str.length; i++) {
          hash ^= str.charCodeAt(i)
          hash = (hash * 0x01000193) >>> 0
        }
        return hash >>> 0
      }
      var FACE_POOL = [
        ['M19.5,13 A7.5,7.5 0 1,1 4.5,13 A7.5,7.5 0 1,1 19.5,13'],
        ['M7.5,5.5 Q4.5,5.5 4.5,8.5', 'L4.5,17.5 Q4.5,20.5 7.5,20.5', 'L16.5,20.5 Q19.5,20.5 19.5,17.5', 'L19.5,8.5 Q19.5,5.5 16.5,5.5 Z'],
        ['M18.5,13 A6.5,8 0 1,1 5.5,13 A6.5,8 0 1,1 18.5,13'],
        ['M17.5,13.5 A5.5,8.5 0 1,1 6.5,13.5 A5.5,8.5 0 1,1 17.5,13.5']
      ]
      var HAIR_POOL = [
        ['M5,10 Q4,8 6,6', 'M19,10 Q20,8 18,6'],
        ['M8,5 Q9,3 10,5', 'M11,4 Q12,2 13,4', 'M14,5 Q15,3 16,5'],
        ['M12,5 Q9,3 6,5', 'M12,5 Q15,3 18,5'],
        ['M12,2.5 a2.5,2.5 0 1,1 0,0.01', 'M7,6 Q12,3 17,6'],
        ['M5,9 Q3,12 4,15', 'M19,9 Q21,12 20,15', 'M3.5,14.5 a1.2,1.2 0 1,1 0,0.01', 'M20.5,14.5 a1.2,1.2 0 1,1 0,0.01'],
        ['M7,6.5 Q8,5.5 9,6.5', 'M10,5.5 Q11,4.5 12,5.5', 'M13,5.5 Q14,4.5 15,5.5', 'M16,6.5 Q17,5.5 17.5,6.5'],
        ['M5,7 Q4,10 5,13 Q6,16 5,19', 'M19,7 Q20,10 19,13 Q18,16 19,19', 'M6,5 Q9,3 12,4 Q15,3 18,5'],
        []
      ]
      var EYES_POOL = [
        ['M9.4,12 a1.2,1.2 0 1,1 0,0.01', 'M14.6,12 a1.2,1.2 0 1,1 0,0.01'],
        ['M8,12 L10,12', 'M14,12 L16,12'],
        ['M8.5,12 Q9.5,14 10.5,12', 'M13.5,12 Q14.5,14 15.5,12'],
        ['M8.5,13 Q9.5,11 10.5,13', 'M13.5,13 Q14.5,11 15.5,13']
      ]
      var BROWS_POOL = [
        ['M8.5,9 L11.5,9', 'M12.5,9 L15.5,9'],
        ['M8,8 L11,9.5', 'M16,8 L13,9.5'],
        ['M8.5,9.5 L11.5,8', 'M12.5,8 L15.5,9.5'],
        []
      ]
      var MOUTH_POOL = [
        ['M9.5,16 Q12,18 14.5,16'],
        ['M10,16.5 L14,16.5'],
        ['M12,16 a2,1.2 0 1,1 0,0.01'],
        ['M10,17 L14,17']
      ]
      var ACCESSORY_POOL = [
        [],
        ['M7,12 a2.6,2.6 0 1,1 0,0.01', 'M14.4,12 a2.6,2.6 0 1,1 0,0.01', 'M9.6,12 L14.4,12'],
        ['M14.4,12 a2.6,2.6 0 1,1 0,0.01', 'M17,9.5 L14.4,12'],
        ['M5.5,10 Q5.5,4 12,3 Q18.5,4 18.5,10', 'M4,10 a1.5,2 0 1,1 0,0.01', 'M20,10 a1.5,2 0 1,1 0,0.01'],
        ['M10,3 L14,5'],
        ['M8.5,13.5 a0.35,0.35 0 1,1 0,0.01', 'M9,14.5 a0.35,0.35 0 1,1 0,0.01', 'M15.5,13.5 a0.35,0.35 0 1,1 0,0.01', 'M15,14.5 a0.35,0.35 0 1,1 0,0.01'],
        ['M10.5,19 L11,18', 'M12,19.5 L12,18.5', 'M13.5,19 L13,18']
      ]
      var POOL_SIZES = [FACE_POOL.length, HAIR_POOL.length, EYES_POOL.length, BROWS_POOL.length, MOUTH_POOL.length, ACCESSORY_POOL.length]
      function pickAvatar(seed) {
        var hash = fnv1a(seed)
        return {
          face: hash % POOL_SIZES[0],
          hair: (hash >>> 3) % POOL_SIZES[1],
          eyes: (hash >>> 7) % POOL_SIZES[2],
          brows: (hash >>> 11) % POOL_SIZES[3],
          mouth: (hash >>> 13) % POOL_SIZES[4],
          accessory: (hash >>> 17) % POOL_SIZES[5]
        }
      }
      function avatarPaths(seed, density) {
        var sel = pickAvatar(seed)
        var paths = []
        var pushPaths = function (arr) {
          for (var i = 0; i < arr.length; i++) {
            if (arr[i] && arr[i].length > 0) paths.push({ d: arr[i] })
          }
        }
        if (density === 'symbol') {
          if (ACCESSORY_POOL[sel.accessory].length > 0) pushPaths(ACCESSORY_POOL[sel.accessory])
          else pushPaths(FACE_POOL[sel.face])
          return paths
        }
        pushPaths(FACE_POOL[sel.face])
        pushPaths(HAIR_POOL[sel.hair])
        pushPaths(EYES_POOL[sel.eyes])
        if (density === 'full') pushPaths(BROWS_POOL[sel.brows])
        pushPaths(MOUTH_POOL[sel.mouth])
        pushPaths(ACCESSORY_POOL[sel.accessory])
        return paths
      }

      // ================= 全局 UI 状态 =================
      const store = { members: [], roster: null, pending: [], style: 'A', seatReady: false, prevChildIds: null, prevCur: undefined, frontMatched: {} }
      const listeners = new Set()
      const emit = () => { listeners.forEach((fn) => fn()) }
      const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
      const setStyle = (v) => { store.style = v; emit() }

      const h = React.createElement
      const sessionsSvc = ctx.get('sessions')
      const layoutSvc = ctx.get('layout')

      const TYPE_META = {
        explore: { role: '研究员' },
        code: { role: '工程师' },
        write: { role: '文档撰写' },
        review: { role: '审查官' },
        general: { role: '通用成员' },
      }
      const TIER_LABEL = { lite: 'Lite', standard: 'Standard', pro: 'Pro', ultra: 'Ultra' }
      const shortTitle = (label) => String(label || '').replace(/^[a-z]+\s+/, '')
      const statusOf = (m) => {
        if (m.completed) return 'done'
        if (m.activity === 'running') return 'working'
        return 'resting'
      }
      const statusMeta = {
        working: { text: (m) => '正在 ' + shortTitle(m.label) + '…', cls: 'bdb-st-working' },
        resting: { text: () => '等待下一轮', cls: 'bdb-st-resting' },
        done: { text: () => '已完成 ✓', cls: 'bdb-st-done' },
      }

      function useStore() {
        const [, force] = React.useState(0)
        React.useEffect(() => subscribe(force), [])
        return store
      }

      // ================= 中栏右缘测量：frame 网格第 3 列（details）宽度 =================
      // 注意：计算后 gridTemplateColumns = '280px minmax(0px, 1fr) 640px'（4 段）→ 必须取最后一段
      // React 改内联样式走 CSSOM，style 属性不变 → MutationObserver 靠 data-details-collapsed/data-dragging；
      // 拖拽中列宽连续变化 → 补 rAF 节流的 pointermove 测量
      function useDetailsWidth() {
        const [w, setW] = React.useState(0)
        React.useEffect(() => {
          let ro = null
          let mo = null
          let raf = null
          const measure = () => {
            try {
              const overlay = document.querySelector('[data-shell-overlay]')
              const frame = overlay && overlay.parentElement
              if (!frame) return
              const cs = getComputedStyle(frame)
              const cols = cs.gridTemplateColumns.split(' ')
              const v = parseFloat(cols[cols.length - 1])
              setW(isFinite(v) && v > 0 ? v : 0)
            } catch (e) {}
          }
          const onMove = () => {
            if (raf !== null) return
            raf = window.requestAnimationFrame(() => {
              raf = null
              measure()
            })
          }
          measure()
          const overlay = document.querySelector('[data-shell-overlay]')
          const frame = overlay && overlay.parentElement
          if (frame) {
            ro = new ResizeObserver(measure)
            ro.observe(frame)
            mo = new MutationObserver(measure)
            mo.observe(frame, { attributes: true, attributeFilter: ['style', 'data-details-collapsed', 'data-dragging'] })
          }
          window.addEventListener('pointermove', onMove)
          return () => {
            if (ro) ro.disconnect()
            if (mo) mo.disconnect()
            if (raf !== null) window.cancelAnimationFrame(raf)
            window.removeEventListener('pointermove', onMove)
          }
        }, [])
        return w
      }

      // ================= 数据：sessions 快照订阅 + 自动弹栏触发 =================
      let refreshing = false
      const sync = () => {
        try {
          if (!sessionsSvc || !sessionsSvc.list) return
          const snap = sessionsSvc.list.getSnapshot()
          const cur = snap.current
          // 会话切换：重置 child 基线，弹栏只服务于「本会话内新增派发」，不跨会话误触发
          if (store.prevCur !== cur) {
            store.prevCur = cur
            store.prevChildIds = null
          }
          const byId = snap.byId || {}
          const kids = Object.values(byId).filter((s) => s && s.parentId === cur)
          const idSet = new Set(kids.map((k) => k.id))
          // 触发检测：新增 child → 刷新目录 + 弹栏（幂等；seatReady 前置）
          if (store.prevChildIds !== null && store.seatReady) {
            const fresh = kids.filter((k) => !store.prevChildIds.has(k.id))
            if (fresh.length > 0) {
              try { if (sessionsSvc.refreshSubagents) sessionsSvc.refreshSubagents(cur) } catch (e) {}
              try { if (layoutSvc) layoutSvc.openDetails() } catch (e) {}
            }
          }
          store.prevChildIds = idSet
          // 目录层（权威）；未就绪（重启后 loading/absent）→ 主动刷新自愈（完成后 notifier 再触发本 sync）
          const catalog = (snap.subagentsByParent && snap.subagentsByParent[cur]) || null
          if (catalog && catalog.state !== 'ready' && !refreshing && sessionsSvc.refreshSubagents) {
            refreshing = true
            sessionsSvc.refreshSubagents(cur).catch(() => {}).finally(() => { refreshing = false })
          }
          const entries = (catalog && catalog.state === 'ready' && catalog.entries) ? catalog.entries : []
          // 成员 = 目录 entries（权威，重启后可自愈）∪ byId 会话（补充 completed 等）
          const fromCatalog = entries.filter((en) => en.kind === 'child').map((en) => {
            const s = kids.find((k) => k.id === en.id) || null
            return {
              id: en.id,
              label: en.label || en.id,
              mode: en.mode || 'one-shot',
              activity: en.activity || 'inactive',
              completed: s ? !!s.completed : false,
              hasChildren: !!en.hasChildren,
              type: undefined, tier: undefined,
            }
          })
          const fromById = kids
            .filter((s) => !fromCatalog.some((c) => c.id === s.id))
            .map((s) => {
              const entry = entries.find((en) => en.kind === 'child' && en.id === s.id) || null
              return {
                id: s.id,
                label: (entry && entry.label) || s.displayTitle || s.id,
                mode: entry ? entry.mode : 'one-shot',
                activity: entry ? entry.activity : (s.running ? 'running' : 'inactive'),
                completed: !!s.completed,
                hasChildren: entry ? !!entry.hasChildren : false,
                type: undefined, tier: undefined,
              }
            })
          store.members = fromCatalog.concat(fromById)
          emit()
        } catch (e) {
          console.error('badgeboard: sync failed', e)
        }
      }
      if (sessionsSvc && sessionsSvc.list && typeof sessionsSvc.list.subscribe === 'function') {
        ctx.effect(() => sessionsSvc.list.subscribe(sync), 'dsh-badgeboard: sessions')
      }
      sync()

      // ================= 数据：Host 档案（roster RPC） =================
      const loadRoster = async () => {
        try {
          const r = await rpc('badge-team/roster', {})
          store.roster = {}
          ;(r && r.members ? r.members : []).forEach((m) => { store.roster[m.id] = m })
          store.pending = (r && r.pending ? r.pending : []).slice()
          emit()
        } catch (e) {
          console.error('badgeboard: roster load failed', e)
        }
      }
      loadRoster()

      // 档案 join（渲染时执行）：continuable 精确匹配；前台 best-effort 匹配最近 pending（60s 窗口，一次性消费）
      const joinRoster = (m) => {
        const r = store.roster ? store.roster[m.id] : undefined
        if (r) return { type: r.type, tier: r.tier }
        if (store.pending.length && !store.frontMatched[m.id]) {
          const now = Date.now()
          for (let i = store.pending.length - 1; i >= 0; i--) {
            if (now - store.pending[i].ts <= 60000) {
              store.frontMatched[m.id] = true
              return { type: store.pending[i].type, tier: store.pending[i].tier }
            }
          }
        }
        return { type: undefined, tier: undefined }
      }

      // 打开子代理视图：sessions.subagentAddress 只返回「已保留」的地址（目录选中过才有），
      // 新派发的子代理拿不到 → 必须先从快照目录推导直接父地址（refreshSubagents 后读 subagentsByParent）
      const openSubagentView = async (id) => {
        try {
          if (!sessionsSvc || !sessionsSvc.openSubagent) return false
          const snap0 = sessionsSvc.list.getSnapshot()
          const cur = snap0 && snap0.current
          if (!cur) return false
          try { if (sessionsSvc.refreshSubagents) await sessionsSvc.refreshSubagents(cur) } catch (e) {}
          const snap = sessionsSvc.list.getSnapshot()
          const catalog = (snap.subagentsByParent && snap.subagentsByParent[cur]) || null
          const entry = catalog && catalog.entries ? catalog.entries.find((en) => en.kind === 'child' && en.id === id) : null
          if (entry) {
            sessionsSvc.openSubagent({ parentSessionId: cur, childSessionId: id, mode: entry.mode })
            return true
          }
          const addr = sessionsSvc.subagentAddress(id)
          if (addr) { sessionsSvc.openSubagent(addr); return true }
          return false
        } catch (e) {
          console.error('badgeboard: open subagent failed', e)
          return false
        }
      }

      // ================= 组件：线稿头像 =================
      function AvatarSvg({ seed, size, tier, density, halo, lg }) {
        const paths = avatarPaths(seed, density || 'simple')
        return h('div', { className: 'bdb-ava' + (lg ? ' bdb-ava--lg' : ''), 'data-tier': tier || '', style: { width: size, height: size } },
          h('div', { className: 'bdb-ava-ring' }),
          halo ? h('div', { className: 'bdb-ava-halo' }) : null,
          h('svg', { viewBox: '0 0 24 24' }, paths.map((p, i) => h('path', { d: p.d, key: i })))
        )
      }

      // ================= 组件：工牌卡（详情区，A/B/C） =================
      function BadgeCard({ m }) {
        const j = joinRoster(m)
        const st = statusMeta[statusOf(m)]
        const role = TYPE_META[j.type] ? TYPE_META[j.type].role : null
        const tierLabel = j.tier ? (TIER_LABEL[j.tier] || j.tier) : '职级未知'
        return h('div', { className: 'bdb-card', 'data-tier': j.tier || '' },
          h('div', { style: { display: 'flex', justifyContent: 'center' } },
            h(AvatarSvg, { seed: m.id, size: 48, tier: j.tier, density: 'full', halo: statusOf(m) === 'working', lg: true })
          ),
          h('div', { className: 'bdb-name' }, shortTitle(m.label)),
          h('div', { className: 'bdb-role' },
            h('span', null, role ? role : '成员'),
            h('span', { className: 'bdb-tier' }, tierLabel)
          ),
          h('div', { className: 'bdb-status ' + st.cls },
            h('span', { className: 'bdb-dot' }),
            h('span', null, st.text(m))
          )
        )
      }

      // ================= 组件：团队面板（details.produced.team 条目） =================
      function TeamPanel(props) {
        const s = useStore()
        const [expanded, setExpanded] = React.useState(null)
        const members = s.members || []
        const working = members.filter((m) => statusOf(m) === 'working').length
        const resting = members.filter((m) => statusOf(m) === 'resting').length
        const done = members.filter((m) => statusOf(m) === 'done').length
        const openInCatalog = (id) => {
          openSubagentView(id)
        }
        const onKeyDown = (e) => {
          if (e && e.key === 'Escape') {
            try { if (layoutSvc) layoutSvc.closeDetails() } catch (err) {}
          }
        }
        return h('div', { className: 'bdb-team', tabIndex: -1, onKeyDown: onKeyDown },
          h('div', { className: 'bdb-team-head' },
            h('div', { className: 'bdb-team-title' }, '团队'),
            h('div', { className: 'bdb-team-stats' },
              h('span', { className: 'bdb-stat bdb-stat-working' }, '⚡' + String(working)),
              h('span', { className: 'bdb-stat' }, '💤' + String(resting)),
              h('span', { className: 'bdb-stat bdb-stat-done' }, '✓' + String(done))
            ),
            h('div', { className: 'bdb-stylebar' },
              ['A', 'B', 'C'].map((st) => h('button', { key: st, className: 'bdb-style-chip' + (s.style === st ? ' bdb-style-on' : ''), onClick: () => setStyle(st), title: '工牌卡风格', 'aria-label': '工牌卡风格 ' + st }, st))
            ),
            h('button', { className: 'bdb-refresh', onClick: () => loadRoster(), title: '刷新档案', 'aria-label': '刷新团队档案' }, '↻')
          ),
          h('div', { className: 'bdb-team-list' },
            members.length === 0
              ? h('p', { className: 'bdb-team-empty' }, '暂无团队 —— 使用 dispatch 创建子代理后自动出现')
              : members.map((m) => {
                  const j = joinRoster(m)
                  const st = statusMeta[statusOf(m)]
                  const role = TYPE_META[j.type] ? TYPE_META[j.type].role : null
                  const tierLabel = j.tier ? (TIER_LABEL[j.tier] || j.tier) : '职级未知'
                  const open = expanded === m.id
                  return h('div', { key: m.id, className: 'bdb-row' + (open ? ' bdb-row-open' : '') },
                    h('div', { className: 'bdb-row-main', onClick: () => setExpanded(open ? null : m.id), role: 'button', tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(open ? null : m.id) } } },
                      h(AvatarSvg, { seed: m.id, size: 34, tier: j.tier, density: 'simple', halo: statusOf(m) === 'working' }),
                      h('div', { className: 'bdb-row-info' },
                        h('div', { className: 'bdb-row-name' }, shortTitle(m.label)),
                        h('div', { className: 'bdb-row-role' }, (role ? role + ' · ' : '') + tierLabel + (m.mode === 'continuable' ? ' · 常驻' : ''))
                      ),
                      h('div', { className: 'bdb-row-status ' + st.cls },
                        h('span', { className: 'bdb-dot' }),
                        h('span', { className: 'bdb-row-status-text' }, st.text(m))
                      )
                    ),
                    open
                      ? h('div', { className: 'bdb-row-detail' },
                          h('div', { className: 'bdb-detail-wrap', 'data-style': s.style }, h(BadgeCard, { m: m })),
                          h('div', { className: 'bdb-detail-grid' },
                            h('div', null, 'subagent_id'), h('code', null, m.id),
                            h('div', null, '任务'), h('code', null, shortTitle(m.label)),
                            h('div', null, '类型'), h('code', null, j.type || '未知'),
                            h('div', null, '职级'), h('code', null, tierLabel),
                            h('div', null, '模式'), h('code', null, m.mode === 'continuable' ? '常驻（可续接）' : '一次性')
                          ),
                          h('button', { className: 'bdb-btn', onClick: () => openInCatalog(m.id) }, '📂 在目录中打开')
                        )
                      : null
                  )
                })
          )
        )
      }

      // ================= 组件：中栏右缘悬浮胶囊 + hover 信息卡（滚动版） =================
      function Rail() {
        const s = useStore()
        const detailsW = useDetailsWidth()
        const members = (s.members || []).filter((m) => statusOf(m) !== 'done').sort((a, b) => (statusOf(a) === 'working' ? 0 : 1) - (statusOf(b) === 'working' ? 0 : 1))
        if (members.length === 0) return null
        const working = members.filter((m) => statusOf(m) === 'working').length
        const pct = Math.round((working / members.length) * 100)
        // hover 信息卡提升到滚动区外（胶囊级渲染 + JS 定位），滚动时重算，避免被 overflow 裁剪
        const listRef = React.useRef(null)
        const leaveTimer = React.useRef(null)
        const [hoverId, setHoverId] = React.useState(null)
        const [popTop, setPopTop] = React.useState(null)
        React.useEffect(() => () => {
          if (leaveTimer.current) clearTimeout(leaveTimer.current)
        }, [])
        const clearLeave = () => {
          if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null }
        }
        const armLeave = () => {
          clearLeave()
          leaveTimer.current = setTimeout(() => setHoverId(null), 160)
        }
        const updatePop = () => {
          const list = listRef.current
          if (!list || !hoverId) { setPopTop(null); return }
          const el = list.querySelector('[data-mid="' + hoverId + '"]')
          if (!el) { setPopTop(null); return }
          const rel = el.offsetTop - list.scrollTop
          if (rel < -8 || rel > list.clientHeight - 8) { setHoverId(null); setPopTop(null); return }
          setPopTop(rel + el.offsetHeight / 2)
        }
        React.useLayoutEffect(() => { updatePop() }, [hoverId, members])
        const hovered = hoverId ? members.find((m) => m.id === hoverId) : null
        const openPanel = () => {
          try { if (layoutSvc) layoutSvc.openDetails() } catch (e) {}
        }
        // 点击成员 → 跳转子代理详细界面（快照目录推导地址 + openSubagent）；失败静默（不打开右侧栏）
        const openMember = (id) => {
          openSubagentView(id)
        }
        const popCard = (m) => {
          const j = joinRoster(m)
          const st = statusMeta[statusOf(m)]
          const role = TYPE_META[j.type] ? TYPE_META[j.type].role : null
          const tierLabel = j.tier ? (TIER_LABEL[j.tier] || j.tier) : '职级未知'
          return h('div', { className: 'bdb-rail-pop', 'data-open': '1', style: { top: (popTop === null ? 0 : popTop) + 'px' }, onMouseEnter: clearLeave, onMouseLeave: armLeave },
            h(AvatarSvg, { seed: m.id, size: 48, tier: j.tier, density: 'simple', halo: statusOf(m) === 'working' }),
            h('div', { className: 'bdb-rail-pop-info' },
              h('div', { className: 'bdb-rail-pop-name' }, shortTitle(m.label)),
              h('div', { className: 'bdb-rail-pop-role' },
                role ? role + ' · ' : '',
                h('span', { className: 'bdb-pop-role-tier', 'data-tier': j.tier || '' }, tierLabel),
                ' · ' + (m.mode === 'continuable' ? '常驻成员' : '一次性成员')
              ),
              h('div', { className: 'bdb-rail-pop-status ' + st.cls },
                h('span', { className: 'bdb-dot' }),
                h('span', null, st.text(m))
              )
            )
          )
        }
        return h('div', { className: 'bdb-rail', style: { right: (detailsW + 12) + 'px' }, onClick: openPanel, title: '团队在场指示：hover 看详情；点击成员打开子代理，点击空白打开右侧栏' },
          h('div', { className: 'bdb-rail-head' },
            h('span', { className: 'bdb-rail-head-txt' }, '团队'),
            h('span', { className: 'bdb-rail-count' }, String(members.length))
          ),
          h('div', { className: 'bdb-rail-list', ref: listRef, onScroll: updatePop },
            members.map((m) => {
              const j = joinRoster(m)
              const st = statusMeta[statusOf(m)]
              const role = TYPE_META[j.type] ? TYPE_META[j.type].role : null
              const tierLabel = j.tier ? (TIER_LABEL[j.tier] || j.tier) : '职级未知'
              return h('div', { key: m.id, className: 'bdb-rail-item', 'data-mid': m.id, 'data-st': statusOf(m), 'data-tier': j.tier || '', tabIndex: 0, role: 'button', 'aria-label': shortTitle(m.label) + '，' + (role ? role : '成员') + '，' + tierLabel + '，点击打开子代理', title: '打开子代理', onClick: (e) => { e.stopPropagation(); openMember(m.id) }, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMember(m.id) } }, onMouseEnter: () => { clearLeave(); setHoverId(m.id) }, onMouseLeave: armLeave, onFocus: () => { clearLeave(); setHoverId(m.id) }, onBlur: armLeave },
                h('div', { className: 'bdb-rail-ava' },
                  h(AvatarSvg, { seed: m.id, size: 36, tier: j.tier, density: 'simple' }),
                  h('span', { className: 'bdb-rail-dot bdb-dot-' + (statusOf(m) === 'working' ? 'working' : 'resting') })
                )
              )
            })
          ),
          hovered && popTop !== null ? popCard(hovered) : null,
          h('div', { className: 'bdb-rail-foot' },
            h('div', { className: 'bdb-rail-prog' }, h('i', { style: { width: pct + '%' } })),
            h('span', null, working + '/' + members.length)
          )
        )
      }

      // ================= 注册 =================
      ctx.effect(() => slots.inject('details.produced.team', () => {
        store.seatReady = true
        return slots.register({ name: 'details.produced.team' }, (props) => h(TeamPanel, { props: props }))
      }), 'dsh-badgeboard: team-seat')
      ctx.effect(() => slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'badgeboard-rail' }, () => h(Rail))), 'dsh-badgeboard: rail')
    }
    module.exports = { apply }
    return module.exports
  },
})
