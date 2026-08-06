import * as vscode from 'vscode'
import * as path from 'path'
import { nodeManager, jdkManager, portManager } from './managers'

type Vm = typeof nodeManager | typeof jdkManager

interface ToolMeta {
  key: 'node' | 'java'
  noun: string
  vm: Vm
  icon: string
  /** Where releases are downloaded from — shown in the Install New view. */
  source: string
}

const TOOLS: ToolMeta[] = [
  { key: 'node', noun: 'Node', vm: nodeManager, icon: 'symbol-event', source: 'nodejs.org' },
  { key: 'java', noun: 'JDK', vm: jdkManager, icon: 'coffee', source: 'Adoptium' },
]

// ── Versions view ─────────────────────────────────────────────

/** A tool header ("Node", "JDK") or one installed version beneath it. */
type VersionNode =
  | { kind: 'tool'; tool: ToolMeta }
  | {
      kind: 'version'
      tool: ToolMeta
      version: string
      path: string
      isCurrent: boolean
      external: boolean
    }

export class VersionsProvider implements vscode.TreeDataProvider<VersionNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChange.event

  refresh() {
    this._onDidChange.fire()
  }

  getChildren(node?: VersionNode): VersionNode[] {
    if (!node) return TOOLS.map((tool) => ({ kind: 'tool', tool }))
    if (node.kind !== 'tool') return []

    // listInstalled() touches the filesystem; a failure here must not blank the
    // whole view.
    let installed: ReturnType<Vm['listInstalled']>
    try {
      installed = node.tool.vm.listInstalled()
    } catch {
      return []
    }

    return installed.map((v) => ({
      kind: 'version' as const,
      tool: node.tool,
      version: v.version,
      path: v.path,
      isCurrent: v.isCurrent,
      external: v.external === true,
    }))
  }

  getTreeItem(node: VersionNode): vscode.TreeItem {
    if (node.kind === 'tool') {
      const current = safeCurrent(node.tool.vm)
      const item = new vscode.TreeItem(
        node.tool.noun,
        vscode.TreeItemCollapsibleState.Expanded,
      )
      item.description = current ?? 'none active'
      item.iconPath = new vscode.ThemeIcon(node.tool.icon)
      item.contextValue = `nvmTool-${node.tool.key}`
      return item
    }

    const item = new vscode.TreeItem(node.version, vscode.TreeItemCollapsibleState.None)
    item.description = node.external ? 'system' : undefined
    item.tooltip = new vscode.MarkdownString(
      [`**${node.version}**`, node.path, node.external ? '_Installed outside this extension._' : '']
        .filter(Boolean)
        .join('\n\n'),
    )
    item.iconPath = new vscode.ThemeIcon(
      node.isCurrent ? 'pass-filled' : 'circle-large-outline',
      node.isCurrent ? new vscode.ThemeColor('charts.green') : undefined,
    )

    // Uninstall is only offered where it can succeed: the managers refuse to
    // remove the active version, and external installs are not ours to delete.
    const removable = !node.external && !node.isCurrent
    item.contextValue = `nvmVersion${removable ? '-removable' : ''}`

    if (!node.isCurrent) {
      item.command = {
        command: 'nodeversions.activateVersion',
        title: `Use ${node.version}`,
        arguments: [node],
      }
    }
    return item
  }
}

// ── Install New view ──────────────────────────────────────────

/** A tool header, or one downloadable release beneath it. */
type RemoteNode =
  | { kind: 'tool'; tool: ToolMeta }
  | {
      kind: 'remote'
      tool: ToolMeta
      version: string
      lts: string | false
      date: string
      installed: boolean
    }
  | { kind: 'error'; tool: ToolMeta; message: string }

