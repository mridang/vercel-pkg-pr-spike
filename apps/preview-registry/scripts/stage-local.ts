// Stages all workspace packages to the local FS-backed BlobStore so the
// dev server has something to serve. Mirrors what the GitHub Actions
// workflow does in production (pack → upload), just without the network.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { x as untar } from 'tar'
import { createFsStore } from '../src/storage.js'

const REPO = resolve(import.meta.dirname, '../../..')
const PACKAGES = ['packages/foo', 'packages/bar', 'packages/baz']
const BRANCH = process.env.LOCAL_BRANCH ?? 'local'
const BLOB_ROOT = resolve(import.meta.dirname, '..', '.local-blob')
const PUBLIC_BASE = process.env.PUBLIC_BASE ?? 'http://localhost:3000'

const store = createFsStore(BLOB_ROOT, PUBLIC_BASE)

const readManifestName = async (tarball: Buffer): Promise<{ name: string }> => {
  let manifest: { name: string } | undefined
  await new Promise<void>((res, rej) => {
    const parser = untar({
      filter: (p) => p === 'package/package.json',
      onentry: (entry) => {
        const chunks: Buffer[] = []
        entry.on('data', (d: Buffer) => chunks.push(d))
        entry.on('end', () => {
          manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        })
      },
    })
    Readable.from(tarball).pipe(parser).on('finish', () => res()).on('error', rej)
  })
  if (!manifest) throw new Error('no package.json in tarball')
  return manifest
}

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

  const tgzs = readdirSync(out).filter((f) => f.endsWith('.tgz'))
  for (const file of tgzs) {
    const buf = readFileSync(join(out, file))
    const { name } = await readManifestName(buf)
    const key = `branch-${BRANCH}/${name}/-/${file}`
    const entry = await store.put(key, buf, 'application/octet-stream')
    console.log(`  uploaded ${name} → ${entry.url}`)
  }

  console.log(`\nstaged ${tgzs.length} tarballs under branch=${BRANCH}`)
  console.log(`now run:  pnpm dev:registry`)
  console.log(`then:     curl ${PUBLIC_BASE}/@mridang/foo | jq .`)
} finally {
  rmSync(out, { recursive: true, force: true })
}
