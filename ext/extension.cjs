'use strict'
// Freebuff Computer Use — orchestrator extension.
// Loaded by a one-line hook placed after THREAD_TOOL_SPECS in Freebuff's orchestrator.js.
// Registers native Freebuff thread tools (not MCP) that see and control the whole desktop, every monitor.
const fs = require('fs')
const { CONFIG_PATH, readConfig, createHelper } = require('./shared.cjs')

const VERSION = '1.1.0'
const helper = createHelper()
const maps = new Map()   // display key -> last screenshot geometry
let lastKey = null       // key of the most recent screenshot, default target for coordinates
let displayCache = { at: 0, list: [] }

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function displays(force) {
  if (!force && Date.now() - displayCache.at < 3000) return displayCache.list
  const list = await helper.call('displays')
  displayCache = { at: Date.now(), list }
  return list
}

function allowed(cfg, index) {
  return cfg.allowedDisplays === 'all' || (Array.isArray(cfg.allowedDisplays) && cfg.allowedDisplays.includes(index))
}

function describeDisplays(list, cfg) {
  return list.map(d => `display ${d.index}${d.primary ? ' (primary)' : ''}: ${d.width}x${d.height} at (${d.x},${d.y}), scale ${Math.round(d.scale * 100)}%` +
    (allowed(cfg, d.index) ? '' : ' [not allowed by the user]')).join('\n')
}

/** Resolve a `display` argument into a capture rectangle. */
async function target(displayArg, cfg) {
  const list = await displays()
  if (displayArg === 'all') {
    const blocked = list.filter(d => !allowed(cfg, d.index))
    if (blocked.length) throw new Error(`display "all" is unavailable because the user restricted Computer Use to displays ${cfg.allowedDisplays.join(', ')}. Use one of those.`)
    const x = Math.min(...list.map(d => d.x)), y = Math.min(...list.map(d => d.y))
    const r = Math.max(...list.map(d => d.x + d.width)), b = Math.max(...list.map(d => d.y + d.height))
    return { key: 'all', x, y, width: r - x, height: b - y, displays: list }
  }
  let index = displayArg
  if (index === undefined || index === null) {
    if (lastKey !== null && maps.has(lastKey)) return { key: lastKey, ...maps.get(lastKey).rect, displays: list }
    index = (list.find(d => d.primary && allowed(cfg, d.index)) ?? list.find(d => allowed(cfg, d.index)) ?? list[0]).index
  }
  const d = list.find(m => m.index === Number(index))
  if (!d) throw new Error(`there is no display ${index}. Displays:\n${describeDisplays(list, cfg)}`)
  if (!allowed(cfg, d.index)) throw new Error(`the user has not allowed Computer Use on display ${d.index}. Allowed: ${cfg.allowedDisplays.join(', ')}`)
  return { key: String(d.index), x: d.x, y: d.y, width: d.width, height: d.height, displays: list }
}

/** Light-green "Freebuff is using this monitor" badge on the given displays (fire and forget). */
function badge(cfg, indices) {
  if (cfg.showIndicator === false) return
  const list = [...new Set(indices.filter(i => Number.isInteger(i) && i >= 0))]
  if (list.length) helper.call('badge', { displays: list, seconds: 6 }).catch(() => {})
}
async function badgeCursor(cfg) {
  if (cfg.showIndicator === false) return
  try {
    const cur = await helper.call('cursor'), list = await displays()
    const d = list.find(m => cur.x >= m.x && cur.x < m.x + m.width && cur.y >= m.y && cur.y < m.y + m.height)
    if (d) badge(cfg, [d.index])
  } catch {}
}
const keyDisplays = t => t.key === 'all' ? t.displays.map(d => d.index) : [Number(t.key)]

function scaleFor(rect, cfg) { return Math.max(1, rect.width / cfg.maxWidth, rect.height / cfg.maxWidth) }

/** Screenshot-space (x, y) on a display -> physical desktop pixels. */
async function toScreen(args, cfg, xName = 'x', yName = 'y') {
  const t = await target(args.display, cfg)
  const m = maps.get(t.key)
  const scale = m ? m.scale : scaleFor(t, cfg)
  const ox = m ? m.rect.x : t.x, oy = m ? m.rect.y : t.y
  const px = Math.round(ox + Number(args[xName]) * scale), py = Math.round(oy + Number(args[yName]) * scale)
  const hit = t.displays.find(d => px >= d.x && px < d.x + d.width && py >= d.y && py < d.y + d.height)
  if (!hit) throw new Error(`(${args[xName]}, ${args[yName]}) on ${t.key === 'all' ? 'the all-displays screenshot' : 'display ' + t.key} is outside every monitor`)
  if (!allowed(cfg, hit.index)) throw new Error(`that point is on display ${hit.index}, which the user has not allowed`)
  badge(cfg, [hit.index])
  return { x: px, y: py, t, scale }
}

