"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JdkManager = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const child_process_1 = require("child_process");
const os_1 = __importDefault(require("os"));
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
// Adoptium (Eclipse Temurin) JDK manager — mirrors NodeManager's behaviour,
// but manages Java JDKs under ~/.jdkvm and configures JAVA_HOME (+ PATH).
class JdkManager {
    constructor() {
        this.versionsDir = path_1.default.join(os_1.default.homedir(), '.jdkvm', 'versions');
        this.symlinkPath = path_1.default.join(os_1.default.homedir(), '.jdkvm', 'current');
        fs_1.default.mkdirSync(this.versionsDir, { recursive: true });
    }
    listInstalled() {
        const current = this.getCurrent();
        const byVersionDesc = (a, b) => {
            const pa = this._parseVersion(a.version);
            const pb = this._parseVersion(b.version);
            for (let i = 0; i < 3; i++) {
                if ((pa[i] || 0) !== (pb[i] || 0))
                    return (pb[i] || 0) - (pa[i] || 0);
            }
            return 0;
        };
        const managed = (fs_1.default.existsSync(this.versionsDir) ? fs_1.default.readdirSync(this.versionsDir) : [])
            .filter((d) => {
            const dir = path_1.default.join(this.versionsDir, d);
            return (fs_1.default.statSync(dir).isDirectory() &&
                fs_1.default.existsSync(path_1.default.join(dir, 'bin', 'java.exe')));
        })
            .map((version) => ({
            version,
            isCurrent: version === current,
            path: path_1.default.join(this.versionsDir, version),
            external: false,
        }))
            .sort(byVersionDesc);
        const managedPaths = new Set(managed.map((m) => m.path.toLowerCase()));
        const external = this._discoverExternal(managedPaths).sort(byVersionDesc);
        return [...managed, ...external];
    }
    getCurrent() {
        try {
            const target = fs_1.default.readlinkSync(this.symlinkPath);
            return path_1.default.basename(target);
        }
        catch {
            return null;
        }
    }
    async listRemote() {
        // Discover available feature versions + which are LTS
        const info = await this._getJson('https://api.adoptium.net/v3/info/available_releases');
        const lts = new Set(info.available_lts_releases ?? []);
        const features = Array.from(new Set([...(info.available_lts_releases ?? []), info.most_recent_feature_release]))
            .filter((n) => typeof n === 'number')
            .sort((a, b) => b - a);
        // Resolve the latest GA build of each feature version (parallel)
        const results = await Promise.all(features.map(async (feature) => {
            try {
                const url = `https://api.adoptium.net/v3/assets/feature_releases/${feature}/ga` +
                    `?architecture=x64&image_type=jdk&os=windows&vendor=eclipse&jvm_impl=hotspot&page_size=1`;
                const assets = await this._getJson(url);
                const rel = assets?.[0];
                if (!rel || !rel.binaries?.length)
                    return null;
                return {
                    version: rel.release_name, // e.g. "jdk-21.0.11+10"
                    lts: lts.has(feature) ? `Java ${feature}` : false,
                    date: (rel.timestamp || '').split('T')[0],
                };
            }
            catch {
                return null;
            }
        }));
        return results.filter((v) => v !== null);
    }
    async install(version, onProgress) {
        const destDir = path_1.default.join(this.versionsDir, version);
        if (fs_1.default.existsSync(destDir)) {
            return { success: false, error: `Version ${version} is already installed` };
        }
        // Deterministic download endpoint — resolves the exact build by release name.
        const downloadUrl = `https://api.adoptium.net/v3/binary/version/${encodeURIComponent(version)}` +
            `/windows/x64/jdk/hotspot/normal/eclipse?project=jdk`;
        const safeName = version.replace(/[^a-zA-Z0-9._-]/g, '_');
        const tmpZip = path_1.default.join(os_1.default.tmpdir(), `${safeName}.zip`);
        const tmpExtract = path_1.default.join(os_1.default.tmpdir(), `jdkvm_${safeName}`);
        try {
            await this._download(downloadUrl, tmpZip, onProgress);
            fs_1.default.rmSync(tmpExtract, { recursive: true, force: true });
            fs_1.default.mkdirSync(tmpExtract, { recursive: true });
            await execAsync(`powershell -Command "Expand-Archive -Force -Path '${tmpZip}' -DestinationPath '${tmpExtract}'"`);
            // The zip contains a single top-level JDK folder (e.g. jdk-21.0.11+10).
            // Locate whichever extracted dir actually holds bin\java.exe.
            const jdkRoot = this._findJdkRoot(tmpExtract);
            if (!jdkRoot) {
                throw new Error('Extraction failed: bin\\java.exe not found in archive');
            }
            await execAsync(`xcopy /E /I /Q "${jdkRoot}" "${destDir}"`, { shell: 'cmd.exe' });
            if (!fs_1.default.existsSync(path_1.default.join(destDir, 'bin', 'java.exe'))) {
                fs_1.default.rmSync(destDir, { recursive: true, force: true });
                throw new Error('java.exe not found after extraction — download may be corrupted');
            }
            fs_1.default.rmSync(tmpZip, { force: true });
            fs_1.default.rmSync(tmpExtract, { recursive: true, force: true });
            onProgress(100);
            return { success: true };
        }
        catch (e) {
            fs_1.default.rmSync(tmpZip, { force: true });
            fs_1.default.rmSync(tmpExtract, { recursive: true, force: true });
            return { success: false, error: String(e) };
        }
    }
    use(version) {
        const versionDir = path_1.default.join(this.versionsDir, version);
        if (!fs_1.default.existsSync(versionDir)) {
            return { success: false, error: `Version ${version} is not installed` };
        }
        try {
            if (fs_1.default.existsSync(this.symlinkPath)) {
                (0, child_process_1.execSync)(`rmdir "${this.symlinkPath}"`, { shell: 'cmd.exe' });
            }
            (0, child_process_1.execSync)(`mklink /J "${this.symlinkPath}" "${versionDir}"`, { shell: 'cmd.exe' });
            return { success: true };
        }
        catch (e) {
            return { success: false, error: String(e) };
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
    /** Check if JAVA_HOME points at the junction AND its bin is on the user PATH */
    isEnvConfigured() {
        try {
            const javaHome = (0, child_process_1.execSync)(`powershell -Command "[System.Environment]::GetEnvironmentVariable('JAVA_HOME', 'User')"`, { shell: 'cmd.exe', encoding: 'utf8' }).trim();
            const userPath = (0, child_process_1.execSync)(`powershell -Command "[System.Environment]::GetEnvironmentVariable('Path', 'User')"`, { shell: 'cmd.exe', encoding: 'utf8' }).trim();
            const binPath = path_1.default.join(this.symlinkPath, 'bin');
            return (javaHome.toLowerCase() === this.symlinkPath.toLowerCase() &&
                userPath.toLowerCase().includes(binPath.toLowerCase()));
        }
        catch {
            return false;
        }
    }
    /** Set JAVA_HOME = ~/.jdkvm/current and prepend its bin to user PATH (no admin needed) */
    setupEnv() {
        try {
            (0, child_process_1.execSync)(`powershell -Command "[System.Environment]::SetEnvironmentVariable('JAVA_HOME', '${this.symlinkPath}', 'User')"`, { shell: 'cmd.exe' });
            const binPath = path_1.default.join(this.symlinkPath, 'bin');
            const currentPath = (0, child_process_1.execSync)(`powershell -Command "[System.Environment]::GetEnvironmentVariable('Path', 'User')"`, { shell: 'cmd.exe', encoding: 'utf8' }).trim();
            if (!currentPath.toLowerCase().includes(binPath.toLowerCase())) {
                const newPath = currentPath ? `${binPath};${currentPath}` : binPath;
                (0, child_process_1.execSync)(`powershell -Command "[System.Environment]::SetEnvironmentVariable('Path', '${newPath}', 'User')"`, { shell: 'cmd.exe' });
            }
            return { success: true };
        }
        catch (e) {
            return { success: false, error: String(e) };
        }
    }
    /** Check if PowerShell profile already has the jdkvm lines */
    isProfileConfigured() {
        try {
            const profilePath = (0, child_process_1.execSync)('powershell -Command "$PROFILE.CurrentUserAllHosts"', { shell: 'cmd.exe', encoding: 'utf8' }).trim();
            if (!fs_1.default.existsSync(profilePath))
                return false;
            const content = fs_1.default.readFileSync(profilePath, 'utf8');
            return content.includes('.jdkvm\\current');
        }
        catch {
            return false;
        }
    }
    /** Inject JAVA_HOME + PATH prepend into PowerShell profile so every new terminal picks up the active JDK */
    setupProfile() {
        try {
            const profilePath = (0, child_process_1.execSync)('powershell -Command "$PROFILE.CurrentUserAllHosts"', { shell: 'cmd.exe', encoding: 'utf8' }).trim();
            const profileDir = path_1.default.dirname(profilePath);
            fs_1.default.mkdirSync(profileDir, { recursive: true });
            const block = `\n# JDKVM — set JAVA_HOME + prepend active JDK to PATH\n` +
                `$env:JAVA_HOME = "$env:USERPROFILE\\.jdkvm\\current"\n` +
                `$env:Path = "$env:JAVA_HOME\\bin;$env:Path"\n`;
            if (fs_1.default.existsSync(profilePath)) {
                const existing = fs_1.default.readFileSync(profilePath, 'utf8');
                if (existing.includes('.jdkvm\\current'))
                    return { success: true };
                fs_1.default.appendFileSync(profilePath, block, 'utf8');
            }
            else {
                fs_1.default.writeFileSync(profilePath, block, 'utf8');
            }
            // Ensure PS execution policy allows the profile to load (skip if already permissive)
            const policy = (0, child_process_1.execSync)('powershell -Command "Get-ExecutionPolicy -Scope CurrentUser"', { shell: 'cmd.exe', encoding: 'utf8' }).trim();
            if (policy === 'Undefined' || policy === 'Restricted') {
                (0, child_process_1.execSync)('powershell -Command "Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force"', { shell: 'cmd.exe' });
            }
            return { success: true };
        }
        catch (e) {
            return { success: false, error: String(e) };
        }
    }
    // ── helpers ────────────────────────────────────────────────
    /** "jdk-21.0.11+10" / "21.0.5" / "1.8.0_432" -> [major, minor, patch] */
    _parseVersion(name) {
        let core = name.replace(/^jdk-?/i, '').split(/[+_-]/)[0];
        // Legacy "1.8.0" form → treat as major 8
        const parts = core.split('.').map((n) => parseInt(n, 10) || 0);
        if (parts[0] === 1 && parts.length > 1)
            return parts.slice(1);
        return parts;
    }
    /** Read the JDK `release` file for a friendly version (falls back to folder name) */
    _jdkLabel(home) {
        try {
            const rel = fs_1.default.readFileSync(path_1.default.join(home, 'release'), 'utf8');
            const m = rel.match(/JAVA_VERSION="?([^"\r\n]+)"?/);
            if (m)
                return m[1];
        }
        catch {
            // no release file — use the folder name
        }
        return path_1.default.basename(home);
    }
    /** Find JDKs already installed on the machine (read-only) */
    _discoverExternal(managedPaths) {
        const found = new Map();
        const add = (home) => {
            if (!home)
                return;
            try {
                const norm = path_1.default.normalize(home).replace(/[\\/]+$/, '');
                const lower = norm.toLowerCase();
                if (found.has(lower) || managedPaths.has(lower))
                    return;
                if (lower.includes('\\.jdkvm\\'))
                    return; // our own managed/junction tree
                // Require the compiler (javac.exe) so JREs are not mistaken for JDKs
                if (!fs_1.default.existsSync(path_1.default.join(norm, 'bin', 'javac.exe')))
                    return;
                found.set(lower, {
                    version: this._jdkLabel(norm),
                    isCurrent: false,
                    path: norm,
                    external: true,
                });
            }
            catch {
                // ignore unreadable candidate
            }
        };
        const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
        const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const parents = [
            path_1.default.join(pf, 'Java'),
            path_1.default.join(pf, 'Eclipse Adoptium'),
            path_1.default.join(pf, 'Eclipse Foundation'),
            path_1.default.join(pf, 'AdoptOpenJDK'),
            path_1.default.join(pf, 'Amazon Corretto'),
            path_1.default.join(pf, 'Microsoft'),
            path_1.default.join(pf, 'Zulu'),
            path_1.default.join(pf, 'Azul', 'Zulu'),
            path_1.default.join(pf, 'BellSoft'),
            path_1.default.join(pf, 'SapMachine'),
            path_1.default.join(pf, 'Semeru'),
            path_1.default.join(pfx86, 'Java'),
        ];
        const safeDirs = (dir) => {
            try {
                return fs_1.default
                    .readdirSync(dir)
                    .map((e) => path_1.default.join(dir, e))
                    .filter((p) => {
                    try {
                        return fs_1.default.statSync(p).isDirectory();
                    }
                    catch {
                        return false;
                    }
                });
            }
            catch {
                return [];
            }
        };
        // Scan vendor parents up to two levels deep (some vendors nest, e.g. Azul\Zulu\zulu-21)
        for (const parent of parents) {
            for (const child of safeDirs(parent)) {
                if (fs_1.default.existsSync(path_1.default.join(child, 'bin', 'java.exe')))
                    add(child);
                else
                    for (const grand of safeDirs(child))
                        add(grand);
            }
        }
        // JAVA_HOME (current process) + anything resolvable from PATH
        add(process.env.JAVA_HOME);
        try {
            const out = (0, child_process_1.execSync)('where java 2>nul', { shell: 'cmd.exe', encoding: 'utf8' });
            for (const line of out.split(/\r?\n/)) {
                const p = line.trim();
                if (/java\.exe$/i.test(p))
                    add(path_1.default.dirname(path_1.default.dirname(p)));
            }
        }
        catch {
            // java not on PATH
        }
        return Array.from(found.values());
    }
    _findJdkRoot(dir) {
        if (fs_1.default.existsSync(path_1.default.join(dir, 'bin', 'java.exe')))
            return dir;
        for (const entry of fs_1.default.readdirSync(dir)) {
            const child = path_1.default.join(dir, entry);
            try {
                if (fs_1.default.statSync(child).isDirectory() && fs_1.default.existsSync(path_1.default.join(child, 'bin', 'java.exe'))) {
                    return child;
                }
            }
            catch {
                // ignore unreadable entries
            }
        }
        return null;
    }
    _getJson(url) {
        return new Promise((resolve, reject) => {
            https_1.default
                .get(url, { headers: { 'User-Agent': 'node-version-manager' } }, (res) => {
                // Follow redirects (some endpoints 3xx)
                const loc = res.headers.location;
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
                    res.resume();
                    this._getJson(loc).then(resolve).catch(reject);
                    return;
                }
                let data = '';
                res.on('data', (c) => (data += c));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            })
                .on('error', reject);
        });
    }
    _download(url, dest, onProgress) {
        return new Promise((resolve, reject) => {
            const file = fs_1.default.createWriteStream(dest);
            https_1.default
                .get(url, { headers: { 'User-Agent': 'node-version-manager' } }, (res) => {
                // Follow 301/302/307/308 (Adoptium -> GitHub -> object storage)
                const loc = res.headers.location;
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
                    file.close();
                    fs_1.default.rmSync(dest, { force: true });
                    this._download(loc, dest, onProgress).then(resolve).catch(reject);
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
exports.JdkManager = JdkManager;
