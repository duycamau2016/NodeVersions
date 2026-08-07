import fs from 'fs'
import path from 'path'
import https from 'https'
import { execSync, exec } from 'child_process'
import os from 'os'
import { promisify } from 'util'
import { ensureWinCmdHook, isWinCmdHookConfigured } from './winShell'

const execAsync = promisify(exec)

const IS_WIN = process.platform === 'win32'
/** Shell profile edited on macOS/Linux to persist PATH (zsh is the macOS default). */
const PROFILE_FILE = path.join(os.homedir(), '.zshrc')

export interface InstalledVersion {
  version: string
  isCurrent: boolean
  path: string
  /** true for Node installs already on the machine (not installed by this app) — read-only */
  external?: boolean
}

export interface RemoteVersion {
  version: string
  lts: string | false
  date: string
}

export class NodeManager {
  public readonly versionsDir: string
  private readonly symlinkPath: string

  constructor() {
    this.versionsDir = path.join(os.homedir(), '.nodevm', 'versions')
    this.symlinkPath = path.join(os.homedir(), '.nodevm', 'current')
    fs.mkdirSync(this.versionsDir, { recursive: true })
  }

  /** Absolute path to the node binary inside an install dir (platform-specific layout). */
  private _nodeBin(dir: string): string {
    return IS_WIN ? path.join(dir, 'node.exe') : path.join(dir, 'bin', 'node')
  }

  private _hasNode(dir: string): boolean {
    return fs.existsSync(this._nodeBin(dir))
  }

