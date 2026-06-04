// Type declarations for the preload-exposed API
export interface InstalledVersion {
  version: string
  isCurrent: boolean
  path: string
}

export interface RemoteVersion {
  version: string
  lts: string | false
  date: string
}

export interface ActionResult {
  success: boolean
  error?: string
}

declare global {
  interface Window {
    nodevm: {
      listInstalled: () => Promise<InstalledVersion[]>
      listRemote: () => Promise<RemoteVersion[]>
      getCurrent: () => Promise<string | null>
      use: (version: string) => Promise<ActionResult>
      install: (version: string) => Promise<ActionResult>
      uninstall: (version: string) => Promise<ActionResult>
      openInstallDir: () => Promise<void>
      onInstallProgress: (cb: (data: { version: string; progress: number }) => void) => void
      removeInstallProgressListener: () => void
      setupPath: () => Promise<ActionResult>
      checkPath: () => Promise<boolean>
      setupProfile: () => Promise<ActionResult>
      checkProfile: () => Promise<boolean>
    }
  }
}
