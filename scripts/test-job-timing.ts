import assert from 'node:assert/strict'
import { parseGCode } from '../src/lib/gcode'
import { buildJobTimingEstimate } from '../src/lib/jobRuntime'
import type { ControllerSettings } from '../src/types'

const settings = { maxRateX: 3000, maxRateY: 3000, maxRateZ: 1000, accelX: 200, accelY: 200, accelZ: 100 } as ControllerSettings

{
  // FluidNC syncs the planner on every M4/M5, even in laser mode with no
  // spin-up delay, so the same path is slower with the laser switched per move.
  const moves: string[] = []
  const switched: string[] = []
  for (let i = 0; i < 20; i++) {
    const move = `G1 X${(i + 1) * 2} Y0 F3000`
    moves.push(move)
    switched.push('M4 S500', move, 'M5')
  }
  const steady = buildJobTimingEstimate(parseGCode(['G21 G90', 'M4 S500', ...moves, 'M5'].join('\n')), settings)
  const stopped = buildJobTimingEstimate(parseGCode(['G21 G90', ...switched].join('\n')), settings)
  assert.ok(steady && stopped)
  // 40 mm at 50 mm/s with 200 mm/s2: one ramp up and down for the steady path,
  // twenty for the switched one (each 2 mm move peaks near 20 mm/s).
  assert.ok(stopped.totalSeconds > steady.totalSeconds * 1.5, `${stopped.totalSeconds} vs ${steady.totalSeconds}`)
  near(stopped.totalSeconds, 20 * 2 * Math.sqrt(2 * 1 / 200), 'every switched move starts and ends at rest')
}

function near(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`)
}

console.log('Job timing tests passed')
