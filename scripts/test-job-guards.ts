import assert from 'node:assert/strict'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

class TestDocument extends EventTarget {
  visibilityState = 'visible'
  documentElement = { classList: { add() {}, remove() {} } }
}

const testDocument = new TestDocument()
Object.assign(globalThis, {
  document: testDocument,
  window: new EventTarget(),
  localStorage: new MemoryStorage(),
  sessionStorage: new MemoryStorage(),
})

let held = 0
let requests = 0
let resolveRequest: (() => void) | null = null
let deferRequests = false
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    wakeLock: {
      request: async () => {
        requests++
        if (deferRequests) await new Promise<void>(resolve => { resolveRequest = resolve })
        held++
        let released = false
        return { release: async () => { if (!released) { released = true; held-- } } }
      },
    },
  },
})

function setVisibility(state: 'visible' | 'hidden') {
  testDocument.visibilityState = state
  testDocument.dispatchEvent(new Event('visibilitychange'))
}

const { useGCodeStore } = await import('../src/store/gcode')
const { useGCodeSenderStore } = await import('../src/store/gcodeSender')
const { useMachineStore } = await import('../src/store')

// An SD job keeps the screen on, and lets it go when it ends.
useGCodeStore.getState().startTrackedJob('controller')
await delay(0)
assert.equal(held, 1, 'an SD job requests the wake lock')
useGCodeStore.getState().finishTrackedJob('controller')
await delay(0)
assert.equal(held, 0, 'the wake lock is released when the job ends')

// The browser drops the lock when the page hides; it is taken again on return.
useGCodeStore.getState().startTrackedJob('local')
await delay(0)
setVisibility('hidden')
await delay(0)
assert.equal(held, 0, 'hidden page releases the lock')
setVisibility('visible')
await delay(0)
assert.equal(held, 1, 'visible page takes the lock again during a job')
useGCodeStore.getState().cancelTrackedJob('local')
await delay(0)
assert.equal(held, 0)

// A request that resolves after the job ended does not keep the screen on.
deferRequests = true
useGCodeStore.getState().startTrackedJob('controller')
await delay(0)
useGCodeStore.getState().cancelTrackedJob('controller')
resolveRequest?.()
await delay(0)
assert.equal(held, 0, 'a late wake lock is released at once')
deferRequests = false

// No job, no lock.
const before = requests
setVisibility('hidden')
setVisibility('visible')
await delay(0)
assert.equal(requests, before, 'no wake lock without a job')

// A framing stream has no tracked job but still keeps the screen on.
useGCodeSenderStore.setState({ phase: 'streaming' })
await delay(0)
assert.equal(held, 1, 'an untracked stream requests the wake lock')
useGCodeSenderStore.setState({ phase: 'completed' })
await delay(0)
assert.equal(held, 0, 'the wake lock is released when the stream ends')
useGCodeSenderStore.setState({ phase: 'idle' })

// A browser stream reports Idle between M5/M4 pairs; no file may be loaded meanwhile.
useMachineStore.setState({ connected: true })
useMachineStore.setState(state => ({ status: { ...state.status, state: 'Idle' } }))
useGCodeStore.setState({ fileName: 'running.nc', sourceText: 'G1 X1\n' })
useGCodeStore.getState().startTrackedJob('local')
await useGCodeStore.getState().loadFromText('G1 X2\n', 'other.nc')
assert.equal(useGCodeStore.getState().fileName, 'running.nc', 'loading is blocked during a local stream')
assert.equal(useGCodeStore.getState().sourceText, 'G1 X1\n')
assert.equal(useGCodeStore.getState().pendingFileName, null)
useGCodeStore.getState().cancelTrackedJob('local')

console.log('Job guard tests passed')
