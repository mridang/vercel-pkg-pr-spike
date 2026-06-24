// Dev server. Runs the same Hono app the Vercel function exports, using
// the same .snapshots/ directory layout the production build populates,
// so the local round-trip is byte-identical to a real deploy.

import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from '../src/app.js'
import { createFsStore } from '../src/storage.js'

const port = Number(process.env.PORT ?? 3000)
const root = resolve(import.meta.dirname, '..', '.snapshots')
const publicBase = `http://localhost:${port}`

const app = createApp(createFsStore(root, publicBase))

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`preview-registry on http://localhost:${info.port}`)
  console.log(`storage backend: fs @ ${root}`)
})
