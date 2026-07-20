import fs from 'fs'
import path from 'path'
import https from 'https'
import { execSync, exec } from 'child_process'
import os from 'os'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface InstalledVersion {
  version: string
  isCurrent: boolean
  path: string
  /** true for JDKs already on the machine (not installed by this app) — read-only */
  external?: boolean
}

export interface RemoteVersion {
  version: string
  lts: string | false
  date: string
}

// Adoptium (Eclipse Temurin) JDK manager — mirrors NodeManager's behaviour,
// but manages Java JDKs under ~/.jdkvm and configures JAVA_HOME (+ PATH).
export class JdkManager {
  public readonly versionsDir: string
  private readonly symlinkPath: string

  constructor() {
    this.versionsDir = path.join(os.homedir(), '.jdkvm', 'versions')
    this.symlinkPath = path.join(os.homedir(), '.jdkvm', 'current')
    fs.mkdirSync(this.versionsDir, { recursive: true })
  }

  listInstalled(): InstalledVersion[] {
    const currentPath = this.getCurrentPath()
    const byVersionDesc = (a: InstalledVersion, b: InstalledVersion) => {
      const pa = this._parseVersion(a.version)
      const pb = this._parseVersion(b.version)
      for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0)
      }
      return 0
    }

    const managed: InstalledVersion[] = (
      fs.existsSync(this.versionsDir) ? fs.readdirSync(this.versionsDir) : []
    )
      .filter((d) => {
        const dir = path.join(this.versionsDir, d)
        return (
          fs.statSync(dir).isDirectory() &&
          fs.existsSync(path.join(dir, 'bin', 'java.exe'))
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

  /** True when `dir` is the JDK the `current` junction points at */
  private _isActive(dir: string, currentPath: string | null): boolean {
    if (currentPath === null) return false
    return this._realLower(dir) === currentPath
  }

  async listRemote(): Promise<RemoteVersion[]> {
    // Discover available feature versions + which are LTS
    const info = await this._getJson<{
      available_lts_releases: number[]
      most_recent_feature_release: number
    }>('https://api.adoptium.net/v3/info/available_releases')

    const lts = new Set(info.available_lts_releases ?? [])
    const features = Array.from(
      new Set([...(info.available_lts_releases ?? []), info.most_recent_feature_release]),
    )
      .filter((n): n is number => typeof n === 'number')
      .sort((a, b) => b - a)

    // Resolve the latest GA build of each feature version (parallel)
    const results = await Promise.all(
      features.map(async (feature) => {
        try {
          const url =
            `https://api.adoptium.net/v3/assets/feature_releases/${feature}/ga` +
            `?architecture=x64&image_type=jdk&os=windows&vendor=eclipse&jvm_impl=hotspot&page_size=1`
          const assets = await this._getJson<
            Array<{ release_name: string; timestamp: string; binaries: unknown[] }>
          >(url)
          const rel = assets?.[0]
          if (!rel || !rel.binaries?.length) return null
          return {
            version: rel.release_name, // e.g. "jdk-21.0.11+10"
            lts: lts.has(feature) ? `Java ${feature}` : false,
            date: (rel.timestamp || '').split('T')[0],
          } as RemoteVersion
        } catch {
          return null
        }
      }),
    )

    return results.filter((v): v is RemoteVersion => v !== null)
  }

  async install(
    version: string,
    onProgress: (p: number) => void,
  ): Promise<{ success: boolean; error?: string }> {
    const destDir = path.join(this.versionsDir, version)
    if (fs.existsSync(destDir)) {
      return { success: false, error: `Version ${version} is already installed` }
    }

    // Deterministic download endpoint — resolves the exact build by release name.
    const downloadUrl =
      `https://api.adoptium.net/v3/binary/version/${encodeURIComponent(version)}` +
      `/windows/x64/jdk/hotspot/normal/eclipse?project=jdk`

    const safeName = version.replace(/[^a-zA-Z0-9._-]/g, '_')
    const tmpZip = path.join(os.tmpdir(), `${safeName}.zip`)
    const tmpExtract = path.join(os.tmpdir(), `jdkvm_${safeName}`)

    try {
      await this._download(downloadUrl, tmpZip, onProgress)

      fs.rmSync(tmpExtract, { recursive: true, force: true })
      fs.mkdirSync(tmpExtract, { recursive: true })

      await execAsync(
        `powershell -Command "Expand-Archive -Force -Path '${tmpZip}' -DestinationPath '${tmpExtract}'"`,
      )

      // The zip contains a single top-level JDK folder (e.g. jdk-21.0.11+10).
      // Locate whichever extracted dir actually holds bin\java.exe.
      const jdkRoot = this._findJdkRoot(tmpExtract)
      if (!jdkRoot) {
        throw new Error('Extraction failed: bin\\java.exe not found in archive')
      }

      await execAsync(`xcopy /E /I /Q "${jdkRoot}" "${destDir}"`, { shell: 'cmd.exe' })

      if (!fs.existsSync(path.join(destDir, 'bin', 'java.exe'))) {
        fs.rmSync(destDir, { recursive: true, force: true })
        throw new Error('java.exe not found after extraction — download may be corrupted')
      }

      fs.rmSync(tmpZip, { force: true })
      fs.rmSync(tmpExtract, { recursive: true, force: true })

      onProgress(100)
      return { success: true }
    } catch (e: unknown) {
      fs.rmSync(tmpZip, { force: true })
      fs.rmSync(tmpExtract, { recursive: true, force: true })
      return { success: false, error: String(e) }
    }
  }

  /**
   * Activate a JDK. `target` is the JDK home directory — either a managed
   * version folder name (e.g. "jdk-21.0.11+10") or an absolute path to a
   * system/external JDK (e.g. "C:\\Program Files\\Java\\jdk-21").
   */
  use(target: string): { success: boolean; error?: string } {
    const versionDir = path.isAbsolute(target)
      ? path.normalize(target)
      : path.join(this.versionsDir, target)

    if (!fs.existsSync(path.join(versionDir, 'bin', 'java.exe'))) {
      return { success: false, error: `No JDK found at ${versionDir}` }
    }

    try {
      if (fs.existsSync(this.symlinkPath)) {
        execSync(`rmdir "${this.symlinkPath}"`, { shell: 'cmd.exe' })
      }
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

  /** Check if JAVA_HOME points at the junction AND its bin is on the user PATH */
  isEnvConfigured(): boolean {
    try {
      const javaHome = execSync(
        `powershell -Command "[System.Environment]::GetEnvironmentVariable('JAVA_HOME', 'User')"`,
        { shell: 'cmd.exe', encoding: 'utf8' },
      ).trim()
      const userPath = execSync(
        `powershell -Command "[System.Environment]::GetEnvironmentVariable('Path', 'User')"`,
        { shell: 'cmd.exe', encoding: 'utf8' },
      ).trim()
      const binPath = path.join(this.symlinkPath, 'bin')
      return (
        javaHome.toLowerCase() === this.symlinkPath.toLowerCase() &&
        userPath.toLowerCase().includes(binPath.toLowerCase())
      )
    } catch {
      return false
    }
  }

  /** Set JAVA_HOME = ~/.jdkvm/current and prepend its bin to user PATH (no admin needed) */
  setupEnv(): { success: boolean; error?: string } {
    try {
      execSync(
        `powershell -Command "[System.Environment]::SetEnvironmentVariable('JAVA_HOME', '${this.symlinkPath}', 'User')"`,
        { shell: 'cmd.exe' },
      )

      const binPath = path.join(this.symlinkPath, 'bin')
      const currentPath = execSync(
        `powershell -Command "[System.Environment]::GetEnvironmentVariable('Path', 'User')"`,
        { shell: 'cmd.exe', encoding: 'utf8' },
      ).trim()

      if (!currentPath.toLowerCase().includes(binPath.toLowerCase())) {
        const newPath = currentPath ? `${binPath};${currentPath}` : binPath
        execSync(
          `powershell -Command "[System.Environment]::SetEnvironmentVariable('Path', '${newPath}', 'User')"`,
          { shell: 'cmd.exe' },
        )
      }

      return { success: true }
    } catch (e: unknown) {
      return { success: false, error: String(e) }
    }
  }

  /** Check if PowerShell profile already has the jdkvm lines */
  isProfileConfigured(): boolean {
    try {
      const profilePath = execSync(
        'powershell -Command "$PROFILE.CurrentUserAllHosts"',
        { shell: 'cmd.exe', encoding: 'utf8' },
      ).trim()
      if (!fs.existsSync(profilePath)) return false
      const content = fs.readFileSync(profilePath, 'utf8')
      return content.includes('.jdkvm\\current')
    } catch {
      return false
    }
  }

  /** Inject JAVA_HOME + PATH prepend into PowerShell profile so every new terminal picks up the active JDK */
  setupProfile(): { success: boolean; error?: string } {
    try {
      const profilePath = execSync(
        'powershell -Command "$PROFILE.CurrentUserAllHosts"',
        { shell: 'cmd.exe', encoding: 'utf8' },
      ).trim()

      const profileDir = path.dirname(profilePath)
      fs.mkdirSync(profileDir, { recursive: true })

      const block =
        `\n# JDKVM — set JAVA_HOME + prepend active JDK to PATH\n` +
        `$env:JAVA_HOME = "$env:USERPROFILE\\.jdkvm\\current"\n` +
        `$env:Path = "$env:JAVA_HOME\\bin;$env:Path"\n`

      if (fs.existsSync(profilePath)) {
        const existing = fs.readFileSync(profilePath, 'utf8')
        if (existing.includes('.jdkvm\\current')) return { success: true }
        fs.appendFileSync(profilePath, block, 'utf8')
      } else {
        fs.writeFileSync(profilePath, block, 'utf8')
      }

      // Ensure PS execution policy allows the profile to load (skip if already permissive)
      const policy = execSync(
        'powershell -Command "Get-ExecutionPolicy -Scope CurrentUser"',
        { shell: 'cmd.exe', encoding: 'utf8' },
      ).trim()
      if (policy === 'Undefined' || policy === 'Restricted') {
        execSync(
          'powershell -Command "Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force"',
          { shell: 'cmd.exe' },
        )
      }

      return { success: true }
    } catch (e: unknown) {
      return { success: false, error: String(e) }
    }
  }

  // ── helpers ────────────────────────────────────────────────

  /** "jdk-21.0.11+10" / "21.0.5" / "1.8.0_432" -> [major, minor, patch] */
  private _parseVersion(name: string): number[] {
    let core = name.replace(/^jdk-?/i, '').split(/[+_-]/)[0]
    // Legacy "1.8.0" form → treat as major 8
    const parts = core.split('.').map((n) => parseInt(n, 10) || 0)
    if (parts[0] === 1 && parts.length > 1) return parts.slice(1)
    return parts
  }

  /** Read the JDK `release` file for a friendly version (falls back to folder name) */
  private _jdkLabel(home: string): string {
    try {
      const rel = fs.readFileSync(path.join(home, 'release'), 'utf8')
      const m = rel.match(/JAVA_VERSION="?([^"\r\n]+)"?/)
      if (m) return m[1]
    } catch {
      // no release file — use the folder name
    }
    return path.basename(home)
  }

  /** Find JDKs already installed on the machine (read-only) */
  private _discoverExternal(managedPaths: Set<string>): InstalledVersion[] {
    const found = new Map<string, InstalledVersion>()

    const add = (home: string | undefined) => {
      if (!home) return
      try {
        const norm = path.normalize(home).replace(/[\\/]+$/, '')
        const lower = norm.toLowerCase()
        if (found.has(lower) || managedPaths.has(lower)) return
        if (lower.includes('\\.jdkvm\\')) return // our own managed/junction tree
        // Require the compiler (javac.exe) so JREs are not mistaken for JDKs
        if (!fs.existsSync(path.join(norm, 'bin', 'javac.exe'))) return
        found.set(lower, {
          version: this._jdkLabel(norm),
          isCurrent: false,
          path: norm,
          external: true,
        })
      } catch {
        // ignore unreadable candidate
      }
    }

    const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
    const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const parents = [
      path.join(pf, 'Java'),
      path.join(pf, 'Eclipse Adoptium'),
      path.join(pf, 'Eclipse Foundation'),
      path.join(pf, 'AdoptOpenJDK'),
      path.join(pf, 'Amazon Corretto'),
      path.join(pf, 'Microsoft'),
      path.join(pf, 'Zulu'),
      path.join(pf, 'Azul', 'Zulu'),
      path.join(pf, 'BellSoft'),
      path.join(pf, 'SapMachine'),
      path.join(pf, 'Semeru'),
      path.join(pfx86, 'Java'),
    ]

    const safeDirs = (dir: string): string[] => {
      try {
        return fs
          .readdirSync(dir)
          .map((e) => path.join(dir, e))
          .filter((p) => {
            try {
              return fs.statSync(p).isDirectory()
            } catch {
              return false
            }
          })
      } catch {
        return []
      }
    }

    // Scan vendor parents up to two levels deep (some vendors nest, e.g. Azul\Zulu\zulu-21)
    for (const parent of parents) {
      for (const child of safeDirs(parent)) {
        if (fs.existsSync(path.join(child, 'bin', 'java.exe'))) add(child)
        else for (const grand of safeDirs(child)) add(grand)
      }
    }

    // JAVA_HOME (current process) + anything resolvable from PATH
    add(process.env.JAVA_HOME)
    try {
      const out = execSync('where java 2>nul', { shell: 'cmd.exe', encoding: 'utf8' })
      for (const line of out.split(/\r?\n/)) {
        const p = line.trim()
        if (/java\.exe$/i.test(p)) add(path.dirname(path.dirname(p)))
      }
    } catch {
      // java not on PATH
    }

    return Array.from(found.values())
  }

  private _findJdkRoot(dir: string): string | null {
    if (fs.existsSync(path.join(dir, 'bin', 'java.exe'))) return dir
    for (const entry of fs.readdirSync(dir)) {
      const child = path.join(dir, entry)
      try {
        if (fs.statSync(child).isDirectory() && fs.existsSync(path.join(child, 'bin', 'java.exe'))) {
          return child
        }
      } catch {
        // ignore unreadable entries
      }
    }
    return null
  }

  private _getJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      https
        .get(url, { headers: { 'User-Agent': 'node-version-manager' } }, (res) => {
          // Follow redirects (some endpoints 3xx)
          const loc = res.headers.location
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
            res.resume()
            this._getJson<T>(loc).then(resolve).catch(reject)
            return
          }
          let data = ''
          res.on('data', (c) => (data += c))
          res.on('end', () => {
            try {
              resolve(JSON.parse(data) as T)
            } catch (e) {
              reject(e)
            }
          })
        })
        .on('error', reject)
    })
  }

  private _download(url: string, dest: string, onProgress: (p: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest)
      https
        .get(url, { headers: { 'User-Agent': 'node-version-manager' } }, (res) => {
          // Follow 301/302/307/308 (Adoptium -> GitHub -> object storage)
          const loc = res.headers.location
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
            file.close()
            fs.rmSync(dest, { force: true })
            this._download(loc, dest, onProgress).then(resolve).catch(reject)
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
