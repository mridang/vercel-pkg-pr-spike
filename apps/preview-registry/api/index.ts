// Vercel entry point. Wires the FS-backed store rooted at the bundled
// .snapshots/ directory (populated during the Vercel build and shipped
// with the deploy via includeFiles in vercel.json) into the shared Hono
// app. Public URL base is taken from the Vercel-injected VERCEL_URL.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handle } from 'hono/vercel'
import { createApp } from '../src/app.js'
import { createFsStore } from '../src/storage.js'

// Vercel's @vercel/node builder may compile ESM to CJS; in that case
// `import.meta.dirname` is undefined and `__dirname` is defined. Try both,
// then fall back to process.cwd() — on Vercel that's the function's
// working directory which still includes our bundled .snapshots/ via
// vercel.json's includeFiles.
const here =
  typeof __dirname === 'string'
    ? __dirname
    : (() => {
        try {
          return dirname(fileURLToPath(import.meta.url))
        } catch {
          return process.cwd()
        }
      })()

const SNAPSHOT_ROOT = resolve(here, '..', '.snapshots')
const PUBLIC_BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : ''

const app = createApp(createFsStore(SNAPSHOT_ROOT, PUBLIC_BASE))

export default handle(app)
