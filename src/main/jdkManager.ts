import fs from 'fs'
import path from 'path'
import https from 'https'
import { execSync, exec } from 'child_process'
import os from 'os'
import { promisify } from 'util'
import { ensureWinCmdHook, isWinCmdHookConfigured } from './winShell'

const execAsync = promisify(exec)

const IS_WIN = process.platform === 'win32'
/** Shell profile edited on macOS/Linux to persist JAVA_HOME + PATH (zsh is the macOS default). */
const PROFILE_FILE = path.join(os.homedir(), '.zshrc')

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

  /** Adoptium API os/arch tokens for the current platform. */
  private get _apiOs(): string {
    return IS_WIN ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
  }
  private get _apiArch(): string {
    return process.arch === 'arm64' ? 'aarch64' : 'x64'
  }

  private _javaBin(dir: string): string {
    return IS_WIN ? path.join(dir, 'bin', 'java.exe') : path.join(dir, 'bin', 'java')
  }
  private _javacBin(dir: string): string {
    return IS_WIN ? path.join(dir, 'bin', 'javac.exe') : path.join(dir, 'bin', 'javac')
  }
  private _hasJava(dir: string): boolean {
    return fs.existsSync(this._javaBin(dir))
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
        return fs.statSync(dir).isDirectory() && this._hasJava(dir)
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

  getCurrent(): string | null {
    try {
      return path.basename(fs.realpathSync(this.symlinkPath))
    } catch {
      return null
    }
  }

  /** Canonical on-disk path the `current` link resolves to (null if unset) */
  private getCurrentPath(): string | null {
    return this._real(this.symlinkPath)
  }

  private _canon(p: string): string {
    return IS_WIN ? p.toLowerCase() : p
  }

  private _real(p: string): string | null {
    try {
      return this._canon(fs.realpathSync(p))
    } catch {
      return null
    }
  }

  /** True when `dir` is the JDK the `current` link points at */
  private _isActive(dir: string, currentPath: string | null): boolean {
    if (currentPath === null) return false
    return this._real(dir) === currentPath
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
            `?architecture=${this._apiArch}&image_type=jdk&os=${this._apiOs}&vendor=eclipse&jvm_impl=hotspot&page_size=1`
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
      `/${this._apiOs}/${this._apiArch}/jdk/hotspot/normal/eclipse?project=jdk`

    const safeName = version.replace(/[^a-zA-Z0-9._-]/g, '_')
    const ext = IS_WIN ? 'zip' : 'tar.gz'
    const tmpArchive = path.join(os.tmpdir(), `${safeName}.${ext}`)
    const tmpExtract = path.join(os.tmpdir(), `jdkvm_${safeName}`)

    try {
      await this._download(downloadUrl, tmpArchive, onProgress)

      fs.rmSync(tmpExtract, { recursive: true, force: true })
      fs.mkdirSync(tmpExtract, { recursive: true })

      if (IS_WIN) {
        await execAsync(
          `powershell -Command "Expand-Archive -Force -Path '${tmpArchive}' -DestinationPath '${tmpExtract}'"`,
        )
      } else {
        await execAsync(`tar -xzf "${tmpArchive}" -C "${tmpExtract}"`)
      }

      // The archive contains a single top-level JDK folder. On macOS the actual
      // JAVA_HOME is nested at <top>/Contents/Home; on Windows it's the top folder.
      const jdkRoot = this._findJavaHome(tmpExtract)
      if (!jdkRoot) {
        throw new Error('Extraction failed: bin/java not found in archive')
      }

      if (IS_WIN) {
        await execAsync(`xcopy /E /I /Q "${jdkRoot}" "${destDir}"`, { shell: 'cmd.exe' })
      } else {
        await execAsync(`cp -R "${jdkRoot}" "${destDir}"`)
      }

      if (!this._hasJava(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true })
        throw new Error('java not found after extraction — download may be corrupted')
      }

      fs.rmSync(tmpArchive, { force: true })
      fs.rmSync(tmpExtract, { recursive: true, force: true })

      onProgress(100)
      return { success: true }
    } catch (e: unknown) {
      fs.rmSync(tmpArchive, { force: true })
      fs.rmSync(tmpExtract, { recursive: true, force: true })
      return { success: false, error: String(e) }
    }
  }

  /**
   * Activate a JDK. `target` is the JDK home directory — either a managed
   * version folder name (e.g. "jdk-21.0.11+10") or an absolute path to a
   * system/external JDK.
   */
  use(target: string): { success: boolean; error?: string } {
    const versionDir = path.isAbsolute(target)
      ? path.normalize(target)
      : path.join(this.versionsDir, target)

    if (!this._hasJava(versionDir)) {
      return { success: false, error: `No JDK found at ${versionDir}` }
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
        fs.unlinkSync(this.symlinkPath)
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

  /** Check if JAVA_HOME points at the link AND its bin is on the user PATH */
  isEnvConfigured(): boolean {
    if (IS_WIN) {
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
    return this._profileHasMarker()
  }

  /** Set JAVA_HOME = ~/.jdkvm/current and prepend its bin to user PATH (no admin needed) */
  setupEnv(): { success: boolean; error?: string } {
    if (IS_WIN) {
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
    // macOS/Linux: JAVA_HOME + PATH are configured via the shell profile.
    return this.setupProfile()
  }

  /** Check if PowerShell profile + CMD AutoRun both set JAVA_HOME / PATH */
  isProfileConfigured(): boolean {
    if (IS_WIN) {
      try {
        const profilePath = execSync(
          'powershell -Command "$PROFILE.CurrentUserAllHosts"',
          { shell: 'cmd.exe', encoding: 'utf8' },
        ).trim()
        if (!fs.existsSync(profilePath)) return false
        const content = fs.readFileSync(profilePath, 'utf8')
        const psOk = content.includes('.jdkvm\\current')
        return psOk && isWinCmdHookConfigured('jdkvm')
      } catch {
        return false
      }
    }
    return this._profileHasMarker()
  }

  /**
   * Inject JAVA_HOME + PATH so every new terminal picks up the active JDK.
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

        const block =
          `\n# JDKVM — set JAVA_HOME + prepend active JDK to PATH\n` +
          `$env:JAVA_HOME = "$env:USERPROFILE\\.jdkvm\\current"\n` +
          `$env:Path = "$env:JAVA_HOME\\bin;$env:Path"\n`

        if (fs.existsSync(profilePath)) {
          const existing = fs.readFileSync(profilePath, 'utf8')
          if (!existing.includes('.jdkvm\\current')) {
            fs.appendFileSync(profilePath, block, 'utf8')
          }
        } else {
          fs.writeFileSync(profilePath, block, 'utf8')
        }

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

        // CMD does not read $PROFILE — wire HKCU AutoRun instead.
        ensureWinCmdHook('jdkvm')

        return { success: true }
      } catch (e: unknown) {
        return { success: false, error: String(e) }
      }
    }

    // macOS/Linux — set JAVA_HOME + prepend its bin to PATH in ~/.zshrc
    try {
      if (this._profileHasMarker()) return { success: true }
      const block =
        `\n# JDKVM — set JAVA_HOME + prepend active JDK to PATH\n` +
        `export JAVA_HOME="$HOME/.jdkvm/current"\n` +
        `export PATH="$JAVA_HOME/bin:$PATH"\n`
      fs.appendFileSync(PROFILE_FILE, block, 'utf8')
      return { success: true }
    } catch (e: unknown) {
      return { success: false, error: String(e) }
    }
  }

  private _profileHasMarker(): boolean {
    try {
      if (!fs.existsSync(PROFILE_FILE)) return false
      return fs.readFileSync(PROFILE_FILE, 'utf8').includes('.jdkvm/current')
    } catch {
      return false
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
        const key = this._canon(norm)
        if (found.has(key) || managedPaths.has(key)) return
        if (key.includes(`${path.sep}.jdkvm${path.sep}`.toLowerCase())) return // our own tree
        // Require the compiler (javac) so JREs are not mistaken for JDKs
        if (!fs.existsSync(this._javacBin(norm))) return
        found.set(key, {
          version: this._jdkLabel(norm),
          isCurrent: false,
          path: norm,
          external: true,
        })
      } catch {
        // ignore unreadable candidate
      }
    }

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

    if (IS_WIN) {
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

      // Scan vendor parents up to two levels deep (some vendors nest, e.g. Azul\Zulu\zulu-21)
      for (const parent of parents) {
        for (const child of safeDirs(parent)) {
          if (this._hasJava(child)) add(child)
          else for (const grand of safeDirs(child)) add(grand)
        }
      }

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
    } else {
      // macOS: the standard JVM location, each bundle exposing Contents/Home.
      const jvmDir = '/Library/Java/JavaVirtualMachines'
      for (const bundle of safeDirs(jvmDir)) {
        const home = path.join(bundle, 'Contents', 'Home')
        if (this._hasJava(home)) add(home)
        else if (this._hasJava(bundle)) add(bundle)
      }

      // /usr/libexec/java_home enumerates every registered JDK (macOS)
      try {
        const out = execSync('/usr/libexec/java_home -V 2>&1', { encoding: 'utf8' })
        for (const m of out.matchAll(/(\/[^\s"']+\/Contents\/Home)/g)) add(m[1])
      } catch {
        // java_home unavailable or no JDKs registered
      }

      add(process.env.JAVA_HOME)
      try {
        const out = execSync('which -a java 2>/dev/null', { encoding: 'utf8' })
        for (const line of out.split(/\r?\n/)) {
          const p = line.trim()
          if (!p) continue
          try {
            add(path.dirname(path.dirname(fs.realpathSync(p))))
          } catch {
            // unresolved entry
          }
        }
      } catch {
        // java not on PATH
      }
    }

    return Array.from(found.values())
  }

  /** Locate the real JAVA_HOME within an extracted archive (handles macOS Contents/Home nesting). */
  private _findJavaHome(dir: string): string | null {
    if (this._hasJava(dir)) return dir
    const macHome = path.join(dir, 'Contents', 'Home')
    if (this._hasJava(macHome)) return macHome
    for (const entry of fs.readdirSync(dir)) {
      const child = path.join(dir, entry)
      try {
        if (!fs.statSync(child).isDirectory()) continue
        if (this._hasJava(child)) return child
        const childMacHome = path.join(child, 'Contents', 'Home')
        if (this._hasJava(childMacHome)) return childMacHome
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
