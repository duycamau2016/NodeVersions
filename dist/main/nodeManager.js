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
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class NodeManager {
    constructor() {
        this.versionsDir = path_1.default.join(os_1.default.homedir(), '.nodevm', 'versions');
        this.symlinkPath = path_1.default.join(os_1.default.homedir(), '.nodevm', 'current');
        fs_1.default.mkdirSync(this.versionsDir, { recursive: true });
    }
    listInstalled() {
        if (!fs_1.default.existsSync(this.versionsDir))
            return [];
        const current = this.getCurrent();
        return fs_1.default
            .readdirSync(this.versionsDir)
            .filter((d) => {
            if (!d.startsWith('v'))
                return false;
            const dir = path_1.default.join(this.versionsDir, d);
            return (fs_1.default.statSync(dir).isDirectory() &&
                fs_1.default.existsSync(path_1.default.join(dir, 'node.exe')));
        })
            .map((version) => ({
            version,
            isCurrent: version === current,
            path: path_1.default.join(this.versionsDir, version),
        }))
            .sort((a, b) => {
            const pa = a.version.replace('v', '').split('.').map(Number);
            const pb = b.version.replace('v', '').split('.').map(Number);
            for (let i = 0; i < 3; i++) {
                if ((pa[i] || 0) !== (pb[i] || 0))
                    return (pb[i] || 0) - (pa[i] || 0);
            }
            return 0;
        });
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
        const arch = process.arch === 'x64' ? 'x64' : 'x86';
        const fileName = `node-${version}-win-${arch}`;
        const downloadUrl = `https://nodejs.org/dist/${version}/${fileName}.zip`;
        const destDir = path_1.default.join(this.versionsDir, version);
        if (fs_1.default.existsSync(destDir)) {
            return { success: false, error: `Version ${version} is already installed` };
        }
        const tmpZip = path_1.default.join(os_1.default.tmpdir(), `${fileName}.zip`);
        try {
            // Download
            await this._download(downloadUrl, tmpZip, onProgress);
            // Extract using PowerShell (no external deps)
            const tmpExtract = path_1.default.join(os_1.default.tmpdir(), `nodevm_${version}`);
            fs_1.default.mkdirSync(tmpExtract, { recursive: true });
            await execAsync(`powershell -Command "Expand-Archive -Force -Path '${tmpZip}' -DestinationPath '${tmpExtract}'"`);
            // Move extracted folder to versionsDir
            const extracted = path_1.default.join(tmpExtract, fileName);
            if (!fs_1.default.existsSync(extracted)) {
                throw new Error(`Extraction failed: expected folder not found at ${extracted}`);
            }
            // Use xcopy on Windows (more reliable than renameSync across paths)
            await execAsync(`xcopy /E /I /Q "${extracted}" "${destDir}"`, { shell: 'cmd.exe' });
            if (!fs_1.default.existsSync(path_1.default.join(destDir, 'node.exe'))) {
                fs_1.default.rmSync(destDir, { recursive: true, force: true });
                throw new Error('node.exe not found after extraction — download may be corrupted');
            }
            // Cleanup
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
    use(version) {
        const versionDir = path_1.default.join(this.versionsDir, version);
        if (!fs_1.default.existsSync(versionDir)) {
            return { success: false, error: `Version ${version} is not installed` };
        }
        try {
            // Remove existing junction without touching its target contents
            if (fs_1.default.existsSync(this.symlinkPath)) {
                (0, child_process_1.execSync)(`rmdir "${this.symlinkPath}"`, { shell: 'cmd.exe' });
            }
            // Create directory junction (works without admin on Windows)
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
    /** Check if ~/.nodevm/current is already in user PATH */
    isPathConfigured() {
        try {
            const userPath = (0, child_process_1.execSync)(`powershell -Command "[System.Environment]::GetEnvironmentVariable('Path', 'User')"`, { shell: 'cmd.exe', encoding: 'utf8' }).trim();
            return userPath.toLowerCase().includes(this.symlinkPath.toLowerCase());
        }
        catch {
            return false;
        }
    }
    /** Prepend ~/.nodevm/current to user PATH permanently (no admin needed) */
    setupPath() {
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
    /** Check if PowerShell profile already has the nodevm prepend line */
    isProfileConfigured() {
        try {
            const profilePath = (0, child_process_1.execSync)('powershell -Command "$PROFILE.CurrentUserAllHosts"', { shell: 'cmd.exe', encoding: 'utf8' }).trim();
            if (!fs_1.default.existsSync(profilePath))
                return false;
            const content = fs_1.default.readFileSync(profilePath, 'utf8');
            return content.includes('.nodevm\\current');
        }
        catch {
            return false;
        }
    }
    /** Inject PATH prepend into PowerShell profile so every new terminal picks up the active version */
    setupProfile() {
        try {
            const profilePath = (0, child_process_1.execSync)('powershell -Command "$PROFILE.CurrentUserAllHosts"', { shell: 'cmd.exe', encoding: 'utf8' }).trim();
            const profileDir = path_1.default.dirname(profilePath);
            fs_1.default.mkdirSync(profileDir, { recursive: true });
            const line = `\n# NodeVM — prepend active version to PATH\n$env:Path = "$env:USERPROFILE\\.nodevm\\current;$env:Path"\n`;
            if (fs_1.default.existsSync(profilePath)) {
                const existing = fs_1.default.readFileSync(profilePath, 'utf8');
                if (existing.includes('.nodevm\\current'))
                    return { success: true };
                fs_1.default.appendFileSync(profilePath, line, 'utf8');
            }
            else {
                fs_1.default.writeFileSync(profilePath, line, 'utf8');
            }
            // Also ensure PS execution policy allows profile
            (0, child_process_1.execSync)('powershell -Command "Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force"', { shell: 'cmd.exe' });
            return { success: true };
        }
        catch (e) {
            return { success: false, error: String(e) };
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
