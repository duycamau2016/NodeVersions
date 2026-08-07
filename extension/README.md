# Node & JDK Version Manager

### Different projects. Different runtimes. One VS Code.

Stop running `nvm use` every time you switch projects.

**Node & JDK Version Manager** lets each VS Code workspace use its own Node.js and JDK version — while keeping your integrated terminal in sync.

> **Node 18 for one project. Node 22 for another. JDK 17 for a third — all from VS Code.**

## Why use it?

Working across multiple projects often means dealing with different runtime requirements:

```text
Angular project     → Node 18
React project       → Node 22
Spring Boot project → JDK 17
Java project        → JDK 21
```

Switching versions manually with `nvm`, changing `JAVA_HOME`, or restarting terminals can become repetitive and error-prone.

With **Node & JDK Version Manager**, you can pin a runtime to a VS Code workspace and let the extension keep your integrated terminals in sync.

### Key features

- ⚡ Switch Node.js versions directly from VS Code
- 📁 Pin Node.js and JDK versions per workspace
- 📄 Support `.nvmrc`, `.node-version`, and `.java-version`
- 💻 Automatically apply the selected runtime to new integrated terminals
- ☕ Manage JDK versions alongside Node.js
- 🔌 Find and manage listening Node.js and Java ports
- 🔒 Existing nvm installations remain read-only
- 🖥️ Manage runtimes without leaving VS Code

### Built for developers working across multiple stacks

Especially useful for projects such as:

```text
Angular + Spring Boot
React + Node.js
Vue + Node.js
Java + Node.js
Multiple Node.js projects
Multiple JDK projects
```

---

## 🚀 Quick Start

1. Install the extension.
2. Open your project in VS Code.
3. Open **Node & JDK Version Manager**.
4. Select a Node.js or JDK version.
5. Pin it to the current workspace.

That's it.

New integrated terminals will use the selected runtime.

---

## 🎬 See it in action

<!-- Keep your existing GIF/image here if your repository already references one. -->

**Project A → Node 18**

**Project B → Node 22**

Both projects can stay open at the same time, with each workspace using its own runtime.

---

# Features

## Every workspace keeps its own version

Open two projects side by side — one on Node 18 and one on Node 22. Each VS Code window keeps its own runtime.

Picking a version **pins it to that workspace**; the other window is untouched.

Use:

- `NodeVersions: Pin Node Version to Workspace`
- `NodeVersions: Pin JDK Version to Workspace`
- Or click a version in the **Versions** view.

This makes it possible to work on projects requiring different Node.js or JDK versions at the same time.

---

## nvm installations are listed too

Node versions installed by **nvm** appear in the list alongside this app's own versions and are badged `nvm`.

They can be pinned like any other version.

The nvm root is detected through:

- `NVM_HOME`
- The `root:` line of `settings.txt` on Windows
- `$NVM_DIR` on macOS/Linux
- `~/.nvm` by default elsewhere

### nvm is strictly read-only

Nothing is ever installed into or deleted from an nvm root.

For nvm-managed versions:

- Install remains disabled
- Uninstall remains disabled
- Existing nvm installations are never modified

> **Note:** fnm, Volta, and asdf installations are not currently detected.

---

## Version files

A workspace runtime can also be selected through version files in the workspace root:

```text
.nvmrc
.node-version
.java-version
```

For example:

```text
.nvmrc
20
```

Commit the version file to your repository and the whole team can use the same runtime.

Disable version-file detection with:

```text
nodeversions.useVersionFiles
```

Supported formats include:

```text
20
v20.11.0
node
latest
```

Codenames such as `lts/hydrogen` are **not** resolved.

---

## Global default vs. workspace pin

The extension supports two runtime scopes.

### Workspace pin

A workspace pin applies only to the current VS Code window.

```text
Project A → Node 18
Project B → Node 22
```

Workspaces with their own pin ignore the global default entirely.

### Global default

The global default is the shared `~/.nodevm/current` link that every window, every shell, and the desktop app can follow.

Right-click a version and select:

**Set as Global Default**

or run:

**NodeVersions: Set Global Default Node Version**

The extension confirms first because changing the global default reaches outside the current VS Code window.

To clear a workspace pin:

**NodeVersions: Unpin Workspace (Use Global Defaults)**

### Runtime resolution order

A runtime is resolved in this order:

```text
1. Version pinned in the current workspace
              ↓
2. .nvmrc / .node-version / .java-version
              ↓
3. Global default
```

If a pinned version is not installed, the extension reports it in the status bar and does **not** silently fall back to the global default.

If you previously enabled the machine-wide setup in the **Settings** tab, the shell may still inherit the system `PATH` / `JAVA_HOME`. Install the missing version to resolve that state.

