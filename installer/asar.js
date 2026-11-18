// Minimal asar reader/writer: read a file, replace files, repack (unpacked entries are left alone).
const fs = require('fs')
const crypto = require('crypto')
const BLOCK = 4 * 1024 * 1024

function readHeader(buf) {
  const headerSize = buf.readUInt32LE(4)
  const strLen = buf.readUInt32LE(12)
  const header = JSON.parse(buf.toString('utf8', 16, 16 + strLen))
  return { header, base: 8 + headerSize }
}

function entry(header, file) {
  let node = header
  for (const part of file.split('/')) { node = node.files?.[part]; if (!node) return null }
  return node
}

function readFile(asarPath, file) {
  const buf = fs.readFileSync(asarPath)
  const { header, base } = readHeader(buf)
  const e = entry(header, file)
  if (!e || e.unpacked || e.files) return null
  const off = base + Number(e.offset)
  return buf.subarray(off, off + e.size)
}

function integrity(data) {
  const blocks = []
  for (let i = 0; i < data.length || i === 0; i += BLOCK) blocks.push(crypto.createHash('sha256').update(data.subarray(i, i + BLOCK)).digest('hex'))
  return { algorithm: 'SHA256', hash: crypto.createHash('sha256').update(data).digest('hex'), blockSize: BLOCK, blocks }
}

/** replacements: { 'electron/main.cjs': Buffer|string }. Writes atomically. */
function writeFiles(asarPath, replacements) {
  const buf = fs.readFileSync(asarPath)
  const { header, base } = readHeader(buf)
  const files = []
  ;(function walk(node, prefix) {
    for (const [name, child] of Object.entries(node.files || {})) {
      const p = prefix ? prefix + '/' + name : name
      if (child.files) walk(child, p)
      else if (!child.unpacked && !child.link && child.offset !== undefined) files.push({ p, node: child, offset: Number(child.offset) })
    }
  })(header, '')
  for (const name of Object.keys(replacements)) if (!files.some(f => f.p === name)) throw new Error(`${name} not found in app.asar`)
  files.sort((a, b) => a.offset - b.offset)
  const chunks = []
  let offset = 0
  for (const f of files) {
    let data = buf.subarray(base + f.offset, base + f.offset + f.node.size)
    if (f.p in replacements) {
      data = Buffer.from(replacements[f.p])
      f.node.size = data.length
      f.node.integrity = integrity(data)
    }
    f.node.offset = String(offset)
    offset += data.length
    chunks.push(data)
  }
  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const padded = Math.ceil(json.length / 4) * 4
  const headerPickle = Buffer.alloc(8 + padded)
  headerPickle.writeUInt32LE(4 + padded, 0)
  headerPickle.writeUInt32LE(json.length, 4)
  json.copy(headerPickle, 8)
  const sizePickle = Buffer.alloc(8)
  sizePickle.writeUInt32LE(4, 0)
  sizePickle.writeUInt32LE(headerPickle.length, 4)
  const tmp = asarPath + '.fbcu-tmp'
  fs.writeFileSync(tmp, Buffer.concat([sizePickle, headerPickle, ...chunks]))
  fs.renameSync(tmp, asarPath)
}

module.exports = { readFile, writeFiles }
