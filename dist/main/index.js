"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const electron_updater_1 = require("electron-updater");
const nodeManager_1 = require("./nodeManager");
const jdkManager_1 = require("./jdkManager");
const portManager_1 = require("./portManager");
let win = null;
const nodeManager = new nodeManager_1.NodeManager();
const jdkManager = new jdkManager_1.JdkManager();
const portManager = new portManager_1.PortManager();
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
electron_1.app.whenReady().then(() => {
    createWindow();
    setupAutoUpdate();
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
// ── Auto-update (electron-updater + GitHub Releases) ──────────
// True while a user-initiated check is running. The automatic startup check
// stays silent — its failures (no releases yet, offline, 404) must not surface
// as scary banners.
let manualUpdateCheck = false;
function setupAutoUpdate() {
    // Only meaningful in a packaged build; skip in dev to avoid noisy errors.
    if (!electron_1.app.isPackaged)
        return;
    electron_updater_1.autoUpdater.autoDownload = true;
    electron_updater_1.autoUpdater.autoInstallOnAppQuit = true;
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        win?.webContents.send('update:available', info.version);
    });
    electron_updater_1.autoUpdater.on('update-not-available', () => {
        if (manualUpdateCheck)
            win?.webContents.send('update:none');
    });
    electron_updater_1.autoUpdater.on('download-progress', (p) => {
        win?.webContents.send('update:progress', Math.round(p.percent));
    });
    electron_updater_1.autoUpdater.on('update-downloaded', (info) => {
        win?.webContents.send('update:downloaded', info.version);
    });
    electron_updater_1.autoUpdater.on('error', (err) => {
        const message = String(err?.message ?? err);
        // Only bother the user about errors when they explicitly asked to check.
        if (manualUpdateCheck)
            win?.webContents.send('update:error', message);
        else
            console.warn('[auto-update] background check failed:', message);
    });
    // Silent background check — swallow the promise rejection.
    electron_updater_1.autoUpdater.checkForUpdates().catch(() => { });
}
electron_1.ipcMain.handle('update:check', async () => {
    if (!electron_1.app.isPackaged)
        return { success: false, error: 'Updates are only available in the installed app.' };
    manualUpdateCheck = true;
    try {
        await electron_updater_1.autoUpdater.checkForUpdates();
        return { success: true };
    }
    catch (err) {
        return { success: false, error: String(err?.message ?? err) };
    }
    finally {
        manualUpdateCheck = false;
    }
});
// Quit and install the downloaded update. isSilent=false shows the installer;
// isForceRunAfter=true relaunches the app afterwards.
electron_1.ipcMain.handle('update:install', () => {
    electron_updater_1.autoUpdater.quitAndInstall(false, true);
});
electron_1.ipcMain.handle('update:current-version', () => electron_1.app.getVersion());
// ── IPC handlers ──────────────────────────────────────────────
electron_1.ipcMain.handle('nvm:list-installed', () => nodeManager.listInstalled());
electron_1.ipcMain.handle('nvm:list-remote', () => nodeManager.listRemote());
electron_1.ipcMain.handle('nvm:current', () => nodeManager.getCurrent());
electron_1.ipcMain.handle('nvm:use', (_e, target) => nodeManager.use(target));
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
electron_1.ipcMain.handle('jvm:use', (_e, target) => jdkManager.use(target));
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
// ── Port monitor IPC handlers ─────────────────────────────────
electron_1.ipcMain.handle('port:list', () => portManager.listPorts());
electron_1.ipcMain.handle('port:kill', (_e, pid) => portManager.killProcess(pid));
