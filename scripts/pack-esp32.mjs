import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import lzma from 'lzma'
import { minify } from 'terser'
import postcss from 'postcss'
import { encodeSource, decodeSource } from './pack-source.mjs'

const require = createRequire(import.meta.url)
const decoder = readFileSync(require.resolve('lzma/src/lzma-d-min.js'), 'utf8')
const license = readFileSync(require.resolve('lzma/LICENSE'), 'utf8')

/** Pack the inline module, optionally sharing its dictionary with Vite's CSS. */
export async function packEsp32Html(html, { packStyles = false } = {}) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  const modules = scripts.filter(match => /\btype\s*=\s*(["'])module\1/i.test(match[1]))
  if (modules.length !== 1 || /\bsrc\s*=/i.test(modules[0][1])) {
    throw new Error('ESP32 packing requires exactly one inline module script.')
  }
  const [original, attributes, source] = modules[0]
  if (!source.trim()) throw new Error('Cannot pack an empty application module.')
  const styles = packStyles ? [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi)]
    .filter(match => /\brel\s*=\s*(["'])stylesheet\1/i.test(match[1])
      && !scripts.some(script => match.index >= script.index && match.index < script.index + script[0].length)) : []
  const payload = source + styles.map(style => style[2]).join('')

  const compress = input => new Promise((resolve, reject) => {
    lzma.compress(input, 3, (result, error) => error ? reject(error) : resolve(Buffer.from(result)))
  })
  const plain = await compress(payload)
  const encoded = await compress(encodeSource(payload))
  // Leave small inputs alone: the dictionary decoder must earn its own bytes.
  const useDictionary = encoded.length + 512 < plain.length
  const packed = useDictionary ? encoded : plain

  // Verify
  const codec = {}
  Function(decoder).call(codec)
  if (decodeSource(codec.LZMA.decompress(packed)) !== payload) {
    throw new Error('ESP32 packing failed its lossless round-trip check.')
  }

  const { code: loader } = await minify(`
    const packedScript = document.querySelector('script[data-figui-packed]');
    const codec = {};
    (function () { ${decoder} }).call(codec);
    function failed(error) {
      console.error('Could not unpack FigUI', error);
      const root = document.getElementById('root');
      if (root) root.textContent = 'Could not load FigUI. Please reload the page.';
    }
    try {
      const bytes = Uint8Array.from(atob('${packed.toString('base64')}'), c => c.charCodeAt(0));
      codec.LZMA.decompress(bytes, (source, error) => {
        if (error) { failed(error); return; }
        try {
          ${useDictionary ? `source = (${decodeSource.toString()})(source);` : ''}
          if (typeof source !== 'string') throw new Error('Invalid application module');
          ${styles.length ? `
          let offset = ${source.length};
          ${JSON.stringify(styles.map(style => style[2].length))}.forEach((length, index) => {
            const style = document.querySelector('style[data-figui-style="' + index + '"]');
            if (!style) throw new Error('Missing application stylesheet');
            style.textContent = source.slice(offset, offset + length);
            offset += length;
            style.removeAttribute('data-figui-style');
          });
          source = source.slice(0, ${source.length});
          ` : ''}
          // Cloning an executed script also copies its "already started" flag,
          // so browsers will not execute the clone. Create a fresh module.
          const script = document.createElement('script');
          for (const { name, value } of packedScript.attributes) {
            if (name !== 'data-figui-packed') script.setAttribute(name, value);
          }
          script.nonce = packedScript.nonce;
          script.textContent = source;
          script.onerror = failed;
          packedScript.after(script);
          packedScript.remove();
        } catch (error) { failed(error); }
      });
    } catch (error) { failed(error); }
  `, { ecma: 2022, module: true, format: { comments: false } })

  // Leave page colors, fonts and margins available during decompression. Restore
  // each complete stylesheet into the same node before the application starts,
  // preserving cascade order, media attributes and CSP nonces.
  const replacements = [{
    start: modules[0].index,
    length: original.length,
    text: `<script${attributes} data-figui-packed>/* LZMA-JS (MIT)\n${license}*/\n${loader}</script>`,
  }]
  for (const [index, style] of styles.entries()) {
    const bootCss = postcss.parse(style[2]).nodes
      .filter(node => node.type === 'rule' && node.selector.split(',')
        .some(selector => [':root', 'html', 'body'].includes(selector.trim())))
      .map(node => node.toString()).join('')
    replacements.push({
      start: style.index,
      length: style[0].length,
      text: `<style${style[1]} data-figui-style="${index}">${bootCss}</style>`,
    })
  }
  for (const { start, length, text } of replacements.sort((a, b) => b.start - a.start)) {
    html = html.slice(0, start) + text + html.slice(start + length)
  }
  return html
}
