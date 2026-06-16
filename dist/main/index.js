"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const nodeManager_1 = require("./nodeManager");
const jdkManager_1 = require("./jdkManager");
let win = null;
const nodeManager = new nodeManager_1.NodeManager();
const jdkManager = new jdkManager_1.JdkManager();
function createWindow() {
    win = new electron_1.BrowserWindow({
        width: 900,
        height: 680,
        minWidth: 700,
        minHeight: 500,
        title: 'Node Version Manager',
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        autoHideMenuBar: true,
    });
    if (process.env.VITE_DEV_SERVER_URL) {
        win.loadURL(process.env.VITE_DEV_SERVER_URL);
        win.webContents.openDevTools();
    }
    else {
        win.loadFile(path_1.default.join(__dirname, '../renderer/index.html'));
    }
}
electron_1.app.whenReady().then(createWindow);
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
// ── IPC handlers ──────────────────────────────────────────────
electron_1.ipcMain.handle('nvm:list-installed', () => nodeManager.listInstalled());
electron_1.ipcMain.handle('nvm:list-remote', () => nodeManager.listRemote());
electron_1.ipcMain.handle('nvm:current', () => nodeManager.getCurrent());
electron_1.ipcMain.handle('nvm:use', (_e, version) => nodeManager.use(version));
electron_1.ipcMain.handle('nvm:install', (_e, version) => {
    // Stream progress via webContents
    return nodeManager.install(version, (progress) => {
        win?.webContents.send('nvm:install-progress', { version, progress });
    });
});
electron_1.ipcMain.handle('nvm:uninstall', (_e, version) => nodeManager.uninstall(version));
electron_1.ipcMain.handle('nvm:open-install-dir', () => {
    electron_1.shell.openPath(nodeManager.versionsDir);
});
electron_1.ipcMain.handle('nvm:setup-path', () => nodeManager.setupPath());
electron_1.ipcMain.handle('nvm:check-path', () => nodeManager.isPathConfigured());
electron_1.ipcMain.handle('nvm:setup-profile', () => nodeManager.setupProfile());
electron_1.ipcMain.handle('nvm:check-profile', () => nodeManager.isProfileConfigured());
// ── JDK (Java) IPC handlers ───────────────────────────────────
electron_1.ipcMain.handle('jvm:list-installed', () => jdkManager.listInstalled());
electron_1.ipcMain.handle('jvm:list-remote', () => jdkManager.listRemote());
electron_1.ipcMain.handle('jvm:current', () => jdkManager.getCurrent());
electron_1.ipcMain.handle('jvm:use', (_e, version) => jdkManager.use(version));
electron_1.ipcMain.handle('jvm:install', (_e, version) => {
    return jdkManager.install(version, (progress) => {
        win?.webContents.send('jvm:install-progress', { version, progress });
    });
});
electron_1.ipcMain.handle('jvm:uninstall', (_e, version) => jdkManager.uninstall(version));
electron_1.ipcMain.handle('jvm:open-install-dir', () => {
    electron_1.shell.openPath(jdkManager.versionsDir);
});
electron_1.ipcMain.handle('jvm:setup-env', () => jdkManager.setupEnv());
electron_1.ipcMain.handle('jvm:check-env', () => jdkManager.isEnvConfigured());
electron_1.ipcMain.handle('jvm:setup-profile', () => jdkManager.setupProfile());
electron_1.ipcMain.handle('jvm:check-profile', () => jdkManager.isProfileConfigured());
