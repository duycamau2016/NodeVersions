<p align="center">
  <img src="assets/logo.png" alt="Node & JDK Version Manager logo" width="128" />
</p>

# Node & JDK Version Manager

A GUI to install, switch and manage multiple **Node.js** and **JDK** versions on **Windows** and **macOS** — with a built-in listening-port monitor and background auto-update. Available both as a standalone desktop app (Electron) and as a **VS Code extension**.

## Screenshots

| Manage installed versions | Install a new version |
|:---:|:---:|
| ![Installed tab — installed Node versions with one-click switching](assets/screenshots/installed-node.png) | ![Install New tab — available Node versions with LTS labels](assets/screenshots/install-new.png) |

| Port monitor | Settings / Auto-update |
|:---:|:---:|
| ![Ports tab — listening ports grouped by Node/Java process, kill by PID](assets/screenshots/ports.png) | ![Settings tab — shell PATH configuration and update check](assets/screenshots/settings.png) |

<p align="center">
  <img src="assets/screenshots/installed-jdk.png" alt="JDK mode — managing installed JDKs" width="720" />
  <br/><em>The same app manages JDKs too — flip the Node | Java switch in the header.</em>
</p>

## Features

### Node & JDK version management

- **Install** any version from the official sources — Node.js from [nodejs.org](https://nodejs.org/dist/), JDKs from [Eclipse Temurin (Adoptium)](https://adoptium.net/). Downloads stream with a live progress bar.
- **Switch** the active version in one click. Activation repoints a single `current` link (a junction on Windows, a symlink on macOS/Linux), so no files are copied on switch.
- **Uninstall** managed versions. The currently active version is protected from removal.
- **Discovers existing installs** already on the machine that this app did not put there — Node found via `where`/`which` and common install dirs, JDKs found via vendor folders, `JAVA_HOME`, and `/usr/libexec/java_home` (macOS). These appear as read-only entries you can still switch to.
- **LTS labels** on the "Install New" list, and only the latest release of each major version is shown to keep the list short.
- **JDK detection is compiler-aware** — a `javac` binary is required, so plain JREs are not listed as JDKs.

### Listening-port monitor

- Lists every **TCP port in LISTENING state** owned by a Node or Java process.
- Shows port, PID, process name, bind address, and runtime (Node/Java).
- **Kill a process** by PID directly from the list (after confirmation). Reports a clear reason on permission errors instead of failing silently.
- Windows reads `netstat -ano` + `tasklist`; macOS/Linux reads `lsof`.

### Shell / environment integration

The **Settings** tab can persist the active version into your environment so shells *outside* the app also see it:

- **Node** — prepends `~/.nodevm/current` to the user `PATH`.
- **JDK** — sets `JAVA_HOME` to `~/.jdkvm/current` and prepends its `bin` to `PATH`.
- On **Windows** this writes to the user environment (no admin required) and can also add a prepend line to your PowerShell `$PROFILE`.
- On **macOS/Linux** this appends the equivalent lines to `~/.zshrc`.

### Background auto-update (desktop app)

- Built on `electron-updater` + GitHub Releases. On launch the app silently checks for a newer release; if one exists it downloads in the background and shows a **Restart & Update** banner.
- A manual **Check for updates** button lives in the **Settings** tab.
- Runs only in the packaged app (not under `npm run dev`), and only from the **second** published release onward (the first is the baseline to compare against).
- **macOS:** auto-update is currently **not active** because the app is unsigned (`identity: null`).

## Where things are installed

| | Location |
|---|---|
| Node versions | `~/.nodevm/versions/` |
| Active Node | `~/.nodevm/current` (junction on Windows, symlink elsewhere) |
| JDK versions | `~/.jdkvm/versions/` |
| Active JDK | `~/.jdkvm/current` |

---

## VS Code Extension

The same engine, embedded in the editor — install and switch Node/JDK versions without leaving VS Code.

<p align="center">
  <img src="assets/screenshots/installed-node.png" alt="The extension panel — the full UI in a VS Code webview" width="720" />
  <br/><em>The full panel runs in a VS Code webview (Installed · Install New · Ports · Settings).</em>
</p>

### Extension features

- **Activity-bar container** with three tree views: **Versions**, **Install New**, and **Listening Ports**. Switch, install, uninstall and kill ports inline from the tree.
- **Full panel** — `NodeVersions: Open Panel` (or click the status-bar item) opens the complete UI in a webview.
- **Command Palette Quick Picks** — `Switch Node Version`, `Switch JDK Version`, and `List Listening Ports` without opening the panel.
- **Terminal integration** — the active Node/JDK is prepended to `PATH` (and `JAVA_HOME` set) for **newly opened** integrated terminals. Terminals already open keep their original environment; open a new one after switching. Toggle with `nodeversions.autoUpdateTerminalEnv`.
- **Status bar** — shows the active Node and JDK version; click to open the panel. Toggle with `nodeversions.showStatusBar`.
- Long installs report to VS Code's notification progress area.
- Machine-wide `PATH` / `JAVA_HOME` edits require an explicit confirmation dialog (they are not needed for the integrated terminal, which works out of the box).
- Runs as a `workspace` extension, so in **Remote-SSH / WSL / Dev Containers** it manages the **remote** machine's versions.

### Extension settings

| Setting | Default | Description |
|---|---|---|
| `nodeversions.autoUpdateTerminalEnv` | `true` | Apply the active Node/JDK to newly opened integrated terminals |
| `nodeversions.showStatusBar` | `true` | Show the active versions in the status bar |

> The extension source lives in [extension/](extension/); see [extension/README.md](extension/README.md) for details.

---

## Requirements

- **Windows or macOS.**
- On Windows, creating the `current` junction may require **Developer Mode** or an elevated first run.
- For building/developing the toolchain: **Node.js >= 20** (22 or 24 recommended) to run Vite/Electron.

> ⚠️ If the machine currently has an old Node active (e.g. v16, activated by this very app), put a newer Node on `PATH` before you build/dev:
> ```powershell
> $env:Path = "C:\Users\<user>\.nodevm\versions\v24.16.0;" + $env:Path
> ```

## Development

### Install dependencies
```bash
npm install
```

### Run in development
```bash
npm run dev
```
Starts the Vite renderer + TypeScript watch + Electron.

> On Windows, if the app opens with no window (running like plain Node), clear the `ELECTRON_RUN_AS_NODE` variable:
> ```powershell
> Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
> ```

### Production build (no packaging)
```bash
npm run build
```

### Build the installer (.exe) locally
```bash
npm run dist
```
> ⚠️ On Windows this needs **Administrator rights** or **Developer Mode**
> (Settings → Privacy & security → For developers → Developer Mode = On), because electron-builder
> creates a symbolic link while unpacking the `winCodeSign` tool. Without it the build fails.
> For releasing, prefer **GitHub Actions** (see below) over a local build.

## Releasing a new version

Building + publishing is done **automatically by GitHub Actions**
([.github/workflows/release.yml](.github/workflows/release.yml)) when you **push a `v*` tag**.
CI builds **both Windows (.exe) and macOS (.dmg)** plus `latest.yml` (for Windows auto-update) and creates a GitHub Release.

> **Important:** the trigger is the **pushed tag**, not the commit message.
> The `version` in `package.json` **must match** the tag — so use `npm version` to do both at once instead of tagging by hand.

```powershell
# 1. Bump the version (edits package.json + creates a commit + a matching tag)
npm version patch        # bug fix:      1.0.1 -> 1.0.2
# npm version minor      # new feature:  1.0.1 -> 1.1.0
# npm version major      # breaking:     1.0.1 -> 2.0.0

# 2. Push both the commit and the tag -> triggers CI
git push origin main --follow-tags
```

CI produces a **draft Release** with:
- **Windows:** `Node Version Manager Setup X.Y.Z.exe`, `latest.yml`, `.blockmap`
- **macOS:** `Node Version Manager-X.Y.Z.dmg` (Intel) and `Node Version Manager-X.Y.Z-arm64.dmg` (Apple Silicon)

Open the draft at **https://github.com/duycamau2016/NodeVersions/releases** and click **Publish release**. While it stays a draft, users don't see it and auto-update doesn't pick it up.

### Where users download

Send users this link after publishing:
```
https://github.com/duycamau2016/NodeVersions/releases/latest
```
- **Windows:** download `Node Version Manager Setup X.Y.Z.exe`. Install **once** — later versions update themselves.
- **macOS:** download the `.dmg` matching the chip (arm64 for Apple Silicon, the other for Intel), open it and drag the app into Applications.

> **macOS is unsigned:** on first launch macOS blocks it ("cannot be opened because the developer cannot be verified").
> To open: right-click the app → **Open** → **Open**; or System Settings → Privacy & Security → **Open Anyway**.
> macOS users must **download new versions manually** each time (no auto-update yet).

## License

ISC — see [LICENSE](LICENSE).
