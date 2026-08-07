"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeManager = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const child_process_1 = require("child_process");
const os_1 = __importDefault(require("os"));
const util_1 = require("util");
const winShell_1 = require("./winShell");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const IS_WIN = process.platform === 'win32';
/** Shell profile edited on macOS/Linux to persist PATH (zsh is the macOS default). */
const PROFILE_FILE = path_1.default.join(os_1.default.homedir(), '.zshrc');
/** Newest release first. Shared by every listing so orderings never disagree. */
function byNodeVersionDesc(a, b) {
    const pa = a.version.replace('v', '').split('.').map(Number);
    const pb = b.version.replace('v', '').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) !== (pb[i] || 0))
            return (pb[i] || 0) - (pa[i] || 0);
    }
    return 0;
}
class NodeManager {
    constructor() {
        this.versionsDir = path_1.default.join(os_1.default.homedir(), '.nodevm', 'versions');
        this.symlinkPath = path_1.default.join(os_1.default.homedir(), '.nodevm', 'current');
        fs_1.default.mkdirSync(this.versionsDir, { recursive: true });
    }
    /** Absolute path to the node binary inside an install dir (platform-specific layout). */
    _nodeBin(dir) {
        return IS_WIN ? path_1.default.join(dir, 'node.exe') : path_1.default.join(dir, 'bin', 'node');
    }
    _hasNode(dir) {
        return fs_1.default.existsSync(this._nodeBin(dir));
    }
    listInstalled() {
        const currentPath = this.getCurrentPath();
        const byVersionDesc = byNodeVersionDesc;
        const managed = (fs_1.default.existsSync(this.versionsDir) ? fs_1.default.readdirSync(this.versionsDir) : [])
            .filter((d) => {
            if (!d.startsWith('v'))
                return false;
            const dir = path_1.default.join(this.versionsDir, d);
            return fs_1.default.statSync(dir).isDirectory() && this._hasNode(dir);
        })
            .map((version) => {
            const dir = path_1.default.join(this.versionsDir, version);
            return {
                version,
                isCurrent: this._isActive(dir, currentPath),
                path: dir,
                external: false,
            };
        })
            .sort(byVersionDesc);
        const managedPaths = new Set(managed.map((m) => this._canon(m.path)));
        const external = this._discoverExternal(managedPaths)
            .map((e) => ({ ...e, isCurrent: this._isActive(e.path, currentPath) }))
            .sort(byVersionDesc);
        return [...managed, ...external];
    }
    /** Find Node installs already on the machine (read-only) */
    _discoverExternal(managedPaths) {
        const found = new Map();
        /** Record an install whose version is already known — no subprocess needed. */
        const addKnown = (v) => {
            const key = this._canon(v.path);
            if (found.has(key) || managedPaths.has(key))
                return;
            found.set(key, v);
        };
        const add = (dir) => {
            if (!dir)
                return;
            try {
                const norm = path_1.default.normalize(dir).replace(/[\\/]+$/, '');
                const key = this._canon(norm);
                if (found.has(key) || managedPaths.has(key))
                    return;
                if (key.includes(`${path_1.default.sep}.nodevm${path_1.default.sep}`.toLowerCase()))
                    return; // our own tree
                const exe = this._nodeBin(norm);
                if (!fs_1.default.existsSync(exe))
                    return;
                let version = '';
                try {
                    version = (0, child_process_1.execSync)(`"${exe}" --version`, { encoding: 'utf8' }).trim();
                }
                catch {
                    // fall back to folder name if the binary won't run
                }
                if (!version)
                    version = path_1.default.basename(norm);
                found.set(key, { version, isCurrent: false, path: norm, external: true, origin: 'system' });
            }
            catch {
                // ignore unreadable candidate
            }
        };
        // nvm first: its version directories are named after the version, so they
        // cost no subprocess, and claiming the dedupe key here means the copy nvm
        // has selected is labelled `nvm` rather than `system` when the PATH sweep
        // below runs into the same directory.
        this.listNvm().forEach(addKnown);
        if (IS_WIN) {
            const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
            const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
            add(path_1.default.join(pf, 'nodejs'));
            add(path_1.default.join(pfx86, 'nodejs'));
            try {
                const out = (0, child_process_1.execSync)('where node 2>nul', { shell: 'cmd.exe', encoding: 'utf8' });
                for (const line of out.split(/\r?\n/)) {
                    const p = line.trim();
                    if (/node\.exe$/i.test(p))
                        add(path_1.default.dirname(p));
                }
            }
            catch {
                // node not on PATH
            }
        }
        else {
            // Common macOS/Homebrew prefixes, then anything resolvable from PATH.
            // Node lives at <prefix>/bin/node, so the install dir is the prefix.
            for (const bin of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) {
                if (fs_1.default.existsSync(bin))
                    add(path_1.default.dirname(path_1.default.dirname(fs_1.default.realpathSync(bin))));
            }
            try {
                const out = (0, child_process_1.execSync)('which -a node 2>/dev/null', { encoding: 'utf8' });
                for (const line of out.split(/\r?\n/)) {
                    const p = line.trim();
                    if (!p)
                        continue;
                    try {
                        const real = fs_1.default.realpathSync(p);
                        add(path_1.default.dirname(path_1.default.dirname(real)));
                    }
                    catch {
                        // unresolved entry
                    }
                }
            }
            catch {
                // node not on PATH
            }
        }
        return Array.from(found.values());
    }
    // ── nvm ─────────────────────────────────────────────────────
    //
    // Read-only. This app never installs into or deletes from an nvm root; it
    // only lists what is there so a version can be selected or pinned.
    //
    // Windows (nvm-windows): versions live at `<root>\v20.11.0\node.exe`, and the
    //   root comes from NVM_HOME, or the `root:` line of settings.txt beside
    //   nvm.exe, or %APPDATA%\nvm.
    // macOS/Linux (nvm-sh): `$NVM_DIR/versions/node/v20.11.0/bin/node`, NVM_DIR
    //   defaulting to ~/.nvm. The pre-0.30 flat layout is not supported — those
    //   are Node 0.x releases.
    /** Directory holding nvm's version folders, or null when nvm is not installed. */
    _nvmVersionsDir() {
        if (!IS_WIN) {
            const root = process.env['NVM_DIR'] || path_1.default.join(os_1.default.homedir(), '.nvm');
            const dir = path_1.default.join(root, 'versions', 'node');
            return fs_1.default.existsSync(dir) ? dir : null;
        }
        const appData = process.env['APPDATA'];
        for (const home of [process.env['NVM_HOME'], appData ? path_1.default.join(appData, 'nvm') : undefined]) {
            if (!home || !fs_1.default.existsSync(home))
                continue;
            // settings.txt is authoritative: nvm.exe and the versions can live apart.
            const root = this._nvmSetting(home, 'root') ?? home;
            if (fs_1.default.existsSync(root))
                return root;
        }
        return null;
    }
    /** Read one `key: value` line out of an nvm-windows settings.txt. */
    _nvmSetting(home, key) {
        try {
            const raw = fs_1.default.readFileSync(path_1.default.join(home, 'settings.txt'), 'utf8');
            for (const line of raw.split(/\r?\n/)) {
                const match = line.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'i'));
                if (match)
                    return match[1];
            }
        }
        catch {
            // no settings.txt, or unreadable
        }
        return null;
    }
    /**
     * The version nvm itself currently has selected, or null.
     *
     * Only labels a row — it never changes behaviour. NVM_SYMLINK naming a path
     * does not mean nvm owns it: on a machine with a plain Node MSI install the
     * variable can point at a real directory, which must not be reported as
     * nvm-managed. Hence the symlink check before resolving.
     */
    _nvmActivePath() {
        if (!IS_WIN)
            return null;
        const appData = process.env['APPDATA'];
        const homes = [process.env['NVM_HOME'], appData ? path_1.default.join(appData, 'nvm') : undefined];
        const link = process.env['NVM_SYMLINK'] ??
            homes.reduce((acc, home) => acc ?? (home ? this._nvmSetting(home, 'path') : null), null);
        if (!link)
            return null;
        try {
            if (!fs_1.default.lstatSync(link).isSymbolicLink())
                return null;
            return this._canon(fs_1.default.realpathSync(link));
        }
        catch {
            return null;
        }
    }
    /** Node versions installed by nvm, newest first. Costs no subprocess. */
    listNvm() {
        const dir = this._nvmVersionsDir();
        if (!dir)
            return [];
        const active = this._nvmActivePath();
        let entries;
        try {
            entries = fs_1.default.readdirSync(dir);
        }
        catch {
            return [];
        }
        return entries
            // Only `vX…` directories. nvm-sh keeps io.js under its own versions/io.js
            // tree, and an `iojs-v3.3.1` name would sort as NaN through the version
            // comparator.
            .filter((name) => /^v\d/.test(name))
            .map((version) => ({ version, path: path_1.default.join(dir, version) }))
            // An empty or half-removed version directory is common in an nvm root;
            // _hasNode is what keeps it out of the list.
            .filter((v) => this._hasNode(v.path))
            .map((v) => ({
            version: v.version,
            isCurrent: false,
            path: v.path,
            external: true,
            origin: 'nvm',
            originActive: active !== null && this._real(v.path) === active,
        }))
            .sort(byNodeVersionDesc);
    }
    /**
     * Everything discoverable without spawning a process: this app's own tree plus
     * nvm's. Callers that resolve a version on a hot path (pin resolution at
     * window activation) use this and fall back to listInstalled() only when it
     * misses, because listInstalled() shells out to `where node` / `which -a node`
     * and runs `node --version` per candidate.
     */
    listLocal() {
        const currentPath = this.getCurrentPath();
        const managed = (fs_1.default.existsSync(this.versionsDir) ? fs_1.default.readdirSync(this.versionsDir) : [])
            .filter((d) => {
            if (!d.startsWith('v'))
                return false;
            const dir = path_1.default.join(this.versionsDir, d);
            try {
                return fs_1.default.statSync(dir).isDirectory() && this._hasNode(dir);
            }
            catch {
                return false;
            }
        })
            .map((version) => {
            const dir = path_1.default.join(this.versionsDir, version);
            return { version, isCurrent: this._isActive(dir, currentPath), path: dir, external: false };
        })
            .sort(byNodeVersionDesc);
        const managedPaths = new Set(managed.map((m) => this._canon(m.path)));
        return [...managed, ...this.listNvm().filter((v) => !managedPaths.has(this._canon(v.path)))];
    }
    getCurrent() {
        try {
            // realpathSync resolves the symlink/junction and canonicalises for display
            return path_1.default.basename(fs_1.default.realpathSync(this.symlinkPath));
        }
        catch {
            return null;
        }
    }
    /** Canonical on-disk path the `current` link resolves to (null if unset) */
    getCurrentPath() {
        return this._real(this.symlinkPath);
    }
    /** Canonicalise a path for comparison (case-insensitive on Windows). */
    _canon(p) {
        return IS_WIN ? p.toLowerCase() : p;
    }
    /** Resolve a path to its canonical form, or null if it can't be resolved */
    _real(p) {
        try {
            return this._canon(fs_1.default.realpathSync(p));
        }
        catch {
            return null;
        }
    }
    /** True when `dir` is the install the `current` link points at */
    _isActive(dir, currentPath) {
        if (currentPath === null)
            return false;
        return this._real(dir) === currentPath;
    }
    async listRemote() {
        return new Promise((resolve, reject) => {
            const url = 'https://nodejs.org/dist/index.json';
            https_1.default
                .get(url, (res) => {
                let data = '';
                res.on('data', (c) => (data += c));
                res.on('end', () => {
                    try {
                        const all = JSON.parse(data);
                        // Return only latest of each major
                        const seen = new Set();
                        const filtered = all.filter((v) => {
                            const major = parseInt(v.version.replace('v', '').split('.')[0]);
                            if (seen.has(major))
                                return false;
                            seen.add(major);
                            return true;
                        });
                        resolve(filtered.slice(0, 20));
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            })
                .on('error', reject);
        });
    }
    async install(version, onProgress) {
        const destDir = path_1.default.join(this.versionsDir, version);
        if (fs_1.default.existsSync(destDir)) {
            return { success: false, error: `Version ${version} is already installed` };
        }
        return IS_WIN
            ? this._installWin(version, destDir, onProgress)
            : this._installUnix(version, destDir, onProgress);
    }
    async _installWin(version, destDir, onProgress) {
        const arch = process.arch === 'x64' ? 'x64' : 'x86';
        const fileName = `node-${version}-win-${arch}`;
        const downloadUrl = `https://nodejs.org/dist/${version}/${fileName}.zip`;
        const tmpZip = path_1.default.join(os_1.default.tmpdir(), `${fileName}.zip`);
        try {
            await this._download(downloadUrl, tmpZip, onProgress);
            const tmpExtract = path_1.default.join(os_1.default.tmpdir(), `nodevm_${version}`);
            fs_1.default.mkdirSync(tmpExtract, { recursive: true });
            await execAsync(`powershell -Command "Expand-Archive -Force -Path '${tmpZip}' -DestinationPath '${tmpExtract}'"`);
            const extracted = path_1.default.join(tmpExtract, fileName);
            if (!fs_1.default.existsSync(extracted)) {
                throw new Error(`Extraction failed: expected folder not found at ${extracted}`);
            }
            await execAsync(`xcopy /E /I /Q "${extracted}" "${destDir}"`, { shell: 'cmd.exe' });
            if (!this._hasNode(destDir)) {
                fs_1.default.rmSync(destDir, { recursive: true, force: true });
                throw new Error('node.exe not found after extraction — download may be corrupted');
            }
            fs_1.default.rmSync(tmpZip, { force: true });
            fs_1.default.rmSync(tmpExtract, { recursive: true, force: true });
            onProgress(100);
            return { success: true };
        }
        catch (e) {
            fs_1.default.rmSync(tmpZip, { force: true });
            return { success: false, error: String(e) };
        }
    }
    async _installUnix(version, destDir, onProgress) {
        const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
        const fileName = `node-${version}-darwin-${arch}`;
        const downloadUrl = `https://nodejs.org/dist/${version}/${fileName}.tar.gz`;
        const tmpTar = path_1.default.join(os_1.default.tmpdir(), `${fileName}.tar.gz`);
        try {
            await this._download(downloadUrl, tmpTar, onProgress);
            // Extract the tarball's single top-level folder straight into destDir.
            fs_1.default.mkdirSync(destDir, { recursive: true });
            await execAsync(`tar -xzf "${tmpTar}" -C "${destDir}" --strip-components=1`);
            if (!this._hasNode(destDir)) {
                fs_1.default.rmSync(destDir, { recursive: true, force: true });
                throw new Error('bin/node not found after extraction — download may be corrupted');
            }
            fs_1.default.rmSync(tmpTar, { force: true });
            onProgress(100);
            return { success: true };
        }
        catch (e) {
            fs_1.default.rmSync(tmpTar, { force: true });
            fs_1.default.rmSync(destDir, { recursive: true, force: true });
            return { success: false, error: String(e) };
        }
    }
    /**
     * Activate an install. `target` is the install directory — either a managed
     * version folder name (e.g. "v22.13.0") or an absolute path to a system/external
     * Node install.
     */
    use(target) {
        const versionDir = path_1.default.isAbsolute(target)
            ? path_1.default.normalize(target)
            : path_1.default.join(this.versionsDir, target);
        if (!this._hasNode(versionDir)) {
            return { success: false, error: `No Node install found at ${versionDir}` };
        }
        try {
            this._relink(versionDir);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: String(e) };
        }
    }
    /** Repoint the `current` link at `versionDir` (junction on Windows, symlink elsewhere). */
    _relink(versionDir) {
        if (IS_WIN) {
            if (fs_1.default.existsSync(this.symlinkPath)) {
                (0, child_process_1.execSync)(`rmdir "${this.symlinkPath}"`, { shell: 'cmd.exe' });
            }
            (0, child_process_1.execSync)(`mklink /J "${this.symlinkPath}" "${versionDir}"`, { shell: 'cmd.exe' });
        }
        else {
            try {
                fs_1.default.unlinkSync(this.symlinkPath); // remove existing symlink without touching its target
            }
            catch {
                // nothing to remove
            }
            fs_1.default.symlinkSync(versionDir, this.symlinkPath, 'dir');
        }
    }
    uninstall(version) {
        const versionDir = path_1.default.join(this.versionsDir, version);
        if (!fs_1.default.existsSync(versionDir)) {
            return { success: false, error: `Version ${version} is not installed` };
        }
        const current = this.getCurrent();
        if (current === version) {
            return { success: false, error: `Cannot uninstall the currently active version` };
        }
        try {
            fs_1.default.rmSync(versionDir, { recursive: true, force: true });
            return { success: true };
        }
        catch (e) {
            return { success: false, error: String(e) };
        }
    }
    /** Check if ~/.nodevm/current is already wired into the shell/user PATH */
    isPathConfigured() {
        if (IS_WIN) {
            try {
                const userPath = (0, child_process_1.execSync)(`powershell -Command "[System.Environment]::GetEnvironmentVariable('Path', 'User')"`, { shell: 'cmd.exe', encoding: 'utf8' }).trim();
                return userPath.toLowerCase().includes(this.symlinkPath.toLowerCase());
            }
            catch {
                return false;
            }
        }
        return this._profileHasMarker();
    }
    /** Prepend ~/.nodevm/current to user PATH permanently (no admin needed) */
    setupPath() {
        if (IS_WIN) {
            try {
                const currentPath = (0, child_process_1.execSync)(`powershell -Command "[System.Environment]::GetEnvironmentVariable('Path', 'User')"`, { shell: 'cmd.exe', encoding: 'utf8' }).trim();
                if (currentPath.toLowerCase().includes(this.symlinkPath.toLowerCase())) {
                    return { success: true };
                }
                const newPath = currentPath ? `${this.symlinkPath};${currentPath}` : this.symlinkPath;
                (0, child_process_1.execSync)(`powershell -Command "[System.Environment]::SetEnvironmentVariable('Path', '${newPath}', 'User')"`, { shell: 'cmd.exe' });
                return { success: true };
            }
            catch (e) {
                return { success: false, error: String(e) };
            }
        }
        // macOS/Linux: PATH is configured via the shell profile (same as setupProfile).
        return this.setupProfile();
    }
    /** Check if PowerShell profile + CMD AutoRun both prepend the active Node */
    isProfileConfigured() {
        if (IS_WIN) {
            try {
                const profilePath = (0, child_process_1.execSync)('powershell -Command "$PROFILE.CurrentUserAllHosts"', { shell: 'cmd.exe', encoding: 'utf8' }).trim();
                if (!fs_1.default.existsSync(profilePath))
                    return false;
                const content = fs_1.default.readFileSync(profilePath, 'utf8');
                const psOk = content.includes('.nodevm\\current');
                return psOk && (0, winShell_1.isWinCmdHookConfigured)('nodevm');
            }
            catch {
                return false;
            }
        }
        return this._profileHasMarker();
    }
    /**
     * Inject PATH prepends so every new terminal picks up the active version.
     * Windows: PowerShell $PROFILE + CMD AutoRun (System PATH beats User PATH).
     * macOS/Linux: ~/.zshrc.
     */
    setupProfile() {
        if (IS_WIN) {
            try {
                const profilePath = (0, child_process_1.execSync)('powershell -Command "$PROFILE.CurrentUserAllHosts"', { shell: 'cmd.exe', encoding: 'utf8' }).trim();
                const profileDir = path_1.default.dirname(profilePath);
                fs_1.default.mkdirSync(profileDir, { recursive: true });
                const line = `\n# NodeVM — prepend active version to PATH\n$env:Path = "$env:USERPROFILE\\.nodevm\\current;$env:Path"\n`;
                if (fs_1.default.existsSync(profilePath)) {
                    const existing = fs_1.default.readFileSync(profilePath, 'utf8');
                    if (!existing.includes('.nodevm\\current')) {
                        fs_1.default.appendFileSync(profilePath, line, 'utf8');
                    }
                }
                else {
                    fs_1.default.writeFileSync(profilePath, line, 'utf8');
                }
                (0, child_process_1.execSync)('powershell -Command "Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force"', { shell: 'cmd.exe' });
                // CMD does not read $PROFILE — wire HKCU AutoRun instead.
                (0, winShell_1.ensureWinCmdHook)('nodevm');
                return { success: true };
            }
            catch (e) {
                return { success: false, error: String(e) };
            }
        }
        // macOS/Linux — prepend ~/.nodevm/current/bin to PATH in ~/.zshrc
        try {
            const block = `\n# NodeVM — prepend active version to PATH\n` +
                `export PATH="$HOME/.nodevm/current/bin:$PATH"\n`;
            if (this._profileHasMarker())
                return { success: true };
            fs_1.default.appendFileSync(PROFILE_FILE, block, 'utf8');
            return { success: true };
        }
        catch (e) {
            return { success: false, error: String(e) };
        }
    }
    _profileHasMarker() {
        try {
            if (!fs_1.default.existsSync(PROFILE_FILE))
                return false;
            return fs_1.default.readFileSync(PROFILE_FILE, 'utf8').includes('.nodevm/current');
        }
        catch {
            return false;
        }
    }
    _download(url, dest, onProgress) {
        return new Promise((resolve, reject) => {
            const file = fs_1.default.createWriteStream(dest);
            https_1.default
                .get(url, (res) => {
                // Follow redirects
                if (res.statusCode === 301 || res.statusCode === 302) {
                    file.close();
                    this._download(res.headers.location, dest, onProgress).then(resolve).catch(reject);
                    return;
                }
                const total = parseInt(res.headers['content-length'] || '0');
                let downloaded = 0;
                res.on('data', (chunk) => {
                    downloaded += chunk.length;
                    if (total > 0)
                        onProgress(Math.round((downloaded / total) * 90));
                });
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            })
                .on('error', (e) => {
                fs_1.default.unlink(dest, () => { });
                reject(e);
            });
        });
    }
}
exports.NodeManager = NodeManager;
