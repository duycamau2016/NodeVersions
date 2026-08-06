import * as vscode from 'vscode'
import { nodeManager, jdkManager } from './managers'

let item: vscode.StatusBarItem | undefined

export function createStatusBar(context: vscode.ExtensionContext) {
  item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  item.command = 'nodeversions.openPanel'
  context.subscriptions.push(item)
  refreshStatusBar()
}

export function refreshStatusBar() {
  if (!item) return

  if (!vscode.workspace.getConfiguration('nodeversions').get<boolean>('showStatusBar', true)) {
    item.hide()
    return
  }

  const node = nodeManager.getCurrent()
  const jdk = jdkManager.getCurrent()

  if (!node && !jdk) {
    item.text = '$(versions) No version active'
    item.tooltip = 'Node & JDK Version Manager — click to open'
    item.show()
    return
  }

  const parts: string[] = []
  if (node) parts.push(node)
  if (jdk) parts.push(shortJdk(jdk))

  item.text = `$(versions) ${parts.join(' · ')}`
  item.tooltip = new vscode.MarkdownString(
    [
      `**Node:** ${node ?? '_none_'}`,
      `**JDK:** ${jdk ?? '_none_'}`,
      '',
      '_Click to open the Node & JDK Version Manager panel._',
    ].join('\n\n'),
  )
  item.show()
}

/**
 * `jdk-21.0.11+10` is too long for a status bar; show `JDK 21`.
 * Legacy names are `1.8.0_392`, where the major version is the *second* number.
 */
function shortJdk(version: string): string {
  const legacy = version.match(/^1\.(\d+)/)
  if (legacy) return `JDK ${legacy[1]}`
  const major = version.match(/(\d+)/)
  return major ? `JDK ${major[1]}` : version
}