/** Physical desktop pixel -> coordinates in the screenshot space of `key`. */
function fromScreen(px, py, key) {
  const m = maps.get(key); if (!m) return null
  return { x: Math.round((px - m.rect.x) / m.scale), y: Math.round((py - m.rect.y) / m.scale) }
}

async function guardActions(cfg) {
  if (!cfg.enabled) throw new Error('Computer Use is turned off in Freebuff Settings > Computer Use.')
  if (!cfg.allowActions) throw new Error('Computer Use is in view-only mode (Settings > Computer Use): you may take screenshots and snapshots but not click or type. Ask the user to do it, or to allow actions.')
  if (cfg.blockedApps?.length) {
    const wins = await helper.call('windows')
    const fg = wins.find(w => w.focused)
    if (fg && cfg.blockedApps.some(b => b.toLowerCase() === String(fg.process).toLowerCase()))
      throw new Error(`the focused window belongs to "${fg.process}", which the user blocked for Computer Use. Do not interact with it.`)
  }
}

async function capture(t, cfg, region, maxWidth) {
  const r = region
    ? { x: Math.round(t.x + region.x), y: Math.round(t.y + region.y), width: Math.round(region.width), height: Math.round(region.height) }
    : { x: t.x, y: t.y, width: t.width, height: t.height }
  const cap = maxWidth ?? cfg.maxWidth
  return helper.call('screenshot', { ...r, maxWidth: cap, maxHeight: cap, format: cfg.format, quality: cfg.quality, drawCursor: cfg.drawCursor })
}

async function screenshotResult(displayArg, cfg, extraNote) {
  const t = await target(displayArg, cfg)
  badge(cfg, keyDisplays(t))
  const shot = await capture(t, cfg)
  maps.set(t.key, { rect: { x: t.x, y: t.y, width: t.width, height: t.height }, scale: shot.scale })
  lastKey = t.key
  const cur = await helper.call('cursor')
  const c = fromScreen(cur.x, cur.y, t.key)
  const inside = c && c.x >= 0 && c.y >= 0 && c.x < shot.imageWidth && c.y < shot.imageHeight
  const note = [
    extraNote,
    `Screenshot of ${t.key === 'all' ? 'ALL displays stitched together' : 'display ' + t.key} — ${shot.imageWidth}x${shot.imageHeight} image (screen area ${t.width}x${t.height}).`,
    `Pass x/y in THIS image's pixels with display=${t.key === 'all' ? '"all"' : t.key} to computer_click and the other actions.`,
    inside ? `Mouse cursor is at (${c.x}, ${c.y}) in this image.` : 'Mouse cursor is on another display.',
    t.displays.length > 1 ? `Monitors:\n${describeDisplays(t.displays, cfg)}` : '',
  ].filter(Boolean).join('\n')
  return { kind: 'image', base64: shot.base64, mediaType: shot.mediaType, note }
}

async function afterAction(cfg, what, physical) {
  if (cfg.actionDelayMs) await sleep(cfg.actionDelayMs)
  await badgeCursor(cfg)
  if (cfg.screenshotAfterAction) {
    const key = physical?.t?.key ?? lastKey
    return screenshotResult(key === null ? undefined : key === 'all' ? 'all' : Number(key), cfg, what)
  }
  const cur = await helper.call('cursor')
  const key = physical?.t?.key ?? lastKey
  const c = key !== null ? fromScreen(cur.x, cur.y, key) : null
  return { ok: true, done: what, cursor: c ? { display: key, x: c.x, y: c.y } : { screenX: cur.x, screenY: cur.y }, hint: 'Take computer_screenshot to check the result before relying on it.' }
}

function wrap(fn) {
  return async (_deps, args) => {
    const cfg = readConfig()
    if (!cfg.enabled) return { error: 'Computer Use is turned off in Freebuff Settings > Computer Use.' }
    try { return await fn(args ?? {}, cfg) } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  }
}

