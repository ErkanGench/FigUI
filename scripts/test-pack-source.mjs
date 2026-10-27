import assert from 'node:assert/strict'
import lzma from 'lzma'
import { encodeSource, decodeSource } from './pack-source.mjs'

const words = Array.from({ length: 1100 }, (_, i) => `property${String(i).padStart(4, '0')}`)
const unicode = '\ufeffCafé — 中文 🛠️\0' + Array.from({ length: 1920 }, (_, i) => String.fromCharCode(128 + i)).join('')
for (const source of [
  '',
  'const value = 123;',
  `${unicode}\n${words.join(' ')}\n${words.join(' ')}\n${unicode}`,
  'a'.repeat(200_000) + '\n' + 'a'.repeat(200_000),
]) {
  const encoded = encodeSource(source)
  assert.equal(decodeSource(encoded), source, 'restore words, escapes, Unicode and all token widths exactly')
  const packed = await new Promise((resolve, reject) => {
    lzma.compress(encoded, 3, (data, error) => error ? reject(error) : resolve(data))
  })
  assert.equal(decodeSource(lzma.decompress(packed)), source, 'LZMA must preserve the binary representation')
}
assert.equal(decodeSource(unicode), unicode, 'plain LZMA strings still work')

const header = [...Buffer.from('1 repeated'), 0]
for (const invalid of [
  [],
  [255],
  [254, ...header, 65],
  [255, ...Buffer.from('NaN repeated'), 0, 65],
  [255, ...header, 0],
  [255, ...header, 252],
  [255, ...header, 129],
  [255, ...header, 65, 66],
  [255, ...header, 0, 255],
]) assert.throws(() => decodeSource(invalid), 'reject damaged metadata, tokens, lengths and UTF-8')

console.log('Packed source tests passed: exact binary/LZMA round trips, Unicode, dictionary boundaries and corruption')
