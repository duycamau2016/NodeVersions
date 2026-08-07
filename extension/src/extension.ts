import * as vscode from 'vscode'
import { NvmPanel, VIEW_TYPE } from './panel'
import { createStatusBar, refreshStatusBar } from './statusBar'
import { applyTerminalEnv, applyToOpenTerminals, warnIfProfileOverridesPin } from './terminalEnv'
import { listPorts, pickVersion, unpinWorkspace } from './commands'
import { registerTreeViews } from './treeView'
import { NODE, JDK } from './managers'
import { initPins, invalidatePins, VERSION_FILE_NAMES } from './pinStore'
import { registerCommand, reportConflicts } from './register'

export function activate(context: vscode.ExtensionContext) {
  // Pins live in workspaceState, so the store needs the context before any
  // surface asks which version is effective.
  initPins(context)

  // Everything that reflects "which version is active" refreshes through here.
  // refreshTrees is assigned below; the closure defers reading it until called.
  let refreshTrees = () => {}
  const onChanged = () => {
    // Resolution is memoised — drop it first or every surface below repaints
    // with the pre-change answer.
    invalidatePins()
    refreshStatusBar()
    const versionChanged = applyTerminalEnv(context)
    refreshTrees()
    warnIfProfileOverridesPin()
    // Only when the version really moved — a tree refresh or an unrelated
    // setting change must not offer to kill the user's dev server.
    if (versionChanged) void applyToOpenTerminals()
  }

  createStatusBar(context)
  applyTerminalEnv(context)
  refreshTrees = registerTreeViews(context, onChanged)

  registerCommand(context, 'nodeversions.openPanel', () => NvmPanel.show(context, onChanged))
  registerCommand(context, 'nodeversions.switchNode', () => pickVersion(NODE, 'pin', onChanged))
  registerCommand(context, 'nodeversions.switchJdk', () => pickVersion(JDK, 'pin', onChanged))
  registerCommand(context, 'nodeversions.setGlobalNode', () => pickVersion(NODE, 'global', onChanged))
  registerCommand(context, 'nodeversions.setGlobalJdk', () => pickVersion(JDK, 'global', onChanged))
  registerCommand(context, 'nodeversions.unpinWorkspace', () => unpinWorkspace(onChanged))
  registerCommand(context, 'nodeversions.listPorts', listPorts)
  registerCommand(context, 'nodeversions.refresh', onChanged)

  context.subscriptions.push(
    // Without a serializer, a panel left open across a window reload comes back
    // blank.
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        NvmPanel.revive(panel, context, onChanged)
      },
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('nodeversions')) onChanged()
    }),

    // Adding or removing a folder can bring a .nvmrc into (or out of) scope.
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      watchVersionFiles(context, onChanged)
      onChanged()
    }),
  )

  watchVersionFiles(context, onChanged)
  reportConflicts(context)
  warnIfProfileOverridesPin()
}

/**
 * A committed `.nvmrc` / `.java-version` is the pin for everyone on the team, so
 * editing, adding or deleting one has to re-resolve immediately — otherwise the
 * status bar keeps claiming a version the repo no longer asks for.
 */
let fileWatchers: vscode.Disposable[] = []

function watchVersionFiles(context: vscode.ExtensionContext, onChanged: () => void) {
  for (const watcher of fileWatchers) watcher.dispose()
  fileWatchers = []

  const pattern = `{${VERSION_FILE_NAMES.join(',')}}`
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== 'file') continue
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, pattern),
    )
    watcher.onDidCreate(onChanged)
    watcher.onDidChange(onChanged)
    watcher.onDidDelete(onChanged)
    fileWatchers.push(watcher)
    context.subscriptions.push(watcher)
  }
}

export function deactivate() {
  for (const watcher of fileWatchers) watcher.dispose()
  fileWatchers = []
  // The status bar item and the environment variable collection are disposed by
  // VS Code via context.subscriptions.
}
