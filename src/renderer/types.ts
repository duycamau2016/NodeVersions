// Type declarations for the preload-exposed API
export interface InstalledVersion {
  version: string
  isCurrent: boolean
  path: string
  /** true for installs already on the machine (not managed by this app) — read-only */
  external?: boolean
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

// Common surface shared by the Node and JDK managers — used by the
// generic Install / Installed tabs so they work for either tool.
export interface VmApi {
  listInstalled: () => Promise<InstalledVersion[]>
  listRemote: () => Promise<RemoteVersion[]>
  getCurrent: () => Promise<string | null>
  /** Activate an install by its directory path (works for managed and system/external installs) */
  use: (target: string) => Promise<ActionResult>
  install: (version: string) => Promise<ActionResult>
  uninstall: (version: string) => Promise<ActionResult>
  openInstallDir: () => Promise<void>
  onInstallProgress: (cb: (data: { version: string; progress: number }) => void) => void
  removeInstallProgressListener: () => void
}

export interface NodeApi extends VmApi {
  setupPath: () => Promise<ActionResult>
  checkPath: () => Promise<boolean>
  setupProfile: () => Promise<ActionResult>
  checkProfile: () => Promise<boolean>
}

export interface JdkApi extends VmApi {
  setupEnv: () => Promise<ActionResult>
  checkEnv: () => Promise<boolean>
  setupProfile: () => Promise<ActionResult>
  checkProfile: () => Promise<boolean>
}

export interface PlatformApi {
  os: 'win32' | 'darwin' | 'linux'
}

declare global {
  interface Window {
    nodevm: NodeApi
    jdkvm: JdkApi
    platform: PlatformApi
  }
}
