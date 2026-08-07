import * as vscode from 'vscode'
import * as path from 'path'
import { NODE, JDK } from './managers'
import { binDir, resolveTool } from './pinStore'

// This is the reason the extension is worth using over the desktop app.
//
// The desktop app can only repoint one machine-wide junction. This collection
// is scoped to a single VS Code window, so two windows can run two different
// Node/JDK versions at once — that is what makes per-repo pinning work at all.
//
// VS Code applies the collection to NEWLY created terminals; terminals already
// open keep the PATH they were spawned with.

/**
 * `applyAtProcessCreation` alone loses to a shell profile.
 *
 * The Settings tab can write `$env:Path = "$env:USERPROFILE\.nodevm\current;$env:Path"`
 * into the PowerShell profile (and the equivalent into ~/.zshrc). That profile
 * runs *after* the process env is built, so it prepends the machine-wide
 * `current` link in front of whatever we pinned and `node -v` reports the global
 * version. Re-applying in the shell integration script puts the pinned bin back
 * in front, because shell integration runs after the profile.
 *
 * `applyAtShellIntegration` is a no-op where shell integration is off, which is
 * why both flags are set rather than just the second.
 */
const APPLY: vscode.EnvironmentVariableMutatorOptions = {
  applyAtProcessCreation: true,
  applyAtShellIntegration: true,
}

/**
 * What the collection currently says, so a repaint that changes nothing does not
 * look like a version switch. `null` until the first apply — the transition from
 * "nothing applied" to "the startup state" is not a change the user made.
 */
let signature: string | null = null

/** @returns true when the effective environment actually changed. */
export function applyTerminalEnv(context: vscode.ExtensionContext): boolean {
  const collection = context.environmentVariableCollection
  collection.clear()

  if (!vscode.workspace.getConfiguration('nodeversions').get<boolean>('autoUpdateTerminalEnv', true)) {
    collection.description = 'Disabled via nodeversions.autoUpdateTerminalEnv'
    return stamp('disabled')
  }

  const labels: string[] = []
  const problems: string[] = []
  // One entry per tool, applied as a SINGLE prepend below. An extension gets
  // exactly one mutator per variable: calling prepend('PATH', …) twice does not
  // stack, the second call silently discards the first. Prepending Node and then
  // JDK separately therefore dropped Node from PATH entirely.
  const pathEntries: string[] = []

  for (const tool of [NODE, JDK]) {
    const resolved = resolveTool(tool)

    if (resolved.unresolved) {
      // Deliberately leave PATH alone: a pin naming a version that is not
      // installed must not quietly fall through to the global one.
      problems.push(`${tool.noun} ${resolved.unresolved} is not installed`)
      continue
    }
    if (!resolved.dir) continue

    pathEntries.push(binDir(tool, resolved.dir))
    if (tool.key === 'java') collection.replace('JAVA_HOME', resolved.dir, APPLY)

    const suffix = resolved.source === 'global' ? '' : ' (pinned)'
    labels.push(`${tool.noun} ${path.basename(resolved.dir)}${suffix}`)
  }

  if (pathEntries.length) {
    collection.prepend('PATH', pathEntries.join(path.delimiter) + path.delimiter, APPLY)
  }

  collection.description = [
    labels.length ? `Active: ${labels.join(' · ')} (new terminals only)` : 'No managed Node/JDK version is active',
    ...problems,
  ].join(' — ')

  return stamp(pathEntries.join(path.delimiter))
}

function stamp(next: string): boolean {
  const changed = signature !== null && signature !== next
  signature = next
  return changed
}

// ── Applying a change to terminals that are already open ──────

/**
 * A process's environment is fixed when it is spawned, so nothing can repoint
 * PATH inside a shell that is already running — the terminal has to be
 * relaunched. VS Code does that by itself for terminals nobody has typed in
 * (`terminal.integrated.environmentChangesRelaunch`, on by default); the ones
 * that have already run a command are what this handles.
 *
 * Relaunching kills whatever is running in the terminal, so the default is to
 * ask rather than to act.
 */
export async function applyToOpenTerminals() {
  const mode = vscode.workspace
    .getConfiguration('nodeversions')
    .get<'ask' | 'always' | 'never'>('relaunchTerminalsOnChange', 'ask')
  if (mode === 'never') return

  const terminals = vscode.window.terminals
  if (terminals.length === 0) return

  if (mode === 'ask') {
    const now = 'Relaunch Now'
    const always = 'Always'
    const never = 'Never'
    const count = terminals.length === 1 ? '1 open terminal' : `${terminals.length} open terminals`
    const pick = await vscode.window.showInformationMessage(
      `The new version applies to new terminals. Relaunch ${count} to use it now? Anything running in them stops.`,
      now,
      always,
      never,
    )
    if (pick === never) {
      await setMode('never')
      return
    }
    if (pick === always) await setMode('always')
    else if (pick !== now) return
  }

  await relaunchAll()
}

function setMode(value: 'always' | 'never') {
  return vscode.workspace
    .getConfiguration('nodeversions')
    .update('relaunchTerminalsOnChange', value, vscode.ConfigurationTarget.Global)
}

/**
 * `workbench.action.terminal.relaunch` acts on the active terminal and takes no
 * argument, so each one has to be made active in turn. Focus is preserved and
 * whatever was active before is restored.
 */
async function relaunchAll() {
  const previouslyActive = vscode.window.activeTerminal

  for (const terminal of vscode.window.terminals) {
    terminal.show(true)
    // show() reaches the workbench asynchronously; without yielding, the
    // command can still see the previously active terminal.
    await new Promise((resolve) => setTimeout(resolve, 50))
    try {
      await vscode.commands.executeCommand('workbench.action.terminal.relaunch')
    } catch {
      // A terminal can be disposed mid-loop; the rest still get relaunched.
    }
  }

  previouslyActive?.show(true)
}

/**
 * The one combination where a pin silently loses: the shell profile prepends the
 * global `current` link, and shell integration — the only thing that can undo
 * that — is switched off. Warn once per window rather than let the user watch
 * `node -v` disagree with the status bar.
 */
let warned = false

export function warnIfProfileOverridesPin() {
  if (warned) return

  const pinned = [NODE, JDK].some((tool) => {
    const source = resolveTool(tool).source
    return source === 'workspace' || source === 'file'
  })
  if (!pinned) return

  const shellIntegration = vscode.workspace
    .getConfiguration('terminal.integrated.shellIntegration')
    .get<boolean>('enabled', true)
  if (shellIntegration) return

  // Shells out, so it runs only after the two cheap checks above have passed.
  const hooked = [NODE, JDK].filter((tool) => {
    try {
      return tool.vm.isProfileConfigured()
    } catch {
      return false
    }
  })
  if (hooked.length === 0) return

  warned = true
  const setting = 'Enable Shell Integration'
  void vscode.window
    .showWarningMessage(
      `Your shell startup profile forces the global ${hooked
        .map((t) => t.noun)
        .join(' and ')} version, and terminal shell integration is disabled — so the workspace pin will not apply in new terminals.`,
      setting,
    )
    .then((pick) => {
      if (pick === setting) {
        void vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'terminal.integrated.shellIntegration.enabled',
        )
      }
    })
}
