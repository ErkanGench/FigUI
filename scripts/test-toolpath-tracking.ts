import assert from 'node:assert/strict'
import { parseGCode } from '../src/lib/gcode'
import {
  buildCumulativeXYLengths,
  buildLineStarts,
  findLastSegmentAtOrBeforeSourceLine,
  findSegmentAtTextOffset,
  findToolpathProgress,
  getTrackingZ,
  isRunningLoadedFile,
} from '../src/lib/toolpathTracking'

// Two identical passes of 400 short moves along Y=0, the way a repeated
// isolation or mask pass looks to the tracker.
function pass() {
  const lines: string[] = []
  for (let step = 1; step <= 400; step++) lines.push(`G1 X${(step / 10).toFixed(1)} Y0`)
  return lines
}
const text = [
  'G21 G90',
  'G0 X0 Y0',
  'M4 S500',
  'G1 F1000',
  ...pass(),
  'G1 Y5',
  'G1 X0',
  'G1 Y0',
  ...pass(),
  'M5',
].join('\n')
const model = parseGCode(text)
const { segments } = model
const cumulative = buildCumulativeXYLengths(segments)
const secondPassFirstLine = 5 + 400 + 3
const lastFirstPassSegment = findLastSegmentAtOrBeforeSourceLine(segments, 4 + 400)
const firstSecondPassSegment = findLastSegmentAtOrBeforeSourceLine(segments, secondPassFirstLine)
assert.equal(segments.sourceLine(lastFirstPassSegment), 404)
assert.equal(segments.sourceLine(firstSecondPassSegment), secondPassFirstLine)
const onFirstPass = (index: number) => index <= lastFirstPassSegment
const onSecondPass = (index: number) => index >= firstSecondPassSegment

{
  // A program that never moves Z is tracked in XY only, wherever Z was focused.
  assert.equal(model.bounds.minZ, model.bounds.maxZ)
  assert.equal(getTrackingZ(model, 15), 0)
  assert.equal(findToolpathProgress(segments, cumulative, 20.05, 0, 15, null, 1), null)
  const progress = findToolpathProgress(segments, cumulative, 20.05, 0, getTrackingZ(model, 15), null, 1)
  assert.ok(progress && onFirstPass(progress.segmentIndex), JSON.stringify(progress))
}

{
  // The SD read position tells the two passes apart on a fresh lock.
  const secondPassOffset = buildLineStarts(text)[secondPassFirstLine + 200 - 1]
  const hint = findSegmentAtTextOffset(segments, buildLineStarts(text), secondPassOffset)
  assert.equal(segments.sourceLine(hint), secondPassFirstLine + 200)
  const unhinted = findToolpathProgress(segments, cumulative, 20.05, 0, 0, null, 1)
  assert.ok(unhinted && onFirstPass(unhinted.segmentIndex), JSON.stringify(unhinted))
  const progress = findToolpathProgress(segments, cumulative, 20.05, 0, 0, null, 1, segments.length - 1, hint)
  assert.ok(progress && onSecondPass(progress.segmentIndex), JSON.stringify(progress))
}

{
  // Lost on the second pass: the relock stays on that pass, not the first.
  // The lookahead is too short for the ordinary search to reach the point.
  const previous = { segmentIndex: firstSecondPassSegment + 150, fraction: 0, misses: 4 }
  const progress = findToolpathProgress(segments, cumulative, 20.05, 0, 0, previous, 0.01)
  assert.ok(progress && onSecondPass(progress.segmentIndex) && progress.misses === 0, JSON.stringify(progress))
}

{
  // A local stream never tracks past the last line the controller accepted:
  // the connector just after the first pass is out of reach until it is accepted.
  const uncapped = findToolpathProgress(segments, cumulative, 40, 2.5, 0, null, 1)
  assert.ok(uncapped && uncapped.segmentIndex > lastFirstPassSegment, JSON.stringify(uncapped))
  assert.equal(findToolpathProgress(
    segments, cumulative, 40, 2.5, 0, null, 1, lastFirstPassSegment, lastFirstPassSegment,
  ), null)
  const progress = findToolpathProgress(
    segments, cumulative, 20.05, 0, 0, null, 1, lastFirstPassSegment, lastFirstPassSegment,
  )
  assert.ok(progress && onFirstPass(progress.segmentIndex), JSON.stringify(progress))
}

{
  // A restart line on a comment or blank line maps to the move before it.
  const commented = parseGCode(['G21 G90', 'G1 X1 F100', '; comment', '(another)', 'G1 X2', '', 'G1 X3'].join('\n')).segments
  const lineAt = (sourceLine: number) => commented.sourceLine(findLastSegmentAtOrBeforeSourceLine(commented, sourceLine))
  assert.equal(lineAt(3), 2)
  assert.equal(lineAt(4), 2)
  assert.equal(lineAt(6), 5)
  assert.equal(findLastSegmentAtOrBeforeSourceLine(commented, 1), -1)
}

{
  // Following moves forward along the pass and counts misses when off the path.
  const start = findToolpathProgress(segments, cumulative, 1.05, 0, 0, null, 1)!
  const next = findToolpathProgress(segments, cumulative, 1.55, 0, 0, start, 1)!
  assert.ok(next.segmentIndex > start.segmentIndex && next.misses === 0, JSON.stringify(next))
  const off = findToolpathProgress(segments, cumulative, 1.55, 3, 0, next, 1)!
  assert.equal(off.segmentIndex, next.segmentIndex)
  assert.equal(off.misses, 1)
}

{
  // Only the file FluidNC reports running is tracked on the loaded preview.
  assert.equal(isRunningLoadedFile('/sd/F-Cu-Lazer.nc', '/sd/F-Cu-Lazer.nc', 'F-Cu-Lazer.nc'), true)
  assert.equal(isRunningLoadedFile('/sd/f-cu-lazer.nc', null, 'F-Cu-Lazer.nc'), true)
  assert.equal(isRunningLoadedFile('/sd/jobs/Maske.nc', 'jobs\\Maske.nc', null), true)
  assert.equal(isRunningLoadedFile('/sd/Maske-Lazer.nc', '/sd/F-Cu-Lazer.nc', 'F-Cu-Lazer.nc'), false)
  assert.equal(isRunningLoadedFile('/sd/Maske-Lazer.nc', null, null), false)
}

console.log('Toolpath tracking tests passed')
