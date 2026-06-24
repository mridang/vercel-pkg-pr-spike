// End-to-end proof. Spawns the dev server, stages the workspace packages
// to its FS-backed store, then runs `npm install` from a throwaway consumer
// project pointing at the dev server as its registry. Imports the installed
// package and runs its exported function — anything other than the expected
// string fails the script.

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const PORT = Number(process.env.PORT ?? 3000)
const REGISTRY = `http://localhost:${PORT}`

const waitForReady = async (url: string, timeoutMs = 10_000): Promise<void> => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`server at ${url} did not become ready within ${timeoutMs}ms`)
}

const log = (msg: string): void => {
  console.log(`\x1b[1;36m[verify]\x1b[0m ${msg}`)
}

const consumer = mkdtempSync(join(tmpdir(), 'consumer-'))
let server: ReturnType<typeof spawn> | undefined

try {
  log('starting local-server')
  server = spawn(
    'corepack',
    ['pnpm', 'tsx', 'apps/preview-registry/scripts/local-server.ts'],
    { cwd: REPO, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  server.stdout?.on('data', (b) => process.stdout.write(`  [server] ${b}`))
  server.stderr?.on('data', (b) => process.stderr.write(`  [server!] ${b}`))

  await waitForReady(`${REGISTRY}/-/ping`)
  log('server up')

  log('building workspace packages')
  // Build everything first so dist/ exists before pnpm pack.
  for (const dir of ['packages/foo', 'packages/bar', 'packages/baz']) {
    const r = spawnSync(
      'corepack',
      ['pnpm', 'exec', 'tsc', '-p', 'tsconfig.json'],
      { cwd: join(REPO, dir), stdio: 'inherit' },
    )
    if (r.status !== 0) throw new Error(`build failed for ${dir}`)
  }

  log('staging tarballs to FS blob store')
  const stage = spawnSync(
    'corepack',
    ['pnpm', 'tsx', 'apps/preview-registry/scripts/stage-local.ts'],
    { cwd: REPO, env: { ...process.env, LOCAL_BRANCH: 'local', PUBLIC_BASE: REGISTRY }, stdio: 'inherit' },
  )
  if (stage.status !== 0) throw new Error('staging failed')

  log(`probing packument @mridang/foo via ${REGISTRY}`)
  const packumentRes = await fetch(`${REGISTRY}/@mridang/foo`)
  if (!packumentRes.ok) throw new Error(`packument GET failed: ${packumentRes.status}`)
  const packument = (await packumentRes.json()) as {
    name: string
    'dist-tags': Record<string, string>
    versions: Record<string, { dist: { tarball: string } }>
  }
  log(`packument ok: name=${packument.name} latest=${packument['dist-tags'].latest}`)

  log(`writing consumer project at ${consumer}`)
  mkdirSync(consumer, { recursive: true })
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer-spike', version: '0.0.0', private: true, type: 'module' }, null, 2),
  )
  writeFileSync(join(consumer, '.npmrc'), `registry=${REGISTRY}\n@mridang:registry=${REGISTRY}\n`)

  log('npm install @mridang/foo @mridang/bar @mridang/baz from local registry')
  const install = spawnSync('npm', ['install', '@mridang/foo', '@mridang/bar', '@mridang/baz'], {
    cwd: consumer,
    stdio: 'inherit',
  })
  if (install.status !== 0) throw new Error('npm install failed')

  log('importing and exercising installed packages')
  writeFileSync(
    join(consumer, 'run.mjs'),
    `import { greet, PKG as FOO } from '@mridang/foo'
import { loudGreet, PKG as BAR } from '@mridang/bar'
import { baz, PKG as BAZ } from '@mridang/baz'
const out = { foo: greet('world'), bar: loudGreet('world'), baz: baz(), names: [FOO, BAR, BAZ] }
console.log(JSON.stringify(out))
`,
  )
  const run = spawnSync('node', ['run.mjs'], { cwd: consumer, encoding: 'utf8' })
  if (run.status !== 0) {
    console.error(run.stderr)
    throw new Error('consumer run failed')
  }
  const got = JSON.parse(run.stdout.trim())
  const want = {
    foo: 'hello, world from foo',
    bar: 'HELLO, WORLD FROM FOO',
    baz: 'baz!',
    names: ['@mridang/foo', '@mridang/bar', '@mridang/baz'],
  }
  const equal = JSON.stringify(got) === JSON.stringify(want)
  if (!equal) {
    console.error('FAIL: got', got, 'want', want)
    throw new Error('runtime mismatch')
  }

  log('\x1b[1;32mPASS\x1b[0m — packages installed from local registry and ran correctly')
  log(JSON.stringify(got))
} finally {
  if (server) server.kill('SIGTERM')
  rmSync(consumer, { recursive: true, force: true })
}
