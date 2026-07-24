"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('platform', {
    os: process.platform, // 'win32' | 'darwin' | 'linux'
});
electron_1.contextBridge.exposeInMainWorld('nodevm', {
    listInstalled: () => electron_1.ipcRenderer.invoke('nvm:list-installed'),
    listRemote: () => electron_1.ipcRenderer.invoke('nvm:list-remote'),
    getCurrent: () => electron_1.ipcRenderer.invoke('nvm:current'),
    use: (target) => electron_1.ipcRenderer.invoke('nvm:use', target),
    install: (version) => electron_1.ipcRenderer.invoke('nvm:install', version),
    uninstall: (version) => electron_1.ipcRenderer.invoke('nvm:uninstall', version),
    openInstallDir: () => electron_1.ipcRenderer.invoke('nvm:open-install-dir'),
    onInstallProgress: (cb) => {
        electron_1.ipcRenderer.on('nvm:install-progress', (_e, data) => cb(data));
    },
    removeInstallProgressListener: () => {
        electron_1.ipcRenderer.removeAllListeners('nvm:install-progress');
    },
    setupPath: () => electron_1.ipcRenderer.invoke('nvm:setup-path'),
    checkPath: () => electron_1.ipcRenderer.invoke('nvm:check-path'),
    setupProfile: () => electron_1.ipcRenderer.invoke('nvm:setup-profile'),
    checkProfile: () => electron_1.ipcRenderer.invoke('nvm:check-profile'),
});
electron_1.contextBridge.exposeInMainWorld('jdkvm', {
    listInstalled: () => electron_1.ipcRenderer.invoke('jvm:list-installed'),
    listRemote: () => electron_1.ipcRenderer.invoke('jvm:list-remote'),
    getCurrent: () => electron_1.ipcRenderer.invoke('jvm:current'),
    use: (target) => electron_1.ipcRenderer.invoke('jvm:use', target),
    install: (version) => electron_1.ipcRenderer.invoke('jvm:install', version),
    uninstall: (version) => electron_1.ipcRenderer.invoke('jvm:uninstall', version),
    openInstallDir: () => electron_1.ipcRenderer.invoke('jvm:open-install-dir'),
    onInstallProgress: (cb) => {
        electron_1.ipcRenderer.on('jvm:install-progress', (_e, data) => cb(data));
    },
    removeInstallProgressListener: () => {
        electron_1.ipcRenderer.removeAllListeners('jvm:install-progress');
    },
    setupEnv: () => electron_1.ipcRenderer.invoke('jvm:setup-env'),
    checkEnv: () => electron_1.ipcRenderer.invoke('jvm:check-env'),
    setupProfile: () => electron_1.ipcRenderer.invoke('jvm:setup-profile'),
    checkProfile: () => electron_1.ipcRenderer.invoke('jvm:check-profile'),
});
electron_1.contextBridge.exposeInMainWorld('portvm', {
    listPorts: () => electron_1.ipcRenderer.invoke('port:list'),
    killPort: (pid) => electron_1.ipcRenderer.invoke('port:kill', pid),
});
electron_1.contextBridge.exposeInMainWorld('updatevm', {
    check: () => electron_1.ipcRenderer.invoke('update:check'),
    install: () => electron_1.ipcRenderer.invoke('update:install'),
    getCurrentVersion: () => electron_1.ipcRenderer.invoke('update:current-version'),
    onAvailable: (cb) => electron_1.ipcRenderer.on('update:available', (_e, version) => cb(version)),
    onNone: (cb) => electron_1.ipcRenderer.on('update:none', () => cb()),
    onProgress: (cb) => electron_1.ipcRenderer.on('update:progress', (_e, percent) => cb(percent)),
    onDownloaded: (cb) => electron_1.ipcRenderer.on('update:downloaded', (_e, version) => cb(version)),
    onError: (cb) => electron_1.ipcRenderer.on('update:error', (_e, message) => cb(message)),
    removeListeners: () => {
        for (const ch of ['update:available', 'update:none', 'update:progress', 'update:downloaded', 'update:error']) {
            electron_1.ipcRenderer.removeAllListeners(ch);
        }
    },
});
