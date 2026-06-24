// Vercel entry point. Picks the Vercel Blob backend and delegates to the
// shared Hono app from src/. Kept tiny so the same handler code runs locally
// (see scripts/local-server.ts).

import { handle } from 'hono/vercel'
import { createApp } from '../src/app.js'
import { createVercelStore } from '../src/storage.js'

export const config = { runtime: 'nodejs22.x' }

const storePromise = createVercelStore(process.env.VERCEL_URL ?? '')
const appPromise = storePromise.then((store) => createApp(store))

const handler = async (req: Request) => {
  const app = await appPromise
  return handle(app)(req)
}

export default handler
