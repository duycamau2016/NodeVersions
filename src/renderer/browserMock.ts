// Browser dev mock — injected when window.nodevm is not available (running in browser, not Electron)
import type { InstalledVersion, RemoteVersion, ActionResult } from './types'

const mockInstalled: InstalledVersion[] = [
  { version: 'v22.13.0', isCurrent: true, path: 'C:\\Users\\user\\.nodevm\\versions\\v22.13.0' },
  { version: 'v20.19.0', isCurrent: false, path: 'C:\\Users\\user\\.nodevm\\versions\\v20.19.0' },
  { version: 'v18.20.5', isCurrent: false, path: 'C:\\Users\\user\\.nodevm\\versions\\v18.20.5' },
]

const mockRemote: RemoteVersion[] = [
  { version: 'v24.1.0', lts: false, date: '2025-05-06' },
  { version: 'v22.13.0', lts: 'Jod', date: '2025-01-13' },
  { version: 'v20.19.0', lts: 'Iron', date: '2025-02-06' },
  { version: 'v18.20.5', lts: 'Hydrogen', date: '2024-07-08' },
  { version: 'v16.20.2', lts: 'Gallium', date: '2023-08-10' },
]

export function injectBrowserMock() {
  if (typeof window !== 'undefined' && !window.nodevm) {
    let currentVersion = 'v22.13.0'
    const progressCallbacks: Array<(data: { version: string; progress: number }) => void> = []

    ;(window as unknown as Record<string, unknown>).nodevm = {
      listInstalled: async (): Promise<InstalledVersion[]> =>
        mockInstalled.map((v) => ({ ...v, isCurrent: v.version === currentVersion })),

      listRemote: async (): Promise<RemoteVersion[]> => {
        await new Promise((r) => setTimeout(r, 800)) // simulate network
        return mockRemote
      },

      getCurrent: async (): Promise<string> => currentVersion,

      use: async (version: string): Promise<ActionResult> => {
        currentVersion = version
        return { success: true }
      },

      install: async (version: string): Promise<ActionResult> => {
        // Simulate install progress
        for (let p = 10; p <= 100; p += 10) {
          await new Promise((r) => setTimeout(r, 300))
          progressCallbacks.forEach((cb) => cb({ version, progress: p }))
        }
        if (!mockInstalled.find((v) => v.version === version)) {
          mockInstalled.unshift({ version, isCurrent: false, path: `C:\\mock\\${version}` })
        }
        return { success: true }
      },

      uninstall: async (version: string): Promise<ActionResult> => {
        const i = mockInstalled.findIndex((v) => v.version === version)
        if (i !== -1) mockInstalled.splice(i, 1)
        return { success: true }
      },

      openInstallDir: async () => {
        alert('Mock: would open C:\\Users\\user\\.nodevm\\versions\\')
      },

      onInstallProgress: (cb: (data: { version: string; progress: number }) => void) => {
        progressCallbacks.push(cb)
      },

      removeInstallProgressListener: () => {
        progressCallbacks.length = 0
      },

      setupPath: async () => ({ success: true }),

      checkPath: async () => false,

      setupProfile: async () => ({ success: true }),

      checkProfile: async () => false,
    }

    console.info('[mock] window.nodevm mock injected for browser dev preview')
  }
}
