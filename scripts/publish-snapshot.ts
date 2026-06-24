// Pack every workspace package, rewrite its version to a snapshot tag
// (0.0.0-<sha>), and push the resulting tarballs into Vercel Blob under
// the branch-scoped key shape the registry serves. Runs in CI.
//
// Required env: BLOB_READ_WRITE_TOKEN (Vercel Blob token), GITHUB_SHA,
// GITHUB_REF_NAME (branch). Optional: PACKAGES (comma-separated list,
// defaults to all under packages/).

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { put } from '@vercel/blob'

const REPO = resolve(import.meta.dirname, '..')
const SHA = (process.env.GITHUB_SHA ?? '').slice(0, 7) || 'localdev'
const BRANCH = (process.env.GITHUB_REF_NAME ?? 'local').replace(/[^a-z0-9-]/gi, '-').toLowerCase()
const SNAPSHOT_VERSION = `0.0.0-sha-${SHA}`

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN missing — refusing to upload')
  process.exit(1)
}

const packageDirs = (process.env.PACKAGES?.split(',') ?? readdirSync(join(REPO, 'packages')))
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => (p.startsWith('packages/') ? p : `packages/${p}`))

const stamp = (dir: string): { name: string; originalVersion: string } => {
  const pkgPath = join(REPO, dir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const original = pkg.version
  pkg.version = SNAPSHOT_VERSION
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  return { name: pkg.name, originalVersion: original }
}

const restore = (dir: string, originalVersion: string): void => {
  const pkgPath = join(REPO, dir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.version = originalVersion
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

const out = mkdtempSync(join(tmpdir(), 'snapshot-'))
const stamped: Array<{ dir: string; name: string; originalVersion: string }> = []
try {
  for (const dir of packageDirs) {
    const meta = stamp(dir)
    stamped.push({ dir, ...meta })
    console.log(`packing ${dir} as ${meta.name}@${SNAPSHOT_VERSION}`)
    execFileSync('corepack', ['pnpm', 'run', 'build'], {
      cwd: join(REPO, dir),
      stdio: 'inherit',
    })
    execFileSync('corepack', ['pnpm', 'pack', '--pack-destination', out], {
      cwd: join(REPO, dir),
      stdio: 'inherit',
    })
  }

  const uploaded: Array<{ name: string; url: string }> = []
  for (const file of readdirSync(out).filter((f) => f.endsWith('.tgz'))) {
    const buf = readFileSync(join(out, file))
    const match = stamped.find((s) => s.name.replace('@', '').replace('/', '-') === file.replace(/-0\.0\.0-sha-.*\.tgz$/, ''))
    if (!match) {
      console.warn(`skip ${file} — no matching package`)
      continue
    }
    const key = `branch-${BRANCH}/${match.name}/-/${file}`
    const blob = await put(key, buf, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/octet-stream',
      allowOverwrite: true,
    })
    console.log(`uploaded ${match.name}@${SNAPSHOT_VERSION} → ${blob.url}`)
    uploaded.push({ name: match.name, url: blob.url })
  }

  // Emit a GitHub Actions step summary that consumers can copy/paste.
  if (process.env.GITHUB_STEP_SUMMARY) {
    const registryUrl = process.env.PUBLIC_REGISTRY_URL ?? `https://<your-app>-git-${BRANCH}-<team>.vercel.app`
    const lines = [
      `## Snapshot ${SNAPSHOT_VERSION}`,
      '',
      `Branch: \`${BRANCH}\``,
      '',
      '```sh',
      `npm install --registry=${registryUrl} \\`,
      ...uploaded.map((u, i) => `  ${u.name}@${SNAPSHOT_VERSION}${i === uploaded.length - 1 ? '' : ' \\'}`),
      '```',
    ].join('\n')
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines + '\n', { flag: 'a' })
  }

  console.log(`\npublished ${uploaded.length} snapshots`)
} finally {
  for (const s of stamped) restore(s.dir, s.originalVersion)
  rmSync(out, { recursive: true, force: true })
}
