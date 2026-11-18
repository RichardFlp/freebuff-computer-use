// FreebuffComputerUse-Setup.exe — installs the Computer Use tools into Freebuff.
//   FreebuffComputerUse-Setup.exe                 install into the detected Freebuff
//   FreebuffComputerUse-Setup.exe "<folder>"      install into that Freebuff folder (or drop the folder on the exe)
//   ... --uninstall                               remove it again
//   ... --yes                                     don't ask questions (closes Freebuff if it is running)
//   ... --reapply                                 silent: re-patch only if a Freebuff update removed it
import fs from 'fs'
import path from 'path'
import { execFileSync, spawn } from 'child_process'
import helperExe from '../build/FbcuHelper.exe' with { type: 'file' }
import sharedSrc from '../ext/shared.cjs' with { type: 'file' }
import extensionSrc from '../ext/extension.cjs' with { type: 'file' }
import electronMainSrc from '../ext/electron-main.cjs' with { type: 'file' }
import settingsUiSrc from '../ext/settings-ui.js' with { type: 'file' }
import patchSrc from '../build/payload-patch.cjs' with { type: 'file' }
const asar = require('./asar.js')
const patch = require('../ext/patch.cjs')

const VERSION = '1.1.0'
const HOME = path.join(process.env.LOCALAPPDATA, 'FreebuffComputerUse')
const PAYLOAD = { 'FbcuHelper.exe': helperExe, 'shared.cjs': sharedSrc, 'extension.cjs': extensionSrc, 'electron-main.cjs': electronMainSrc, 'settings-ui.js': settingsUiSrc, 'patch.cjs': patchSrc }
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const RUN_NAME = 'FreebuffComputerUseReapply'

const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const YES = flag('--yes') || flag('--reapply'), QUIET = flag('--reapply')
const log = (...a) => { if (!QUIET) console.log(...a) }
const ask = (q, def = true) => { if (YES) return def; const a = (prompt(`${q} ${def ? '[Y/n]' : '[y/N]'}`) || '').trim().toLowerCase(); return a ? a.startsWith('y') : def }
const pause = () => { if (!YES) prompt('\nPress Enter to close.') }

