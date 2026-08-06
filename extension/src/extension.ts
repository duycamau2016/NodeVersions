import * as vscode from 'vscode'
import { NvmPanel, VIEW_TYPE } from './panel'
import { createStatusBar, refreshStatusBar } from './statusBar'
import { applyTerminalEnv } from './terminalEnv'
import { switchVersion, listPorts, nodeVm, jdkVm } from './commands'
import { registerTreeViews } from './treeView'

export function activate(context: vscode.ExtensionContext) {
  // Everything that reflects "which version is active" refreshes through here.
  // refreshTrees is assigned below; the closure defers reading it until called.
  let refreshTrees = () => {}
  const onChanged = () => {
    refreshStatusBar()
    applyTerminalEnv(context)
    refreshTrees()
  }

  createStatusBar(context)
  applyTerminalEnv(context)
  refreshTrees = registerTreeViews(context, onChanged)

  context.subscriptions.push(
    vscode.commands.registerCommand('nodeversions.openPanel', () =>
      NvmPanel.show(context, onChanged),
    ),
    vscode.commands.registerCommand('nodeversions.switchNode', () =>
      switchVersion('Node', nodeVm, onChanged),
    ),
    vscode.commands.registerCommand('nodeversions.switchJdk', () =>
      switchVersion('JDK', jdkVm, onChanged),
    ),
    vscode.commands.registerCommand('nodeversions.listPorts', listPorts),
    vscode.commands.registerCommand('nodeversions.refresh', onChanged),

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
  )
}

export function deactivate() {
  // The status bar item and the environment variable collection are disposed by
  // VS Code via context.subscriptions.
}
