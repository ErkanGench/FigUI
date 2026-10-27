import assert from 'node:assert/strict'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

Object.assign(globalThis, {
  document: Object.assign(new EventTarget(), { visibilityState: 'visible', documentElement: { classList: { add() {}, remove() {} } } }),
  window: Object.assign(new EventTarget(), { location: { protocol: 'http:', pathname: '/' } }),
  localStorage: new MemoryStorage(),
  sessionStorage: new MemoryStorage(),
})
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instance: FakeWebSocket | null = null

  readyState = FakeWebSocket.CONNECTING
  bufferedAmount = 0
  binaryType = ''
  sent: string[] = []
  onopen: (() => void) | null = null
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null

  constructor(_url: string, _protocol: string) {
    FakeWebSocket.instance = this
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN
      this.onopen?.()
    })
  }

  send(data: string | Uint8Array) {
    if (typeof data === 'string') this.sent.push(data.trim())
  }

  receive(data: string) { this.onmessage?.({ data }) }

  drop() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1006, reason: '', wasClean: false })
  }

  close() { this.drop() }
}
Object.assign(globalThis, { WebSocket: FakeWebSocket })

const ws = await import('../src/lib/ws')
const { useMachineStore } = await import('../src/store')
const { sendCloseCommand } = await import('../src/lib/pluginClose')
const machine = () => useMachineStore.getState()
const linesSent = () => FakeWebSocket.instance!.sent.filter(line => line === 'G0 M5').length

await ws.connect('fluidnc.test')
machine().setConnected(true)
await delay(20)

// Idle and connected: the command goes out at once.
machine().updateStatus({ state: 'Idle' })
sendCloseCommand('G0 M5')
await delay(20)
assert.equal(linesSent(), 1)

// Closed during a jog: FluidNC would refuse the line, so it waits for Idle.
machine().updateStatus({ state: 'Jog' })
sendCloseCommand('G0 M5')
await delay(20)
assert.equal(linesSent(), 1, 'not sent during the jog')
machine().updateStatus({ state: 'Idle' })
await delay(20)
assert.equal(linesSent(), 2, 'sent once the jog ends')

// Closed while disconnected: it waits for the connection and an Idle report.
machine().setConnected(false)
FakeWebSocket.instance!.drop()
sendCloseCommand('G0 M5')
await delay(20)
await ws.connect('fluidnc.test')
await delay(20)
machine().updateStatus({ state: 'Alarm' })
machine().setConnected(true)
await delay(20)
assert.equal(linesSent(), 0, 'not sent on the new socket while in alarm')
machine().updateStatus({ state: 'Idle' })
await delay(20)
assert.equal(linesSent(), 1, 'sent on the new socket once connected and idle')
machine().updateStatus({ state: 'Run' })
machine().updateStatus({ state: 'Idle' })
await delay(20)
assert.equal(linesSent(), 1, 'sent only once')

ws.disconnect()
console.log('Plugin close command tests passed')
