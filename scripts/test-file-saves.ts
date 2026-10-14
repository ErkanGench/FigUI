import assert from 'node:assert/strict'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

Object.assign(globalThis, {
  document: Object.assign(new EventTarget(), { visibilityState: 'visible', documentElement: { classList: { add() {}, remove() {} } } }),
  window: new EventTarget(),
  localStorage: new MemoryStorage(),
  sessionStorage: new MemoryStorage(),
})
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
// The bundle is one module, so this stands in for Vite's import.meta.env.
Object.assign(import.meta, { env: { DEV: false } })

// Every request in order: "GET <path>?<action> <filename>[ -> newname]" or "UPLOAD <path>".
let log: string[] = []
let fileOp: (params: URLSearchParams) => string | Error = () => '{"status":"Ok"}'
let remote: Record<string, number> = {}

const listing = '{"files":[],"path":"/","total":"1 MB","used":"0 B","occupation":"0","status":"Ok"}'

globalThis.fetch = (async (input: string | URL) => {
  const url = new URL(String(input), 'http://fluidnc.local')
  if (url.hostname === 'store.test') {
    const name = url.pathname.split('/').pop() ?? ''
    log.push(`FETCH ${name}`)
    const status = remote[name] ?? 404
    const body = name === 'plugin.json' ? '{"name":"P","version":"2.0.0","files":["index.html","icon.png"]}' : 'x'
    return new Response(status === 200 ? body : 'missing', { status })
  }
  if (url.pathname.endsWith('.macro')) return new Response('', { status: 404 })
  const action = url.searchParams.get('action')
  if (!action) return new Response(listing)
  const name = url.searchParams.get('filename')
  const newname = url.searchParams.get('newname')
  log.push(`${action} ${name}${newname ? ` -> ${newname}` : ''}`)
  const reply = fileOp(url.searchParams)
  if (reply instanceof Error) throw reply
  return new Response(reply)
}) as typeof fetch

class FakeXhr {
  upload: Record<string, (() => void) | null> = {}
  status = 200
  responseText = '{"status":"Ok"}'
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  open() {}
  abort() {}
  send(fd: FormData) {
    log.push(`upload ${(fd.get('myfile[]') as File).name}`)
    queueMicrotask(() => this.onload?.())
  }
}
Object.assign(globalThis, { XMLHttpRequest: FakeXhr })

const { replaceFileContent } = await import('../src/lib/http')
const { installStorePlugin } = await import('../src/lib/plugins')

// The new content goes to a temporary name and is renamed over the file.
log = []
await replaceFileContent('/', 'config.yaml', 'name: A\n', 'local')
assert.deepEqual(log, ['upload /config.yaml.new', 'rename config.yaml.new -> config.yaml'])

// A filesystem that refuses to rename onto an existing file.
log = []
let refused = false
fileOp = params => {
  if (params.get('action') === 'rename' && !refused) {
    refused = true
    return '{"status":"Cannot rename config.yaml.new File exists"}'
  }
  return '{"status":"Ok"}'
}
await replaceFileContent('/', 'config.yaml', 'name: A\n', 'local')
assert.deepEqual(log, [
  'upload /config.yaml.new',
  'rename config.yaml.new -> config.yaml',
  'delete config.yaml',
  'rename config.yaml.new -> config.yaml',
])

// A lost reply may mean the rename happened: never delete the file then.
log = []
fileOp = params => params.get('action') === 'rename' ? new TypeError('Failed to fetch') : '{"status":"Ok"}'
await assert.rejects(replaceFileContent('/', 'config.yaml', 'name: A\n', 'local'))
assert.deepEqual(log, ['upload /config.yaml.new', 'rename config.yaml.new -> config.yaml'])
fileOp = () => '{"status":"Ok"}'

// A failed download writes nothing to the card.
const entry = { id: 'p', name: 'P', version: '2.0.0', base: 'https://store.test/p/' } as Parameters<typeof installStorePlugin>[0]
remote = { 'plugin.json': 200, 'index.html': 200 }
log = []
await assert.rejects(installStorePlugin(entry, 'sd', () => {}), /icon\.png/)
assert.equal(log.some(line => !line.startsWith('FETCH')), false, log.join('\n'))

// plugin.json is written last, so a cut-off install does not look complete.
remote = { 'plugin.json': 200, 'index.html': 200, 'icon.png': 200 }
log = []
await installStorePlugin(entry, 'sd', () => {})
assert.deepEqual(log.filter(line => line.startsWith('upload')), [
  'upload /plugins/p/index.html',
  'upload /plugins/p/icon.png',
  'upload /plugins/p/plugin.json',
])

// A macro that cannot run says why in the terminal instead of doing nothing.
const { runMacro } = await import('../src/lib/macros')
const { useTerminalStore } = await import('../src/store/terminal')
const lastLine = () => useTerminalStore.getState().lines.at(-1)?.text ?? ''
await runMacro({ id: '1', label: 'Air', command: '', color: 'default', filename: '/air.macro', target: 'SD' })
assert.match(lastLine(), /Macro "Air" not run: \/air\.macro could not be read \(HTTP 404\)/)
await runMacro({ id: '2', label: 'Home', command: '$H', color: 'default' })
assert.match(lastLine(), /Macro "Home" not run: not connected to the controller/)

console.log('File save tests passed.')
