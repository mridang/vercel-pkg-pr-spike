import { describe, expect, test } from 'vitest'
import {
  collectPackages,
  renderLanding,
  ROBOTS_TXT,
  type PackageRow,
} from './landing.js'
import type { BlobEntry } from './storage.js'

const blob = (overrides: Partial<BlobEntry>): BlobEntry => ({
  key: '@mridang/foo/-/mridang-foo-0.0.0-sha-abc1234.tgz',
  url: 'https://example.test/-/blob/foo',
  size: 1024,
  uploadedAt: new Date('2026-06-24T00:00:00Z'),
  ...overrides,
})

describe('collectPackages', () => {
  test('parses scope, name, version, and size from each tarball blob', () => {
    const rows = collectPackages([
      blob({
        key: '@mridang/foo/-/mridang-foo-0.0.0-sha-abc1234.tgz',
        size: 708,
      }),
    ])
    expect(rows).toEqual<readonly PackageRow[]>([
      { name: '@mridang/foo', version: '0.0.0-sha-abc1234', sizeBytes: 708 },
    ])
  })

  test('sorts the result alphabetically by package name', () => {
    const rows = collectPackages([
      blob({
        key: '@mridang/zoo/-/mridang-zoo-0.0.0-sha-x.tgz',
      }),
      blob({
        key: '@mridang/apple/-/mridang-apple-0.0.0-sha-x.tgz',
      }),
      blob({
        key: '@mridang/middle/-/mridang-middle-0.0.0-sha-x.tgz',
      }),
    ])
    expect(rows.map((row) => row.name)).toEqual([
      '@mridang/apple',
      '@mridang/middle',
      '@mridang/zoo',
    ])
  })

  test('deduplicates by package name (first blob wins)', () => {
    const rows = collectPackages([
      blob({
        key: '@mridang/foo/-/mridang-foo-0.0.0-sha-aaaaaaa.tgz',
        size: 100,
      }),
      blob({
        key: '@mridang/foo/-/mridang-foo-0.0.0-sha-bbbbbbb.tgz',
        size: 200,
      }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.version).toBe('0.0.0-sha-aaaaaaa')
  })

  test('ignores blobs that do not match the expected tarball shape', () => {
    const rows = collectPackages([
      blob({ key: 'not-a-package.txt' }),
      blob({ key: '@mridang/foo/-/garbage' }),
      blob({
        key: '@mridang/foo/-/mridang-foo-0.0.0-sha-ok.tgz',
      }),
    ])
    expect(rows.map((row) => row.name)).toEqual(['@mridang/foo'])
  })

  test('returns an empty list when no blobs match', () => {
    expect(collectPackages([])).toEqual([])
  })

  test('falls back to "unknown" when the filename does not carry a version', () => {
    const rows = collectPackages([
      blob({ key: '@mridang/foo/-/totally-unrelated.tgz' }),
    ])
    expect(rows[0]?.version).toBe('unknown')
  })
})

describe('renderLanding', () => {
  const samplePackages: readonly PackageRow[] = [
    { name: '@mridang/foo', version: '0.0.0-sha-abc', sizeBytes: 800 },
    { name: '@mridang/bar', version: '0.0.0-sha-abc', sizeBytes: 1024 },
  ]

  test('embeds the deploy origin and branch into the HTML output', () => {
    const html = renderLanding(
      samplePackages,
      'https://my-deploy.vercel.app',
      'feat/example',
    )
    expect(html).toContain('https://my-deploy.vercel.app')
    expect(html).toContain('feat/example')
  })

  test('emits noindex / nofollow robot directives', () => {
    const html = renderLanding(
      samplePackages,
      'https://my-deploy.vercel.app',
      'main',
    )
    expect(html).toMatch(/<meta name="robots"[^>]*noindex/i)
    expect(html).toMatch(/<meta name="robots"[^>]*nofollow/i)
    expect(html).toMatch(/<meta name="googlebot"[^>]*noindex/i)
  })

  test('renders each package row with its version and size', () => {
    const html = renderLanding(
      samplePackages,
      'https://my-deploy.vercel.app',
      'main',
    )
    expect(html).toContain('@mridang/foo')
    expect(html).toContain('@mridang/bar')
    expect(html).toContain('0.0.0-sha-abc')
    expect(html).toContain('1.0 KB')
  })

  test('builds the install command from the package list', () => {
    const html = renderLanding(
      samplePackages,
      'https://x.test',
      'main',
    )
    expect(html).toContain(
      'npm install @mridang/foo@0.0.0-sha-abc @mridang/bar@0.0.0-sha-abc --registry=https://x.test',
    )
  })

  test('uses a placeholder example install command when no packages exist', () => {
    const html = renderLanding([], 'https://x.test', 'main')
    expect(html).toContain('npm install @mridang/foo --registry=https://x.test')
    expect(html).toContain('No snapshots in this deploy yet.')
  })

  test('escapes HTML-special characters in branch names so injection is impossible', () => {
    const html = renderLanding(
      samplePackages,
      'https://x.test',
      '<script>alert(1)</script>',
    )
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('ROBOTS_TXT', () => {
  test('disallows every user agent', () => {
    expect(ROBOTS_TXT).toContain('User-agent: *')
    expect(ROBOTS_TXT).toContain('Disallow: /')
  })
})
