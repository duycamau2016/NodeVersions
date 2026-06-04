// Dev startup script: launches Vite renderer + tsc watch + Electron
// Windows-friendly alternative to cross-env

// --- Ensure this script runs with the system Node 24 ---
;(function ensureSystemNode() {
  const major = parseInt(process.version.replace('v', '').split('.')[0], 10)
  if (major >= 24) return

  const fs = require('fs')
  const { execFileSync, spawnSync } = require('child_process')

  const candidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
  ]

  let systemNode = null
  try {
    const found = execFileSync('where', ['node'], { encoding: 'utf8', shell: true })
      .trim().split(/\r?\n/)
    for (const p of found) {
      const t = p.trim()
      if (t.includes('.nodevm')) continue
      if (fs.existsSync(t)) { systemNode = t; break }
    }
  } catch {}

  if (!systemNode) {
    for (const c of candidates) {
      if (require('fs').existsSync(c)) { systemNode = c; break }
    }
  }

  if (!systemNode) {
    console.warn('[dev] WARNING: system Node 24 not found, using', process.version)
    return
  }

  console.log(`[dev] Re-launching with ${systemNode} (was ${process.version})`)
  const result = spawnSync(systemNode, process.argv.slice(1), {
    stdio: 'inherit',
    env: process.env,
  })
  process.exit(result.status ?? 0)
})()
// ---

const { spawn } = require('child_process')
const path = require('path')

const root = path.join(__dirname, '..')

function run(cmd, args, opts = {}) {
  const proc = spawn(cmd, args, { stdio: 'inherit', shell: true, cwd: root, ...opts })
  proc.on('error', (e) => console.error(`[${cmd}] error:`, e.message))
  return proc
}

console.log('[dev] Starting Vite renderer...')
const vite = run('npx', ['vite'])

console.log('[dev] Starting tsc watch for main process...')
const tsc = run('npx', ['tsc', '-p', 'tsconfig.main.json', '--watch', '--preserveWatchOutput'])

// Wait for Vite to be ready, then launch Electron
const waitOn = require('wait-on')
waitOn({ resources: ['http://localhost:5173'], timeout: 30000 }, (err) => {
  if (err) {
    console.error('[dev] Vite did not start in time:', err)
    process.exit(1)
  }
  console.log('[dev] Vite ready. Launching Electron...')
  const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5173' }
  const electron = run('npx', ['electron', '.'], { env })

  electron.on('close', () => {
    vite.kill()
    tsc.kill()
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  vite.kill()
  tsc.kill()
  process.exit(0)
})
