import type { BlobEntry } from './storage.js'

/**
 * One row on the landing page's package list.
 *
 * Snapshot version is parsed out of the tarball filename rather than
 * read from the manifest inside, so producing this list is a cheap
 * pure-data transform with no I/O.
 */
export interface PackageRow {
  readonly name: string
  readonly version: string
  readonly sizeBytes: number
}

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
} as const

const HTML_ESCAPE_PATTERN = /[&<>"']/g

const escapeHtml = (input: string): string =>
  input.replace(
    HTML_ESCAPE_PATTERN,
    (character) =>
      HTML_ESCAPE_MAP[character as keyof typeof HTML_ESCAPE_MAP] ?? character,
  )

const TARBALL_KEY_PATTERN = /^(@[^/]+\/[^/]+)\/-\/(.+)\.tgz$/

/**
 * Derive a sorted, deduplicated list of {@link PackageRow}s from the
 * raw blob listing.
 *
 * Each tarball's blob key looks like
 * `@scope/name/-/scope-name-<version>.tgz`. The scope and name come
 * from the directory portion; the version is recovered by stripping
 * the `scope-name-` prefix from the filename. Blobs that do not match
 * this shape are silently skipped — the registry happily ignores
 * anything else dropped into its storage root.
 */
export const collectPackages = (
  blobs: readonly BlobEntry[],
): readonly PackageRow[] => {
  const rowsByName = blobs.reduce<ReadonlyMap<string, PackageRow>>(
    (accumulator, blob) => {
      const match = blob.key.match(TARBALL_KEY_PATTERN)
      if (!match) return accumulator
      const [, packageName, filename] = match
      if (!packageName || !filename) return accumulator
      if (accumulator.has(packageName)) return accumulator
      const filenamePrefix =
        packageName.replace('@', '').replace('/', '-') + '-'
      const version = filename.startsWith(filenamePrefix)
        ? filename.slice(filenamePrefix.length)
        : 'unknown'
      return new Map([
        ...accumulator,
        [packageName, { name: packageName, version, sizeBytes: blob.size }],
      ])
    },
    new Map(),
  )

  return [...rowsByName.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  )
}

/**
 * Render a static HTML landing page describing this deploy.
 *
 * The page is intentionally noindex/nofollow — preview deploys are
 * ephemeral and should not be picked up by crawlers. Styling comes
 * from the Tailwind CDN script so the function bundle ships nothing
 * but the inlined HTML string.
 *
 * @param packages - Sorted package list from {@link collectPackages}.
 * @param origin - Absolute URL prefix to advertise install commands
 *   against (`https://<deploy>.vercel.app`).
 * @param branch - Git branch name this deploy was built from. Used
 *   purely for display.
 */
export const renderLanding = (
  packages: readonly PackageRow[],
  origin: string,
  branch: string,
): string => {
  const installList =
    packages.length > 0
      ? packages
          .map((entry) => `${entry.name}@${entry.version}`)
          .join(' ')
      : '@mridang/foo'

  const packageListHtml =
    packages.length > 0
      ? packages
          .map(
            (entry) => `
        <li class="flex items-center justify-between rounded-lg bg-slate-900/60 ring-1 ring-slate-800 px-5 py-3">
          <code class="text-indigo-300 text-sm">${escapeHtml(entry.name)}</code>
          <span class="text-xs text-slate-500 font-mono">${escapeHtml(entry.version)} · ${(entry.sizeBytes / 1024).toFixed(1)} KB</span>
        </li>`,
          )
          .join('')
      : `<li class="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 px-5 py-3 text-slate-500 text-sm">No snapshots in this deploy yet.</li>`

  return `<!DOCTYPE html>
<html lang="en" class="bg-slate-950">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">
<meta name="googlebot" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
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

/**
 * Plain-text body served at `/robots.txt` to keep crawlers out of any
 * preview deploy URL.
 */
export const ROBOTS_TXT = `User-agent: *
Disallow: /
`
