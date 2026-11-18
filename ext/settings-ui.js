// Freebuff Computer Use — Settings > Computer Use panel.
// Runs in the hosted Freebuff page (main world); talks to the main process via window.freebuffComputerUse.
(() => {
  if (window.__fbcuSettings) return
  window.__fbcuSettings = true
  const api = window.freebuffComputerUse
  if (!api) return
  const ENTRY = 'data-fbcu-entry', PANEL = 'fbcu-panel'
  const NAV_WORDS = ['general', 'appearance', 'account', 'models', 'mcp', 'agents', 'keyboard', 'shortcuts', 'billing', 'notifications', 'privacy', 'advanced', 'about', 'diagnose', 'integrations', 'tools', 'profile']
  const text = el => (el.textContent || '').replace(/\s+/g, ' ').trim()
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  let dumped = false

  /** The Settings nav: a "General" item plus at least two sibling items that look like section names. */
  function findNav() {
    const cands = [...document.querySelectorAll('button, a, [role="tab"], [role="menuitem"], [role="link"], li, div[tabindex]')]
      .filter(el => /^general$/i.test(text(el)) && visible(el) && !el.closest('#' + PANEL))
    for (let item of cands) {
      // climb to the element that is a direct child of the list holding all the section items
      for (let node = item, depth = 0; node && node.parentElement && depth < 5; node = node.parentElement, depth++) {
        const sibs = [...node.parentElement.children].filter(s => s !== node && visible(s))
        const hits = sibs.filter(s => NAV_WORDS.some(w => text(s).toLowerCase().startsWith(w)) || (text(s).length > 0 && text(s).length < 28 && s.tagName === node.tagName))
        if (sibs.length >= 2 && hits.length >= 2) return { list: node.parentElement, item: node, items: [node, ...sibs] }
      }
    }
    return null
  }

  /** The area that shows the selected section: the biggest visible block next to the nav. */
  function findContent(nav) {
    for (let a = nav.list; a && a !== document.body; a = a.parentElement) {
      const p = a.parentElement; if (!p) break
      let best = null, area = 0
      for (const c of p.children) {
        if (c === a || c.contains(nav.list) || c.id === PANEL || !visible(c)) continue
        const r = c.getBoundingClientRect(), s = r.width * r.height
        if (s > area && r.width > 240 && r.height > 160) { best = c; area = s }
      }
      if (best) return best
    }
    return null
  }

  function outline(root, depth = 0, out = []) {
    if (depth > 14 || out.length > 4000) return out
    for (const el of root.children) {
      if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'svg', 'path'].includes(el.tagName)) continue
      const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').slice(0, 60)
      const r = el.getBoundingClientRect()
      out.push(`${'  '.repeat(depth)}<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.getAttribute('role') ? ' role=' + el.getAttribute('role') : ''} class="${String(el.className?.baseVal ?? el.className).slice(0, 80)}"> ${own} @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`)
      outline(el, depth + 1, out)
    }
    return out
  }

  // ---------- panel ----------
  const css = `
#${PANEL}{position:fixed;z-index:2147483000;overflow:auto;box-sizing:border-box;padding:28px 32px;font:inherit;line-height:1.45}
#${PANEL}.fbcu-modal{inset:6vh 8vw;border-radius:14px;box-shadow:0 20px 70px rgba(0,0,0,.45)}
#${PANEL} *{box-sizing:border-box}
#${PANEL} h2{font-size:1.35em;font-weight:600;margin:0 0 4px}
#${PANEL} .sub{opacity:.65;margin:0 0 22px;font-size:.92em}
#${PANEL} section{border:1px solid var(--fbcu-line);border-radius:10px;margin:0 0 16px;overflow:hidden}
#${PANEL} .row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:13px 16px;border-top:1px solid var(--fbcu-line)}
#${PANEL} section>.row:first-child{border-top:0}
#${PANEL} .row b{display:block;font-weight:550}
#${PANEL} .row small{display:block;opacity:.62;font-size:.86em;margin-top:2px}
#${PANEL} .sw{position:relative;width:38px;height:22px;flex:none;border-radius:11px;background:var(--fbcu-line);cursor:pointer;border:0;padding:0;transition:background .15s}
#${PANEL} .sw::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s}
#${PANEL} .sw[aria-checked=true]{background:var(--fbcu-accent)}
#${PANEL} .sw[aria-checked=true]::after{left:19px}
#${PANEL} select,#${PANEL} input[type=number],#${PANEL} textarea{font:inherit;color:inherit;background:transparent;border:1px solid var(--fbcu-line);border-radius:7px;padding:5px 8px}
#${PANEL} select option{color:#000}
#${PANEL} textarea{width:100%;min-height:54px;resize:vertical}
#${PANEL} .mons{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;padding:14px 16px}
#${PANEL} .mon{border:1px solid var(--fbcu-line);border-radius:9px;padding:10px;cursor:pointer;user-select:none}
#${PANEL} .mon.on{border-color:var(--fbcu-accent);box-shadow:0 0 0 1px var(--fbcu-accent) inset}
#${PANEL} .mon img,#${PANEL} .mon .ph{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;border-radius:5px;background:var(--fbcu-line);margin-bottom:8px}
#${PANEL} .mon small{opacity:.65}
#${PANEL} .btn{font:inherit;color:inherit;background:transparent;border:1px solid var(--fbcu-line);border-radius:7px;padding:5px 12px;cursor:pointer}
#${PANEL} .btn:hover{border-color:var(--fbcu-accent)}
#${PANEL} .x{position:absolute;top:14px;right:16px}
#${PANEL} .status{opacity:.6;font-size:.85em;margin-top:8px}
#${PANEL} .dim{opacity:.45;pointer-events:none}
#${PANEL} .warn{padding:10px 16px;font-size:.88em;opacity:.8}`

  let panel = null, cfg = null, monitors = [], previews = {}, info = {}

  function palette(host) {
    const bgOf = el => { for (; el; el = el.parentElement) { const c = getComputedStyle(el).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c } return '#1e1e1e' }
    const bg = bgOf(host || document.body)
    const m = bg.match(/\d+/g) || [30, 30, 30], lum = (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255
    const color = getComputedStyle(host || document.body).color
    const accentEl = document.querySelector('[class*="primary"], [class*="accent"], button[type="submit"]')
    let accent = accentEl ? getComputedStyle(accentEl).backgroundColor : ''
    if (!accent || /rgba\(0, 0, 0, 0\)|transparent/.test(accent)) accent = '#4f8cff'
    return { bg, color, accent, line: lum < 0.5 ? 'rgba(255,255,255,.13)' : 'rgba(0,0,0,.12)' }
  }

  const sw = (key, label, hint) => `<div class="row"><div><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</div><button class="sw" role="switch" data-k="${key}" aria-checked="${!!cfg[key]}"></button></div>`

  function render() {
    if (!panel) return
    const all = cfg.allowedDisplays === 'all'
    const on = i => all || cfg.allowedDisplays.includes(i)
    panel.innerHTML = `
      <button class="btn x" data-act="close" title="Close">✕</button>
      <h2>Computer Use</h2>
      <p class="sub">Lets Freebuff's agent see your screens and use the mouse and keyboard through the <code>computer_*</code> tools. Changes apply to the next agent turn.</p>
      <section>
        ${sw('enabled', 'Enable Computer Use', 'Offer the screenshot, click, type and window tools to the agent.')}
        <div class="${cfg.enabled ? '' : 'dim'}">
        ${sw('allowActions', 'Allow mouse and keyboard control', 'Off = view-only: the agent can take screenshots and read windows but not click or type.')}
        ${sw('failSafe', 'Fail-safe corner', 'Move your mouse into the top-left corner of any monitor to stop the agent’s actions.')}
        ${sw('showIndicator', 'Show “Freebuff is using this monitor”', 'A small light-green badge appears at the top of each monitor while the agent is looking at or controlling it. It never shows up in the agent’s screenshots.')}
        </div>
      </section>
      <section class="${cfg.enabled ? '' : 'dim'}">
        <div class="row"><div><b>Monitors the agent may use</b><small>${monitors.length} detected. Click to allow or block one.</small></div>
          <button class="btn" data-act="all">${all ? 'All allowed' : 'Allow all'}</button></div>
        <div class="mons">${monitors.map(d => `
          <div class="mon ${on(d.index) ? 'on' : ''}" data-mon="${d.index}">
            ${previews[d.index] ? `<img src="${previews[d.index]}" alt="">` : '<div class="ph"></div>'}
            <b>Display ${d.index}${d.primary ? ' · primary' : ''}</b><br>
            <small>${d.width}×${d.height} at ${d.x},${d.y} · ${Math.round(d.scale * 100)}%</small><br>
            <small>${on(d.index) ? 'Allowed' : 'Blocked'}</small>
          </div>`).join('')}</div>
        <div class="warn"><button class="btn" data-act="preview">Test screenshot</button></div>
      </section>
      <section class="${cfg.enabled ? '' : 'dim'}">
        <div class="row"><div><b>Screenshot size</b><small>Longest edge sent to the model. Smaller is faster and cheaper; larger reads small text better.</small></div>
          <select data-n="maxWidth">${[1024, 1280, 1366, 1600, 1920, 2560].map(v => `<option ${cfg.maxWidth === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="row"><div><b>Image format</b><small>JPEG is smaller; PNG is lossless.</small></div>
          <select data-s="format"><option value="jpeg" ${cfg.format === 'jpeg' ? 'selected' : ''}>JPEG</option><option value="png" ${cfg.format === 'png' ? 'selected' : ''}>PNG</option></select></div>
        <div class="row"><div><b>JPEG quality</b></div><input type="number" min="20" max="100" step="5" data-n="quality" value="${cfg.quality}"></div>
        ${sw('drawCursor', 'Draw the mouse cursor in screenshots')}
        ${sw('screenshotAfterAction', 'Screenshot after every action', 'Return a fresh screenshot with each click or keystroke (uses more tokens).')}
        <div class="row"><div><b>Delay after each action</b><small>Milliseconds to let the screen settle.</small></div><input type="number" min="0" max="3000" step="50" data-n="actionDelayMs" value="${cfg.actionDelayMs}"></div>
      </section>
      <section class="${cfg.enabled ? '' : 'dim'}">
        <div class="row" style="display:block"><b>Blocked apps</b><small>Process names, one per line (for example <code>KeePass</code>). The agent cannot act while one of these is focused.</small>
          <textarea data-list="blockedApps" placeholder="KeePass&#10;1Password">${(cfg.blockedApps || []).join('\n')}</textarea></div>
      </section>
      <div class="status">Freebuff Computer Use ${info.version || ''} · settings in ${info.home || ''}</div>`
  }

  async function save(patch) {
    cfg = await api.setConfig({ ...cfg, ...patch })
    render()
  }

  function wire() {
    panel.addEventListener('click', async e => {
      const t = e.target.closest('[data-k],[data-mon],[data-act]'); if (!t) return
      if (t.dataset.k) return save({ [t.dataset.k]: !cfg[t.dataset.k] })
      if (t.dataset.act === 'close') return close()
      if (t.dataset.act === 'all') return save({ allowedDisplays: 'all' })
      if (t.dataset.act === 'preview') { for (const d of monitors) previews[d.index] = await api.preview(d.index).catch(() => null); return render() }
      if (t.dataset.mon) {
        const i = Number(t.dataset.mon)
        let list = cfg.allowedDisplays === 'all' ? monitors.map(d => d.index) : [...cfg.allowedDisplays]
        list = list.includes(i) ? list.filter(n => n !== i) : [...list, i]
        if (!list.length) return
        return save({ allowedDisplays: list.length === monitors.length ? 'all' : list.sort() })
      }
    })
    panel.addEventListener('change', e => {
      const t = e.target
      if (t.dataset.n) save({ [t.dataset.n]: Number(t.value) })
      else if (t.dataset.s) save({ [t.dataset.s]: t.value })
      else if (t.dataset.list) save({ [t.dataset.list]: t.value.split(/\r?\n/) })
    })
  }

  let tracking = null
  async function open(nav) {
    close()
    const content = nav && findContent(nav)
    const host = content || document.body
    const pal = palette(host)
    panel = document.createElement('div')
    panel.id = PANEL
    panel.style.cssText = `--fbcu-line:${pal.line};--fbcu-accent:${pal.accent};background:${pal.bg};color:${pal.color};font-family:${getComputedStyle(host).fontFamily}`
    if (content) {
      const place = () => { if (!panel) return; const r = content.getBoundingClientRect(); Object.assign(panel.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }) }
      place(); tracking = setInterval(place, 250)
    } else panel.classList.add('fbcu-modal')
    document.body.appendChild(panel)
    ;[cfg, monitors, info] = await Promise.all([api.getConfig(), api.displays().catch(() => []), api.info().catch(() => ({}))])
    wire(); render()
    document.querySelectorAll(`[${ENTRY}]`).forEach(el => el.setAttribute('aria-current', 'page'))
  }
  function close() {
    clearInterval(tracking); tracking = null
    panel?.remove(); panel = null
    document.querySelectorAll(`[${ENTRY}]`).forEach(el => el.removeAttribute('aria-current'))
  }
  addEventListener('keydown', e => { if (e.key === 'Escape' && panel) close() }, true)

  function inject() {
    const nav = findNav()
    if (!nav) { if (panel && !document.querySelector(`[${ENTRY}]`)) close(); return }
    if (!dumped) { dumped = true; api.dump(outline(document.body).join('\n')).catch(() => {}) }
    if (nav.list.querySelector(`[${ENTRY}]`)) return
    const entry = nav.item.cloneNode(true)
    entry.setAttribute(ENTRY, '')
    entry.removeAttribute('id'); entry.removeAttribute('href')
    entry.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'))
    entry.removeAttribute('aria-selected'); entry.removeAttribute('aria-current'); entry.removeAttribute('data-state'); entry.removeAttribute('data-active')
    // replace the label text, keep any icon
    const walker = document.createTreeWalker(entry, NodeFilter.SHOW_TEXT)
    let first = true
    for (let n; (n = walker.nextNode());) if (n.textContent.trim()) { n.textContent = first ? 'Computer Use' : ''; first = false }
    if (first) entry.textContent = 'Computer Use'
    // copy the look of an unselected item, if the cloned one was the selected one
    const plain = nav.items.find(el => el !== nav.item && el.className !== nav.item.className && el.tagName === nav.item.tagName)
    if (plain && /active|selected|current/i.test(String(nav.item.className))) entry.className = plain.className
    entry.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); open(findNav() || nav) }, true)
    nav.list.appendChild(entry)
    // leaving for another section closes the panel
    nav.list.addEventListener('click', e => { if (!e.target.closest(`[${ENTRY}]`)) close() }, true)
  }

  const style = document.createElement('style'); style.textContent = css
  const boot = () => { document.head.appendChild(style); inject(); new MutationObserver(() => { clearTimeout(boot.t); boot.t = setTimeout(inject, 150) }).observe(document.body, { childList: true, subtree: true }) }
  document.body ? boot() : addEventListener('DOMContentLoaded', boot)
})()
