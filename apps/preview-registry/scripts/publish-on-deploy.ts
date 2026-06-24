// Runs as part of the Vercel build. Packs every workspace package,
// stamps each with a snapshot version derived from the deploy's commit
// SHA, and writes the tarballs into apps/preview-registry/.snapshots/.
// vercel.json's includeFiles rule ships that directory with the
// function bundle, so the runtime reads from local disk — no external
// storage, no token, no GitHub secret.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPO = resolve(APP_ROOT, '..', '..')
const SNAPSHOT_ROOT = join(APP_ROOT, '.snapshots')

const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'localdev'
const snapshotVersion = `0.0.0-sha-${sha}`

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

// Wipe any prior snapshots from this build dir so the function only
// ships the ones we just packed.
rmSync(SNAPSHOT_ROOT, { recursive: true, force: true })

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

  const namesByDir = [...stampedOriginals.keys()].map((p) => ({
    path: p,
    name: (JSON.parse(readFileSync(p, 'utf8')) as { name: string }).name,
  }))

  let written = 0
  for (const file of readdirSync(out).filter((f) => f.endsWith('.tgz'))) {
    const matched = namesByDir.find((m) =>
      file.startsWith(m.name.replace('@', '').replace('/', '-') + '-'),
    )
    if (!matched) {
      console.warn(`skip ${file} — no matching workspace package`)
      continue
    }
    const dest = join(SNAPSHOT_ROOT, matched.name, '-', file)
    mkdirSync(resolve(dest, '..'), { recursive: true })
    writeFileSync(dest, readFileSync(join(out, file)))
    console.log(`bundled ${matched.name}@${snapshotVersion}`)
    written++
  }

  console.log(`\nbundled ${written} snapshot(s) into ${SNAPSHOT_ROOT}`)
} finally {
  restoreAll()
  rmSync(out, { recursive: true, force: true })
}
