// Browser dev mock — injected when window.nodevm / window.jdkvm are not
// available (running in a browser, not Electron)
import type { InstalledVersion, RemoteVersion, ActionResult } from './types'

const mockNodeInstalled: InstalledVersion[] = [
  { version: 'v22.13.0', isCurrent: true, path: 'C:\\Users\\user\\.nodevm\\versions\\v22.13.0' },
  { version: 'v20.19.0', isCurrent: false, path: 'C:\\Users\\user\\.nodevm\\versions\\v20.19.0' },
  { version: 'v18.20.5', isCurrent: false, path: 'C:\\Users\\user\\.nodevm\\versions\\v18.20.5' },
  { version: 'v20.11.0', isCurrent: false, path: 'C:\\Program Files\\nodejs', external: true },
]

const mockNodeRemote: RemoteVersion[] = [
  { version: 'v24.1.0', lts: false, date: '2025-05-06' },
  { version: 'v22.13.0', lts: 'Jod', date: '2025-01-13' },
  { version: 'v20.19.0', lts: 'Iron', date: '2025-02-06' },
  { version: 'v18.20.5', lts: 'Hydrogen', date: '2024-07-08' },
  { version: 'v16.20.2', lts: 'Gallium', date: '2023-08-10' },
]

const mockJdkInstalled: InstalledVersion[] = [
  { version: 'jdk-21.0.11+10', isCurrent: true, path: 'C:\\Users\\user\\.jdkvm\\versions\\jdk-21.0.11+10' },
  { version: 'jdk-17.0.13+11', isCurrent: false, path: 'C:\\Users\\user\\.jdkvm\\versions\\jdk-17.0.13+11' },
  { version: '1.8.0_392', isCurrent: false, path: 'C:\\Program Files\\Java\\jdk1.8.0_392', external: true },
]

const mockJdkRemote: RemoteVersion[] = [
  { version: 'jdk-26+8', lts: false, date: '2026-03-17' },
  { version: 'jdk-25.0.1+9', lts: 'Java 25', date: '2026-04-23' },
  { version: 'jdk-21.0.11+10', lts: 'Java 21', date: '2026-04-23' },
  { version: 'jdk-17.0.13+11', lts: 'Java 17', date: '2025-10-15' },
  { version: 'jdk-11.0.25+9', lts: 'Java 11', date: '2025-10-15' },
  { version: 'jdk-8u432-b06', lts: 'Java 8', date: '2025-10-15' },
]

// Builds a mock implementation of the common VM surface backed by mutable arrays.
function makeMockVm(installed: InstalledVersion[], remote: RemoteVersion[], initialCurrent: string) {
  // Track the active install by path so system/external installs work like the real managers
  let currentPath = installed.find((v) => v.version === initialCurrent)?.path ?? ''
  const progressCallbacks: Array<(data: { version: string; progress: number }) => void> = []

  return {
    listInstalled: async (): Promise<InstalledVersion[]> =>
      installed.map((v) => ({ ...v, isCurrent: v.path === currentPath })),

    listRemote: async (): Promise<RemoteVersion[]> => {
      await new Promise((r) => setTimeout(r, 800)) // simulate network
      return remote
    },

    getCurrent: async (): Promise<string | null> =>
      installed.find((v) => v.path === currentPath)?.version ?? null,

    use: async (target: string): Promise<ActionResult> => {
      currentPath = target
      return { success: true }
    },

    install: async (version: string): Promise<ActionResult> => {
      for (let p = 10; p <= 100; p += 10) {
        await new Promise((r) => setTimeout(r, 300))
        progressCallbacks.forEach((cb) => cb({ version, progress: p }))
      }
      if (!installed.find((v) => v.version === version)) {
        installed.unshift({ version, isCurrent: false, path: `C:\\mock\\${version}` })
      }
      return { success: true }
    },

    uninstall: async (version: string): Promise<ActionResult> => {
      const i = installed.findIndex((v) => v.version === version)
      if (i !== -1) installed.splice(i, 1)
      return { success: true }
    },

    openInstallDir: async () => {
      alert('Mock: would open the versions folder')
    },

    onInstallProgress: (cb: (data: { version: string; progress: number }) => void) => {
      progressCallbacks.push(cb)
    },

    removeInstallProgressListener: () => {
      progressCallbacks.length = 0
    },

    setupProfile: async () => ({ success: true }),
    checkProfile: async () => false,
  }
}

export function injectBrowserMock() {
  if (typeof window === 'undefined') return
  const w = window as unknown as Record<string, unknown>

  if (!window.nodevm) {
    w.nodevm = {
      ...makeMockVm(mockNodeInstalled, mockNodeRemote, 'v22.13.0'),
      setupPath: async () => ({ success: true }),
      checkPath: async () => false,
    }
    console.info('[mock] window.nodevm mock injected for browser dev preview')
  }

  if (!window.jdkvm) {
    w.jdkvm = {
      ...makeMockVm(mockJdkInstalled, mockJdkRemote, 'jdk-21.0.11+10'),
      setupEnv: async () => ({ success: true }),
      checkEnv: async () => false,
    }
    console.info('[mock] window.jdkvm mock injected for browser dev preview')
  }
}
