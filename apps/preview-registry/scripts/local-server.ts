// Dev server. Runs the same Hono app the Vercel function exports, but with
// a filesystem-backed BlobStore so the round-trip works without `vercel
// dev`, Vercel Blob, or any network. The .local-blob directory lives under
// the app root and is gitignored.

import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from '../src/app.js'
import { createFsStore } from '../src/storage.js'

const port = Number(process.env.PORT ?? 3000)
const root = resolve(import.meta.dirname, '..', '.local-blob')
const publicBase = `http://localhost:${port}`

const app = createApp(createFsStore(root, publicBase))

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`preview-registry on http://localhost:${info.port}`)
  console.log(`storage backend: fs @ ${root}`)
})