function isFreebuff(dir) {
  return dir && fs.existsSync(path.join(dir, 'resources', 'app.asar')) && fs.existsSync(path.join(dir, 'resources', 'orchestrator', 'orchestrator.js'))
}
function findFreebuff() {
  const given = args.find(a => !a.startsWith('--'))
  if (given) {
    const d = path.resolve(given.replace(/^"|"$/g, ''))
    for (const c of [d, path.dirname(d), path.join(d, '..', '..')]) if (isFreebuff(c)) return c
    throw new Error(`"${d}" is not a Freebuff folder (expected resources\\app.asar inside).`)
  }
  const cands = [path.join(process.env.LOCALAPPDATA, 'Programs', '@codebufffreebuff-desktop'), path.join(process.env.LOCALAPPDATA, 'Programs', 'Freebuff'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Freebuff')]
  for (const c of cands) if (isFreebuff(c)) return c
  if (YES) throw new Error('Freebuff was not found. Pass its folder as an argument.')
  for (;;) {
    const p = (prompt('Freebuff was not found automatically. Paste the Freebuff folder (the one with Freebuff.exe):') || '').trim().replace(/^"|"$/g, '')
    if (!p) throw new Error('No folder given.')
    if (isFreebuff(p)) return p
    console.log('That folder does not contain Freebuff (resources\\app.asar). Try again.')
  }
}

function freebuffRunning(dir) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith('${dir.replace(/'/g, "''")}', 'OrdinalIgnoreCase') } | Select-Object -ExpandProperty Id`], { encoding: 'utf8', windowsHide: true })
    return out.split(/\s+/).filter(Boolean).map(Number)
  } catch { return [] }
}
function closeFreebuff(dir) {
  let pids = freebuffRunning(dir)
  if (!pids.length) return true
  if (QUIET) return false
  if (!ask('Freebuff is running and must be closed to install. Close it now?')) return false
  try { execFileSync('taskkill', ['/IM', 'Freebuff.exe'], { stdio: 'ignore' }) } catch {}
  for (let i = 0; i < 40 && (pids = freebuffRunning(dir)).length; i++) Bun.sleepSync(250)
  for (const pid of pids) try { execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' }) } catch {}
  Bun.sleepSync(800)
  return freebuffRunning(dir).length === 0
}

function backup(file, isPatched) {
  const b = file + '.fbcu-backup'
  if (!isPatched && !fs.existsSync(b)) fs.copyFileSync(file, b)
}
function writeText(file, text) { const tmp = file + '.fbcu-tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file) }

function state(dir) {
  const r = path.join(dir, 'resources')
  const orch = path.join(r, 'orchestrator', 'orchestrator.js'), loader = path.join(r, 'orchestrator', 'orchestrator-loader.mjs'), app = path.join(r, 'app.asar')
  const main = asar.readFile(app, 'electron/main.cjs')?.toString('utf8'), pre = asar.readFile(app, 'electron/hosted-preload.cjs')?.toString('utf8')
  if (main == null || pre == null) throw new Error('This Freebuff version has an unexpected layout (electron/main.cjs not found in app.asar).')
  const o = fs.readFileSync(orch, 'utf8'), l = fs.readFileSync(loader, 'utf8')
  return { orch, loader, app, o, l, main, pre, patched: { orch: patch.has(o), loader: patch.has(l), main: patch.has(main), pre: patch.has(pre) } }
}

function copyPayload() {
  fs.mkdirSync(HOME, { recursive: true })
  for (const [name, src] of Object.entries(PAYLOAD)) {
    const dest = path.join(HOME, name)
    const data = fs.readFileSync(src)
    try { fs.writeFileSync(dest, data) } catch (e) {
      if (!(name.endsWith('.exe') && (e.code === 'EBUSY' || e.code === 'EPERM'))) throw e
      // an old helper is still running (Freebuff closed but its helper lingered): stop it and retry
      try { execFileSync('taskkill', ['/F', '/IM', name], { stdio: 'ignore' }) } catch {}
      Bun.sleepSync(500)
      fs.writeFileSync(dest, data)
    }
  }
  // keep a copy of this installer for --reapply / uninstall
  try { if (path.resolve(process.execPath) !== path.join(HOME, 'FreebuffComputerUse-Setup.exe')) fs.copyFileSync(process.execPath, path.join(HOME, 'FreebuffComputerUse-Setup.exe')) } catch {}
}

function install(dir) {
  const s = state(dir)
  // build all patched sources first so an unsupported version fails before anything is written
  const next = { o: patch.patchOrchestrator(s.o), l: patch.patchLoader(s.l), main: patch.patchMain(s.main), pre: patch.patchPreload(s.pre) }
  copyPayload()
  backup(s.orch, s.patched.orch); backup(s.loader, s.patched.loader); backup(s.app, s.patched.main || s.patched.pre)
  if (next.o !== s.o) writeText(s.orch, next.o)
  if (next.l !== s.l) writeText(s.loader, next.l)
  if (next.main !== s.main || next.pre !== s.pre) asar.writeFiles(s.app, { 'electron/main.cjs': next.main, 'electron/hosted-preload.cjs': next.pre })
  let appVersion = ''; try { appVersion = JSON.parse(asar.readFile(s.app, 'package.json')).version } catch {}
  fs.writeFileSync(path.join(HOME, 'install.json'), JSON.stringify({ version: VERSION, freebuffDir: dir, appVersion, installedAt: new Date().toISOString() }, null, 2))
  return appVersion
}

function uninstall(dir) {
  const s = state(dir)
  if (s.patched.orch) writeText(s.orch, patch.strip(s.o))
  if (s.patched.loader) writeText(s.loader, patch.strip(s.l).replace("let contents = result.bytes.toString('utf8')", "const contents = result.bytes.toString('utf8')"))
  if (s.patched.main || s.patched.pre) asar.writeFiles(s.app, { 'electron/main.cjs': patch.strip(s.main), 'electron/hosted-preload.cjs': patch.strip(s.pre) })
  for (const f of [s.orch, s.loader, s.app]) try { fs.rmSync(f + '.fbcu-backup') } catch {}
  try { execFileSync('reg', ['delete', RUN_KEY, '/v', RUN_NAME, '/f'], { stdio: 'ignore' }) } catch {}
  for (const name of [...Object.keys(PAYLOAD), 'install.json', 'dom-dump.txt']) try { fs.rmSync(path.join(HOME, name)) } catch {}
}

function guardInstalled() { try { execFileSync('reg', ['query', RUN_KEY, '/v', RUN_NAME], { stdio: 'ignore' }); return true } catch { return false } }
function setGuard(on) {
  if (on) execFileSync('reg', ['add', RUN_KEY, '/v', RUN_NAME, '/t', 'REG_SZ', '/d', `"${path.join(HOME, 'FreebuffComputerUse-Setup.exe')}" --reapply`, '/f'], { stdio: 'ignore' })
  else try { execFileSync('reg', ['delete', RUN_KEY, '/v', RUN_NAME, '/f'], { stdio: 'ignore' }) } catch {}
}

async function main() {
  log(`Freebuff Computer Use ${VERSION} — lets Freebuff's agent see and control your screens.\n`)
  const dir = findFreebuff()
  log(`Freebuff: ${dir}`)

  if (flag('--reapply')) {
    const s = state(dir)
    if (Object.values(s.patched).every(Boolean)) return
    if (freebuffRunning(dir).length) return // never touch a running Freebuff silently; next logon will do it
    install(dir)
    return
  }

  const s = state(dir)
  const installed = Object.values(s.patched).some(Boolean)
  let mode = flag('--uninstall') ? 'uninstall' : 'install'
  if (installed && !flag('--uninstall') && !YES) {
    const a = (prompt('Computer Use is already installed. [R]einstall/update, [U]ninstall, or [C]ancel?') || 'r').trim().toLowerCase()
    if (a.startsWith('u')) mode = 'uninstall'
    else if (a.startsWith('c')) return
  } else if (!installed && mode === 'install' && !ask('Install Computer Use into this Freebuff?')) return

  const wasRunning = freebuffRunning(dir).length > 0
  if (!closeFreebuff(dir)) throw new Error('Freebuff is still running. Close it and run this again.')

  if (mode === 'uninstall') {
    uninstall(dir)
    log('\nComputer Use was removed. Your settings stay in ' + HOME + '\\config.json.')
  } else {
    const appVersion = install(dir)
    log(`\nInstalled into Freebuff ${appVersion}.`)
    log('  • The agent now has computer_screenshot, computer_click, computer_type, computer_key, computer_scroll,')
    log('    computer_drag, computer_windows, computer_snapshot and more, across all your monitors.')
    log('  • Settings > Computer Use controls it: on/off, view-only, which monitors, screenshot size, blocked apps.')
    log('  • Fail-safe: move the mouse into the top-left corner of any monitor to stop the agent.')
    if (!guardInstalled()) {
      log('\nFreebuff updates replace its files, which removes Computer Use until you run this installer again.')
      if (ask('Re-apply it automatically at sign-in after Freebuff updates? (adds a startup entry)', false)) { setGuard(true); log('Startup re-apply enabled.') }
    }
  }
  if ((wasRunning || mode === 'install') && ask('Start Freebuff now?', wasRunning))
    spawn(path.join(dir, 'Freebuff.exe'), [], { detached: true, stdio: 'ignore' }).unref()
}

try { await main(); pause() } catch (e) {
  if (QUIET) process.exit(1)
  console.error('\nError: ' + (e?.message || e)); pause(); process.exit(1)
}
