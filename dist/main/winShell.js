"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWinCmdHookConfigured = isWinCmdHookConfigured;
exports.ensureWinCmdHook = ensureWinCmdHook;
/**
 * Windows CMD startup hooks via HKCU\...\Command Processor\AutoRun.
 *
 * User PATH loses to System PATH, so registry Step 1 alone is not enough for
 * `node` / `java` in a fresh CMD window. PowerShell gets $PROFILE; CMD gets
 * AutoRun pointing at a small .cmd we own under ~/.nodevm or ~/.jdkvm.
 *
 * AutoRun is a single string shared by every tool — we only append our call
 * snippet and never wipe an existing value.
 */
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const AUTORUN_PS_PATH = 'HKCU:\\Software\\Microsoft\\Command Processor';
function scriptRelPath(kind) {
    return kind === 'nodevm' ? '.nodevm\\cmd-autorun.cmd' : '.jdkvm\\cmd-autorun.cmd';
}
function scriptAbsPath(kind) {
    return path_1.default.join(os_1.default.homedir(), kind === 'nodevm' ? '.nodevm' : '.jdkvm', 'cmd-autorun.cmd');
}
function callSnippet(kind) {
    const rel = scriptRelPath(kind);
    // `if exist` keeps AutoRun quiet when the user uninstalls the manager later.
    return `if exist "%USERPROFILE%\\${rel}" call "%USERPROFILE%\\${rel}"`;
}
function scriptBody(kind) {
    if (kind === 'nodevm') {
        return [
            '@echo off',
            'REM NodeVM — prepend active version to PATH (CMD)',
            'set "PATH=%USERPROFILE%\\.nodevm\\current;%PATH%"',
            '',
        ].join('\r\n');
    }
    return [
        '@echo off',
        'REM JDKVM — set JAVA_HOME + prepend active JDK to PATH (CMD)',
        'set "JAVA_HOME=%USERPROFILE%\\.jdkvm\\current"',
        'set "PATH=%JAVA_HOME%\\bin;%PATH%"',
        '',
    ].join('\r\n');
}
function escapeForPowerShellSingleQuoted(value) {
    return value.replace(/'/g, "''");
}
function getCmdAutoRun() {
    try {
        // Empty / missing value → empty string (reg/PS may throw).
        const out = (0, child_process_1.execSync)(`powershell -NoProfile -Command "(Get-ItemProperty -LiteralPath '${AUTORUN_PS_PATH}' -Name AutoRun -ErrorAction SilentlyContinue).AutoRun"`, { shell: 'cmd.exe', encoding: 'utf8' }).trim();
        return out;
    }
    catch {
        return '';
    }
}
function setCmdAutoRun(value) {
    const escaped = escapeForPowerShellSingleQuoted(value);
    (0, child_process_1.execSync)(`powershell -NoProfile -Command "New-Item -Path '${AUTORUN_PS_PATH}' -Force | Out-Null; Set-ItemProperty -LiteralPath '${AUTORUN_PS_PATH}' -Name AutoRun -Value '${escaped}' -Type String"`, { shell: 'cmd.exe' });
}
/** True when our .cmd exists and AutoRun calls it. */
function isWinCmdHookConfigured(kind) {
    try {
        if (!fs_1.default.existsSync(scriptAbsPath(kind)))
            return false;
        const autorun = getCmdAutoRun().toLowerCase();
        return autorun.includes(scriptRelPath(kind).toLowerCase());
    }
    catch {
        return false;
    }
}
/**
 * Write the manager's cmd-autorun.cmd and ensure AutoRun calls it.
 * Preserves any pre-existing AutoRun content from other tools.
 */
function ensureWinCmdHook(kind) {
    const abs = scriptAbsPath(kind);
    fs_1.default.mkdirSync(path_1.default.dirname(abs), { recursive: true });
    fs_1.default.writeFileSync(abs, scriptBody(kind), 'utf8');
    const rel = scriptRelPath(kind);
    const current = getCmdAutoRun();
    if (current.toLowerCase().includes(rel.toLowerCase()))
        return;
    const snippet = callSnippet(kind);
    const next = current ? `${current} & ${snippet}` : snippet;
    setCmdAutoRun(next);
}
