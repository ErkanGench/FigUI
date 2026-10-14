import type { GCodeModel, Segment, SegmentTable } from './gcode'
import { clamp01, getArcGeometry, getArcPoint, normalizeAngle } from './gcodeBuild'

/*
 * Execution-line tracking: where on the loaded toolpath the live machine
 * position is. The viewer's completed path, Follow and the line offered for
 * Restart-from-line after a reset all come from here.
 */

export interface ToolpathProgress {
  segmentIndex: number
  fraction: number
  misses?: number
}

const INITIAL_LOCK_TOLERANCE_MM = 0.25
const FOLLOW_TOLERANCE_MM = 0.2
const ENDPOINT_TOLERANCE_MM = 0.2
const SEGMENT_LOOKAHEAD = 12
const LOOKAHEAD_MAX_SEGMENTS = 4000
/** Consecutive missed reports before the tracker searches the whole job again. */
const PROGRESS_RELOCK_MISSES = 4
/** Matches this close to the file-progress hint count as equally likely. */
const PROGRESS_HINT_SLACK_SEGMENTS = 300

function measureProgressAlongSegment(seg: Segment, px: number, py: number, pz: number) {
  if (seg.i === undefined) {
    const dx = seg.x1 - seg.x0
    const dy = seg.y1 - seg.y0
    const lenSq = dx * dx + dy * dy
    if (lenSq < 1e-9) {
      const distSq = (px - seg.x0) ** 2 + (py - seg.y0) ** 2 + (pz - seg.z0) ** 2
      return { fraction: 0, distanceSq: distSq }
    }
    const rawFraction = ((px - seg.x0) * dx + (py - seg.y0) * dy) / lenSq
    const fraction = clamp01(rawFraction)
    const projX = seg.x0 + dx * fraction
    const projY = seg.y0 + dy * fraction
    const projZ = seg.z0 + (seg.z1 - seg.z0) * fraction
    const distanceSq = (px - projX) ** 2 + (py - projY) ** 2 + (pz - projZ) ** 2
    return { fraction, distanceSq }
  }

  const arc = getArcGeometry(seg)
  if (arc.r < 1e-9) {
    const distSq = (px - seg.x0) ** 2 + (py - seg.y0) ** 2 + (pz - seg.z0) ** 2
    return { fraction: 0, distanceSq: distSq }
  }

  // The live position in the arc's plane, in getArcGeometry's axis order.
  const pu = seg.arcPlane === 18 ? pz : seg.arcPlane === 19 ? py : px
  const pv = seg.arcPlane === 18 ? px : seg.arcPlane === 19 ? pz : py
  const pointAngle = Math.atan2(pv - arc.cy, pu - arc.cx)
  const delta = seg.cw
    ? normalizeAngle(arc.startAngle - pointAngle)
    : normalizeAngle(pointAngle - arc.startAngle)

  if (arc.fullCircle || delta <= arc.sweep + 1e-6) {
    const fraction = clamp01(delta / arc.sweep)
    const projected = getArcPoint(seg, arc, fraction)
    const distanceSq = (px - projected.x) ** 2 + (py - projected.y) ** 2 + (pz - projected.z) ** 2
    return { fraction, distanceSq }
  }

  const startDistSq = (px - seg.x0) ** 2 + (py - seg.y0) ** 2 + (pz - seg.z0) ** 2
  const endDistSq = (px - seg.x1) ** 2 + (py - seg.y1) ** 2 + (pz - seg.z1) ** 2
  return startDistSq <= endDistSq
    ? { fraction: 0, distanceSq: startDistSq }
    : { fraction: 1, distanceSq: endDistSq }
}

function compareProgress(a: ToolpathProgress, b: ToolpathProgress) {
  if (a.segmentIndex !== b.segmentIndex) return a.segmentIndex - b.segmentIndex
  return a.fraction - b.fraction
}

