'use strict'
// Freebuff Computer Use — Electron main-process hook (loaded from Freebuff's main.cjs).
// Serves the Settings > Computer Use panel: config read/write, monitor list, live preview.
const fs = require('fs')
const path = require('path')
const { HOME, readConfig, writeConfig, createHelper } = require('./shared.cjs')

const UI_PATH = path.join(HOME, 'settings-ui.js')
const TRUSTED = [/^https:\/\/([a-z0-9-]+\.)*freebuff\.com$/, /^https:\/\/([a-z0-9-]+\.)*freebuffweb\.site$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/, /^http:\/\/localhost(:\d+)?$/]
let helper = null

function trusted(event) {
  try {
    const url = event.senderFrame?.url || event.sender?.getURL?.() || ''
    const origin = new URL(url).origin
    return TRUSTED.some(r => r.test(origin))
  } catch { return false }
}

function install(electron) {
  const { ipcMain, app } = electron
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event)) throw new Error('untrusted sender')
    return fn(...args)
  })
  const h = () => (helper ??= createHelper())

  handle('fbcu:ui-source', () => { try { return fs.readFileSync(UI_PATH, 'utf8') } catch { return null } })
  handle('fbcu:get-config', () => readConfig())
  handle('fbcu:set-config', (input) => writeConfig(input))
  handle('fbcu:info', () => {
    let info = {}; try { info = JSON.parse(fs.readFileSync(path.join(HOME, 'install.json'), 'utf8')) } catch {}
    return { ...info, appVersion: app.getVersion(), home: HOME }
  })
  handle('fbcu:displays', () => h().call('displays'))
  handle('fbcu:preview', async (index) => {
    const list = await h().call('displays')
    const d = list.find(m => m.index === Number(index)) ?? list[0]
    const shot = await h().call('screenshot', { x: d.x, y: d.y, width: d.width, height: d.height, maxWidth: 480, maxHeight: 480, format: 'jpeg', quality: 60, drawCursor: true })
    return `data:${shot.mediaType};base64,${shot.base64}`
  })
  // Diagnostics: the settings script can save an outline of the page to adapt to new Freebuff layouts.
  handle('fbcu:dump', (text) => { fs.writeFileSync(path.join(HOME, 'dom-dump.txt'), String(text).slice(0, 2_000_000)); return true })
  app.on('will-quit', () => helper?.stop())
}

module.exports = { install }
