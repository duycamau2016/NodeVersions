import * as vscode from 'vscode'

// `vscode.commands.registerCommand` throws when another extension already owns
// the id. That is not hypothetical here: this extension has shipped under two
// publisher ids, and someone with both installed runs two copies that fight
// over the whole `nodeversions.*` namespace.
//
// Registrations are batched into one `subscriptions.push(...)` call, so a single
// throw aborts every registration after it — the tree views are already live at
// that point, and their items end up pointing at commands that never got
// registered ("command 'nodeversions.pinVersion' not found"). Failing one
// registration must not take the rest of activation down with it.

const conflicts: string[] = []

export function registerCommand(
  context: vscode.ExtensionContext,
  id: string,
  handler: (...args: any[]) => any,
) {
  try {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler))
  } catch {
    conflicts.push(id)
  }
}

export function registerDisposable(context: vscode.ExtensionContext, make: () => vscode.Disposable) {
  try {
    context.subscriptions.push(make())
  } catch {
    // A view id owned by another extension: nothing to recover, and the
    // conflict warning below already tells the user why.
  }
}

/**
 * Tell the user which extension is shadowing us. Silent degradation here reads
 * as "the pin feature is broken" rather than "you have two copies installed".
 */
export function reportConflicts(context: vscode.ExtensionContext) {
  if (conflicts.length === 0) return

  const rivals = vscode.extensions.all
    .filter(
      (e) =>
        e.id !== context.extension.id &&
        (e.packageJSON?.contributes?.commands ?? []).some((c: { command?: string }) =>
          c.command?.startsWith('nodeversions.'),
        ),
    )
    .map((e) => e.id)

  const who = rivals.length ? rivals.join(', ') : 'another installed extension'
  const uninstall = 'Show Extensions'
  vscode.window
    .showWarningMessage(
      `Node & JDK Version Manager is installed twice: ${who} registers the same commands, so some actions will not work. Uninstall the duplicate and reload the window.`,
      uninstall,
    )
    .then((pick) => {
      if (pick === uninstall) {
        void vscode.commands.executeCommand('workbench.extensions.search', '@installed nodeversions')
      }
    })

  conflicts.length = 0
}