function pointDistanceSq(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  return (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2
}

/** Reused result of measureProgressAt; read it before the next call. */
const lineProgressMeasurement = { fraction: 0, distanceSq: 0 }

/**
 * Same as measureProgressAlongSegment for one move of the table, without
 * building the move object for straight lines, so a whole large job can be
 * searched quickly.
 */
function measureProgressAt(segments: SegmentTable, index: number, px: number, py: number, pz: number) {
  if (segments.isArc(index)) return measureProgressAlongSegment(segments.get(index), px, py, pz)
  const x0 = segments.px[index], y0 = segments.py[index], z0 = segments.pz[index]
  const dx = segments.px[index + 1] - x0
  const dy = segments.py[index + 1] - y0
  const dz = segments.pz[index + 1] - z0
  const lenSq = dx * dx + dy * dy
  const fraction = lenSq < 1e-9 ? 0 : clamp01(((px - x0) * dx + (py - y0) * dy) / lenSq)
  const ex = px - (x0 + dx * fraction)
  const ey = py - (y0 + dy * fraction)
  const ez = pz - (z0 + dz * fraction)
  lineProgressMeasurement.fraction = fraction
  lineProgressMeasurement.distanceSq = ex * ex + ey * ey + ez * ez
  return lineProgressMeasurement
}

function findNearbyProgress(
  segments: SegmentTable,
  px: number,
  py: number,
  pz: number,
  startIndex: number,
  endIndex: number,
  toleranceSq: number,
  previous: ToolpathProgress | null,
  preferLatest: boolean,
  /** Segment the job is roughly at; matches far from it lose to nearer ones. */
  hintIndex: number | null = null,
): ToolpathProgress | null {
  let best: (ToolpathProgress & { distanceSq: number }) | null = null
  const hintDistance = (index: number) => hintIndex == null ? 0 : Math.max(0, Math.abs(index - hintIndex) - PROGRESS_HINT_SLACK_SEGMENTS)

  for (let i = startIndex; i <= endIndex && i < segments.length; i++) {
    const measurement = measureProgressAt(segments, i, px, py, pz)
    if (measurement.distanceSq > toleranceSq) continue

    const candidate: ToolpathProgress & { distanceSq: number } = {
      segmentIndex: i,
      fraction: measurement.fraction,
      distanceSq: measurement.distanceSq,
    }

    if (previous && i === previous.segmentIndex && candidate.fraction < previous.fraction) {
      candidate.fraction = previous.fraction
    }

    const hintGain = best ? hintDistance(best.segmentIndex) - hintDistance(i) : 0
    if (hintGain < 0) continue

    if (
      !best
      || hintGain > 0
      || (preferLatest && (
        compareProgress(candidate, best) > 0
        || (compareProgress(candidate, best) === 0 && candidate.distanceSq < best.distanceSq)
      ))
      || (!preferLatest && (
        candidate.distanceSq < best.distanceSq - 1e-9
        || (Math.abs(candidate.distanceSq - best.distanceSq) <= 1e-9
          && compareProgress(candidate, best) < 0)
      ))
    ) {
      best = candidate
    }
  }

  return best ? { segmentIndex: best.segmentIndex, fraction: best.fraction } : null
}

export function segmentXYLength(seg: Segment) {
  if (seg.i !== undefined) {
    const arc = getArcGeometry(seg)
    const linear = seg.arcPlane === 18 ? seg.y1 - seg.y0 : seg.arcPlane === 19 ? seg.x1 - seg.x0 : seg.z1 - seg.z0
    return Math.hypot(arc.sweep * arc.r, linear)
  }
  return Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0, seg.z1 - seg.z0)
}

export function buildCumulativeXYLengths(segments: SegmentTable) {
  const cumulative = new Float64Array(segments.length + 1)
  for (let i = 0; i < segments.length; i++) {
    const length = segments.isArc(i)
      ? segmentXYLength(segments.get(i))
      : Math.hypot(
          segments.px[i + 1] - segments.px[i],
          segments.py[i + 1] - segments.py[i],
          segments.pz[i + 1] - segments.pz[i],
        )
    cumulative[i + 1] = cumulative[i] + length
  }
  return cumulative
}

