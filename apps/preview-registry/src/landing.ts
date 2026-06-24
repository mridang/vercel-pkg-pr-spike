// Landing page rendered at /. Lists every package the current deploy's
// snapshot bundle ships, with copy-pasteable install commands. Pure
// string templating so the function bundle stays tiny (no SSR framework).

import type { BlobEntry } from './storage.js'

interface PackageInfo {
  name: string
  version: string
  sizeBytes: number
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '"' ? '&quot;' :
    '&#39;',
  )

export const collectPackages = (blobs: BlobEntry[]): PackageInfo[] => {
  const map = new Map<string, PackageInfo>()
  for (const blob of blobs) {
    // Key shape: "<scope>/<name>/-/<file>.tgz"
    const match = blob.key.match(/^(@[^/]+\/[^/]+)\/-\/(.+)\.tgz$/)
    if (!match) continue
    const [, name, filename] = match
    if (!name || !filename) continue
    // Filename shape: "<scope-name>-<version>.tgz" (pnpm pack convention)
    const prefix = name.replace('@', '').replace('/', '-') + '-'
    const version = filename.startsWith(prefix)
      ? filename.slice(prefix.length)
      : 'unknown'
    if (!map.has(name)) {
      map.set(name, { name, version, sizeBytes: blob.size })
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export const renderLanding = (
  packages: PackageInfo[],
  origin: string,
  branch: string,
): string => {
  const installList = packages.length
    ? packages.map((p) => `${p.name}@${p.version}`).join(' ')
    : '@mridang/foo'
  const sampleVersion = packages[0]?.version ?? '0.0.0-sha-xxxxxxx'

  const packageListHtml = packages.length
    ? packages
        .map(
          (p) => `
        <li class="flex items-center justify-between rounded-lg bg-slate-900/60 ring-1 ring-slate-800 px-5 py-3">
          <code class="text-indigo-300 text-sm">${escapeHtml(p.name)}</code>
          <span class="text-xs text-slate-500 font-mono">${escapeHtml(p.version)} · ${(p.sizeBytes / 1024).toFixed(1)} KB</span>
        </li>`,
        )
        .join('')
    : `<li class="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 px-5 py-3 text-slate-500 text-sm">No snapshots in this deploy yet.</li>`

  return `<!DOCTYPE html>
<html lang="en" class="bg-slate-950">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>vercel-pkg-pr-spike · per-PR npm registry</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="preconnect" href="https://rsms.me/">
<link rel="stylesheet" href="https://rsms.me/inter/inter.css">
<style>
  html { font-family: 'Inter', system-ui, sans-serif; }
  pre, code { font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace; }
</style>
</head>
<body class="bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-slate-100 min-h-screen antialiased">
  <div class="max-w-3xl mx-auto px-6 py-16">
    <header class="mb-12">
      <p class="text-xs uppercase tracking-[0.2em] text-indigo-400 mb-3 font-medium">Per-PR npm registry · powered by Vercel</p>
      <h1 class="text-4xl font-semibold tracking-tight mb-3">vercel-pkg-pr-spike</h1>
      <p class="text-slate-400 text-sm">
        Branch <code class="text-indigo-300">${escapeHtml(branch)}</code> ·
        ${packages.length} ${packages.length === 1 ? 'snapshot' : 'snapshots'} bundled in this deploy
      </p>
    </header>

    <section class="mb-10">
      <h2 class="text-xs uppercase tracking-[0.2em] text-slate-500 mb-3 font-medium">Install</h2>
      <p class="text-slate-400 text-sm mb-3">One-line install pinned to this snapshot:</p>
      <div class="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-5 mb-4">
        <pre class="text-sm text-emerald-300 overflow-x-auto whitespace-pre-wrap break-all">npm install ${escapeHtml(installList)} --registry=${escapeHtml(origin)}</pre>
      </div>
      <p class="text-slate-400 text-sm mb-3">Or scope it via <code class="text-indigo-300">.npmrc</code> for all <code class="text-indigo-300">@mridang/*</code> installs:</p>
      <div class="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-5">
        <pre class="text-sm text-emerald-300 overflow-x-auto">@mridang:registry=${escapeHtml(origin)}</pre>
      </div>
    </section>

    <section class="mb-10">
      <h2 class="text-xs uppercase tracking-[0.2em] text-slate-500 mb-3 font-medium">Packages</h2>
      <ul class="space-y-2">${packageListHtml}
      </ul>
    </section>

    <section class="mb-10">
      <h2 class="text-xs uppercase tracking-[0.2em] text-slate-500 mb-3 font-medium">Use it</h2>
      <div class="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-5">
        <pre class="text-sm text-slate-300 overflow-x-auto"><span class="text-indigo-300">import</span> { greet } <span class="text-indigo-300">from</span> <span class="text-emerald-300">'@mridang/foo'</span>

<span class="text-slate-500">console</span>.log(greet(<span class="text-emerald-300">'world'</span>))
<span class="text-slate-500">// → "hello, world from foo"</span></pre>
      </div>
    </section>

    <footer class="text-xs text-slate-500 border-t border-slate-800 pt-6 mt-12 leading-relaxed">
      Every git push redeploys this URL with fresh tarballs bundled inside the Vercel function.
      No GitHub secrets, no Vercel Blob, no external storage — each PR's preview deploy is its own
      isolated npm registry.
    </footer>
  </div>
</body>
</html>`
}
