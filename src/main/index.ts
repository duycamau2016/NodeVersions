import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { autoUpdater } from 'electron-updater'
import { NodeManager } from './nodeManager'
import { JdkManager } from './jdkManager'
import { PortManager } from './portManager'

let win: BrowserWindow | null = null
const nodeManager = new NodeManager()
const jdkManager = new JdkManager()
const portManager = new PortManager()

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 700,
    minHeight: 500,
    title: 'Node Version Manager',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  setupAutoUpdate()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── Auto-update (electron-updater + GitHub Releases) ──────────
function setupAutoUpdate() {
  // Only meaningful in a packaged build; skip in dev to avoid noisy errors.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    win?.webContents.send('update:available', info.version)
  })
  autoUpdater.on('update-not-available', () => {
    win?.webContents.send('update:none')
  })
  autoUpdater.on('download-progress', (p) => {
    win?.webContents.send('update:progress', Math.round(p.percent))
  })
  autoUpdater.on('update-downloaded', (info) => {
    win?.webContents.send('update:downloaded', info.version)
  })
  autoUpdater.on('error', (err) => {
    win?.webContents.send('update:error', String(err?.message ?? err))
  })

  autoUpdater.checkForUpdates()
}

ipcMain.handle('update:check', () => {
  if (!app.isPackaged) return { success: false, error: 'Updates are only available in the installed app.' }
  return autoUpdater.checkForUpdates().then(
    () => ({ success: true }),
    (err) => ({ success: false, error: String(err?.message ?? err) }),
  )
})

// Quit and install the downloaded update. isSilent=false shows the installer;
// isForceRunAfter=true relaunches the app afterwards.
ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall(false, true)
})

ipcMain.handle('update:current-version', () => app.getVersion())

// ── IPC handlers ──────────────────────────────────────────────

ipcMain.handle('nvm:list-installed', () => nodeManager.listInstalled())

ipcMain.handle('nvm:list-remote', () => nodeManager.listRemote())

ipcMain.handle('nvm:current', () => nodeManager.getCurrent())

ipcMain.handle('nvm:use', (_e, target: string) => nodeManager.use(target))

ipcMain.handle('nvm:install', (_e, version: string) => {
  // Stream progress via webContents
  return nodeManager.install(version, (progress) => {
    win?.webContents.send('nvm:install-progress', { version, progress })
  })
})

ipcMain.handle('nvm:uninstall', (_e, version: string) => nodeManager.uninstall(version))

ipcMain.handle('nvm:open-install-dir', () => {
  shell.openPath(nodeManager.versionsDir)
})

ipcMain.handle('nvm:setup-path', () => nodeManager.setupPath())

ipcMain.handle('nvm:check-path', () => nodeManager.isPathConfigured())

ipcMain.handle('nvm:setup-profile', () => nodeManager.setupProfile())

ipcMain.handle('nvm:check-profile', () => nodeManager.isProfileConfigured())

// ── JDK (Java) IPC handlers ───────────────────────────────────

ipcMain.handle('jvm:list-installed', () => jdkManager.listInstalled())

ipcMain.handle('jvm:list-remote', () => jdkManager.listRemote())

ipcMain.handle('jvm:current', () => jdkManager.getCurrent())

ipcMain.handle('jvm:use', (_e, target: string) => jdkManager.use(target))

ipcMain.handle('jvm:install', (_e, version: string) => {
  return jdkManager.install(version, (progress) => {
    win?.webContents.send('jvm:install-progress', { version, progress })
  })
})

ipcMain.handle('jvm:uninstall', (_e, version: string) => jdkManager.uninstall(version))

ipcMain.handle('jvm:open-install-dir', () => {
  shell.openPath(jdkManager.versionsDir)
})

ipcMain.handle('jvm:setup-env', () => jdkManager.setupEnv())

ipcMain.handle('jvm:check-env', () => jdkManager.isEnvConfigured())

ipcMain.handle('jvm:setup-profile', () => jdkManager.setupProfile())

ipcMain.handle('jvm:check-profile', () => jdkManager.isProfileConfigured())

// ── Port monitor IPC handlers ─────────────────────────────────

ipcMain.handle('port:list', () => portManager.listPorts())

ipcMain.handle('port:kill', (_e, pid: number) => portManager.killProcess(pid))