function buildSpecs(z) {
  const display = z.union([z.number().int().min(0), z.literal('all')]).optional()
    .describe('Monitor index from computer_displays, or "all" for every monitor stitched into one image. Defaults to the display of your most recent screenshot, else the primary monitor.')
  const xy = { x: z.number().describe('X in pixels of the latest screenshot of `display`'), y: z.number().describe('Y in pixels of the latest screenshot of `display`') }
  const modifiers = z.string().optional().describe('Keys held during the action, e.g. "ctrl", "shift", "ctrl+shift"')

  return [
    {
      name: 'computer_displays',
      description: 'Computer Use: list the monitors of the user\'s computer (index, resolution, position, DPI scale, primary). Call this first when the user has several monitors to pick the right one.',
      shape: {},
      run: wrap(async (_a, cfg) => {
        const list = await displays(true)
        return { displays: list.map(d => ({ ...d, allowed: allowed(cfg, d.index) })), summary: describeDisplays(list, cfg), allowActions: cfg.allowActions }
      }),
    },
    {
      name: 'computer_screenshot',
      description: 'Computer Use: take a screenshot of the user\'s real desktop (not a browser preview). Choose a monitor with `display` or "all". Pass `region` to zoom into part of the display for small text (region coordinates are in the normal screenshot\'s pixels; clicks still use the normal screenshot\'s coordinates). Always look before clicking, and again after actions to verify.',
      shape: {
        display,
        region: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).optional()
          .describe('Zoom: area of the normal screenshot of `display` to capture at higher detail'),
      },
      run: wrap(async (a, cfg) => {
        if (!a.region) return screenshotResult(a.display, cfg)
        const t = await target(a.display, cfg)
        badge(cfg, keyDisplays(t))
        const m = maps.get(t.key)
        const scale = m ? m.scale : scaleFor(t, cfg)
        const region = { x: a.region.x * scale, y: a.region.y * scale, width: a.region.width * scale, height: a.region.height * scale }
        const shot = await capture(t, cfg, region, Math.max(cfg.maxWidth, 1600))
        return { kind: 'image', base64: shot.base64, mediaType: shot.mediaType,
          note: `Zoomed view of region (${a.region.x},${a.region.y}) ${a.region.width}x${a.region.height} of display ${t.key}. A point (u,v) in this zoomed image is (${a.region.x} + u*${(a.region.width / shot.imageWidth).toFixed(4)}, ${a.region.y} + v*${(a.region.height / shot.imageHeight).toFixed(4)}) in the normal screenshot coordinates you click with.` }
      }),
    },
    {
      name: 'computer_snapshot',
      description: 'Computer Use: read the accessibility (UI Automation) tree of the focused window, or the window `handle` from computer_windows, as text: controls with ids like [e12], names, values and screen positions. Works without vision. Click an element with computer_click {elementId}.',
      shape: {
        handle: z.number().int().optional().describe('Window handle from computer_windows; defaults to the focused window'),
        maxElements: z.number().int().min(10).max(2000).optional(),
        interactiveOnly: z.boolean().optional().describe('Default true: only buttons, inputs, list items, text etc.'),
      },
      run: wrap(async (a) => {
        const r = await helper.call('snapshot', { handle: a.handle, maxElements: a.maxElements ?? 400, interactiveOnly: a.interactiveOnly ?? true }, 60000)
        return { snapshot: r.text, elements: r.count, note: 'Positions after @ are physical screen pixels. Prefer computer_click {elementId} for these.' }
      }),
    },
    {
      name: 'computer_click',
      description: 'Computer Use: move the mouse and click on the user\'s desktop. Give x/y from your latest screenshot of `display`, or an elementId from computer_snapshot. Supports right/middle click, double/triple click and held modifier keys.',
      shape: {
        x: xy.x.optional(), y: xy.y.optional(), display,
        elementId: z.string().optional().describe('Element id such as "e12" from the latest computer_snapshot'),
        button: z.enum(['left', 'right', 'middle', 'back', 'forward']).optional(),
        clicks: z.number().int().min(1).max(3).optional().describe('2 = double click, 3 = triple click'),
        modifiers,
      },
      run: wrap(async (a, cfg) => {
        await guardActions(cfg)
        let p
        if (a.elementId) {
          const e = await helper.call('element', { elementId: a.elementId })
          const hit = (await displays()).find(d => e.x >= d.x && e.x < d.x + d.width && e.y >= d.y && e.y < d.y + d.height)
          if (hit && !allowed(cfg, hit.index)) throw new Error(`element ${a.elementId} is on display ${hit.index}, which the user has not allowed`)
          if (hit) badge(cfg, [hit.index])
          p = { x: e.x, y: e.y }
        } else {
          if (a.x === undefined || a.y === undefined) throw new Error('pass x and y, or elementId')
          p = await toScreen(a, cfg)
        }
        await helper.call('click', { x: p.x, y: p.y, button: a.button ?? 'left', clicks: a.clicks ?? 1, modifiers: a.modifiers ?? '', failSafe: cfg.failSafe })
        return afterAction(cfg, `${a.clicks === 2 ? 'double-' : a.clicks === 3 ? 'triple-' : ''}${a.button ?? 'left'} click`, p)
      }),
    },
    {
      name: 'computer_move',
      description: 'Computer Use: move the mouse pointer (hover) without clicking.',
      shape: { ...xy, display },
      run: wrap(async (a, cfg) => {
        await guardActions(cfg)
        const p = await toScreen(a, cfg)
        await helper.call('move', { x: p.x, y: p.y, failSafe: cfg.failSafe })
        return afterAction(cfg, 'move', p)
      }),
    },
    {
      name: 'computer_drag',
      description: 'Computer Use: press the mouse at (fromX, fromY), drag to (toX, toY) and release. Both points use the latest screenshot of `display` ("all" lets you drag between monitors).',
      shape: {
        fromX: z.number(), fromY: z.number(), toX: z.number(), toY: z.number(), display,
        button: z.enum(['left', 'right', 'middle']).optional(), modifiers,
        durationMs: z.number().int().min(100).max(5000).optional(),
      },
      run: wrap(async (a, cfg) => {
        await guardActions(cfg)
        const from = await toScreen(a, cfg, 'fromX', 'fromY'), to = await toScreen(a, cfg, 'toX', 'toY')
        await helper.call('drag', { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, button: a.button ?? 'left', modifiers: a.modifiers ?? '', durationMs: a.durationMs ?? 400, failSafe: cfg.failSafe })
        return afterAction(cfg, 'drag', to)
      }),
    },
    {
      name: 'computer_scroll',
      description: 'Computer Use: scroll the mouse wheel, optionally after moving to x/y (scrolling goes to whatever is under the pointer). amount = wheel notches (default 3).',
      shape: {
        x: xy.x.optional(), y: xy.y.optional(), display,
        direction: z.enum(['up', 'down', 'left', 'right']),
        amount: z.number().int().min(1).max(50).optional(), modifiers,
      },
      run: wrap(async (a, cfg) => {
        await guardActions(cfg)
        const p = a.x !== undefined && a.y !== undefined ? await toScreen(a, cfg) : null
        if (!p) await badgeCursor(cfg)
        await helper.call('scroll', { ...(p ? { x: p.x, y: p.y } : {}), direction: a.direction, amount: a.amount ?? 3, modifiers: a.modifiers ?? '', failSafe: cfg.failSafe })
        return afterAction(cfg, `scroll ${a.direction}`, p)
      }),
    },
    {
      name: 'computer_type',
      description: 'Computer Use: type text into the focused control on the user\'s desktop (any characters, including emoji and accents; "\\n" presses Enter). Click the field first. For very long text prefer computer_clipboard set + computer_key "ctrl+v".',
      shape: { text: z.string().max(20000), delayMs: z.number().int().min(0).max(200).optional().describe('Pause between characters') },
      run: wrap(async (a, cfg) => {
        await guardActions(cfg)
        await badgeCursor(cfg)
        await helper.call('type', { text: a.text, delayMs: a.delayMs ?? 0, failSafe: cfg.failSafe }, 120000 + a.text.length * ((a.delayMs ?? 0) + 5))
        return afterAction(cfg, `typed ${a.text.length} characters`)
      }),
    },
    {
      name: 'computer_key',
      description: 'Computer Use: press keys or shortcuts on the user\'s desktop. Combine with "+", separate a sequence with spaces: "enter", "ctrl+s", "alt+tab", "win+d", "ctrl+shift+esc", "ctrl+a backspace", "f5", "pagedown".',
      shape: { keys: z.string().min(1), repeat: z.number().int().min(1).max(100).optional() },
      run: wrap(async (a, cfg) => {
        await guardActions(cfg)
        await badgeCursor(cfg)
        await helper.call('key', { keys: a.keys, repeat: a.repeat ?? 1, failSafe: cfg.failSafe })
        return afterAction(cfg, `pressed ${a.keys}`)
      }),
    },
    {
      name: 'computer_windows',
      description: 'Computer Use: list open windows (title, app, handle, monitor, bounds, focused) or act on one: focus, minimize, maximize, restore, close, move (x/y/width/height in physical screen pixels, e.g. to move a window to another monitor). Pick the window by `handle` or by a case-insensitive `title`/`process` match.',
      shape: {
        action: z.enum(['list', 'focus', 'minimize', 'maximize', 'restore', 'close', 'move']).optional(),
        handle: z.number().int().optional(), title: z.string().optional(), process: z.string().optional(),
        x: z.number().int().optional(), y: z.number().int().optional(), width: z.number().int().optional(), height: z.number().int().optional(),
      },
      run: wrap(async (a, cfg) => {
        const action = a.action ?? 'list'
        const wins = await helper.call('windows')
        if (action === 'list') {
          return { windows: wins.map(w => ({ handle: w.handle, title: w.title, process: w.process, display: w.display, x: w.x, y: w.y, width: w.width, height: w.height, minimized: w.minimized, maximized: w.maximized, focused: w.focused })) }
        }
        await guardActions(cfg)
        let w = a.handle !== undefined ? wins.find(v => v.handle === a.handle) : null
        if (!w && (a.title || a.process)) {
          const t = a.title?.toLowerCase(), p = a.process?.toLowerCase().replace(/\.exe$/, '')
          w = wins.find(v => (!t || v.title.toLowerCase().includes(t)) && (!p || v.process.toLowerCase() === p))
        }
        if (!w) throw new Error('no matching window; call computer_windows {action:"list"} first')
        badge(cfg, [w.display])
        if (cfg.blockedApps?.some(b => b.toLowerCase() === w.process.toLowerCase())) throw new Error(`"${w.process}" is blocked for Computer Use by the user`)
        if (w.display >= 0 && !allowed(cfg, w.display) && action !== 'move') throw new Error(`that window is on display ${w.display}, which the user has not allowed`)
        if (action === 'move') {
          const list = await displays()
          const hit = list.find(d => (a.x ?? w.x) >= d.x && (a.x ?? w.x) < d.x + d.width && (a.y ?? w.y) >= d.y && (a.y ?? w.y) < d.y + d.height)
          if (hit && !allowed(cfg, hit.index)) throw new Error(`display ${hit.index} is not allowed`)
        }
        const r = await helper.call('window', { handle: w.handle, action, x: a.x ?? w.x, y: a.y ?? w.y, width: a.width, height: a.height, failSafe: cfg.failSafe })
        await sleep(cfg.actionDelayMs)
        return { ok: true, window: { handle: w.handle, title: w.title, process: w.process }, action, result: r }
      }),
    },
    {
      name: 'computer_clipboard',
      description: 'Computer Use: read or replace the text on the user\'s clipboard.',
      shape: { action: z.enum(['get', 'set']), text: z.string().max(200000).optional() },
      run: wrap(async (a, cfg) => {
        if (a.action === 'get') return { text: await helper.call('clipboard_get') }
        await guardActions(cfg)
        await helper.call('clipboard_set', { text: a.text ?? '' })
        return { ok: true }
      }),
    },
    {
      name: 'computer_wait',
      description: 'Computer Use: wait for the screen to update (an app launching, a page loading), then optionally return a fresh screenshot.',
      shape: { seconds: z.number().min(0.1).max(30), screenshot: z.boolean().optional(), display },
      run: wrap(async (a, cfg) => {
        await sleep(a.seconds * 1000)
        return a.screenshot ? screenshotResult(a.display, cfg, `Waited ${a.seconds}s.`) : { ok: true, waited: a.seconds }
      }),
    },
  ]
}

let registered = null
/** Called from the orchestrator hook with Freebuff's live THREAD_TOOL_SPECS array and its zod. */
function registerTools(threadToolSpecs, z) {
  const specs = buildSpecs(z)
  const names = new Set(specs.map(s => s.name))
  const sync = () => {
    const on = readConfig().enabled
    for (let i = threadToolSpecs.length - 1; i >= 0; i--) if (names.has(threadToolSpecs[i]?.name)) threadToolSpecs.splice(i, 1)
    if (on) threadToolSpecs.push(...specs)
  }
  sync()
  // Settings changes apply on the next agent turn, no restart needed.
  try { fs.watchFile(CONFIG_PATH, { interval: 1000 }, () => { try { sync() } catch {} }) } catch {}
  registered = { specs, sync }
  process.on('exit', () => helper.stop())
  console.error(`[computer-use] v${VERSION} registered ${specs.length} tools (${readConfig().enabled ? 'enabled' : 'disabled'})`)
  return specs
}

module.exports = { VERSION, registerTools, buildSpecs, _helper: helper, get registered() { return registered } }
