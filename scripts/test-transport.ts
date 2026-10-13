import assert from 'node:assert/strict'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

Object.assign(globalThis, {
  document: Object.assign(new EventTarget(), { visibilityState: 'visible', documentElement: { classList: { add() {}, remove() {} } } }),
  window: new EventTarget(),
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
  sent: Array<string | number> = []
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
  }

  receive(data: string) { this.onmessage?.({ data }) }

  drop() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1006, reason: '', wasClean: false })
  }

  close() { this.drop() }
}
Object.assign(globalThis, { WebSocket: FakeWebSocket })

// ── HTTP: [ESP800] and file actions ──────────────────────────────────────────
const requests: URL[] = []
let commandReplies: Array<(url: URL) => Response> = []
Object.assign(globalThis, {
  fetch: async (input: string) => {
    const url = new URL(input)
    requests.push(url)
    const reply = commandReplies.shift()
    assert.ok(reply, `unexpected request ${url}`)
    return reply(url)
  },
})

const http = await import('../src/lib/http')
http.setBase('http://fluidnc.test')

const ESP800 = 'FW version: FluidNC v4.1.1 # FW target:grbl-embedded # webcommunication: Async:80:1.2.3.4'
commandReplies = [() => new Response(ESP800)]
assert.equal(await http.getDeviceInfo(), ESP800)
assert.equal(requests[0].searchParams.get('cmd'), '[ESP800]', '[ESP800] must use cmd=, which FluidNC allows during motion')
assert.equal(requests[0].searchParams.get('plain'), null)

requests.length = 0
commandReplies = [() => new Response('Invalid command', { status: 500 }), () => new Response(ESP800)]
assert.equal(await http.getDeviceInfoFast(), ESP800, 'firmware without cmd= must fall back to plain=')
assert.equal(requests[1].searchParams.get('plain'), '[ESP800]')

requests.length = 0
commandReplies = [() => { throw new TypeError('Failed to fetch') }]
await assert.rejects(http.getDeviceInfoFast(), /Failed to fetch/)
assert.equal(requests.length, 1, 'an unreachable controller must not be probed twice')

const listing = (status: string) => () => new Response(JSON.stringify({ files: [], path: '/', status }))
commandReplies = [listing('a.nc deleted')]
await http.deleteFile('/sd/', 'a.nc')
commandReplies = [listing('Cannot delete a.nc Permission denied')]
await assert.rejects(http.deleteFile('/sd/', 'a.nc'), /Cannot delete a\.nc/)
commandReplies = [listing('Cannot rename a.nc File exists')]
await assert.rejects(http.renameFile('/sd/', 'a.nc', 'b.nc'), /Cannot rename/)
commandReplies = [() => new Response('{"status":"No SD card"}')]
await assert.rejects(http.createDir('/sd/', 'jobs'), /No SD card/)
// Success statuses start with the file name, which may itself look like a failure.
commandReplies = [listing('error.nc deleted')]
await http.deleteFile('/sd/', 'error.nc')
commandReplies = [listing('Cannot.nc renamed to x.nc')]
await http.renameFile('/sd/', 'Cannot.nc', 'x.nc')
commandReplies = [listing('Error-test created')]
await http.createDir('/sd/', 'Error-test')
commandReplies = [listing('Missing parts deleted')]
await http.deleteDir('/sd/', 'Missing parts')
commandReplies = [listing('Ok')]
await http.createDir('/', 'plugins', 'local')
commandReplies = [listing('Ok')]
assert.deepEqual((await http.listFiles('/sd/')).files, [])

// A file arrives in chunks; a character split between two of them survives.
const fileBytes = new TextEncoder().encode('G0 X1 ; ölçü\n')
commandReplies = [() => new Response(new ReadableStream({
  start(stream) {
    stream.enqueue(fileBytes.slice(0, 12))
    stream.enqueue(fileBytes.slice(12))
    stream.close()
  },
}))]
assert.equal(await http.fetchFileContent('/a.nc'), 'G0 X1 ; ölçü\n')

