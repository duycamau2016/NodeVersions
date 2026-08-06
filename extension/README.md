<div align="center">
  <img src="https://raw.githubusercontent.com/duycamau2016/NodeVersions/main/assets/logo.png" alt="Node & JDK Version Manager logo" width="128" />
  <h1>Node &amp; JDK Version Manager</h1>
  <p>Install, switch and manage Node.js and JDK versions without leaving VS Code.</p>
</div>

---

## Features

### Switch versions from the Command Palette

`NodeVersions: Switch Node Version` · `NodeVersions: Switch JDK Version` — a
Quick Pick over everything installed, including Node/JDK installs already on the
machine that this extension did not put there.

### New terminals get the version you picked

Switching a version prepends the active install to `PATH` (and sets `JAVA_HOME`)
for **newly opened** integrated terminals. Terminals that are already open keep
the environment they were started with — open a new one after switching.

Turn it off with `nodeversions.autoUpdateTerminalEnv`.

### The full panel

`NodeVersions: Open Panel`, or click the version in the status bar.

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
| Active Node | `~/.nodevm/current` (junction on Windows, symlink elsewhere) |
| JDK versions | `~/.jdkvm/versions/` |
| Active JDK | `~/.jdkvm/current` |

Node comes from **nodejs.org**, JDKs from **Eclipse Temurin (Adoptium)**.

## Machine-wide PATH changes

The **Settings** tab can register the manager in your *user* `PATH` /
`JAVA_HOME` (Windows registry) or in `~/.zshrc` (macOS/Linux), so shells outside
VS Code also see the active version.

That reaches outside the editor and persists after VS Code closes, so the
extension asks for confirmation before doing it. You do **not** need it for the
integrated terminal — that works out of the box.

## Settings

| Setting | Default | |
|---|---|---|
| `nodeversions.autoUpdateTerminalEnv` | `true` | Apply the active Node/JDK to newly opened terminals |
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
