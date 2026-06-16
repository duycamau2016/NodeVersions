"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('nodevm', {
    listInstalled: () => electron_1.ipcRenderer.invoke('nvm:list-installed'),
    listRemote: () => electron_1.ipcRenderer.invoke('nvm:list-remote'),
    getCurrent: () => electron_1.ipcRenderer.invoke('nvm:current'),
    use: (version) => electron_1.ipcRenderer.invoke('nvm:use', version),
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
    use: (version) => electron_1.ipcRenderer.invoke('jvm:use', version),
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
