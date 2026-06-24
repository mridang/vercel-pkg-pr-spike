// Builds an npm "packument" (the JSON metadata response from
// GET /<pkg>) by listing tarballs in the blob store and extracting each
// one's package.json. This is what the npm CLI hits before downloading.

import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { x as untar } from 'tar'
import type { BlobEntry, BlobStore } from './storage.js'

interface TarballMeta {
  manifest: Record<string, unknown> & { name: string; version: string }
  shasum: string
  integrity: string
  size: number
}

const readManifestFromTarball = async (buf: Buffer): Promise<TarballMeta> => {
  const shasum = createHash('sha1').update(buf).digest('hex')
  const integrity = 'sha512-' + createHash('sha512').update(buf).digest('base64')

  let manifest: TarballMeta['manifest'] | undefined
  await new Promise<void>((resolve, reject) => {
    const parser = untar({
      filter: (path) => path === 'package/package.json',
      onentry: (entry) => {
        const chunks: Buffer[] = []
        entry.on('data', (d: Buffer) => chunks.push(d))
        entry.on('end', () => {
          manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        })
        entry.on('error', reject)
      },
    })
    Readable.from(buf).pipe(parser).on('finish', () => resolve()).on('error', reject)
  })

  if (!manifest) throw new Error('no package/package.json inside tarball')
  return { manifest, shasum, integrity, size: buf.length }
}

export interface Packument {
  name: string
  'dist-tags': Record<string, string>
  versions: Record<string, unknown>
}

export const buildPackument = async (
  store: BlobStore,
  branch: string,
  scope: string,
  name: string,
): Promise<Packument | null> => {
  const prefix = `branch-${branch}/${scope}/${name}/-/`
  const blobs = (await store.list(prefix)).filter((b) => b.key.endsWith('.tgz'))
  if (blobs.length === 0) return null

  const versions: Record<string, unknown> = {}
  let latest: { version: string; time: number } | undefined

  await Promise.all(
    blobs.map(async (blob: BlobEntry) => {
      const buf = await store.read(blob.key)
      const { manifest, shasum, integrity, size } = await readManifestFromTarball(buf)
      versions[manifest.version] = {
        ...manifest,
        dist: { tarball: blob.url, shasum, integrity, unpackedSize: size },
      }
      const t = blob.uploadedAt.getTime()
      if (!latest || t > latest.time) latest = { version: manifest.version, time: t }
    }),
  )

  return {
    name: `${scope}/${name}`,
    'dist-tags': latest ? { latest: latest.version } : {},
    versions,
  }
}