export class InstallProvider implements vscode.TreeDataProvider<RemoteNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChange.event

  /** Remote lists cost a network round-trip, so they are fetched on first
   *  expand and reused until something actually changes them. */
  private cache = new Map<string, RemoteNode[]>()

  refresh() {
    this._onDidChange.fire()
  }

  /** Drop the cached release lists so the next expand re-fetches. */
  invalidate() {
    this.cache.clear()
    this.refresh()
  }

  async getChildren(node?: RemoteNode): Promise<RemoteNode[]> {
    if (!node) return TOOLS.map((tool) => ({ kind: 'tool', tool }))
    if (node.kind !== 'tool') return []

    const cached = this.cache.get(node.tool.key)
    if (cached) return cached

    let children: RemoteNode[]
    try {
      const [remote, installed] = await Promise.all([
        node.tool.vm.listRemote(),
        Promise.resolve(node.tool.vm.listInstalled()),
      ])
      const have = new Set(installed.filter((v) => !v.external).map((v) => v.version))
      children = remote.map((r) => ({
        kind: 'remote' as const,
        tool: node.tool,
        version: r.version,
        lts: r.lts,
        date: r.date,
        installed: have.has(r.version),
      }))
    } catch (err: unknown) {
      // Offline or a rate-limited API must show *why*, not an empty list.
      children = [
        {
          kind: 'error',
          tool: node.tool,
          message: String((err as Error)?.message ?? err),
        },
      ]
    }

    this.cache.set(node.tool.key, children)
    return children
  }

  getTreeItem(node: RemoteNode): vscode.TreeItem {
    if (node.kind === 'tool') {
      const item = new vscode.TreeItem(
        node.tool.noun,
        vscode.TreeItemCollapsibleState.Collapsed,
      )
      item.description = `available from ${node.tool.source}`
      item.iconPath = new vscode.ThemeIcon(node.tool.icon)
      item.contextValue = `nvmRemoteTool-${node.tool.key}`
      return item
    }

    if (node.kind === 'error') {
      const item = new vscode.TreeItem(
        `Could not load ${node.tool.noun} releases`,
        vscode.TreeItemCollapsibleState.None,
      )
      item.description = node.message
      item.tooltip = new vscode.MarkdownString(
        [`**${node.tool.source} request failed**`, node.message, '', '_Use the refresh button._'].join(
          '\n\n',
        ),
      )
      item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'))
      return item
    }

    const item = new vscode.TreeItem(node.version, vscode.TreeItemCollapsibleState.None)
    const tags = [node.lts ? `LTS ${node.lts}` : undefined, node.date].filter(Boolean)
    item.description = node.installed ? `installed · ${tags.join(' · ')}` : tags.join(' · ')
    item.tooltip = new vscode.MarkdownString(
      [
        `**${node.version}**`,
        node.lts ? `LTS: ${node.lts}` : 'Current release (not LTS)',
        `Released: ${node.date || 'unknown'}`,
        '',
        node.installed ? '_Already installed._' : `_Click to download and install from ${node.tool.source}._`,
      ].join('\n\n'),
    )
    item.iconPath = new vscode.ThemeIcon(
      node.installed ? 'pass-filled' : 'cloud-download',
      node.installed ? new vscode.ThemeColor('charts.green') : undefined,
    )
    item.contextValue = node.installed ? 'nvmRemote-installed' : 'nvmRemote'

    if (!node.installed) {
      item.command = {
        command: 'nodeversions.installVersion',
        title: `Install ${node.version}`,
        arguments: [node],
      }
    }
    return item
  }
}

// ── Ports view ────────────────────────────────────────────────

interface PortNode {
  port: number
  pid: number
  processName: string
  runtime: string
  address: string
  protocol: string
}

export class PortsProvider implements vscode.TreeDataProvider<PortNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChange.event

  refresh() {
    this._onDidChange.fire()
  }

  async getChildren(node?: PortNode): Promise<PortNode[]> {
    if (node) return []
    try {
      return await portManager.listPorts()
    } catch {
      return []
    }
  }

  getTreeItem(node: PortNode): vscode.TreeItem {
    const item = new vscode.TreeItem(String(node.port), vscode.TreeItemCollapsibleState.None)
    item.description = `${node.processName} · pid ${node.pid}`
    item.tooltip = new vscode.MarkdownString(
      [`**Port ${node.port}**`, `${node.protocol} ${node.address}`, `PID ${node.pid}`].join('\n\n'),
    )
    item.iconPath = new vscode.ThemeIcon(node.runtime === 'java' ? 'coffee' : 'symbol-event')
    item.contextValue = 'nvmPort'
    return item
  }
}

// ── Wiring ────────────────────────────────────────────────────

function safeCurrent(vm: Vm): string | null {
  try {
    return vm.getCurrent()
  } catch {
    return null
  }
}

/**
 * Where a freshly installed release landed. Both managers extract into
 * `<versionsDir>/<version>` using the exact release string, so this mirrors
 * their own destDir computation rather than re-listing the directory.
 */
