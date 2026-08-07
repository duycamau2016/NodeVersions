import * as vscode from 'vscode'
import { portManager, TOOLS, ToolMeta } from './managers'
import { describeSource, listWithEffective, resolveTool, setManualPin } from './pinStore'

type Mode = 'pin' | 'global'

/**
 * Switching a version without opening the webview — the one thing the desktop
 * app cannot do at all.
 *
 * `pin` scopes the choice to this window; `global` repoints the shared
 * ~/.nodevm/current junction and therefore affects every other window too.
 */
export async function pickVersion(tool: ToolMeta, mode: Mode, onChanged: () => void) {
  let installed: ReturnType<typeof listWithEffective>
  try {
    installed = listWithEffective(tool)
  } catch (err: unknown) {
    vscode.window.showErrorMessage(
      `Could not read installed ${tool.noun} versions: ${String((err as Error)?.message ?? err)}`,
    )
    return
  }

  if (installed.length === 0) {
    const open = 'Open Panel'
    const pick = await vscode.window.showInformationMessage(
      `No ${tool.noun} versions installed yet.`,
      open,
    )
    if (pick === open) await vscode.commands.executeCommand('nodeversions.openPanel')
    return
  }

  const current = resolveTool(tool)
  const items: (vscode.QuickPickItem & { target?: string; version?: string; unpin?: boolean })[] =
    installed.map((v) => ({
      label: v.isCurrent ? `$(check) ${v.version}` : v.version,
      description: [v.external ? 'system install' : undefined, v.isGlobal ? 'global default' : undefined]
        .filter(Boolean)
        .join(' · '),
      detail: v.path,
      target: v.path,
      version: v.version,
    }))

  // Only offer "unpin" when there is a pin to remove.
  if (mode === 'pin' && (current.source === 'workspace' || current.unresolved)) {
    items.unshift({
      label: '$(circle-slash) Use the global default',
      description: 'remove this workspace’s pin',
      unpin: true,
    })
  }

  const choice = await vscode.window.showQuickPick(items, {
    title:
      mode === 'pin'
        ? `Pin ${tool.noun} version for this workspace`
        : `Set the global default ${tool.noun} version`,
    placeHolder:
      mode === 'pin'
        ? `Currently ${current.version ?? current.unresolved ?? 'none'} — ${describeSource(current)}`
        : 'This affects every VS Code window and every shell on this machine',
  })
  if (!choice) return

  if (choice.unpin) {
    await setManualPin(tool.key, null)
    onChanged()
    vscode.window.showInformationMessage(
      `${tool.noun} pin removed. This workspace follows the global default again.`,
    )
    return
  }

  if (mode === 'pin') {
    await setManualPin(tool.key, { version: choice.version!, path: choice.target! })
    onChanged()
    vscode.window.showInformationMessage(
      `${tool.noun} ${choice.version} pinned to this workspace. Open a new terminal to pick it up.`,
    )
    return
  }

  const result = tool.vm.use(choice.target!)
  if (result.success) {
    onChanged()
    vscode.window.showInformationMessage(
      `${tool.noun} ${choice.version} is now the global default. Open a new terminal to pick it up.`,
    )
  } else {
    vscode.window.showErrorMessage(result.error ?? `Failed to switch ${tool.noun} version.`)
  }
}

/** Drop every per-workspace pin and fall back to the global defaults. */
export async function unpinWorkspace(onChanged: () => void) {
  const hadPin = TOOLS.some((tool) => resolveTool(tool).source === 'workspace')
  // Sequential: each write invalidates the resolution cache, and concurrent
  // writes would let a re-resolve land between them.
  for (const tool of TOOLS) await setManualPin(tool.key, null)
  onChanged()

  // Version files are committed to the repo, so unpinning cannot clear them —
  // saying so is better than the user wondering why the pin came back.
  const stillPinned = TOOLS.map((tool) => resolveTool(tool)).filter((r) => r.source === 'file')
  if (stillPinned.length) {
    vscode.window.showInformationMessage(
      `Workspace pins cleared. Still pinned by ${stillPinned
        .map((r) => r.file)
        .join(', ')} — disable nodeversions.useVersionFiles to ignore those.`,
    )
  } else {
    vscode.window.showInformationMessage(
      hadPin ? 'Workspace pins cleared.' : 'This workspace had no pins.',
    )
  }
}

export async function listPorts() {
  const ports = await portManager.listPorts()
  if (ports.length === 0) {
    vscode.window.showInformationMessage('No Node or Java process is listening on a port.')
    return
  }

  const choice = await vscode.window.showQuickPick(
    ports.map((p) => ({
      label: `$(radio-tower) ${p.port}`,
      description: `${p.processName} · pid ${p.pid}`,
      detail: `${p.protocol} ${p.address}`,
      pid: p.pid,
      port: p.port,
    })),
    { title: 'Listening ports (Node / Java)', placeHolder: 'Select a port to kill its process' },
  )
  if (!choice) return

  const kill = 'Kill Process'
  const confirm = await vscode.window.showWarningMessage(
    `Kill the process on port ${choice.port}?`,
    { modal: true, detail: `PID ${choice.pid}. Unsaved work in that process is lost.` },
    kill,
  )
  if (confirm !== kill) return

  const result = await portManager.killProcess(choice.pid)
  if (result.success) vscode.window.showInformationMessage(`Killed pid ${choice.pid}.`)
  else vscode.window.showErrorMessage(result.error ?? 'Failed to kill the process.')
}
