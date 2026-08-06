import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Builds the VS Code webview bundle from the SHARED React sources in
// ../src/renderer. Deliberately separate from the repo-root vite.config.ts so
// the Electron build is untouched.
//
// Run from the repo root (see build.js) so vite/react resolve out of the root
// node_modules — the extension does not duplicate them.
const repoRoot = resolve(__dirname, '..')

export default defineConfig({
  root: resolve(__dirname, 'webview'),
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(repoRoot, 'src/renderer') },
    // Guard against a second React copy sneaking in if extension/node_modules
    // ever gains one — two copies break hooks at runtime.
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: resolve(__dirname, 'dist/webview'),
    emptyOutDir: true,
    // Inline every asset (logo.svg, fonts) as a data URI. Webviews rewrite
    // resource URLs through asWebviewUri; inlining sidesteps that entirely.
    assetsInlineLimit: 4 * 1024 * 1024,
    rollupOptions: {
      output: {
        // Pinned names so panel.ts can build URIs without reading a manifest.
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/index[extname]',
      },
    },
  },
})
