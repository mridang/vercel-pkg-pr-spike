// Vercel entry point. Wires the FS-backed store rooted at the bundled
// .snapshots/ directory (populated during the Vercel build and shipped
// with the deploy via includeFiles in vercel.json) into the shared Hono
// app. Public URL base is taken from the Vercel-injected VERCEL_URL.

import { resolve } from 'node:path'
import { handle } from 'hono/vercel'
import { createApp } from '../src/app.js'
import { createFsStore } from '../src/storage.js'

const SNAPSHOT_ROOT = resolve(import.meta.dirname, '..', '.snapshots')
const PUBLIC_BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : ''

const app = createApp(createFsStore(SNAPSHOT_ROOT, PUBLIC_BASE))

export default handle(app)
