// Storage abstraction so the same handler runs against Vercel Blob in
// production and against a local filesystem during the spike. Keys are flat
// strings of the form "branch-<ref>/<scope>/<name>/-/<file>.tgz" — the same
// shape Vercel Blob will see.

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

// Local filesystem backend. Writes under .local-blob/ and serves tarballs
// back through the registry app itself (the handler maps /-/blob/<key> to a
// read() call) — no separate static server needed for the spike.
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

// Vercel Blob backend — used in deployed environments. Reads only; uploads
// happen from CI via @vercel/blob's put() directly (see CI workflow).
export const createVercelStore = async (publicBase: string): Promise<BlobStore> => {
  const { list, put, head } = await import('@vercel/blob')
  return {
    async put(key, body, contentType) {
      const blob = await put(key, body, {
        access: 'public',
        addRandomSuffix: false,
        contentType,
        allowOverwrite: true,
      })
      return { key, url: blob.url, size: body.length, uploadedAt: new Date() }
    },

    async list(prefix) {
      const out: BlobEntry[] = []
      let cursor: string | undefined
      do {
        const page = await list({ prefix, cursor })
        for (const blob of page.blobs) {
          out.push({
            key: blob.pathname,
            url: blob.url,
            size: blob.size,
            uploadedAt: new Date(blob.uploadedAt),
          })
        }
        cursor = page.cursor
      } while (cursor)
      return out
    },

    async read(key) {
      const info = await head(key)
      const res = await fetch(info.url)
      if (!res.ok) throw new Error(`fetch ${info.url}: ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    },
  }
}

// Branch routing: in Vercel, preview deployments live at
// <project>-git-<branch>-<team>.vercel.app. We extract <branch> from the host
// so each PR's deployment only sees its own tarballs.
export const branchFromHost = (host: string | undefined): string => {
  if (!host) return 'main'
  const m = host.match(/-git-([a-z0-9-]+?)(?:-[a-z0-9]+)?\.vercel\.app$/)
  if (m) return m[1]!
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return process.env.LOCAL_BRANCH ?? 'local'
  }
  return 'main'
}
