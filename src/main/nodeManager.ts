import fs from 'fs'
import path from 'path'
import https from 'https'
import { execSync, exec } from 'child_process'
import os from 'os'
import { promisify } from 'util'
import { createGunzip } from 'zlib'

const execAsync = promisify(exec)

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
        return (
          fs.statSync(dir).isDirectory() &&
          fs.existsSync(path.join(dir, 'node.exe'))
        )
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

    const managedPaths = new Set(managed.map((m) => m.path.toLowerCase()))
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
        const lower = norm.toLowerCase()
        if (found.has(lower) || managedPaths.has(lower)) return
        if (lower.includes('\\.nodevm\\')) return // our own managed/junction tree
        const exe = path.join(norm, 'node.exe')
        if (!fs.existsSync(exe)) return
        let version = ''
        try {
          version = execSync(`"${exe}" --version`, { encoding: 'utf8' }).trim()
        } catch {
          // fall back to folder name if the binary won't run
        }
        if (!version) version = path.basename(norm)
        found.set(lower, { version, isCurrent: false, path: norm, external: true })
      } catch {
        // ignore unreadable candidate
      }
    }

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

    return Array.from(found.values())
  }

  getCurrent(): string | null {
    try {
      // realpathSync resolves the junction and canonicalises casing for display
      return path.basename(fs.realpathSync(this.symlinkPath))
    } catch {
      return null
    }
  }

  /** Canonical, lower-cased on-disk path the `current` junction resolves to (null if unset) */
  private getCurrentPath(): string | null {
    return this._realLower(this.symlinkPath)
  }

  /** Resolve a path to its canonical lower-cased form, or null if it can't be resolved */
  private _realLower(p: string): string | null {
    try {
      return fs.realpathSync(p).toLowerCase()
    } catch {
      return null
    }
  }

  /** True when `dir` is the install the `current` junction points at */
  private _isActive(dir: string, currentPath: string | null): boolean {
    if (currentPath === null) return false
    return this._realLower(dir) === currentPath
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
    const arch = process.arch === 'x64' ? 'x64' : 'x86'
    const fileName = `node-${version}-win-${arch}`
    const downloadUrl = `https://nodejs.org/dist/${version}/${fileName}.zip`
    const destDir = path.join(this.versionsDir, version)

    if (fs.existsSync(destDir)) {
      return { success: false, error: `Version ${version} is already installed` }
    }

    const tmpZip = path.join(os.tmpdir(), `${fileName}.zip`)

    try {
      // Download
      await this._download(downloadUrl, tmpZip, onProgress)

      // Extract using PowerShell (no external deps)
      const tmpExtract = path.join(os.tmpdir(), `nodevm_${version}`)
      fs.mkdirSync(tmpExtract, { recursive: true })

      await execAsync(
        `powershell -Command "Expand-Archive -Force -Path '${tmpZip}' -DestinationPath '${tmpExtract}'"`,
      )

      // Move extracted folder to versionsDir
      const extracted = path.join(tmpExtract, fileName)
      if (!fs.existsSync(extracted)) {
        throw new Error(`Extraction failed: expected folder not found at ${extracted}`)
      }

      // Use xcopy on Windows (more reliable than renameSync across paths)
      await execAsync(
        `xcopy /E /I /Q "${extracted}" "${destDir}"`,
        { shell: 'cmd.exe' },
      )

      if (!fs.existsSync(path.join(destDir, 'node.exe'))) {
        fs.rmSync(destDir, { recursive: true, force: true })
        throw new Error('node.exe not found after extraction — download may be corrupted')
      }

      // Cleanup
      fs.rmSync(tmpZip, { force: true })
      fs.rmSync(tmpExtract, { recursive: true, force: true })

      onProgress(100)
      return { success: true }
    } catch (e: unknown) {
      fs.rmSync(tmpZip, { force: true })
      return { success: false, error: String(e) }
    }
  }

  /**
   * Activate an install. `target` is the install directory — either a managed
   * version folder name (e.g. "v22.13.0") or an absolute path to a system/external
   * Node install (e.g. "C:\\Program Files\\nodejs").
   */
  use(target: string): { success: boolean; error?: string } {
    const versionDir = path.isAbsolute(target)
      ? path.normalize(target)
      : path.join(this.versionsDir, target)

    if (!fs.existsSync(path.join(versionDir, 'node.exe'))) {
      return { success: false, error: `No Node install found at ${versionDir}` }
    }

    try {
      // Remove existing junction without touching its target contents
      if (fs.existsSync(this.symlinkPath)) {
        execSync(`rmdir "${this.symlinkPath}"`, { shell: 'cmd.exe' })
      }

      // Create directory junction (works without admin on Windows)
      execSync(`mklink /J "${this.symlinkPath}" "${versionDir}"`, { shell: 'cmd.exe' })

      return { success: true }
    } catch (e: unknown) {
      return { success: false, error: String(e) }
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

  /** Check if ~/.nodevm/current is already in user PATH */
  isPathConfigured(): boolean {
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

  /** Prepend ~/.nodevm/current to user PATH permanently (no admin needed) */
  setupPath(): { success: boolean; error?: string } {
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

  /** Check if PowerShell profile already has the nodevm prepend line */
  isProfileConfigured(): boolean {
    try {
      const profilePath = execSync(
        'powershell -Command "$PROFILE.CurrentUserAllHosts"',
        { shell: 'cmd.exe', encoding: 'utf8' },
      ).trim()
      if (!fs.existsSync(profilePath)) return false
      const content = fs.readFileSync(profilePath, 'utf8')
      return content.includes('.nodevm\\current')
    } catch {
      return false
    }
  }

  /** Inject PATH prepend into PowerShell profile so every new terminal picks up the active version */
  setupProfile(): { success: boolean; error?: string } {
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
        if (existing.includes('.nodevm\\current')) return { success: true }
        fs.appendFileSync(profilePath, line, 'utf8')
      } else {
        fs.writeFileSync(profilePath, line, 'utf8')
      }

      // Also ensure PS execution policy allows profile
      execSync(
        'powershell -Command "Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force"',
        { shell: 'cmd.exe' },
      )

      return { success: true }
    } catch (e: unknown) {
      return { success: false, error: String(e) }
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
