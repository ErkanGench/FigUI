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
  window: new EventTarget(),
  localStorage: new MemoryStorage(),
  sessionStorage: new MemoryStorage(),
  fetch: async () => new Response(''),
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
  sent: Array<string | number> = []
  muted = false
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
    this.sent.push(typeof data === 'string' ? data.trim() : data[0])
    if (typeof data === 'string' && !this.muted) setTimeout(() => this.onmessage?.({ data: 'ok\n' }), 5)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1000, reason: '', wasClean: true })
  }
}
Object.assign(globalThis, { WebSocket: FakeWebSocket })

const ws = await import('../src/lib/ws')
const { useMachineStore } = await import('../src/store')
const { useGCodeStore } = await import('../src/store/gcode')
const laser = await import('../src/lib/laser')

const lines = (socket: FakeWebSocket) => socket.sent.filter((item): item is string => typeof item === 'string' && !item.startsWith('$G') && item !== '?')
const setState = (state: 'Idle' | 'Jog' | 'Run') => useMachineStore.getState().updateStatus({ state })

// Power is a share of $30, capped, and never rounded up to full power on an S0-1 scale.
assert.equal(laser.laserPointerCommand(1, 1000), 'G1 F100 M3 S10')
assert.equal(laser.laserPointerCommand(1, 1), 'G1 F100 M3 S0.01')
assert.equal(laser.laserPointerCommand(50, 1000), 'G1 F100 M3 S100')

await ws.connect('fluidnc.test')
const socket = FakeWebSocket.instance!
await delay(50)
useMachineStore.getState().updateControllerSettings({ spindleMax: 1000, laserMode: true })

// Not idle: nothing fires.
setState('Jog')
socket.sent.length = 0
assert.equal(laser.startLaserPointer(1), false)
assert.equal(laser.startLaserPointer(0), false)
assert.deepEqual(lines(socket), [])

// The auto-off timer is the pointer's own; capture it instead of waiting a minute.
setState('Idle')
const realSetTimeout = globalThis.setTimeout
let autoOff: (() => void) | null = null
let autoOffMs = 0
globalThis.setTimeout = ((fn: () => void, ms: number) => {
  autoOff = fn
  autoOffMs = ms
  return 0
}) as typeof setTimeout
assert.equal(laser.startLaserPointer(1), true)
globalThis.setTimeout = realSetTimeout
await delay(20)
assert.deepEqual(lines(socket), ['G1 F100 M3 S10'])
assert.equal(autoOffMs, laser.LASER_POINTER_MS)
assert.ok(laser.laserPointerEndsAt() > Date.now())

// Running out during a jog: G-code is refused then, so M5 waits for Idle.
socket.sent.length = 0
setState('Jog')
autoOff!()
assert.equal(laser.laserPointerEndsAt(), 0)
await delay(20)
assert.deepEqual(lines(socket), [], 'no M5 while jogging')
setState('Idle')
await delay(20)
assert.deepEqual(lines(socket), ['G0 M5'], 'M5 once idle')
setState('Idle')
await delay(20)
assert.deepEqual(lines(socket), ['G0 M5'], 'only one M5')

// The last panel to go switches the pointer off.
socket.sent.length = 0
const releaseA = laser.retainLaserPointer()
const releaseB = laser.retainLaserPointer()
assert.equal(laser.startLaserPointer(2), true)
releaseA()
await delay(20)
assert.deepEqual(lines(socket), ['G1 F100 M3 S20'])
releaseB()
await delay(20)
assert.deepEqual(lines(socket), ['G1 F100 M3 S20', 'G0 M5'])

// Starting a job switches the pointer off first, ahead of anything queued.
socket.sent.length = 0
assert.equal(laser.startLaserPointer(1), true)
await delay(20)
ws.sendRaw('$SD/Run=/job.nc')
laser.releaseLaserPointerForJob()
await delay(20)
assert.deepEqual(lines(socket), ['G1 F100 M3 S10', 'G0 M5', '$SD/Run=/job.nc'])
assert.equal(laser.laserPointerEndsAt(), 0)
socket.sent.length = 0
laser.releaseLaserPointerForJob()
await delay(20)
assert.deepEqual(lines(socket), [], 'nothing when the pointer is off')

// A job takes over the laser: the pointer is dropped and no M5 lands in it.
socket.sent.length = 0
assert.equal(laser.startLaserPointer(1), true)
useGCodeStore.setState({ trackedJob: { source: 'controller', startedAt: Date.now() } as never })
setState('Run')
assert.equal(laser.laserPointerEndsAt(), 0)
assert.equal(laser.stopLaserPointer(), false)
setState('Idle')
await delay(20)
assert.deepEqual(lines(socket), ['G1 F100 M3 S10'])
assert.equal(laser.startLaserPointer(1), false, 'no pointer while a job is tracked')
useGCodeStore.setState({ trackedJob: null })

// M6 switching to another spindle re-reads $$, so the panel follows $32.
socket.sent.length = 0
socket.muted = true
setState('Run')
socket.onmessage?.({ data: '[MSG:INFO: Changed to spindle:Router]\n' })
await delay(20)
assert.ok(!lines(socket).includes('$$'), 'not while running')
setState('Idle')
await delay(20)
assert.deepEqual(lines(socket), ['$$'])
socket.onmessage?.({ data: '$30=24000\n$32=0\nok\n' })
await delay(20)
assert.equal(useMachineStore.getState().controllerSettings.laserMode, false)
assert.equal(useMachineStore.getState().controllerSettings.spindleMax, 24000)

// Hiding the page switches the pointer off at once, not through the queue.
const pointerOn = laser.laserPointerCommand(1, 24000)
const doc = document as unknown as { visibilityState: string }
socket.muted = false
socket.sent.length = 0
assert.equal(laser.startLaserPointer(1), true)
await delay(20)
doc.visibilityState = 'hidden'
document.dispatchEvent(new Event('visibilitychange'))
assert.deepEqual(lines(socket), [pointerOn, 'G0 M5'])
doc.visibilityState = 'visible'

// Closing the page: main.tsx closes the socket in the same pagehide, which clears the queue.
socket.sent.length = 0
assert.equal(laser.startLaserPointer(1), true)
await delay(20)
window.dispatchEvent(new Event('pagehide'))
ws.disconnect()
assert.deepEqual(lines(socket), [pointerOn, 'G0 M5'], 'M5 reaches the controller before the socket closes')

console.log('laser pointer tests passed')
process.exit(0)