export function findToolpathProgress(
  segments: SegmentTable,
  cumulativeXYLengths: Float64Array,
  px: number,
  py: number,
  pz: number,
  previous: ToolpathProgress | null,
  lookaheadDistanceMm: number,
  maxSegmentIndex = segments.length - 1,
  hintIndex: number | null = null,
): ToolpathProgress | null {
  const allowedEndIndex = Math.min(maxSegmentIndex, segments.length - 1)
  if (segments.length === 0 || allowedEndIndex < 0) return null

  const lockAnywhere = (hint: number | null) => findNearbyProgress(
    segments,
    px,
    py,
    pz,
    0,
    allowedEndIndex,
    INITIAL_LOCK_TOLERANCE_MM ** 2,
    null,
    false,
    hint,
  )

  if (!previous) return lockAnywhere(hintIndex)

  // Lost for several reports (for example the preview was opened mid-job):
  // search the whole job again rather than only just ahead of a stale position.
  // Without a job position hint, prefer matches near where the tool was last
  // seen, so a repeated pass does not fall back to an earlier one.
  if ((previous.misses ?? 0) >= PROGRESS_RELOCK_MISSES) {
    const relocked = lockAnywhere(hintIndex ?? previous.segmentIndex)
    if (relocked) return { ...relocked, misses: 0 }
  }

  const startIndex = previous.segmentIndex
  const maxEndIndex = Math.min(startIndex + LOOKAHEAD_MAX_SEGMENTS, allowedEndIndex)
  const nearEndIndex = Math.min(startIndex + SEGMENT_LOOKAHEAD, allowedEndIndex)

  const near = findNearbyProgress(
    segments,
    px,
    py,
    pz,
    startIndex,
    nearEndIndex,
    FOLLOW_TOLERANCE_MM ** 2,
    previous,
    false,
  )
  if (near) return { ...near, misses: 0 }

  const priorMisses = previous.misses ?? 0
  const distanceLimit = cumulativeXYLengths[startIndex] + lookaheadDistanceMm * (priorMisses + 1)
  let farEndIndex = nearEndIndex
  while (farEndIndex < maxEndIndex && cumulativeXYLengths[farEndIndex + 1] < distanceLimit) farEndIndex++

  if (farEndIndex > nearEndIndex) {
    const far = findNearbyProgress(
      segments,
      px,
      py,
      pz,
      nearEndIndex + 1,
      farEndIndex,
      FOLLOW_TOLERANCE_MM ** 2,
      previous,
      false,
    )
    if (far) return { ...far, misses: 0 }
  }

  const current = segments.get(startIndex)
  if (pointDistanceSq(px, py, pz, current.x1, current.y1, current.z1) <= ENDPOINT_TOLERANCE_MM ** 2) {
    return { segmentIndex: startIndex, fraction: 1, misses: 0 }
  }

  return { ...previous, misses: priorMisses + 1 }
}

/**
 * Whether the SD file FluidNC reports running is the file loaded in the
 * viewer. A job started from another device may run a different one.
 */
export function isRunningLoadedFile(sdFilename: string, loadedPath: string | null, fileName: string | null) {
  const baseName = (path: string) => path.slice(path.replace(/\\/g, '/').lastIndexOf('/') + 1).toLowerCase()
  const running = baseName(sdFilename)
  return (!!fileName && fileName.toLowerCase() === running) || (!!loadedPath && baseName(loadedPath) === running)
}

/** The path to load the file a status report names. FluidNC reports it with its /sd or /localfs mount. */
export function runningFilePath(sdFilename: string) {
  const path = sdFilename.replace(/\\/g, '/')
  return /^\/(sd|localfs)\//i.test(path) ? path : `/sd/${path.replace(/^\/+/, '')}`
}

/**
 * Z to compare the live position against. A program that never moves Z (a
 * laser focused by hand) says nothing about where the machine's Z is, so it
 * is tracked in XY only.
 */
export function getTrackingZ(model: GCodeModel, machineZ: number) {
  return model.bounds.minZ === model.bounds.maxZ ? model.bounds.minZ : machineZ
}

/** Offset of every line in `text`. */
export function buildLineStarts(text: string) {
  let count = 1
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) count++
  const starts = new Uint32Array(count)
  let line = 1
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) starts[line++] = index + 1
  return starts
}

export function findLastSegmentAtOrBeforeSourceLine(segments: SegmentTable, sourceLine: number) {
  let low = 0
  let high = segments.length - 1
  let result = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (segments.sourceLine(middle) <= sourceLine) {
      result = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return result
}

/**
 * The last move at or before the line holding character `offset` of the
 * program text, or -1. FluidNC's SD percent (of bytes read) gives the offset.
 */
export function findSegmentAtTextOffset(segments: SegmentTable, lineStarts: Uint32Array, offset: number) {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (lineStarts[middle] <= offset) low = middle
    else high = middle - 1
  }
  return findLastSegmentAtOrBeforeSourceLine(segments, low + 1)
}