### Using an nvm version as the global default

Setting an **nvm** version as the global default points `~/.nodevm/current` at a directory also managed by nvm.

This works, but two managers then claim the same tree. A later `nvm uninstall` can leave the link dangling.

Pinning an nvm version to a workspace does not have this problem.

---

## New terminals get the version you picked

A workspace pin applies the selected Node.js installation to `PATH` and sets `JAVA_HOME` for **newly opened integrated terminals**.

A shell cannot have its `PATH` changed after it is already running, so an existing terminal may keep the previous version until it is relaunched.

VS Code relaunches terminals you have not typed in by itself. For the rest, the extension offers to relaunch them after a version change.

Relaunching a terminal stops whatever is currently running in it, so the extension asks for confirmation first.

Configure this behavior with:

```text
nodeversions.relaunchTerminalsOnChange
```

Available values:

```text
ask
always
never
```

### Terminal scope

A workspace pin covers:

- Integrated terminals in the current VS Code window

External shells and processes launched outside VS Code continue to follow the **global default**.

If you enabled the **Settings** tab's shell-startup setup, your PowerShell profile or `~/.zshrc` prepends the global `current` link after VS Code builds the terminal environment.

The extension re-applies the workspace pin through VS Code's terminal shell integration, so the workspace pin still wins.

If:

```text
terminal.integrated.shellIntegration.enabled
```

is turned **off**, the shell profile wins instead and the extension warns you about it.

### Multi-root workspaces

The pin is **window-wide, not per-folder**.

In a multi-root workspace, all folders share the same runtime pin.

Turn the whole automatic terminal environment mechanism off with:

```text
nodeversions.autoUpdateTerminalEnv
```

When disabled, workspace pins have nothing to act on.

---

## The full panel

Open the panel with:

**NodeVersions: Open Panel**

or click the active version in the status bar.

The panel provides:

| Installed | Install new |
| --------- | ----------- |
| View installed Node.js/JDK versions | Install additional versions |
| Switch versions | Download supported versions |
| Pin versions to workspace | Manage runtime versions |

| Ports | Settings |
| ----- | -------- |
| Find listening Node/Java processes | Configure runtime behavior |
| Inspect ports | Configure terminal handling |
| Kill processes after confirmation | Configure status bar and version files |

---

## Port monitor

`NodeVersions: List Listening Ports` lists every Node.js and Java process holding a port.

You can terminate a process after confirmation.

This is useful when you encounter:

```text
Port 3000 is already in use
```

or:

```text
Address already in use
```

without leaving VS Code to find the process.

---

## Where things are installed

| Component | Location |
| --------- | -------- |
| Node versions | `~/.nodevm/versions/` |
| Global default Node | `~/.nodevm/current` |
| JDK versions | `~/.jdkvm/versions/` |
| Global default JDK | `~/.jdkvm/current` |
| Workspace pins | VS Code workspace state or a version file in the repo |

On Windows, `~/.nodevm/current` is a junction. On macOS/Linux it is a symlink.

Node versions are downloaded from **nodejs.org**.

JDKs are downloaded from **Eclipse Temurin (Adoptium)**.

---

## Machine-wide PATH changes

The **Settings** tab can register the manager in your *user* `PATH` / `JAVA_HOME`.

### Windows

- User `PATH`
- `JAVA_HOME`
- PowerShell `$PROFILE`
- CMD `AutoRun`

### macOS / Linux

- Shell startup configuration
- `~/.zshrc`

This allows shells outside VS Code to see the active version.

You do **not** need machine-wide configuration for the integrated VS Code terminal — workspace runtime switching works out of the box.

Because this configuration reaches outside the editor and persists after VS Code closes, the extension asks for confirmation before applying it.

---

## Settings

| Setting | Default | Description |
| ------- | ------- | ----------- |
| `nodeversions.autoUpdateTerminalEnv` | `true` | Apply the active Node.js/JDK version to newly opened terminals |
| `nodeversions.useVersionFiles` | `true` | Honour `.nvmrc`, `.node-version`, and `.java-version` in the workspace root |
| `nodeversions.relaunchTerminalsOnChange` | `ask` | Relaunch already-open terminals after a version change: `ask`, `always`, or `never` |
| `nodeversions.showStatusBar` | `true` | Show active versions in the status bar |

---

## Requirements

- Windows
- macOS

The extension runs where the VS Code workspace filesystem is located.

This means that in Remote-SSH, WSL, or Dev Containers, it manages the **remote machine's** Node.js and JDK versions.

On Windows, creating the `current` junction may require Developer Mode or an elevated first run.

---

## Also available as a desktop app

The same engine is available as a standalone desktop application:

https://github.com/duycamau2016/NodeVersions/releases

---

## License

ISC
