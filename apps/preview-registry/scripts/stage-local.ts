import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Workspace package directories the local stage script will pack.
 *
 * Kept in sync with `packages/*` by convention; if you add a package
 * to the workspace, extend this list.
 */
const WORKSPACE_PACKAGES = [
  'packages/foo',
  'packages/bar',
  'packages/baz',
] as const

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPO_ROOT = resolve(APP_ROOT, '..', '..')
const SNAPSHOT_ROOT = join(APP_ROOT, '.snapshots')

interface WorkspaceManifest {
  readonly name: string
  readonly version: string
}

/**
 * Pack every workspace package into the local FS snapshot store so the
 * dev server has something to serve.
 *
 * Mirrors the shape of what
 * {@link ../api/index.ts | the Vercel function bundle} ships in
 * production, just without version stamping — packages keep their
 * checked-in `0.0.0` so iterating on schema or routing is fast.
 */
const stageLocal = async (): Promise<void> => {
  rmSync(SNAPSHOT_ROOT, { recursive: true, force: true })

  const stagingDirectory = mkdtempSync(join(tmpdir(), 'stage-local-'))
  try {
    for (const packageDirectory of WORKSPACE_PACKAGES) {
      console.log(`packing ${packageDirectory}`)
      execFileSync(
        'corepack',
        [
          'pnpm',
          'pack',
          '--pack-destination',
          stagingDirectory,
        ],
        { cwd: join(REPO_ROOT, packageDirectory), stdio: 'inherit' },
      )
    }

    const manifests: readonly { path: string; manifest: WorkspaceManifest }[] =
      WORKSPACE_PACKAGES.map((packageDirectory) => {
        const packageJsonPath = join(
          REPO_ROOT,
          packageDirectory,
          'package.json',
        )
        return {
          path: packageJsonPath,
          manifest: JSON.parse(
            readFileSync(packageJsonPath, 'utf8'),
          ) as WorkspaceManifest,
        }
      })

    for (const tarballFile of readdirSync(stagingDirectory).filter(
      (file) => file.endsWith('.tgz'),
    )) {
      const tarballBody = readFileSync(join(stagingDirectory, tarballFile))
      const matchedManifest = manifests.find(({ manifest }) =>
        tarballFile.startsWith(
          manifest.name.replace('@', '').replace('/', '-') + '-',
        ),
      )?.manifest
      if (!matchedManifest) {
        console.warn(`skip ${tarballFile} — no matching workspace package`)
        continue
      }
      const destination = join(
        SNAPSHOT_ROOT,
        matchedManifest.name,
        '-',
        tarballFile,
      )
      mkdirSync(resolve(destination, '..'), { recursive: true })
      writeFileSync(destination, tarballBody)
      console.log(`  bundled ${matchedManifest.name} → ${destination}`)
    }

    console.log(`\nstaged into ${SNAPSHOT_ROOT}`)
    console.log('now run:  corepack pnpm dev:registry')
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true })
  }
}

await stageLocal()
