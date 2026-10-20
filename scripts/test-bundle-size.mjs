import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { compareBundleSizes, DEFAULT_LIMITS } from './check-bundle-size.mjs'

test('unchanged and smaller bundles do not trigger growth warnings', () => {
  assert.deepEqual(compareBundleSizes(147849, 147849).warnings, [])
  assert.deepEqual(compareBundleSizes(147849, 140000).warnings, [])
})

test('growth warns only above 3 KiB, regardless of its percentage', () => {
  assert.equal(compareBundleSizes(150000, 153073).warnings.length, 1)
  assert.equal(compareBundleSizes(150000, 153072).warnings.length, 0)
  assert.equal(compareBundleSizes(150000, 152000).warnings.length, 0)
  assert.equal(compareBundleSizes(10000, 12000).warnings.length, 0)
})

test('the total budget warns even when an already oversized bundle shrinks', () => {
  const result = compareBundleSizes(200000, 190000)
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /exceeds.*budget/)
  assert.deepEqual(
    compareBundleSizes(DEFAULT_LIMITS.maxBytes, DEFAULT_LIMITS.maxBytes)
      .warnings,
    [],
  )
})

test('the measured PR examples trigger warnings with exact deltas', () => {
  const pr58 = compareBundleSizes(147849, 152156)
  const pr65 = compareBundleSizes(147849, 160340)
  assert.equal(pr58.delta, 4307)
  assert.equal(pr65.delta, 12491)
  assert.equal(pr58.warnings.length, 1)
  assert.equal(pr65.warnings.length, 1)
})

test('empty bundles and invalid thresholds fail rather than reporting success', () => {
  assert.throws(() => compareBundleSizes(0, 100), /positive integer/)
  assert.throws(() => compareBundleSizes(100, 0), /positive integer/)
  assert.throws(
    () => compareBundleSizes(100, 101, { ...DEFAULT_LIMITS, warnBytes: NaN }),
    /non-negative/,
  )
})

test('CLI writes a summary, warns by default, and fails only when configured', () => {
  const directory = mkdtempSync(join(tmpdir(), 'figui-bundle-size-'))
  try {
    const base = join(directory, 'base.gz')
    const pr = join(directory, 'pr.gz')
    const summary = join(directory, 'summary.md')
    writeFileSync(base, Buffer.alloc(147849))
    writeFileSync(pr, Buffer.alloc(152156))
    const script = fileURLToPath(
      new URL('./check-bundle-size.mjs', import.meta.url),
    )
    const env = {
      ...process.env,
      GITHUB_STEP_SUMMARY: summary,
      BUNDLE_WARN_BYTES: '3072',
      BUNDLE_MAX_BYTES: '182272',
      BUNDLE_FAIL_ON_WARNING: 'false',
    }
    const run = (overrides) =>
      spawnSync(process.execPath, [script, base, pr], {
        encoding: 'utf8',
        env: { ...env, ...overrides },
      })
    const advisory = run({})
    assert.equal(advisory.status, 0, advisory.stderr)
    assert.match(advisory.stdout, /::warning title=ESP32 bundle size::/)
    assert.match(readFileSync(summary, 'utf8'), /\+4307 bytes/)
    const strict = run({ BUNDLE_FAIL_ON_WARNING: 'true' })
    assert.equal(strict.status, 1)
    assert.match(strict.stdout, /::error title=ESP32 bundle size::/)
    for (const value of [undefined, '', ' \t ']) {
      const defaults = run({ BUNDLE_WARN_BYTES: value, BUNDLE_MAX_BYTES: value })
      assert.equal(defaults.status, 0, defaults.stderr)
      assert.match(defaults.stdout, /growth warning threshold is 3072 bytes/)
      assert.match(defaults.stdout, /Build budget \| 182272 bytes/)
      assert.doesNotMatch(defaults.stdout, /exceeds.*budget/)
    }
    const custom = run({ BUNDLE_WARN_BYTES: '5000', BUNDLE_MAX_BYTES: '160000' })
    assert.equal(custom.status, 0, custom.stderr)
    assert.match(custom.stdout, /Build budget \| 160000 bytes/)
    assert.doesNotMatch(custom.stdout, /::warning/)
    assert.equal(run({ BUNDLE_WARN_BYTES: 'invalid' }).status, 1)
    assert.equal(run({ BUNDLE_FAIL_ON_WARNING: 'invalid' }).status, 1)
    rmSync(pr)
    assert.equal(run({}).status, 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
