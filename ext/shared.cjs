'use strict'
// Shared by the orchestrator extension (Bun) and the Electron main hook (Node).
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const HOME = path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'FreebuffComputerUse')
const CONFIG_PATH = path.join(HOME, 'config.json')
const HELPER_PATH = path.join(HOME, 'FbcuHelper.exe')

const DEFAULTS = Object.freeze({
  enabled: true,          // tools are offered to the agent at all
  allowActions: true,     // false = view-only (screenshots, snapshots, window list)
  allowedDisplays: 'all', // 'all' or an array of display indexes the agent may see/control
  maxWidth: 1366,         // screenshot longest-edge cap (px)
  format: 'jpeg',         // 'jpeg' | 'png'
  quality: 70,            // jpeg quality
  drawCursor: true,
  failSafe: true,         // mouse in a monitor's top-left corner aborts actions
  showIndicator: true,    // light-green "Freebuff is using this monitor" badge on monitors the agent uses
  actionDelayMs: 120,     // settle time after each action
  screenshotAfterAction: false,
  blockedApps: [],        // process names the agent may not focus/click into, e.g. ["KeePass"]
})

function readConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) } } catch { return { ...DEFAULTS } }
}

function sanitizeConfig(input) {
  const c = { ...readConfig() }
  if (!input || typeof input !== 'object') return c
  for (const k of ['enabled', 'allowActions', 'drawCursor', 'failSafe', 'screenshotAfterAction', 'showIndicator'])
    if (typeof input[k] === 'boolean') c[k] = input[k]
  if (input.allowedDisplays === 'all') c.allowedDisplays = 'all'
  else if (Array.isArray(input.allowedDisplays)) c.allowedDisplays = [...new Set(input.allowedDisplays.filter(n => Number.isInteger(n) && n >= 0 && n < 64))]
  if (Number.isFinite(input.maxWidth)) c.maxWidth = Math.max(480, Math.min(3840, Math.round(input.maxWidth)))
  if (Number.isFinite(input.quality)) c.quality = Math.max(20, Math.min(100, Math.round(input.quality)))
  if (Number.isFinite(input.actionDelayMs)) c.actionDelayMs = Math.max(0, Math.min(3000, Math.round(input.actionDelayMs)))
  if (input.format === 'png' || input.format === 'jpeg') c.format = input.format
  if (Array.isArray(input.blockedApps)) c.blockedApps = input.blockedApps.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim().replace(/\.exe$/i, '')).slice(0, 100)
  return c
}

function writeConfig(input) {
  const c = sanitizeConfig(input)
  fs.mkdirSync(HOME, { recursive: true })
  const tmp = CONFIG_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2))
  fs.renameSync(tmp, CONFIG_PATH)
  return c
}

/** One long-lived FbcuHelper.exe, JSON lines over stdio, requests serialized. */
function createHelper(exe = HELPER_PATH) {
  let child = null, buf = '', seq = 0
  const pending = new Map()
  let chain = Promise.resolve()

  function start() {
    if (child) return child
    if (!fs.existsSync(exe)) throw new Error(`Computer Use helper is missing at ${exe}. Re-run FreebuffComputerUse-Setup.exe.`)
    child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', d => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        if (!line) continue
        let msg; try { msg = JSON.parse(line) } catch { continue }
        const p = pending.get(msg.id); if (!p) continue
        pending.delete(msg.id); clearTimeout(p.timer)
        msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || 'helper error'))
      }
    })
    child.stderr.on('data', () => {})
    const dead = (why) => {
      child = null; buf = ''
      for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('Computer Use helper exited: ' + why)) }
      pending.clear()
    }
    child.on('exit', code => dead('code ' + code))
    child.on('error', e => dead(e.message))
    return child
  }

  function raw(cmd, args = {}, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      let c; try { c = start() } catch (e) { return reject(e) }
      const id = ++seq
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Computer Use helper timed out on '${cmd}'`)); try { c.kill() } catch {} }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      c.stdin.write(JSON.stringify({ ...args, id, cmd }) + '\n')
    })
  }
  // Serialize: input actions must never interleave.
  function call(cmd, args, timeoutMs) {
    const run = chain.then(() => raw(cmd, args, timeoutMs))
    chain = run.catch(() => {})
    return run
  }
  function stop() { try { child?.kill() } catch {} child = null }
  return { call, stop }
}

module.exports = { HOME, CONFIG_PATH, HELPER_PATH, DEFAULTS, readConfig, writeConfig, sanitizeConfig, createHelper }
