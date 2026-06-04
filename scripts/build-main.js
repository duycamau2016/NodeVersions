// Simple build script for the Electron main process
// Usage: node scripts/build-main.js
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

console.log('Building Electron main process...')

execSync('npx tsc -p tsconfig.main.json', { stdio: 'inherit', cwd: path.join(__dirname, '..') })

// Copy preload.js to dist/main
const preloadSrc = path.join(__dirname, '../dist/main/src/main/preload.js')
const preloadDst = path.join(__dirname, '../dist/main/preload.js')

if (fs.existsSync(preloadSrc)) {
  fs.copyFileSync(preloadSrc, preloadDst)
}

// Flatten: move dist/main/src/main/* to dist/main/*
const nested = path.join(__dirname, '../dist/main/src/main')
if (fs.existsSync(nested)) {
  const files = fs.readdirSync(nested)
  for (const f of files) {
    fs.copyFileSync(path.join(nested, f), path.join(__dirname, '../dist/main', f))
  }
  fs.rmSync(path.join(__dirname, '../dist/main/src'), { recursive: true, force: true })
}

console.log('Main process build complete.')
