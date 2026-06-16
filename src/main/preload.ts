import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('nodevm', {
  listInstalled: () => ipcRenderer.invoke('nvm:list-installed'),
  listRemote: () => ipcRenderer.invoke('nvm:list-remote'),
  getCurrent: () => ipcRenderer.invoke('nvm:current'),
  use: (version: string) => ipcRenderer.invoke('nvm:use', version),
  install: (version: string) => ipcRenderer.invoke('nvm:install', version),
  uninstall: (version: string) => ipcRenderer.invoke('nvm:uninstall', version),
  openInstallDir: () => ipcRenderer.invoke('nvm:open-install-dir'),
  onInstallProgress: (cb: (data: { version: string; progress: number }) => void) => {
    ipcRenderer.on('nvm:install-progress', (_e, data) => cb(data))
  },
  removeInstallProgressListener: () => {
    ipcRenderer.removeAllListeners('nvm:install-progress')
  },
  setupPath: () => ipcRenderer.invoke('nvm:setup-path'),
  checkPath: () => ipcRenderer.invoke('nvm:check-path'),
  setupProfile: () => ipcRenderer.invoke('nvm:setup-profile'),
  checkProfile: () => ipcRenderer.invoke('nvm:check-profile'),
})

contextBridge.exposeInMainWorld('jdkvm', {
  listInstalled: () => ipcRenderer.invoke('jvm:list-installed'),
  listRemote: () => ipcRenderer.invoke('jvm:list-remote'),
  getCurrent: () => ipcRenderer.invoke('jvm:current'),
  use: (version: string) => ipcRenderer.invoke('jvm:use', version),
  install: (version: string) => ipcRenderer.invoke('jvm:install', version),
  uninstall: (version: string) => ipcRenderer.invoke('jvm:uninstall', version),
  openInstallDir: () => ipcRenderer.invoke('jvm:open-install-dir'),
  onInstallProgress: (cb: (data: { version: string; progress: number }) => void) => {
    ipcRenderer.on('jvm:install-progress', (_e, data) => cb(data))
  },
  removeInstallProgressListener: () => {
    ipcRenderer.removeAllListeners('jvm:install-progress')
  },
  setupEnv: () => ipcRenderer.invoke('jvm:setup-env'),
  checkEnv: () => ipcRenderer.invoke('jvm:check-env'),
  setupProfile: () => ipcRenderer.invoke('jvm:setup-profile'),
  checkProfile: () => ipcRenderer.invoke('jvm:check-profile'),
})
