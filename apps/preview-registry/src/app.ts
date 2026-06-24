// Hono app exposing the npm registry protocol over a BlobStore. The same
// app instance runs locally (via @hono/node-server) and on Vercel (wrapped
// with hono/vercel's handle()), so the contract is identical in both
// environments. Each deploy serves only its own deploy's snapshots.

import { Hono } from 'hono'
import { collectPackages, renderLanding } from './landing.js'
import { buildPackument } from './packument.js'
import type { BlobStore } from './storage.js'

export const createApp = (store: BlobStore) => {
  const app = new Hono()

  app.get('/-/ping', (c) => c.text('OK'))

  // Landing page. Lists every package the current snapshot bundle ships
  // with copy-pasteable install commands for this deploy's URL. The
  // origin comes from the Host header so the displayed install command
  // matches whichever preview-deploy URL the visitor opened.
  app.get('/', async (c) => {
    const blobs = await store.list('')
    const packages = collectPackages(blobs)
    const host = c.req.header('host') ?? 'localhost'
    const origin = `${host.startsWith('localhost') ? 'http' : 'https'}://${host}`
    const branch = process.env.VERCEL_GIT_COMMIT_REF ?? 'local'
    c.header('Content-Type', 'text/html; charset=utf-8')
    return c.html(renderLanding(packages, origin, branch))
  })

  // Catch-all so we never bubble an uncaught route mismatch back to
  // Vercel's runtime (which would surface as FUNCTION_INVOCATION_FAILED
  // instead of a clean 404). Same applies to handler exceptions.
  app.notFound((c) => c.json({ error: 'not found', path: c.req.path }, 404))
  app.onError((err, c) =>
    c.json({ error: err.message, path: c.req.path, stack: err.stack }, 500),
  )

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
