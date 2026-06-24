// Hono app exposing the npm registry protocol over a BlobStore. The same
// app instance runs locally (via @hono/node-server) and on Vercel (wrapped
// with hono/vercel's handle()), so the contract is identical in both
// environments. Each deploy serves only its own deploy's snapshots.

import { Hono } from 'hono'
import { buildPackument } from './packument.js'
import type { BlobStore } from './storage.js'

export const createApp = (store: BlobStore) => {
  const app = new Hono()

  app.get('/', (c) =>
    c.json({ ok: true, registry: '@mridang/preview-registry-spike' }),
  )
  app.get('/-/ping', (c) => c.text('OK'))

  // Tarball serving. In every environment we read from the same FS-backed
  // store. On Vercel the store is rooted in the function bundle (snapshots
  // get baked in at build time via includeFiles in vercel.json).
  app.get('/-/blob/*', async (c) => {
    const key = decodeURIComponent(c.req.path.replace(/^\/-\/blob\//, ''))
    try {
      const buf = await store.read(key)
      // Hono's c.body() requires `Uint8Array<ArrayBuffer>` specifically.
      // A Buffer view is `Uint8Array<ArrayBufferLike>` (its underlying
      // buffer may be SharedArrayBuffer), so we copy into a fresh
      // ArrayBuffer. Tarballs are small enough that the copy is free.
      const view = new Uint8Array(buf.byteLength)
      view.set(buf)
      c.header('Content-Type', 'application/octet-stream')
      return c.body(view)
    } catch {
      return c.json({ error: 'not found' }, 404)
    }
  })

  // Scoped packument: GET /@scope/name
  app.get('/:scope{@[^/]+}/:name', async (c) => {
    const packument = await buildPackument(
      store,
      c.req.param('scope'),
      c.req.param('name'),
    )
    if (!packument) return c.json({ error: 'not found' }, 404)
    c.header('Cache-Control', 's-maxage=60, stale-while-revalidate=86400')
    return c.json(packument)
  })

  // npm CLI URL-encodes the slash in scoped names (@scope%2fname).
  app.get('/:full{@[^/]+%2[Ff][^/]+}', async (c) => {
    const decoded = decodeURIComponent(c.req.param('full'))
    const [scope, name] = decoded.split('/')
    if (!scope || !name) return c.json({ error: 'bad path' }, 400)
    const packument = await buildPackument(store, scope, name)
    if (!packument) return c.json({ error: 'not found' }, 404)
    c.header('Cache-Control', 's-maxage=60, stale-while-revalidate=86400')
    return c.json(packument)
  })

  return app
}
