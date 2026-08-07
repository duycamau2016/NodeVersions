<div align="center">
  <img src="https://raw.githubusercontent.com/duycamau2016/NodeVersions/main/assets/logo.png" alt="Node & JDK Version Manager logo" width="128" />
  <h1>Node &amp; JDK Version Manager</h1>
  <p>Install, switch and manage Node.js and JDK versions without leaving VS Code.</p>
</div>

---

## Features

### Every repo keeps its own version

Two projects open side by side, one on Node 18 and one on Node 22 — each VS Code
window keeps its own. Picking a version **pins** it to that workspace; the other
window is untouched.

`NodeVersions: Pin Node Version to Workspace` ·
`NodeVersions: Pin JDK Version to Workspace`, or click a version in the
**Versions** view.

### nvm installs are listed too

Node versions installed by **nvm** appear in the list alongside this app's own,
badged `nvm`, and can be pinned like any other. The nvm root is found through
`NVM_HOME` / the `root:` line of `settings.txt` on Windows, or `$NVM_DIR`
(default `~/.nvm`) elsewhere.

Strictly read-only: nothing is ever installed into or deleted from an nvm root,
and Uninstall stays disabled for those rows. fnm, Volta and asdf are not read.

A pin resolves in this order:

1. what you picked in this window (stored in VS Code's workspace state)
2. a `.nvmrc` / `.node-version` / `.java-version` file in the workspace root —
   commit it and the whole team gets the same version
   (disable with `nodeversions.useVersionFiles`)
3. the global default, i.e. the pre-pinning behaviour

`NodeVersions: Unpin Workspace (Use Global Defaults)` clears a pin. A pinned
version that is not installed is reported in the status bar and the extension
adds nothing to `PATH`, rather than silently falling back to the global default.
(If you previously ran the machine-wide setup in the **Settings** tab, the shell
still inherits the system `PATH` / `JAVA_HOME` — install the missing version to
get out of that state.)

Version files understand `20`, `v20.11.0`, `lts/*`-free plain versions and the
`node` / `latest` aliases. Codenames such as `lts/hydrogen` are **not** resolved.

### Global default vs. workspace pin

The global default is the shared `~/.nodevm/current` link that every window,
every shell and the desktop app follow. Right-click a version →
**Set as Global Default** (or `NodeVersions: Set Global Default Node Version`)
to change it; the extension confirms first, because it reaches outside this
window.

Workspaces with their own pin ignore the global default entirely.

Setting an **nvm** version as the global default points `~/.nodevm/current` at a
directory nvm also manages. It works, but two managers then claim one tree — a
later `nvm uninstall` leaves that link dangling. Pinning to a workspace does not
have this problem.

### New terminals get the version you picked

A pin prepends the install to `PATH` (and sets `JAVA_HOME`) for **newly opened**
integrated terminals.

A shell cannot have its `PATH` changed once it is running, so a terminal that is
already open keeps the old version until it is relaunched. VS Code relaunches
terminals you have not typed in by itself; for the rest the extension offers to
relaunch them after a version change — relaunching stops whatever is running in
them, so it asks first. Set `nodeversions.relaunchTerminalsOnChange` to `always`
or `never` to skip the prompt.

Scope worth knowing:

- A pin covers integrated terminals of this window. External shells and
  processes launched outside VS Code follow the **global default**.
- If you ran the **Settings** tab's shell-startup setup, your PowerShell profile
  (or `~/.zshrc`) prepends the global `current` link *after* VS Code builds the
  terminal environment. The extension re-applies the pin through VS Code's
  terminal shell integration, which runs after the profile — so the pin still
  wins. With `terminal.integrated.shellIntegration.enabled` turned **off** the
  profile wins instead, and the extension warns you about it.
- The pin is window-wide, not per-folder: in a multi-root workspace all folders
  share one pin.
- Turn the whole mechanism off with `nodeversions.autoUpdateTerminalEnv` — pins
  then have nothing to act on.

### The full panel

`NodeVersions: Open Panel`, or click the version in the status bar. Switching a
version here pins it to the workspace, same as the tree view.

| Installed | Install new |
|---|---|
| ![Installed tab — installed Node versions, one-click switching](https://raw.githubusercontent.com/duycamau2016/NodeVersions/main/assets/screenshots/installed-node.png) | ![Install tab — available Node versions with LTS labels](https://raw.githubusercontent.com/duycamau2016/NodeVersions/main/assets/screenshots/install-new.png) |

| Ports | Settings |
|---|---|
| ![Ports tab — listening ports by Node/Java process, kill from the list](https://raw.githubusercontent.com/duycamau2016/NodeVersions/main/assets/screenshots/ports.png) | ![Settings tab — shell PATH configuration](https://raw.githubusercontent.com/duycamau2016/NodeVersions/main/assets/screenshots/settings.png) |

<div align="center">
  <img src="https://raw.githubusercontent.com/duycamau2016/NodeVersions/main/assets/screenshots/installed-jdk.png" alt="JDK mode — managing installed JDKs" width="720" />
</div>

### Port monitor

`NodeVersions: List Listening Ports` lists every Node and Java process holding a
port, and kills one after a confirmation.

## Where things are installed

| | Location |
|---|---|
| Node versions | `~/.nodevm/versions/` |
| Global default Node | `~/.nodevm/current` (junction on Windows, symlink elsewhere) |
| JDK versions | `~/.jdkvm/versions/` |
| Global default JDK | `~/.jdkvm/current` |
| Workspace pins | VS Code workspace state, or a version file in the repo |

Node comes from **nodejs.org**, JDKs from **Eclipse Temurin (Adoptium)**.

## Machine-wide PATH changes

The **Settings** tab can register the manager in your *user* `PATH` /
`JAVA_HOME` (Windows registry) and shell startup (PowerShell `$PROFILE` + CMD
`AutoRun` on Windows, or `~/.zshrc` on macOS/Linux), so shells outside
VS Code also see the active version.

That reaches outside the editor and persists after VS Code closes, so the
extension asks for confirmation before doing it. You do **not** need it for the
integrated terminal — that works out of the box.

## Settings

| Setting | Default | |
|---|---|---|
| `nodeversions.autoUpdateTerminalEnv` | `true` | Apply the active Node/JDK to newly opened terminals |
| `nodeversions.useVersionFiles` | `true` | Honour `.nvmrc` / `.node-version` / `.java-version` in the workspace root |
| `nodeversions.relaunchTerminalsOnChange` | `ask` | Relaunch already-open terminals after a version change (`ask` / `always` / `never`) |
| `nodeversions.showStatusBar` | `true` | Show the active versions in the status bar |

## Requirements

- Windows or macOS. On Windows, creating the `current` junction may need
  Developer Mode or an elevated first run.
- Runs where the filesystem is (`extensionKind: workspace`), so in Remote-SSH /
  WSL / Dev Containers it manages the **remote** machine's versions.

## Also available as a desktop app

Same engine, standalone window:
<https://github.com/duycamau2016/NodeVersions/releases>

## License

ISC