function nodeInstallPath(node: Extract<RemoteNode, { kind: 'remote' }>): string {
  return path.join(node.tool.vm.versionsDir, node.version)
}

export function registerTreeViews(context: vscode.ExtensionContext, onChanged: () => void) {
  const versions = new VersionsProvider()
  const install = new InstallProvider()
  const ports = new PortsProvider()

  const refreshAll = () => {
    versions.refresh()
    ports.refresh()
    // Only the "installed" badges change on a switch/uninstall — the release
    // lists themselves are still valid, so this deliberately does not refetch.
    install.refresh()
  }

  context.subscriptions.push(
    vscode.window.createTreeView('nodeversions.versions', { treeDataProvider: versions }),
    vscode.window.createTreeView('nodeversions.install', { treeDataProvider: install }),
    vscode.window.createTreeView('nodeversions.ports', { treeDataProvider: ports }),

    vscode.commands.registerCommand('nodeversions.installVersion', async (node: RemoteNode) => {
      if (!node || node.kind !== 'remote' || node.installed) return

      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Installing ${node.tool.noun} ${node.version}`,
          cancellable: false,
        },
        (progress) => {
          let last = 0
          return node.tool.vm.install(node.version, (p: number) => {
            // withProgress wants an increment, the managers report an absolute
            // percentage — convert, and never report a negative step.
            const step = Math.max(0, p - last)
            last = p
            progress.report({ increment: step, message: `${p}%` })
          })
        },
      )

      if (result.success) {
        // The release list's "installed" badge is now stale for this tool.
        install.invalidate()
        onChanged()
        const use = 'Use It Now'
        const pick = await vscode.window.showInformationMessage(
          `${node.tool.noun} ${node.version} installed.`,
          use,
        )
        if (pick === use) {
          await vscode.commands.executeCommand('nodeversions.activateVersion', {
            kind: 'version',
            tool: node.tool,
            version: node.version,
            path: nodeInstallPath(node),
            isCurrent: false,
            external: false,
          })
        }
      } else {
        vscode.window.showErrorMessage(
          result.error ?? `Failed to install ${node.tool.noun} ${node.version}.`,
        )
      }
    }),

    vscode.commands.registerCommand('nodeversions.refreshRemote', () => install.invalidate()),

    vscode.commands.registerCommand('nodeversions.activateVersion', (node: VersionNode) => {
      if (!node || node.kind !== 'version') return
      const result = node.tool.vm.use(node.path)
      if (!result.success) {
        vscode.window.showErrorMessage(
          result.error ?? `Failed to switch ${node.tool.noun} version.`,
        )
        return
      }
      onChanged()
      vscode.window.showInformationMessage(
        `${node.tool.noun} ${node.version} is now active. Open a new terminal to pick it up.`,
      )
    }),

    vscode.commands.registerCommand('nodeversions.uninstallVersion', async (node: VersionNode) => {
      if (!node || node.kind !== 'version') return
      const remove = 'Uninstall'
      const confirm = await vscode.window.showWarningMessage(
        `Uninstall ${node.tool.noun} ${node.version}?`,
        { modal: true, detail: `This deletes ${node.path} from disk.` },
        remove,
      )
      if (confirm !== remove) return

      const result = node.tool.vm.uninstall(node.version)
      if (result.success) {
        onChanged()
        vscode.window.showInformationMessage(`${node.tool.noun} ${node.version} uninstalled.`)
      } else {
        vscode.window.showErrorMessage(result.error ?? 'Failed to uninstall.')
      }
    }),

    vscode.commands.registerCommand('nodeversions.killPort', async (node: PortNode) => {
      if (!node) return
      const kill = 'Kill Process'
      const confirm = await vscode.window.showWarningMessage(
        `Kill the process on port ${node.port}?`,
        { modal: true, detail: `PID ${node.pid}. Unsaved work in that process is lost.` },
        kill,
      )
      if (confirm !== kill) return

      const result = await portManager.killProcess(node.pid)
      if (result.success) {
        vscode.window.showInformationMessage(`Killed pid ${node.pid}.`)
        ports.refresh()
      } else {
        vscode.window.showErrorMessage(result.error ?? 'Failed to kill the process.')
      }
    }),

    vscode.commands.registerCommand('nodeversions.refreshViews', refreshAll),
  )

  return refreshAll
}
