import assert from 'node:assert/strict'
import { parseGcStateLine, parseStatusReport } from '../src/lib/parser'

const parse = (line: string) => {
  const status = parseStatusReport(line)
  assert.ok(status, `${line} must parse`)
  return status
}

// FluidNC reports Idle whenever the motion queue drains during a file job
// (every laser M5/M3 pair). SD: stays in the report until the file ends, so
// the job must stay Run or the UI ends it and plays the end sound mid-job.
let s = parse('<Idle|MPos:1,2,0|FS:0,0|SD:45.20,/sd/F-Cu-Lazer.nc>')
assert.equal(s.state, 'Run')
assert.equal(s.sdPercent, 45.2)
assert.equal(s.sdFilename, '/sd/F-Cu-Lazer.nc')
assert.deepEqual([s.mpos?.x, s.mpos?.y, s.mpos?.z], [1, 2, 0])

// Without SD: the file job has ended and the progress fields are cleared.
s = parse('<Idle|MPos:1,2,0|FS:0,0>')
assert.equal(s.state, 'Idle')
assert.equal(s.sdPercent, undefined)
assert.equal(s.sdFilename, undefined)
// The keys must be present so the store merge clears the old values.
assert.ok('sdPercent' in s && 'sdFilename' in s)

// Other states are kept as reported; a comma in the file name survives.
s = parse('<Hold:0|WPos:0,0,0|FS:0,0|SD:45.2,/sd/a,b.nc>')
assert.equal(s.state, 'Hold')
assert.equal(s.sdFilename, '/sd/a,b.nc')

// Feed, spindle, overrides and the planner line number.
s = parse('<Run|MPos:0,0,0|FS:1500,800|Ov:100,50,120|Ln:42>')
assert.equal(s.feed, 1500)
assert.equal(s.spindle, 800)
assert.deepEqual([s.feedOverride, s.rapidOverride, s.spindleOverride], [100, 50, 120])
assert.equal(s.plannerLineNumber, 42)
const noLn = parse('<Run|MPos:0,0,0|FS:0,0>')
assert.ok('plannerLineNumber' in noLn)
assert.equal(noLn.plannerLineNumber, undefined)

// Alarm code comes from the state field and is cleared outside Alarm.
assert.equal(parse('<Alarm:1|MPos:0,0,0|FS:0,0>').alarmCode, 1)
assert.ok('alarmCode' in parse('<Idle|MPos:0,0,0|FS:0,0>'))
assert.equal(parse('<Idle|MPos:0,0,0|FS:0,0>').alarmCode, undefined)

// Pn: is only sent while a pin is active, so its absence clears the pins.
assert.equal(parse('<Idle|MPos:0,0,0|FS:0,0|Pn:P>').pinState, 'P')
assert.equal(parse('<Idle|MPos:0,0,0|FS:0,0>').pinState, '')

// Inch reports are converted to mm.
s = parseStatusReport('<Idle|MPos:1,0,0|FS:10,0>', { reportInches: true })!
assert.equal(s.mpos?.x, 25.4)
assert.equal(s.feed, 254)

assert.equal(parseStatusReport('Idle|MPos:0,0,0'), null)

// [GC:] modal state.
const gc = parseGcStateLine('[GC:G1 G54 G17 G21 G90 G94 M4 M9 T0 F1200 S300]')!
assert.equal(gc.gcodeModes?.spindle, 'M4')
assert.equal(gc.spindleRunning, true)
assert.equal(gc.spindle, 300)
assert.equal(gc.gcodeModes?.feed, 1200)
assert.equal(parseGcStateLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]')!.spindleRunning, false)

console.log('status parser tests passed')
