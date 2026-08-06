import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { nodeManager, jdkManager } from './managers'

// This is the reason the extension is worth using over the desktop app.
//
// `use()` repoints a junction/symlink at ~/.nodevm/current, but a terminal that
// is already open keeps the PATH it was spawned with. Without this collection,
// a user switches to v20, opens the integrated terminal, types `node -v`, sees
// the old version — and reads it as a bug. VS Code applies this collection to
// NEWLY created terminals.

/** ~/.nodevm/current — the manager keeps it private, but it is versionsDir's sibling. */
function currentLink(versionsDir: string): string {
  return path.join(path.dirname(versionsDir), 'current')
}

function resolved(link: string): string | null {
  try {
    return fs.realpathSync(link)
  } catch {
    return null
  }
}

export function applyTerminalEnv(context: vscode.ExtensionContext) {
  const collection = context.environmentVariableCollection
  collection.clear()

  if (!vscode.workspace.getConfiguration('nodeversions').get<boolean>('autoUpdateTerminalEnv', true)) {
    collection.description = 'Disabled via nodeversions.autoUpdateTerminalEnv'
    return
  }

  const labels: string[] = []

  const nodeDir = resolved(currentLink(nodeManager.versionsDir))
  if (nodeDir) {
    // Windows puts node.exe at the install root; macOS/Linux use bin/.
    const bin = process.platform === 'win32' ? nodeDir : path.join(nodeDir, 'bin')
    collection.prepend('PATH', bin + path.delimiter)
    labels.push(`Node ${path.basename(nodeDir)}`)
  }

  const jdkDir = resolved(currentLink(jdkManager.versionsDir))
  if (jdkDir) {
    collection.replace('JAVA_HOME', jdkDir)
    collection.prepend('PATH', path.join(jdkDir, 'bin') + path.delimiter)
    labels.push(`JDK ${path.basename(jdkDir)}`)
  }

  collection.description = labels.length
    ? `Active: ${labels.join(' · ')} (new terminals only)`
    : 'No managed Node/JDK version is active'
}
