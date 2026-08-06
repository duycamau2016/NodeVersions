// Webview-side RPC bridge — SIDE-EFFECTFUL ON IMPORT, BY DESIGN.
//
// The React UI was written against Electron's `contextBridge`, where every call
// is a promise (`ipcRenderer.invoke`). A webview only has one-way
// `postMessage`, so we correlate requests and responses by id here and rebuild
// the exact same `window.nodevm` / `jdkvm` / `portvm` surface. Nothing under
// src/renderer/ needs to know which host it is running in.
//
// Why top-level side effects instead of an exported init(): SettingsTab.tsx and
// JdkSettingsTab.tsx read `window.platform.os` at MODULE scope. ES imports are
// hoisted, so a function called from main.tsx would run too late. Importing this
// module first is what guarantees the globals exist before App's module graph
// evaluates — see the import order in main.tsx.
import type { NodeApi, JdkApi, PortApi } from '../../src/renderer/types'

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

type Outbound = { __nvm: true; kind: 'invoke'; id: number; channel: string; args: unknown[] }
type Inbound =
  | { __nvm: true; kind: 'response'; id: number; result?: unknown; error?: string }
  | { __nvm: true; kind: 'event'; channel: string; data: unknown }

const vscode = acquireVsCodeApi()

const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
const listeners = new Map<string, ((data: any) => void)[]>()
let seq = 0

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    vscode.postMessage({ __nvm: true, kind: 'invoke', id, channel, args } satisfies Outbound)
  })
}

function on(channel: string, cb: (data: any) => void) {
  const list = listeners.get(channel) ?? []
  list.push(cb)
  listeners.set(channel, list)
}

window.addEventListener('message', (e: MessageEvent<Inbound>) => {
  const msg = e.data
  if (!msg || msg.__nvm !== true) return

  if (msg.kind === 'response') {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.result)
  } else if (msg.kind === 'event') {
    for (const cb of listeners.get(msg.channel) ?? []) cb(msg.data)
  }
})

/** The half of the API shared by both tools, parameterised by channel prefix. */
function vmApi(prefix: 'nvm' | 'jvm') {
  const progressChannel = `${prefix}:install-progress`
  return {
    listInstalled: () => invoke(`${prefix}:list-installed`),
    listRemote: () => invoke(`${prefix}:list-remote`),
    getCurrent: () => invoke(`${prefix}:current`),
    use: (target: string) => invoke(`${prefix}:use`, target),
    install: (version: string) => invoke(`${prefix}:install`, version),
    uninstall: (version: string) => invoke(`${prefix}:uninstall`, version),
    openInstallDir: () => invoke(`${prefix}:open-install-dir`),
    onInstallProgress: (cb: (data: { version: string; progress: number }) => void) =>
      on(progressChannel, cb),
    removeInstallProgressListener: () => {
      listeners.delete(progressChannel)
    },
  }
}

// The extension stamps the host OS into the HTML it generates — a meta tag
// rather than an inline script so the CSP needs no extra allowance.
const hostOs =
  document.querySelector('meta[name="nvm-platform"]')?.getAttribute('content') ?? 'win32'

window.__NVM_HOST__ = 'vscode'
window.platform = { os: hostOs as 'win32' | 'darwin' | 'linux' }

// VS Code webviews run in a sandboxed iframe that does not grant `allow-modals`,
// so the browser's confirm()/alert() do not work. The shared components call
// both (InstalledTab, PortsTab, SettingsTab, JdkSettingsTab).
//
// confirm(): cannot be answered asynchronously, so it returns true here and the
// *real* confirmation is a native VS Code modal raised host-side, inside the
// destructive handlers themselves (see confirmDestructive in panel.ts). That
// also makes the command-palette path and the panel path share one dialog.
const alwaysConfirm = () => true
window.confirm = alwaysConfirm

// alert(): returns void, so it can go through the async channel as-is.
const routedAlert = (message?: unknown) => {
  void invoke('ui:alert', String(message ?? ''))
}
window.alert = routedAlert

// If either override silently fails to stick (a non-writable property on some
// host), uninstall and kill-port become no-ops — the native confirm() would be
// blocked by the sandbox and return false. Identity-compare rather than calling
// confirm(), which would pop a real dialog on a host where the assignment did
// take. Fail loudly instead of silently.
if (window.confirm !== alwaysConfirm || window.alert !== routedAlert) {
  void invoke(
    'ui:alert',
    'Node & JDK Version Manager: the webview could not override confirm()/alert(). ' +
      'Uninstall and kill-port may not work — please report this.',
  )
}

window.nodevm = {
  ...vmApi('nvm'),
  setupPath: () => invoke('nvm:setup-path'),
  checkPath: () => invoke('nvm:check-path'),
  setupProfile: () => invoke('nvm:setup-profile'),
  checkProfile: () => invoke('nvm:check-profile'),
} as NodeApi

window.jdkvm = {
  ...vmApi('jvm'),
  setupEnv: () => invoke('jvm:setup-env'),
  checkEnv: () => invoke('jvm:check-env'),
  setupProfile: () => invoke('jvm:setup-profile'),
  checkProfile: () => invoke('jvm:check-profile'),
} as JdkApi

window.portvm = {
  listPorts: () => invoke('port:list'),
  killPort: (pid: number) => invoke('port:kill', pid),
} as PortApi
