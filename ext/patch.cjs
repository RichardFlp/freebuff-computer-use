'use strict'
// Source patches for Freebuff. Each insertion sits between /*fbcu:start*/ and /*fbcu:end*/ so it can be
// detected, replaced and removed exactly. Used by the installer and, at runtime, by the orchestrator
// loader so hot-updated orchestrator bundles get the tools too.
const START = '/*fbcu:start*/', END = '/*fbcu:end*/'
const HOME_EXPR = `(process.env.LOCALAPPDATA+"\\\\FreebuffComputerUse\\\\")`

const strip = (src) => {
  let s = src, i
  while ((i = s.indexOf(START)) >= 0) {
    const j = s.indexOf(END, i); if (j < 0) break
    s = s.slice(0, i) + s.slice(j + END.length)
  }
  return s
}
const has = (src) => src.includes(START)
const block = (code) => `${START}${code}${END}`

/** orchestrator.js: register the computer_* tools right after THREAD_TOOL_SPECS is defined. */
function patchOrchestrator(src) {
  src = strip(src)
  const m = /[\s,]THREAD_TOOL_SPECS = \[[\s\S]*?\n\];/.exec(src)
  if (!m) throw new Error('THREAD_TOOL_SPECS not found in orchestrator.js (unsupported Freebuff version)')
  const at = m.index + m[0].length
  const code = `;try{const __fbcu=import.meta.require(${HOME_EXPR}+"extension.cjs");__fbcu.registerTools(THREAD_TOOL_SPECS,typeof exports_external!=="undefined"?exports_external:null);globalThis.__FBCU_EXT=__fbcu}catch(e){console.error("[computer-use] extension failed to load",e)}`
  return src.slice(0, at) + block(code) + src.slice(at)
}

/** orchestrator-loader.mjs: pass hot-bundle source through patchOrchestrator before Bun loads it. */
function patchLoader(src) {
  src = strip(src)
  const anchor = /(?:const|let) contents = result\.bytes\.toString\('utf8'\)/
  if (!anchor.test(src)) throw new Error('orchestrator-loader.mjs anchor not found (unsupported Freebuff version)')
  const code = `;try{const __p=require(${HOME_EXPR}+"patch.cjs");contents=__p.patchOrchestrator(contents)}catch(e){console.error("[computer-use] bundle patch skipped",e&&e.message)}`
  return src.replace(anchor, "let contents = result.bytes.toString('utf8')" + block(code))
}

/** electron/main.cjs: IPC handlers for the Settings panel. */
function patchMain(src) {
  src = strip(src)
  const code = `\n;try{require(${HOME_EXPR}+"electron-main.cjs").install(require("electron"))}catch(e){console.error("[computer-use] main hook failed",e)}\n`
  return src + block(code)
}

/** electron/hosted-preload.cjs: a narrow bridge + the Settings panel script in the hosted page. */
function patchPreload(src) {
  src = strip(src)
  const code = `\n;try{(()=>{const{contextBridge:cb,ipcRenderer:ir,webFrame:wf}=require("electron");const i=(c,...a)=>ir.invoke(c,...a);cb.exposeInMainWorld("freebuffComputerUse",Object.freeze({getConfig:()=>i("fbcu:get-config"),setConfig:c=>i("fbcu:set-config",c),displays:()=>i("fbcu:displays"),preview:n=>i("fbcu:preview",n),info:()=>i("fbcu:info"),dump:t=>i("fbcu:dump",t)}));i("fbcu:ui-source").then(s=>{if(s)wf.executeJavaScript(s)}).catch(()=>{})})()}catch(e){}\n`
  return src + block(code)
}

module.exports = { START, END, strip, has, patchOrchestrator, patchLoader, patchMain, patchPreload }
