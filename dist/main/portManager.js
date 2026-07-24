"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PortManager = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const IS_WIN = process.platform === 'win32';
/** Classify a process name/command into node | java, or null if neither. */
function classify(name) {
    const n = name.toLowerCase();
    if (n === 'node' || n === 'node.exe' || n.includes('node'))
        return 'node';
    if (n === 'java' || n === 'java.exe' || n.includes('java'))
        return 'java';
    return null;
}
/**
 * Lists TCP ports in LISTENING state owned by Node or Java processes.
 * Windows: parses `netstat -ano` then maps PID -> image name via `tasklist`.
 * macOS/Linux: parses `lsof` which already reports the command name per socket.
 */
class PortManager {
    async listPorts() {
        try {
            return IS_WIN ? await this._listWindows() : await this._listUnix();
        }
        catch {
            // Tools missing or produced no parseable output — treat as "nothing listening"
            return [];
        }
    }
    /** Force-kills a process by PID. Returns a structured result rather than throwing. */
    async killProcess(pid) {
        if (!Number.isInteger(pid) || pid <= 0) {
            return { success: false, error: `Invalid PID: ${pid}` };
        }
        try {
            // process.kill works on both platforms; SIGKILL maps to a forced terminate on Windows.
            process.kill(pid, 'SIGKILL');
            return { success: true };
        }
        catch (err) {
            if (err?.code === 'ESRCH')
                return { success: true }; // already gone
            if (err?.code === 'EPERM') {
                return { success: false, error: `Permission denied killing PID ${pid} (try running as administrator).` };
            }
            return { success: false, error: err?.message ?? `Failed to kill PID ${pid}` };
        }
    }
    // ── Windows ─────────────────────────────────────────────────────
    async _listWindows() {
        const { stdout } = await execAsync('netstat -ano -p TCP');
        // netstat rows: "  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234"
        const byPid = new Map();
        for (const line of stdout.split(/\r?\n/)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 5 || parts[0].toUpperCase() !== 'TCP')
                continue;
            if (parts[3].toUpperCase() !== 'LISTENING')
                continue;
            const local = parts[1];
            const pid = Number(parts[4]);
            if (!Number.isInteger(pid) || pid <= 0)
                continue;
            const { address, port } = this._splitAddress(local);
            if (port == null)
                continue;
            const arr = byPid.get(pid) ?? [];
            arr.push({ port, address });
            byPid.set(pid, arr);
        }
        if (byPid.size === 0)
            return [];
        const names = await this._tasklistNames([...byPid.keys()]);
        const result = [];
        const seen = new Set();
        for (const [pid, entries] of byPid) {
            const name = names.get(pid) ?? '';
            const runtime = classify(name);
            if (!runtime)
                continue;
            for (const { port, address } of entries) {
                const key = `${pid}:${port}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                result.push({ port, pid, processName: name, runtime, address, protocol: 'TCP' });
            }
        }
        return result.sort((a, b) => a.port - b.port);
    }
    /** Maps PIDs -> image name using a single `tasklist` call (CSV output). */
    async _tasklistNames(pids) {
        const map = new Map();
        try {
            const { stdout } = await execAsync('tasklist /FO CSV /NH');
            for (const line of stdout.split(/\r?\n/)) {
                // CSV: "node.exe","1234","Console","1","50,000 K"
                const m = line.match(/^"([^"]+)","(\d+)"/);
                if (!m)
                    continue;
                map.set(Number(m[2]), m[1]);
            }
        }
        catch {
            // ignore — unmapped PIDs simply get filtered out by classify()
        }
        // Keep only the PIDs we asked about
        const wanted = new Set(pids);
        for (const pid of [...map.keys()])
            if (!wanted.has(pid))
                map.delete(pid);
        return map;
    }
    // ── macOS / Linux ───────────────────────────────────────────────
    async _listUnix() {
        // -nP: no name resolution (faster); -iTCP -sTCP:LISTEN: only listening TCP sockets
        const { stdout } = await execAsync('lsof -nP -iTCP -sTCP:LISTEN');
        // lsof rows: "node   1234 user   23u  IPv4 ...  TCP 127.0.0.1:3000 (LISTEN)"
        const result = [];
        const seen = new Set();
        for (const line of stdout.split(/\r?\n/)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 9)
                continue;
            if (parts[7]?.toUpperCase() !== 'TCP')
                continue;
            const name = parts[0];
            const runtime = classify(name);
            if (!runtime)
                continue;
            const pid = Number(parts[1]);
            if (!Number.isInteger(pid) || pid <= 0)
                continue;
            const { address, port } = this._splitAddress(parts[8]);
            if (port == null)
                continue;
            const key = `${pid}:${port}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            result.push({ port, pid, processName: name, runtime, address, protocol: 'TCP' });
        }
        return result.sort((a, b) => a.port - b.port);
    }
    /**
     * Splits a "host:port" local-address token, handling IPv6 (e.g. "[::]:3000",
     * "*:8080", "0.0.0.0:5432"). Returns port=null when no numeric port is present.
     */
    _splitAddress(token) {
        const idx = token.lastIndexOf(':');
        if (idx === -1)
            return { address: token, port: null };
        const address = token.slice(0, idx) || '*';
        const port = Number(token.slice(idx + 1));
        return { address, port: Number.isInteger(port) ? port : null };
    }
}
exports.PortManager = PortManager;
