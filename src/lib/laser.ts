import { useMachineStore } from '../store'
import { useGCodeStore } from '../store/gcode'
import { onLine, sendRaw, sendRawNow, sendSilentRaw } from './ws'

/** The pointer switches itself off after this long. */
export const LASER_POINTER_MS = 60_000
export const LASER_POINTER_DEFAULT_PCT = 1
export const LASER_POINTER_MAX_PCT = 10
const LASER_POINTER_PCT_KEY = 'laser.pointerPct'

let pointerEndsAt = 0
let pointerTimer: ReturnType<typeof setTimeout> | undefined
let offPending = false
let panelsMounted = 0
const pointerListeners = new Set<() => void>()

function notifyPointer() {
  pointerListeners.forEach(fn => fn())
}

export function laserPointerEndsAt() {
  return pointerEndsAt
}

export function onLaserPointerChange(fn: () => void): () => void {
  pointerListeners.add(fn)
  return () => { pointerListeners.delete(fn) }
}

export function loadLaserPointerPct() {
  try {
    const value = Number(localStorage.getItem(LASER_POINTER_PCT_KEY))
    if (value > 0 && value <= LASER_POINTER_MAX_PCT) return value
  } catch { /* noop */ }
  return LASER_POINTER_DEFAULT_PCT
}

/**
 * FluidNC lights a laser for M3 S<n> without motion only in G1/G2/G3 mode
 * (after boot it is in G0, where the same M3 leaves the laser dark). G1
 * without axis words does not move, but it needs a feed rate. M3 keeps the
 * power constant, so the dot stays on while jogging.
 */
export function laserPointerCommand(pct: number, spindleMax: number) {
  const power = Number((spindleMax * Math.min(pct, LASER_POINTER_MAX_PCT) / 100).toFixed(3))
  return `G1 F100 M3 S${power}`
}

export function startLaserPointer(pct: number) {
  const machine = useMachineStore.getState()
  const spindleMax = machine.controllerSettings.spindleMax
  if (!spindleMax || !(pct > 0) || pct > LASER_POINTER_MAX_PCT) return false
  if (!machine.connected || machine.status.state !== 'Idle' || machine.controllerResetPending) return false
  if (useGCodeStore.getState().trackedJob || !sendRaw(laserPointerCommand(pct, spindleMax))) return false
  try { localStorage.setItem(LASER_POINTER_PCT_KEY, String(pct)) } catch { /* noop */ }
  offPending = false
  clearTimeout(pointerTimer)
  pointerEndsAt = Date.now() + LASER_POINTER_MS
  pointerTimer = setTimeout(() => stopLaserPointer(), LASER_POINTER_MS)
  notifyPointer()
  return true
}

/**
 * Switch the laser off. Returns true when M5 was sent now rather than queued.
 * `immediate` writes it straight to the socket, for a page that is closing.
 */
export function stopLaserPointer(immediate = false) {
  clearTimeout(pointerTimer)
  pointerTimer = undefined
  pointerEndsAt = 0
  offPending = true
  notifyPointer()
  return flushLaserOff(immediate)
}

/**
 * Call right before a job is started. The pointer leaves M3, G1 and a low S
 * modal, so a program that cuts before its first M3/M4/S would run at pointer
 * power. The M5 is written straight to the socket so it reaches the
 * controller ahead of $SD/Run or the first streamed line.
 */
export function releaseLaserPointerForJob() {
  if (pointerEndsAt || offPending) stopLaserPointer(true)
}

/**
 * G-code is refused during a jog or an alarm, so the M5 waits for Idle; it
 * also waits out a lost link. A program owns the laser once a job starts.
 */
function flushLaserOff(immediate = false) {
  if (!offPending) return false
  if (useGCodeStore.getState().trackedJob) {
    offPending = false
    return false
  }
  const machine = useMachineStore.getState()
  if (!machine.connected || machine.status.state !== 'Idle') return false
  offPending = false
  // G0 puts back the motion mode the pointer changed, so a later M3 without
  // motion leaves the laser dark again.
  const off = 'G0 M5'
  if (immediate ? sendRawNow(off) : sendRaw(off)) return true
  offPending = true
  return false
}

// Hiding or closing the page switches the pointer off. These listeners are
// added on import, so pagehide runs before main.tsx closes the socket, which
// clears the command queue: the M5 has to go out directly.
function stopPointerOnHide(e: Event) {
  if (e.type !== 'pagehide' && document.visibilityState === 'visible') return
  if (pointerEndsAt || offPending) stopLaserPointer(true)
}
// Optional calls: tests and other non-browser hosts have no page to hide.
globalThis.window?.addEventListener?.('pagehide', stopPointerOnHide)
globalThis.document?.addEventListener?.('visibilitychange', stopPointerOnHide)

/** Panels showing the pointer; the last one to go switches it off. */
export function retainLaserPointer(): () => void {
  panelsMounted++
  return () => {
    panelsMounted--
    if (panelsMounted === 0 && pointerEndsAt) stopLaserPointer()
  }
}

// FluidNC's $30 and $32 follow the active spindle, and M6 can switch between
// a laser and a router. Read the settings again once the machine is idle.
let settingsQueryPending = false
const SETTINGS_QUERY_SILENT_RESPONSE = {
  starts: (line: string) => line.startsWith('$') || line.startsWith('error:'),
  consume: (line: string) => line.startsWith('$'),
  done: (line: string) => line === 'ok' || line === 'error' || line.startsWith('error:'),
}

onLine(line => {
  if (/Changed to spindle:/i.test(line)) settingsQueryPending = true
})

useMachineStore.subscribe(machine => {
  if (pointerEndsAt && useGCodeStore.getState().trackedJob) {
    clearTimeout(pointerTimer)
    pointerTimer = undefined
    pointerEndsAt = 0
    notifyPointer()
  }
  flushLaserOff()
  if (settingsQueryPending && machine.connected && machine.status.state === 'Idle' && !useGCodeStore.getState().trackedJob) {
    settingsQueryPending = false
    if (!sendSilentRaw('$$', SETTINGS_QUERY_SILENT_RESPONSE)) settingsQueryPending = true
  }
})
