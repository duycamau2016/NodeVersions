import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { TOOLS, Tool, ToolMeta } from './managers'

// Why this module exists
// ----------------------
// `vm.use()` repoints ~/.nodevm/current — one junction, shared by every VS Code
// window, every external shell and the desktop app. Two repos open side by side
// therefore fight over it: switching in one silently switches the other.
//
// A *pin* never touches that junction. It records which install this window
// should use and lets terminalEnv.ts put that install's bin directory on PATH
// for the terminals this window spawns. Windows stay independent because
// `workspaceState` and `environmentVariableCollection` are both per-window.

const IS_WIN = process.platform === 'win32'

const pinKey = (tool: Tool) => `nodeversions.pin.${tool}`

let ctx: vscode.ExtensionContext | undefined

export function initPins(context: vscode.ExtensionContext) {
  ctx = context
}

// ── Resolution ────────────────────────────────────────────────

export type PinSource = 'workspace' | 'file' | 'global' | 'none'

export interface Resolved {
  tool: ToolMeta
  /** The install this workspace should actually use; null when nothing resolves. */
  version: string | null
  dir: string | null
  source: PinSource
  /** Name of the version file the request came from, when source is 'file'. */
  file?: string
  /** A pin or version file that names something no installed version matches. */
  unresolved?: string
}

/** `resolve` walks the filesystem, so results are memoised until something changes. */
const cache = new Map<Tool, Resolved>()

export function invalidatePins() {
  cache.clear()
}

export function resolveTool(tool: ToolMeta): Resolved {
  const hit = cache.get(tool.key)
  if (hit) return hit
  const fresh = compute(tool)
  cache.set(tool.key, fresh)
  return fresh
}

export function resolveAll(): Resolved[] {
  return TOOLS.map(resolveTool)
}

function compute(tool: ToolMeta): Resolved {
  const manual = getManualPin(tool.key)
  if (manual) return fromRequest(tool, manual, 'workspace')

  const declared = readVersionFile(tool)
  if (declared) return { ...fromRequest(tool, declared.request, 'file'), file: declared.file }

  // Unpinned workspaces keep the pre-pinning behaviour exactly: follow the
  // global `current` junction, whatever the desktop app last pointed it at.
  const dir = realpath(currentLink(tool.vm.versionsDir))
  return dir
    ? { tool, version: path.basename(dir), dir, source: 'global' }
    : { tool, version: null, dir: null, source: 'none' }
}

function fromRequest(tool: ToolMeta, request: string, source: PinSource): Resolved {
  const match = matchInstalled(tool, request)
  // An unresolved pin deliberately yields no directory rather than falling back
  // to the global one — a silent fallback is exactly the cross-repo bleed this
  // feature exists to stop.
  return match
    ? { tool, version: match.version, dir: match.path, source }
    : { tool, version: null, dir: null, source, unresolved: request }
}

// ── Manual pins ───────────────────────────────────────────────

export function getManualPin(tool: Tool): string | null {
  return ctx?.workspaceState.get<string>(pinKey(tool)) ?? null
}

export async function setManualPin(tool: Tool, version: string | null): Promise<void> {
  // `undefined` is how workspaceState deletes a key; `null` would be stored.
  await ctx?.workspaceState.update(pinKey(tool), version ?? undefined)
  invalidatePins()
}

export function isPinned(tool: ToolMeta): boolean {
  const source = resolveTool(tool).source
  return source === 'workspace' || source === 'file'
}

// ── Version files ─────────────────────────────────────────────

/** Every filename any tool reads — used to build the file watchers. */
export const VERSION_FILE_NAMES = Array.from(new Set(TOOLS.flatMap((t) => t.versionFiles)))

function readVersionFile(tool: ToolMeta): { request: string; file: string } | null {
  if (!config().get<boolean>('useVersionFiles', true)) return null

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    // Remote/virtual folders have no path the local managers could serve.
    if (folder.uri.scheme !== 'file') continue
    for (const name of tool.versionFiles) {
      let raw: string
      try {
        raw = fs.readFileSync(path.join(folder.uri.fsPath, name), 'utf8')
      } catch {
        continue
      }
      const request = firstMeaningfulLine(raw)
      if (request) return { request, file: name }
    }
  }
  return null
}

function firstMeaningfulLine(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) return trimmed
  }
  return null
}

// ── Matching a request against what is installed ──────────────

/** `.nvmrc` aliases that mean "whatever the newest install is". */
const NEWEST = new Set(['node', 'latest', 'current', '*'])

interface Installed {
  version: string
  path: string
}

function matchInstalled(tool: ToolMeta, request: string): Installed | null {
  // Fast path: the request is already a directory name under versionsDir. Pins
  // store the exact version string, so this is the common case.
  const direct = path.join(tool.vm.versionsDir, request)
  if (hasBinary(tool, direct)) return { version: request, path: direct }

  // Then a plain directory scan, which covers every managed install. Only a
  // loose request that matches nothing managed (say `.nvmrc` naming a system
  // Node) is worth listInstalled(), which shells out to `where node` /
  // `which -a node` — too slow to sit on the activation path by default.
  return pick(listManaged(tool), request) ?? pick(listExternal(tool), request)
}