// ── Firmware update: FluidNC answers 200 and reports the result in status ────
class FakeXhr {
  static reply = ''
  status = 200
  responseText = ''
  timeout = 0
  upload = {}
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null
  open() {}
  abort() {}
  send() {
    this.responseText = FakeXhr.reply
    queueMicrotask(() => this.onload?.())
  }
}
Object.assign(globalThis, { XMLHttpRequest: FakeXhr })
const image = new File(['x'], 'firmware.bin')
FakeXhr.reply = '{"status":"3"}'
await http.uploadFirmware(image)
FakeXhr.reply = '{"status":"1"}'
await assert.rejects(http.uploadFirmware(image), /rejected the firmware image/)
FakeXhr.reply = ''
await http.uploadFirmware(image)

// Saving an edited file whose name looks like a failure status.
commandReplies = [listing('error.nc.new renamed to error.nc')]
await http.replaceFileContent('/sd/', 'error.nc', 'G0 X1\n', 'sd')

// ── WebSocket: nothing replays after a reconnect except jog cancel ───────────
const ws = await import('../src/lib/ws')
const { useMachineStore } = await import('../src/store')

await ws.connect('fluidnc.test')
let socket = FakeWebSocket.instance!
assert.equal(ws.sendRaw('G0 X1'), true)
await delay(100)
assert.ok(socket.sent.includes('G0 X1'))

socket.drop()
assert.equal(useMachineStore.getState().connected, false)
assert.equal(ws.sendRaw('G0 X50'), false, 'a command typed while disconnected is not sent')
assert.equal(ws.sendRealtime(0x7E), false, 'cycle start while disconnected is not sent')
assert.equal(ws.sendRealtime(0x85), false, 'jog cancel is not sent yet')
ws.sendRealtime(0x85)
ws.sendRealtime(0x85)

await ws.connect('fluidnc.test')
socket = FakeWebSocket.instance!
await delay(60)
assert.ok(!socket.sent.includes('G0 X50'), 'a command typed while disconnected must not run after reconnect')
assert.ok(!socket.sent.includes(0x7E), 'cycle start must not replay after reconnect')
assert.equal(socket.sent.filter(item => item === 0x85).length, 1, 'jog cancel is replayed once after reconnect')

// ── Status reports: a burst is merged, state changes are applied at once ─────
await delay(150)
const countBefore = useMachineStore.getState().statusReportCount
for (let i = 1; i <= 40; i++) socket.receive(`<Idle|MPos:${i},0,0|FS:0,0|WCO:0,0,0>`)
const countAfterBurst = useMachineStore.getState().statusReportCount
assert.ok(countAfterBurst - countBefore <= 2, `a burst must not apply every report (${countAfterBurst - countBefore})`)
socket.receive('<Run|MPos:41,0,0|FS:100,0>')
assert.equal(useMachineStore.getState().status.state, 'Run', 'a state change is applied at once')
assert.equal(useMachineStore.getState().status.mpos.x, 41)
for (let i = 42; i <= 45; i++) socket.receive(`<Run|MPos:${i},0,0|FS:100,0>`)
socket.receive('ALARM:1')
await delay(150)
assert.equal(useMachineStore.getState().status.state, 'Alarm', 'a deferred report must not overwrite a later alarm')
assert.equal(useMachineStore.getState().status.mpos.x, 45, 'the deferred report is applied before the alarm')

socket.receive('<Alarm:1|MPos:46,0,0|FS:0,0>')
socket.receive('<Alarm:1|MPos:47,0,0|FS:0,0>')
await delay(150)
assert.equal(useMachineStore.getState().status.mpos.x, 47, 'the latest deferred report is applied after the interval')

// ── Silent queries: a reply lost to a reset does not block a local stream ────
ws.disconnect()
await ws.connect('fluidnc.test')
socket = FakeWebSocket.instance!
await delay(100)
assert.ok(socket.sent.includes('$G'), 'the modal state is queried on connect')
assert.equal(ws.isResponseTrafficQuiescent(0), false, 'the $G reply is still due')
assert.equal(ws.sendRealtime(0x18), true)
await delay(1100)
assert.equal(ws.isResponseTrafficQuiescent(0), true, 'a $G that the reset dropped must be forgotten')

ws.sendSilentAlarmQuery()
await delay(100)
socket.receive('1: Hard limit')
socket.receive('error:3')
assert.equal(ws.isResponseTrafficQuiescent(0), true, 'error:N ends a silent query')

const shownLines: string[] = []
const stopShowing = ws.onLine(line => shownLines.push(line))

