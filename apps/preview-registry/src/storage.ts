// Tarballs live on the local filesystem of whichever environment is
// serving them. In production that's the function bundle (snapshots are
// written during the Vercel build and shipped with the deploy). Locally
// it's the same .snapshots/ directory under apps/preview-registry/, so
// the dev server reads from exactly the same shape it serves in prod.
//
// Keys are flat strings of the form "<scope>/<name>/-/<file>.tgz". No
// branch prefix needed — each Vercel preview deploy already has its own
// isolated function bundle scoped to one branch.

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface BlobEntry {
  readonly key: string
  readonly url: string
  readonly size: number
  readonly uploadedAt: Date
}

export interface BlobStore {
  put(key: string, body: Buffer, contentType: string): Promise<BlobEntry>
  list(prefix: string): Promise<BlobEntry[]>
  read(key: string): Promise<Buffer>
}

export const createFsStore = (root: string, publicBase: string): BlobStore => ({
  async put(key, body, _contentType) {
    const path = join(root, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body)
    return {
      key,
      url: `${publicBase}/-/blob/${encodeURI(key)}`,
      size: body.length,
      uploadedAt: new Date(),
    }
  },

  async list(prefix) {
    const out: BlobEntry[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
        throw err
      }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
        } else {
          const key = full.slice(root.length + 1)
          if (!key.startsWith(prefix)) continue
          const info = await stat(full)
          out.push({
            key,
            url: `${publicBase}/-/blob/${encodeURI(key)}`,
            size: info.size,
            uploadedAt: info.mtime,
          })
        }
      }
    }
    await walk(root)
    return out
  },

  async read(key) {
    return readFile(join(root, key))
  },
})
