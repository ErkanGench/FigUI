import { appendFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_LIMITS = {
  warnBytes: 3 * 1024,
  maxBytes: 178 * 1024,
}

export function compareBundleSizes(
  baseBytes,
  prBytes,
  limits = DEFAULT_LIMITS,
) {
  for (const [name, value] of Object.entries({ baseBytes, prBytes })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(
        `${name} must be a positive integer; the bundle may be missing or empty.`,
      )
    }
  }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative number.`)
    }
  }

  const delta = prBytes - baseBytes
  const percent = (delta / baseBytes) * 100
  const warnings = []
  if (delta > limits.warnBytes) {
    warnings.push(
      `Bundle grew by ${delta} bytes (${percent.toFixed(2)}%). Review the added storage cost; the growth warning threshold is ${limits.warnBytes} bytes.`,
    )
  }
  if (prBytes > limits.maxBytes) {
    warnings.push(
      `Bundle exceeds the ${limits.maxBytes}-byte budget by ${prBytes - limits.maxBytes} bytes. Leave storage for macros, configuration files, and future features.`,
    )
  }
  return {
    baseBytes,
    prBytes,
    delta,
    percent,
    warnings,
    maxBytes: limits.maxBytes,
  }
}

const size = (bytes) => `${bytes} bytes (${(bytes / 1024).toFixed(2)} KiB)`
const signed = (value) => `${value > 0 ? '+' : ''}${value}`

export function formatReport(result, failOnWarning) {
  const { baseBytes, prBytes, delta, percent, warnings, maxBytes } = result
  return [
    '## ESP32 bundle size',
    '',
    'Measured final `dist/index.html.gz` artifacts after the complete ESP32 build pipeline.',
    '',
    '| Measurement | Size |',
    '| --- | ---: |',
    `| Target branch | ${size(baseBytes)} |`,
    `| PR merged with target | ${size(prBytes)} |`,
    `| Change | ${signed(delta)} bytes (${signed(percent.toFixed(2))}%) |`,
    `| Build budget | ${size(maxBytes)} |`,
    `| Remaining budget | ${size(maxBytes - prBytes)} |`,
    '',
    ...(warnings.length
      ? warnings.map((warning) => `- **Warning:** ${warning}`)
      : ['No size warning thresholds exceeded.']),
    '',
    failOnWarning
      ? 'Size warnings fail this check.'
      : 'Size warnings are advisory; they do not fail this check.',
    'The build budget is a warning threshold, not a target to fill or a measurement of the device partition.',
    '',
  ].join('\n')
}

function main() {
  const [basePath, prPath, ...extra] = process.argv.slice(2)
  if (!basePath || !prPath || extra.length) {
    throw new Error(
      'Usage: node scripts/check-bundle-size.mjs <base.html.gz> <pr.html.gz>',
    )
  }
  const limits = Object.fromEntries(
    [
      ['warnBytes', 'BUNDLE_WARN_BYTES'],
      ['maxBytes', 'BUNDLE_MAX_BYTES'],
    ].map(([key, env]) => [
      key,
      !process.env[env]?.trim()
        ? DEFAULT_LIMITS[key]
        : Number(process.env[env]),
    ]),
  )
  const mode = process.env.BUNDLE_FAIL_ON_WARNING ?? 'false'
  if (mode !== 'true' && mode !== 'false')
    throw new Error('BUNDLE_FAIL_ON_WARNING must be "true" or "false".')
  const failOnWarning = mode === 'true'
  const result = compareBundleSizes(
    statSync(basePath).size,
    statSync(prPath).size,
    limits,
  )
  const report = formatReport(result, failOnWarning)
  console.log(report)
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report)
  for (const warning of result.warnings) {
    console.log(
      `::${failOnWarning ? 'error' : 'warning'} title=ESP32 bundle size::${warning}`,
    )
  }
  if (failOnWarning && result.warnings.length) process.exitCode = 1
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main()
  } catch (error) {
    console.error(
      `::error title=ESP32 bundle size::${String(error.message).replace(/[%\r\n]/g, (character) => ({ '%': '%25', '\r': '%0D', '\n': '%0A' })[character])}`,
    )
    process.exitCode = 1
  }
}
