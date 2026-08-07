import * as vscode from 'vscode'
import { NODE, JDK } from './managers'
import { describeSource, resolveTool, Resolved } from './pinStore'

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

  const node = resolveTool(NODE)
  const jdk = resolveTool(JDK)
  const both = [node, jdk]

  const broken = both.filter((r) => r.unresolved)
  const pinned = both.some((r) => r.source === 'workspace' || r.source === 'file')

  const parts = both.filter((r) => r.version).map((r) => label(r))

  // A pin naming a version that is not installed is the one state worth
  // colouring — the terminal silently has no managed version on PATH.
  item.backgroundColor = broken.length
    ? new vscode.ThemeColor('statusBarItem.warningBackground')
    : undefined

  if (broken.length) {
    item.text = `$(warning) ${broken.map((r) => `${r.tool.noun} ${r.unresolved}?`).join(' · ')}`
  } else if (parts.length === 0) {
    item.text = '$(versions) No version active'
  } else {
    item.text = `$(${pinned ? 'pin' : 'versions'}) ${parts.join(' · ')}`
  }

  item.tooltip = tooltip(node, jdk)
  item.show()
}

function label(r: Resolved): string {
  const version = r.version ?? ''
  return r.tool.key === 'java' ? shortJdk(version) : version
}

function tooltip(node: Resolved, jdk: Resolved): vscode.MarkdownString {
  const md = new vscode.MarkdownString(
    [
      line(node),
      line(jdk),
      '',
      `[Pin Node…](command:nodeversions.switchNode) · [Pin JDK…](command:nodeversions.switchJdk)`,
      `[Use global defaults](command:nodeversions.unpinWorkspace) · [Open panel](command:nodeversions.openPanel)`,
      '',
      '_A pin only affects this window. Open a new terminal to pick it up._',
    ].join('\n\n'),
  )
  // Required for the `command:` links above to be clickable.
  md.isTrusted = true
  return md
}

function line(r: Resolved): string {
  if (r.unresolved) return `**${r.tool.noun}:** \`${r.unresolved}\` — _requested but not installed_`
  if (!r.version) return `**${r.tool.noun}:** _none_`
  return `**${r.tool.noun}:** ${r.version} — _${describeSource(r)}_`
}

/**
 * `jdk-21.0.11+10` is too long for a status bar; show `JDK 21`.
 * Legacy names are `1.8.0_392`, where the major version is the *second* number.
 */
function shortJdk(version: string): string {
  const legacy = version.match(/^(?:jdk-?)?1\.(\d+)/i)
  if (legacy) return `JDK ${legacy[1]}`
  const major = version.match(/(\d+)/)
  return major ? `JDK ${major[1]}` : version
}
