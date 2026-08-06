import * as vscode from 'vscode'
import { nodeManager, jdkManager, portManager } from './managers'

type Vm = { listInstalled(): { version: string; isCurrent: boolean; path: string; external?: boolean }[]
            use(target: string): { success: boolean; error?: string } }

/**
 * Switching a version without opening the webview — the one thing the desktop
 * app cannot do at all.
 */
export async function switchVersion(noun: string, vm: Vm, onChanged: () => void) {
  const installed = vm.listInstalled()
  if (installed.length === 0) {
    const open = 'Open Panel'
    const pick = await vscode.window.showInformationMessage(
      `No ${noun} versions installed yet.`,
      open,
    )
    if (pick === open) await vscode.commands.executeCommand('nodeversions.openPanel')
    return
  }

  const choice = await vscode.window.showQuickPick(
    installed.map((v) => ({
      label: v.isCurrent ? `$(check) ${v.version}` : v.version,
      description: v.external ? 'system install' : undefined,
      detail: v.path,
      target: v.path,
      isCurrent: v.isCurrent,
    })),
    { title: `Switch ${noun} version`, placeHolder: `Select the ${noun} version to activate` },
  )
  if (!choice || choice.isCurrent) return

  const result = vm.use(choice.target)
  if (result.success) {
    onChanged()
    vscode.window.showInformationMessage(
      `${noun} switched. Open a new terminal to pick it up.`,
    )
  } else {
    vscode.window.showErrorMessage(result.error ?? `Failed to switch ${noun} version.`)
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

export const nodeVm: Vm = nodeManager
export const jdkVm: Vm = jdkManager
