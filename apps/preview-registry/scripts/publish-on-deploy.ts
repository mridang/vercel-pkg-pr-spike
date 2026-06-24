// Runs as part of the Vercel build for this app. Packs every workspace
// package, stamps each with a snapshot version (0.0.0-sha-<sha>), and
// uploads the tarballs to Vercel Blob using the BLOB_READ_WRITE_TOKEN
// that Vercel auto-injects when a Blob store is connected to the project.
//
// No GitHub secret, no CI workflow — every Vercel deploy republishes its
// own preview-scoped snapshots.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { put } from '@vercel/blob'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPO = resolve(APP_ROOT, '..', '..')

const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'localdev'
const rawBranch = process.env.VERCEL_GIT_COMMIT_REF ?? 'main'
const branch = rawBranch.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
const snapshotVersion = `0.0.0-sha-${sha}`

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN missing — connect a Blob store to this Vercel project')
  process.exit(1)
}

const packageDirs = readdirSync(join(REPO, 'packages'))
  .map((p) => `packages/${p}`)
  .filter((p) => {
    try {
      return readdirSync(join(REPO, p)).includes('package.json')
    } catch {
      return false
    }
  })

const stampedOriginals = new Map<string, string>()
const stamp = (dir: string): string => {
  const pkgPath = join(REPO, dir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  stampedOriginals.set(pkgPath, pkg.version)
  pkg.version = snapshotVersion
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  return pkg.name
}
const restoreAll = (): void => {
  for (const [path, version] of stampedOriginals) {
    const pkg = JSON.parse(readFileSync(path, 'utf8'))
    pkg.version = version
    writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n')
  }
}

const out = mkdtempSync(join(tmpdir(), 'publish-on-deploy-'))
try {
  for (const dir of packageDirs) {
    const name = stamp(dir)
    console.log(`packing ${dir} → ${name}@${snapshotVersion}`)
    execFileSync('corepack', ['pnpm', 'pack', '--pack-destination', out], {
      cwd: join(REPO, dir),
      stdio: 'inherit',
    })
  }

  const uploaded: Array<{ name: string; url: string }> = []
  const files = readdirSync(out).filter((f) => f.endsWith('.tgz'))
  for (const file of files) {
    const buf = readFileSync(join(out, file))
    // pnpm pack names files as <scope-package>-<version>.tgz, e.g.
    // mridang-foo-0.0.0-sha-abc123d.tgz. Recover the npm package name by
    // matching against the package.json names we just stamped.
    const matched = [...stampedOriginals.keys()]
      .map((p) => JSON.parse(readFileSync(p, 'utf8')) as { name: string })
      .find((m) => file.startsWith(m.name.replace('@', '').replace('/', '-') + '-'))
    if (!matched) {
      console.warn(`skip ${file} — no matching workspace package`)
      continue
    }
    const key = `branch-${branch}/${matched.name}/-/${file}`
    const blob = await put(key, buf, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/octet-stream',
      allowOverwrite: true,
    })
    console.log(`uploaded ${matched.name}@${snapshotVersion} → ${blob.url}`)
    uploaded.push({ name: matched.name, url: blob.url })
  }

  console.log(`\npublished ${uploaded.length} snapshot(s) under branch=${branch}`)
} finally {
  restoreAll()
  rmSync(out, { recursive: true, force: true })
}
