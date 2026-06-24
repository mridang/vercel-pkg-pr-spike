import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../src/app.js'
import { createFsStore } from '../src/storage.js'

/**
 * Resolve the directory the snapshot bundle lives in, regardless of
 * whether the function was shipped as ESM or transpiled to CJS by the
 * Vercel builder. Tries `__dirname` first (CJS), then
 * `import.meta.url` (native ESM), and finally `process.cwd()` so the
 * registry still serves the right files if either of those become
 * undefined in a future runtime.
 */
const resolveFunctionDirectory = (): string => {
  const cjsDirectory =
    typeof __dirname === 'string' ? __dirname : undefined
  if (cjsDirectory) return cjsDirectory
  try {
    return dirname(fileURLToPath(import.meta.url))
  } catch {
    return process.cwd()
  }
}

const SNAPSHOT_ROOT = resolve(resolveFunctionDirectory(), '..', '.snapshots')

const PUBLIC_BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : ''

const app = createApp(createFsStore(SNAPSHOT_ROOT, PUBLIC_BASE))

/**
 * Vercel's `@vercel/node` runtime treats a default export as the
 * classic `(req, res) => void` Node HTTP signature, but Hono is a
 * web-Fetch app. Exporting `fetch` makes Vercel route requests
 * through the Fetch signature instead. Only one named export is
 * needed; exporting both `fetch` and individual HTTP method names
 * causes the runtime to dispatch the request twice.
 */
export const fetch = app.fetch