function pick(installed: Installed[], request: string): Installed | null {
  if (installed.length === 0) return null

  const req = normalize(request)
  if (NEWEST.has(req)) return installed[0]

  const exact = installed.find((v) => normalize(v.version) === req)
  if (exact) return exact

  // `.nvmrc` holding "20" should match v20.11.0; `.java-version` holding "17"
  // should match jdk-17.0.13+11.
  const prefixed = installed.find((v) => isVersionPrefix(normalize(v.version), req))
  if (prefixed) return prefixed

  // Last resort for naming schemes prefixes miss, e.g. request "8" against
  // "jdk8u392-b08". Guarded on a leading digit so a codename like
  // `lts/hydrogen` cannot parse to 0 and match something arbitrary.
  if (/^\d/.test(req)) {
    const wanted = majorOf(req)
    const byMajor = installed.find((v) => majorOf(normalize(v.version)) === wanted)
    if (byMajor) return byMajor
  }

  return null
}

/** Installs this extension manages, newest first — no subprocesses. */
function listManaged(tool: ToolMeta): Installed[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(tool.vm.versionsDir)
  } catch {
    return []
  }
  return entries
    .map((version) => ({ version, path: path.join(tool.vm.versionsDir, version) }))
    .filter((v) => hasBinary(tool, v.path))
    .sort((a, b) => compareDesc(a.version, b.version))
}

/** The expensive half: Node/JDK installs already on the machine. */
function listExternal(tool: ToolMeta): Installed[] {
  try {
    return tool.vm.listInstalled().filter((v) => v.external)
  } catch {
    return []
  }
}

function normalize(version: string): string {
  return version.trim().toLowerCase().replace(/^v/, '').replace(/^jdk-?/, '')
}

/** True when `version` is `request` followed by a version separator, not more digits. */
function isVersionPrefix(version: string, request: string): boolean {
  if (!version.startsWith(request)) return false
  return /[.+_-]/.test(version.charAt(request.length))
}

/** Numeric components, collapsing the legacy `1.8.0` form to `8.0`. */
function numericParts(version: string): number[] {
  const parts = version.split(/[.+_-]/).map((n) => parseInt(n, 10) || 0)
  return parts[0] === 1 && parts.length > 1 ? parts.slice(1) : parts
}

function majorOf(version: string): number {
  return numericParts(version)[0]
}

function compareDesc(a: string, b: string): number {
  const pa = numericParts(normalize(a))
  const pb = numericParts(normalize(b))
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0)
  }
  return 0
}

// ── Paths ─────────────────────────────────────────────────────

/** ~/.nodevm/current — the manager keeps it private, but it is versionsDir's sibling. */
function currentLink(versionsDir: string): string {
  return path.join(path.dirname(versionsDir), 'current')
}

function realpath(target: string): string | null {
  try {
    return fs.realpathSync(target)
  } catch {
    return null
  }
}

function canon(target: string): string {
  return IS_WIN ? target.toLowerCase() : target
}

function hasBinary(tool: ToolMeta, dir: string): boolean {
  const exe =
    tool.key === 'node'
      ? IS_WIN
        ? path.join(dir, 'node.exe')
        : path.join(dir, 'bin', 'node')
      : path.join(dir, 'bin', IS_WIN ? 'java.exe' : 'java')
  return fs.existsSync(exe)
}

/** Windows puts node.exe at the install root; everything else lives in bin/. */
export function binDir(tool: ToolMeta, dir: string): string {
  return tool.key === 'node' && IS_WIN ? dir : path.join(dir, 'bin')
}

// ── Helpers for the UI surfaces ───────────────────────────────

/**
 * `listInstalled()` with `isCurrent` recomputed against the *effective* install
 * rather than the global junction, so every surface agrees on what is active.
 */
export function listWithEffective(tool: ToolMeta) {
  const target = effectivePath(tool)
  return tool.vm.listInstalled().map((v) => ({
    ...v,
    isCurrent: target !== null && canon(realpath(v.path) ?? v.path) === target,
    /** Whether the global junction points here — distinct from being effective. */
    isGlobal: v.isCurrent,
  }))
}

function effectivePath(tool: ToolMeta): string | null {
  const dir = resolveTool(tool).dir
  return dir ? canon(realpath(dir) ?? dir) : null
}

/** The installed version living at `target`, for callers that only have a path. */
export function versionAtPath(tool: ToolMeta, target: string): string | null {
  const wanted = canon(realpath(target) ?? target)
  try {
    const hit = tool.vm.listInstalled().find((v) => canon(realpath(v.path) ?? v.path) === wanted)
    if (hit) return hit.version
  } catch {
    // fall through to the basename guess
  }
  return hasBinary(tool, target) ? path.basename(target) : null
}

/** Short human label for where the effective version came from. */
export function describeSource(r: Resolved): string {
  switch (r.source) {
    case 'workspace':
      return 'pinned to this workspace'
    case 'file':
      return `pinned by ${r.file}`
    case 'global':
      return 'global default'
    default:
      return 'none active'
  }
}

function config() {
  return vscode.workspace.getConfiguration('nodeversions')
}
