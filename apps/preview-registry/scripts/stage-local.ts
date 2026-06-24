// Stages all workspace packages to .snapshots/ so the dev server has
// something to serve. Same layout, same paths as the Vercel build —
// the only difference is no version stamping (uses each package's
// published version as-is) so the loop matches whatever's checked in.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPO = resolve(APP_ROOT, '..', '..')
const SNAPSHOT_ROOT = join(APP_ROOT, '.snapshots')
const PACKAGES = ['packages/foo', 'packages/bar', 'packages/baz']

rmSync(SNAPSHOT_ROOT, { recursive: true, force: true })

const out = mkdtempSync(join(tmpdir(), 'stage-local-'))
try {
  for (const dir of PACKAGES) {
    console.log(`packing ${dir}`)
    execFileSync(
      'corepack',
      ['pnpm', 'pack', '--pack-destination', out],
      { cwd: join(REPO, dir), stdio: 'inherit' },
    )
  }

  for (const file of readdirSync(out).filter((f) => f.endsWith('.tgz'))) {
    const buf = readFileSync(join(out, file))
    // pnpm names tarballs <scope>-<package>-<version>.tgz. Find the
    // matching workspace pkg.json by stripping the prefix.
    const pkgJsonPath = PACKAGES.map((p) => join(REPO, p, 'package.json'))
      .map((p) => ({ path: p, json: JSON.parse(readFileSync(p, 'utf8')) as { name: string } }))
      .find(({ json }) => file.startsWith(json.name.replace('@', '').replace('/', '-') + '-'))
    if (!pkgJsonPath) {
      console.warn(`skip ${file} — no matching workspace package`)
      continue
    }
    const dest = join(SNAPSHOT_ROOT, pkgJsonPath.json.name, '-', file)
    mkdirSync(resolve(dest, '..'), { recursive: true })
    writeFileSync(dest, buf)
    console.log(`  bundled ${pkgJsonPath.json.name} → ${dest}`)
  }

  console.log(`\nstaged into ${SNAPSHOT_ROOT}`)
  console.log(`now run:  corepack pnpm dev:registry`)
} finally {
  rmSync(out, { recursive: true, force: true })
}