  listInstalled(): InstalledVersion[] {
    const currentPath = this.getCurrentPath()
    const byVersionDesc = (a: InstalledVersion, b: InstalledVersion) => {
      const pa = a.version.replace('v', '').split('.').map(Number)
      const pb = b.version.replace('v', '').split('.').map(Number)
      for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0)
      }
      return 0
    }

    const managed: InstalledVersion[] = (
      fs.existsSync(this.versionsDir) ? fs.readdirSync(this.versionsDir) : []
    )
      .filter((d) => {
        if (!d.startsWith('v')) return false
        const dir = path.join(this.versionsDir, d)
        return fs.statSync(dir).isDirectory() && this._hasNode(dir)
      })
      .map((version) => {
        const dir = path.join(this.versionsDir, version)
        return {
          version,
          isCurrent: this._isActive(dir, currentPath),
          path: dir,
          external: false,
        }
      })
      .sort(byVersionDesc)

    const managedPaths = new Set(managed.map((m) => this._canon(m.path)))
    const external = this._discoverExternal(managedPaths)
      .map((e) => ({ ...e, isCurrent: this._isActive(e.path, currentPath) }))
      .sort(byVersionDesc)

    return [...managed, ...external]
  }

  /** Find Node installs already on the machine (read-only) */
  private _discoverExternal(managedPaths: Set<string>): InstalledVersion[] {
    const found = new Map<string, InstalledVersion>()

    const add = (dir: string | undefined) => {
      if (!dir) return
      try {
        const norm = path.normalize(dir).replace(/[\\/]+$/, '')
        const key = this._canon(norm)
        if (found.has(key) || managedPaths.has(key)) return
        if (key.includes(`${path.sep}.nodevm${path.sep}`.toLowerCase())) return // our own tree
        const exe = this._nodeBin(norm)
        if (!fs.existsSync(exe)) return
        let version = ''
        try {
          version = execSync(`"${exe}" --version`, { encoding: 'utf8' }).trim()
        } catch {
          // fall back to folder name if the binary won't run
        }
        if (!version) version = path.basename(norm)
        found.set(key, { version, isCurrent: false, path: norm, external: true })
      } catch {
        // ignore unreadable candidate
      }
    }

    if (IS_WIN) {
      const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
      const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
      add(path.join(pf, 'nodejs'))
      add(path.join(pfx86, 'nodejs'))

      try {
        const out = execSync('where node 2>nul', { shell: 'cmd.exe', encoding: 'utf8' })
        for (const line of out.split(/\r?\n/)) {
          const p = line.trim()
          if (/node\.exe$/i.test(p)) add(path.dirname(p))
        }
      } catch {
        // node not on PATH
      }
    } else {
      // Common macOS/Homebrew prefixes, then anything resolvable from PATH.
      // Node lives at <prefix>/bin/node, so the install dir is the prefix.
      for (const bin of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) {
        if (fs.existsSync(bin)) add(path.dirname(path.dirname(fs.realpathSync(bin))))
      }
      try {
        const out = execSync('which -a node 2>/dev/null', { encoding: 'utf8' })
        for (const line of out.split(/\r?\n/)) {
          const p = line.trim()
          if (!p) continue
          try {
            const real = fs.realpathSync(p)
            add(path.dirname(path.dirname(real)))
          } catch {
            // unresolved entry
          }
        }
      } catch {
        // node not on PATH
      }
    }

    return Array.from(found.values())
  }

  getCurrent(): string | null {
    try {
      // realpathSync resolves the symlink/junction and canonicalises for display
      return path.basename(fs.realpathSync(this.symlinkPath))
    } catch {
      return null
    }
  }

  /** Canonical on-disk path the `current` link resolves to (null if unset) */
  private getCurrentPath(): string | null {
    return this._real(this.symlinkPath)
  }

  /** Canonicalise a path for comparison (case-insensitive on Windows). */
  private _canon(p: string): string {
    return IS_WIN ? p.toLowerCase() : p
  }

  /** Resolve a path to its canonical form, or null if it can't be resolved */
  private _real(p: string): string | null {
    try {
      return this._canon(fs.realpathSync(p))
    } catch {
      return null
    }
  }

  /** True when `dir` is the install the `current` link points at */
  private _isActive(dir: string, currentPath: string | null): boolean {
    if (currentPath === null) return false
    return this._real(dir) === currentPath
  }

  async listRemote(): Promise<RemoteVersion[]> {
    return new Promise((resolve, reject) => {
      const url = 'https://nodejs.org/dist/index.json'
      https
        .get(url, (res) => {
          let data = ''
          res.on('data', (c) => (data += c))
          res.on('end', () => {
            try {
              const all: Array<{ version: string; lts: string | false; date: string }> =
                JSON.parse(data)
              // Return only latest of each major
              const seen = new Set<number>()
              const filtered = all.filter((v) => {
                const major = parseInt(v.version.replace('v', '').split('.')[0])
                if (seen.has(major)) return false
                seen.add(major)
                return true
              })
              resolve(filtered.slice(0, 20))
            } catch (e) {
              reject(e)
            }
          })
        })
        .on('error', reject)
    })
  }

  async install(version: string, onProgress: (p: number) => void): Promise<{ success: boolean; error?: string }> {
    const destDir = path.join(this.versionsDir, version)
    if (fs.existsSync(destDir)) {
      return { success: false, error: `Version ${version} is already installed` }
    }

    return IS_WIN
      ? this._installWin(version, destDir, onProgress)
      : this._installUnix(version, destDir, onProgress)
  }

  private async _installWin(
    version: string,
    destDir: string,
    onProgress: (p: number) => void,
  ): Promise<{ success: boolean; error?: string }> {
    const arch = process.arch === 'x64' ? 'x64' : 'x86'
    const fileName = `node-${version}-win-${arch}`
    const downloadUrl = `https://nodejs.org/dist/${version}/${fileName}.zip`
    const tmpZip = path.join(os.tmpdir(), `${fileName}.zip`)

    try {
      await this._download(downloadUrl, tmpZip, onProgress)

      const tmpExtract = path.join(os.tmpdir(), `nodevm_${version}`)
      fs.mkdirSync(tmpExtract, { recursive: true })

      await execAsync(
        `powershell -Command "Expand-Archive -Force -Path '${tmpZip}' -DestinationPath '${tmpExtract}'"`,
      )

      const extracted = path.join(tmpExtract, fileName)
      if (!fs.existsSync(extracted)) {
        throw new Error(`Extraction failed: expected folder not found at ${extracted}`)
      }

      await execAsync(`xcopy /E /I /Q "${extracted}" "${destDir}"`, { shell: 'cmd.exe' })

      if (!this._hasNode(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true })
        throw new Error('node.exe not found after extraction — download may be corrupted')
      }

      fs.rmSync(tmpZip, { force: true })
      fs.rmSync(tmpExtract, { recursive: true, force: true })

      onProgress(100)
      return { success: true }
    } catch (e: unknown) {
      fs.rmSync(tmpZip, { force: true })
      return { success: false, error: String(e) }
    }
  }

  private async _installUnix(
    version: string,
    destDir: string,
    onProgress: (p: number) => void,
  ): Promise<{ success: boolean; error?: string }> {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const fileName = `node-${version}-darwin-${arch}`
    const downloadUrl = `https://nodejs.org/dist/${version}/${fileName}.tar.gz`
    const tmpTar = path.join(os.tmpdir(), `${fileName}.tar.gz`)

    try {
      await this._download(downloadUrl, tmpTar, onProgress)

      // Extract the tarball's single top-level folder straight into destDir.
      fs.mkdirSync(destDir, { recursive: true })
      await execAsync(`tar -xzf "${tmpTar}" -C "${destDir}" --strip-components=1`)

      if (!this._hasNode(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true })
        throw new Error('bin/node not found after extraction — download may be corrupted')
      }

      fs.rmSync(tmpTar, { force: true })

      onProgress(100)
      return { success: true }
    } catch (e: unknown) {
      fs.rmSync(tmpTar, { force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
      return { success: false, error: String(e) }
    }
  }

  /**
   * Activate an install. `target` is the install directory — either a managed
   * version folder name (e.g. "v22.13.0") or an absolute path to a system/external
   * Node install.
   */
  use(target: string): { success: boolean; error?: string } {
    const versionDir = path.isAbsolute(target)
      ? path.normalize(target)
      : path.join(this.versionsDir, target)

    if (!this._hasNode(versionDir)) {
      return { success: false, error: `No Node install found at ${versionDir}` }
    }

    try {
      this._relink(versionDir)
      return { success: true }
    } catch (e: unknown) {
      return { success: false, error: String(e) }
    }
  }

  /** Repoint the `current` link at `versionDir` (junction on Windows, symlink elsewhere). */
  private _relink(versionDir: string): void {
    if (IS_WIN) {
      if (fs.existsSync(this.symlinkPath)) {
        execSync(`rmdir "${this.symlinkPath}"`, { shell: 'cmd.exe' })
      }
      execSync(`mklink /J "${this.symlinkPath}" "${versionDir}"`, { shell: 'cmd.exe' })
    } else {
      try {
        fs.unlinkSync(this.symlinkPath) // remove existing symlink without touching its target
      } catch {
        // nothing to remove
      }
      fs.symlinkSync(versionDir, this.symlinkPath, 'dir')
    }
  }

  uninstall(version: string): { success: boolean; error?: string } {
    const versionDir = path.join(this.versionsDir, version)
    if (!fs.existsSync(versionDir)) {
      return { success: false, error: `Version ${version} is not installed` }
    }

    const current = this.getCurrent()
    if (current === version) {
      return { success: false, error: `Cannot uninstall the currently active version` }
    }

    try {
      fs.rmSync(versionDir, { recursive: true, force: true })
      return { success: true }
    } catch (e: unknown) {
      return { success: false, error: String(e) }
    }
  }

  /** Check if ~/.nodevm/current is already wired into the shell/user PATH */
  isPathConfigured(): boolean {
    if (IS_WIN) {
      try {
        const userPath = execSync(
          `powershell -Command "[System.Environment]::GetEnvironmentVariable('Path', 'User')"`,
          { shell: 'cmd.exe', encoding: 'utf8' },
        ).trim()
        return userPath.toLowerCase().includes(this.symlinkPath.toLowerCase())
      } catch {
        return false
      }
    }
    return this._profileHasMarker()
  }

  /** Prepend ~/.nodevm/current to user PATH permanently (no admin needed) */
  setupPath(): { success: boolean; error?: string } {
    if (IS_WIN) {
      try {
        const currentPath = execSync(
          `powershell -Command "[System.Environment]::GetEnvironmentVariable('Path', 'User')"`,
          { shell: 'cmd.exe', encoding: 'utf8' },
        ).trim()

        if (currentPath.toLowerCase().includes(this.symlinkPath.toLowerCase())) {
          return { success: true }
        }

        const newPath = currentPath ? `${this.symlinkPath};${currentPath}` : this.symlinkPath

        execSync(
          `powershell -Command "[System.Environment]::SetEnvironmentVariable('Path', '${newPath}', 'User')"`,
          { shell: 'cmd.exe' },
        )

        return { success: true }
      } catch (e: unknown) {
        return { success: false, error: String(e) }
      }
    }
    // macOS/Linux: PATH is configured via the shell profile (same as setupProfile).
    return this.setupProfile()
  }

  /** Check if PowerShell profile + CMD AutoRun both prepend the active Node */
  isProfileConfigured(): boolean {
    if (IS_WIN) {
      try {
        const profilePath = execSync(
          'powershell -Command "$PROFILE.CurrentUserAllHosts"',
          { shell: 'cmd.exe', encoding: 'utf8' },
        ).trim()
        if (!fs.existsSync(profilePath)) return false
        const content = fs.readFileSync(profilePath, 'utf8')
        const psOk = content.includes('.nodevm\\current')
        return psOk && isWinCmdHookConfigured('nodevm')
      } catch {
        return false
      }
    }
    return this._profileHasMarker()
  }

  /**
   * Inject PATH prepends so every new terminal picks up the active version.
   * Windows: PowerShell $PROFILE + CMD AutoRun (System PATH beats User PATH).
   * macOS/Linux: ~/.zshrc.
   */
  setupProfile(): { success: boolean; error?: string } {
    if (IS_WIN) {
      try {
        const profilePath = execSync(
          'powershell -Command "$PROFILE.CurrentUserAllHosts"',
          { shell: 'cmd.exe', encoding: 'utf8' },
        ).trim()

        const profileDir = path.dirname(profilePath)
        fs.mkdirSync(profileDir, { recursive: true })

        const line = `\n# NodeVM — prepend active version to PATH\n$env:Path = "$env:USERPROFILE\\.nodevm\\current;$env:Path"\n`

        if (fs.existsSync(profilePath)) {
          const existing = fs.readFileSync(profilePath, 'utf8')
          if (!existing.includes('.nodevm\\current')) {
            fs.appendFileSync(profilePath, line, 'utf8')
          }
        } else {
          fs.writeFileSync(profilePath, line, 'utf8')
        }

        execSync(
          'powershell -Command "Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force"',
          { shell: 'cmd.exe' },
        )

        // CMD does not read $PROFILE — wire HKCU AutoRun instead.
        ensureWinCmdHook('nodevm')

        return { success: true }
      } catch (e: unknown) {
        return { success: false, error: String(e) }
      }
    }

    // macOS/Linux — prepend ~/.nodevm/current/bin to PATH in ~/.zshrc
    try {
      const block =
        `\n# NodeVM — prepend active version to PATH\n` +
        `export PATH="$HOME/.nodevm/current/bin:$PATH"\n`
      if (this._profileHasMarker()) return { success: true }
      fs.appendFileSync(PROFILE_FILE, block, 'utf8')
      return { success: true }
    } catch (e: unknown) {
      return { success: false, error: String(e) }
    }
  }

  private _profileHasMarker(): boolean {
    try {
      if (!fs.existsSync(PROFILE_FILE)) return false
      return fs.readFileSync(PROFILE_FILE, 'utf8').includes('.nodevm/current')
    } catch {
      return false
    }
  }

  private _download(url: string, dest: string, onProgress: (p: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest)
      https
        .get(url, (res) => {
          // Follow redirects
          if (res.statusCode === 301 || res.statusCode === 302) {
            file.close()
            this._download(res.headers.location!, dest, onProgress).then(resolve).catch(reject)
            return
          }
          const total = parseInt(res.headers['content-length'] || '0')
          let downloaded = 0
          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length
            if (total > 0) onProgress(Math.round((downloaded / total) * 90))
          })
          res.pipe(file)
          file.on('finish', () => {
            file.close()
            resolve()
          })
        })
        .on('error', (e) => {
          fs.unlink(dest, () => {})
          reject(e)
        })
    })
  }
}