// Stop during a job: the $G reply is lost and ALARM:3 asks for the alarm name
// inside the cooldown. The $A waits for the cooldown instead of queuing
// behind the dead $G, and nothing leaks into the terminal.
await delay(2100)
assert.ok(socket.sent.filter(item => item === '$G').length >= 2, 'the $G poll runs')
ws.suspendBackgroundTraffic() // no further $G poll
assert.equal(ws.isResponseTrafficQuiescent(0), false, 'a $G reply is due')
ws.sendRealtime(0x18)
await delay(50)
socket.receive('ALARM:3')
const alarmQueries = () => socket.sent.filter(item => item === '$A').length
let alarmQueriesAnswered = alarmQueries()
const answerAlarmQueries = () => { // the controller answers at once
  for (; alarmQueriesAnswered < alarmQueries(); alarmQueriesAnswered++) {
    socket.receive('Active alarm: 3 (Abort during cycle)')
    socket.receive('ok')
  }
}
const alarmQueriesBefore = alarmQueries()
assert.equal(ws.sendSilentAlarmQuery(), true)
await delay(100)
answerAlarmQueries()
assert.equal(alarmQueries(), alarmQueriesBefore, 'no query during the cooldown')
await delay(1000)
answerAlarmQueries()
assert.equal(alarmQueries(), alarmQueriesBefore + 1, 'the query goes out after the cooldown')
assert.equal(useMachineStore.getState().status.alarmName, 'Abort during cycle')
assert.equal(ws.isResponseTrafficQuiescent(0), true, 'the $A reply ends its own query')
assert.deepEqual(shownLines, ['ALARM:3'])
shownLines.length = 0

// ── report_inches is learned over the websocket when HTTP refuses $$ ─────────
// FluidNC refuses $Report/Inches outside Idle/Alarm (error:8) but answers $$
// in any state, starting with $13.
const busy = () => new Response('Try again when not moving', { status: 503 })
commandReplies = [busy, busy]
await ws.sendStartupQueries()
await delay(100)
assert.ok(socket.sent.includes('$$'), 'the settings are asked over the websocket during motion')
assert.ok(!socket.sent.includes('$Report/Inches'), 'not the query FluidNC refuses during motion')
socket.receive('$13=1')
socket.receive('$10=1')
socket.receive('$30=1000')
socket.receive('$32=1')
socket.receive('$100=80.000')
socket.receive('ok')
assert.equal(useMachineStore.getState().controllerSettings.reportInches, true)
assert.equal(useMachineStore.getState().controllerSettings.laserMode, true)
assert.equal(ws.isResponseTrafficQuiescent(0), true)
commandReplies = [busy, busy]
await ws.sendStartupQueries()
await delay(100)
socket.receive('error:8')
assert.equal(ws.isResponseTrafficQuiescent(0), true, 'a refused settings query does not stay pending')
assert.deepEqual(shownLines, [], 'the query and its reply stay out of the terminal')
stopShowing()
useMachineStore.getState().updateControllerSettings({ reportInches: false, laserMode: undefined })
ws.resumeBackgroundTraffic()
await delay(50)

// ── Polling stands aside while the controller auto-reports ───────────────────
const polls = () => socket.sent.filter(item => item === 0x3F).length
const gcQueries = () => socket.sent.filter(item => item === '$G').length
const pollsBefore = polls()
const gcBefore = gcQueries()
for (let i = 0; i < 15; i++) {
  socket.receive(`<Jog|MPos:${i},0,0|FS:500,0>`)
  await delay(100)
}
assert.equal(polls(), pollsBefore, 'no ? while auto-reports arrive')
assert.equal(gcQueries(), gcBefore, 'no $G while auto-reports arrive')
await delay(1100)
assert.ok(polls() > pollsBefore, 'polling resumes once auto-reports stop')

// ── Liveness: a paused page is not judged on silence it could not measure ────
const realNow = Date.now
let clockOffset = 0
Date.now = () => realNow() + clockOffset
const isConnected = () => useMachineStore.getState().connected
clockOffset += 30_000 // the page was frozen for 30 s
await delay(2100)
assert.equal(isConnected(), true, 'the first check after a pause does not drop the link')
socket.receive('<Idle|MPos:0,0,0|FS:0,0>')
clockOffset += 30_000
await delay(2100)
assert.equal(isConnected(), true, 'traffic heard since the last check keeps the link')
clockOffset += 30_000
await delay(2100)
assert.equal(isConnected(), false, 'a second late check with nothing heard drops the link')
Date.now = realNow

ws.disconnect()
console.log('transport tests passed')
