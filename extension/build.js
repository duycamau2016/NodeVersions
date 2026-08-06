#!/usr/bin/env node
// Builds both halves of the extension:
//   1. the webview bundle  (vite, from the shared src/renderer sources)
//   2. the extension host  (esbuild, bundling src/main/*Manager.ts in)
//
// Both run with cwd = repo root so they resolve vite/react/esbuild out of the
// root node_modules. extension/ keeps only its own dev deps (@types/vscode).
const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const extDir = __dirname
const repoRoot = path.join(extDir, '..')
const watch = process.argv.includes('--watch')

function run(args) {
  console.log(`> npx ${args.join(' ')}`)
  execFileSync('npx', args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
}

// ── 1. Webview ──────────────────────────────────────────────
run([
  'vite',
  'build',
  '--config',
  path.relative(repoRoot, path.join(extDir, 'vite.config.ts')),
  ...(watch ? ['--watch'] : []),
])

// ── 2. Extension host ───────────────────────────────────────
// `--external:vscode` is mandatory: the vscode module is injected by the
// editor at runtime and has no npm package to bundle.
run([
  '--yes',
  'esbuild',
  path.relative(repoRoot, path.join(extDir, 'src/extension.ts')),
  '--bundle',
  '--platform=node',
  '--target=node20',
  '--format=cjs',
  '--external:vscode',
  '--minify',
  '--sourcemap',
  `--outfile=${path.relative(repoRoot, path.join(extDir, 'dist/extension.js'))}`,
  ...(watch ? ['--watch'] : []),
])

// ── 3. Marketplace icon ─────────────────────────────────────
// Reuse the app icon rather than keeping a second copy in git.
const iconSrc = path.join(repoRoot, 'build/icon.png')
const iconDst = path.join(extDir, 'icon.png')
if (fs.existsSync(iconSrc)) {
  fs.copyFileSync(iconSrc, iconDst)
  console.log('> copied build/icon.png -> extension/icon.png')
} else {
  console.warn('! build/icon.png not found — extension/icon.png not refreshed')
}

console.log('\nExtension build complete.')
