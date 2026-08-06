import * as vscode from 'vscode'
import { nodeManager, jdkManager, portManager } from './managers'

/** Fired after any action that can change which version is active. */
export type OnChanged = () => void

const VIEW_TYPE = 'nodeversions.panel'

export class NvmPanel {
  private static current: NvmPanel | undefined

  private readonly disposables: vscode.Disposable[] = []

  static show(context: vscode.ExtensionContext, onChanged: OnChanged) {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One

    if (NvmPanel.current) {
      NvmPanel.current.panel.reveal(column)
      return
    }

    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Node & JDK Version Manager', column, {
      ...NvmPanel.webviewOptions(context),
      // The React UI keeps all its state in component state. Rather than teach
      // the shared components about vscode.getState/setState (which would mean
      // editing src/renderer/), keep the context alive. The bundle is small.
      retainContextWhenHidden: true,
    })
    NvmPanel.current = new NvmPanel(panel, context, onChanged)
  }

  /** Restores the panel after a window reload (see the serializer in extension.ts). */
  static revive(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    onChanged: OnChanged,
  ) {
    panel.webview.options = NvmPanel.webviewOptions(context)
    NvmPanel.current = new NvmPanel(panel, context, onChanged)
  }

  private static webviewOptions(context: vscode.ExtensionContext): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
    }
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly onChanged: OnChanged,
  ) {
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png')
    this.panel.webview.html = this.buildHtml(context)

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables,
    )
  }

  private dispose() {
    NvmPanel.current = undefined
    while (this.disposables.length) this.disposables.pop()?.dispose()
  }

  // ── RPC ────────────────────────────────────────────────────

  private post(msg: unknown) {
    // Best-effort: the panel may already be disposed when a slow install
    // finishes.
    void this.panel.webview.postMessage(msg)
  }

  private emit(channel: string, data: unknown) {
    this.post({ __nvm: true, kind: 'event', channel, data })
  }

  private async handleMessage(msg: any) {
    if (!msg || msg.__nvm !== true || msg.kind !== 'invoke') return

    const handler = this.handlers[msg.channel]
    if (!handler) {
      this.post({
        __nvm: true,
        kind: 'response',
        id: msg.id,
        error: `Unknown channel: ${msg.channel}`,
      })
      return
    }

    try {
      const result = await handler(...(msg.args ?? []))
      this.post({ __nvm: true, kind: 'response', id: msg.id, result })
    } catch (err: any) {
      this.post({
        __nvm: true,
        kind: 'response',
        id: msg.id,
        error: String(err?.message ?? err),
      })
    }
  }

  /**
   * Channel table — a near-verbatim port of the `ipcMain.handle` block in
   * src/main/index.ts. Keep the channel names identical so the shared React
   * components need no changes.
   */
  private readonly handlers: Record<string, (...args: any[]) => any> = {
    // ── Node ──
    'nvm:list-installed': () => nodeManager.listInstalled(),
    'nvm:list-remote': () => nodeManager.listRemote(),
    'nvm:current': () => nodeManager.getCurrent(),
    'nvm:use': (target: string) => this.afterChange(nodeManager.use(target)),
    'nvm:install': (version: string) =>
      this.withProgress(`Installing Node ${version}`, (report) =>
        nodeManager.install(version, (progress) => {
          report(progress)
          this.emit('nvm:install-progress', { version, progress })
        }),
      ),
    'nvm:uninstall': (version: string) =>
      this.confirmDestructive(
        `Uninstall Node ${version}?`,
        'The version directory is deleted from ~/.nodevm/versions.',
        () => nodeManager.uninstall(version),
      ),
    'nvm:open-install-dir': () => openFolder(nodeManager.versionsDir),
    'nvm:setup-path': () =>
      this.confirmEnvChange(
        'Add Node to the system PATH?',
        'This edits your user PATH environment variable so the active Node version is used by every shell on this machine — not just VS Code.',
        () => nodeManager.setupPath(),
      ),
    'nvm:check-path': () => nodeManager.isPathConfigured(),
    'nvm:setup-profile': () =>
      this.confirmEnvChange(
        'Add Node to your shell profile?',
        'This appends a PATH export to ~/.zshrc so the active Node version is used by every new shell — not just VS Code.',
        () => nodeManager.setupProfile(),
      ),
    'nvm:check-profile': () => nodeManager.isProfileConfigured(),

    // ── JDK ──
    'jvm:list-installed': () => jdkManager.listInstalled(),
    'jvm:list-remote': () => jdkManager.listRemote(),
    'jvm:current': () => jdkManager.getCurrent(),
    'jvm:use': (target: string) => this.afterChange(jdkManager.use(target)),
    'jvm:install': (version: string) =>
      this.withProgress(`Installing JDK ${version}`, (report) =>
        jdkManager.install(version, (progress) => {
          report(progress)
          this.emit('jvm:install-progress', { version, progress })
        }),
      ),
    'jvm:uninstall': (version: string) =>
      this.confirmDestructive(
        `Uninstall JDK ${version}?`,
        'The version directory is deleted from ~/.jdkvm/versions.',
        () => jdkManager.uninstall(version),
      ),
    'jvm:open-install-dir': () => openFolder(jdkManager.versionsDir),
    'jvm:setup-env': () =>
      this.confirmEnvChange(
        'Set JAVA_HOME system-wide?',
        'This edits your user JAVA_HOME and PATH environment variables so the active JDK is used by every shell on this machine — not just VS Code.',
        () => jdkManager.setupEnv(),
      ),
    'jvm:check-env': () => jdkManager.isEnvConfigured(),
    'jvm:setup-profile': () =>
      this.confirmEnvChange(
        'Add JAVA_HOME to your shell profile?',
        'This appends JAVA_HOME and PATH exports to ~/.zshrc so the active JDK is used by every new shell — not just VS Code.',
        () => jdkManager.setupProfile(),
      ),
    'jvm:check-profile': () => jdkManager.isProfileConfigured(),

    // ── Ports ──
    'port:list': () => portManager.listPorts(),
    'port:kill': (pid: number) =>
      this.confirmDestructive(
        `Kill process ${pid}?`,
        'Unsaved work in that process is lost.',
        () => portManager.killProcess(pid),
      ),

    // ── Webview shims (see bridge.ts) ──
    'ui:alert': (message: string) => {
      vscode.window.showErrorMessage(message)
    },
  }

  // ── Helpers ────────────────────────────────────────────────

  /** Refresh the status bar / terminal env after a result that may have switched versions. */
  private afterChange<T extends { success: boolean }>(result: T): T {
    if (result.success) this.onChanged()
    return result
  }

  /**
   * The webview's window.confirm is stubbed to `true` (VS Code's sandboxed
   * iframe has no `allow-modals`), so destructive actions raise their real
   * confirmation here as a native modal.
   */
  private async confirmDestructive<T extends { success: boolean; error?: string }>(
    title: string,
    detail: string,
    run: () => T | Promise<T>,
  ): Promise<T | { success: boolean; error?: string }> {
    const proceed = 'Continue'
    const choice = await vscode.window.showWarningMessage(title, { modal: true, detail }, proceed)
    if (choice !== proceed) return { success: false, error: 'Cancelled.' }
    return this.afterChange(await run())
  }

  /**
   * Editing PATH / JAVA_HOME reaches outside VS Code and outlives the editor.
   * The desktop app can do it without ceremony; an extension should ask first.
   */
  private async confirmEnvChange(
    title: string,
    detail: string,
    run: () => { success: boolean; error?: string },
  ): Promise<{ success: boolean; error?: string }> {
    const proceed = 'Continue'
    const choice = await vscode.window.showWarningMessage(
      title,
      { modal: true, detail },
      proceed,
    )
    if (choice !== proceed) return { success: false, error: 'Cancelled.' }
    return this.afterChange(run())
  }

  /** Mirror the in-webview progress bar onto VS Code's notification area. */
  private withProgress<T>(
    title: string,
    run: (report: (percent: number) => void) => Promise<T>,
  ): Thenable<T> {
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: false },
      async (progress) => {
        let last = 0
        const result = await run((percent) => {
          const delta = percent - last
          if (delta > 0) {
            progress.report({ increment: delta, message: `${percent}%` })
            last = percent
          }
        })
        this.onChanged()
        return result
      },
    )
  }

  // ── HTML ───────────────────────────────────────────────────

  private buildHtml(context: vscode.ExtensionContext): string {
    const webview = this.panel.webview
    const base = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'assets')
    // Filenames are pinned in extension/vite.config.ts so we can build these
    // URIs without parsing a build manifest.
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'index.js'))
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'index.css'))
    const nonce = makeNonce()

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
    <meta name="nvm-platform" content="${process.platform}" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Node &amp; JDK Version Manager</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`
  }
}

function openFolder(dir: string) {
  return vscode.env.openExternal(vscode.Uri.file(dir))
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length))
  return out
}

export { VIEW_TYPE }
