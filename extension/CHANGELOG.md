# Changelog

## 1.1.0 — unreleased

### Added

- **Per-workspace version pinning.** Each VS Code window resolves its own Node
  and JDK version, so two repos open side by side no longer fight over one
  machine-wide link. Pins are stored in workspace state and applied through the
  window's terminal environment; the shared `~/.nodevm/current` junction is left
  alone.
- **Version files.** A `.nvmrc`, `.node-version` or `.java-version` in the
  workspace root pins the repo for everyone who clones it. A pin set in the UI
  overrides the file. Disable with `nodeversions.useVersionFiles`.
- `NodeVersions: Pin Node Version to Workspace`,
  `NodeVersions: Pin JDK Version to Workspace` and
  `NodeVersions: Unpin Workspace (Use Global Defaults)`.
- `NodeVersions: Set Global Default Node/JDK Version` — the old machine-wide
  switch, now explicit and behind a confirmation.
- The status bar distinguishes a pinned version (`$(pin)`) from the global
  default, and warns when a pin names a version that is not installed.
- After a version change the extension offers to relaunch terminals that are
  already open, instead of leaving them silently on the old version. Relaunching
  stops what is running in them, so it asks first; `always` / `never` are
  available through `nodeversions.relaunchTerminalsOnChange`.

### Fixed

- **Node was never added to the terminal `PATH`.** An extension gets a single
  mutator per environment variable, so `prepend('PATH', …)` for Node followed by
  `prepend('PATH', …)` for the JDK silently discarded the Node one — only the
  JDK bin was ever prepended. Both directories now go in as one prepend.
- A pin had no effect in the integrated terminal once the **Settings** tab's
  shell-startup hook was installed: the PowerShell profile / `~/.zshrc` prepends
  the global `current` link *after* the terminal environment is built, so
  `node -v` kept reporting the global version. The environment changes are now
  also applied through terminal shell integration, which runs after the profile.
  When shell integration is disabled the extension says so instead of silently
  losing.
- One failed command registration no longer aborts the rest of activation. With
  two copies of this extension installed under different publisher ids
  (`duycamau2016.nodeversions` and `yudaliot.nodeversions`) the second copy hit
  `command already exists` mid-registration, leaving tree items pointing at
  commands that were never registered. The conflict is now reported by name.

### Changed

- Clicking a version in the **Versions** view now pins it to the workspace
  instead of switching the machine-wide default. The global switch moved to the
  right-click menu (**Set as Global Default**).
- `NodeVersions: Switch Node/JDK Version` were renamed to `Pin … to Workspace`
  and now pin rather than switch globally. The command ids are unchanged.
- The webview panel's "use this version" pins to the workspace too, so the
  panel, the tree view and the status bar always agree.
- A pin that names a version which is not installed no longer falls back to the
  global default — the fallback was the cross-repo bleed this release fixes.

## 1.0.0 — unreleased

First VS Code release. Ports the Node & JDK Version Manager desktop app into the
editor, reusing its version-management engine unchanged.

### Added

- **Panel** (`NodeVersions: Open Panel`) — the full desktop UI in a webview:
  installed versions, install new, listening ports, settings.
- **Terminal integration** — the active Node/JDK is prepended to `PATH`
  (and `JAVA_HOME` set) for **newly opened** integrated terminals. Toggle with
  `nodeversions.autoUpdateTerminalEnv`.
- **Status bar** — shows the active Node and JDK version; click to open the
  panel. Toggle with `nodeversions.showStatusBar`.
- **Commands** — `Switch Node Version`, `Switch JDK Version` and
  `List Listening Ports` run as Quick Picks without opening the panel.
- Long installs report to VS Code's notification progress area.

### Changed from the desktop app

- The self-update UI is removed; the Marketplace handles extension updates.
- Machine-wide `PATH` / `JAVA_HOME` edits now require an explicit confirmation
  dialog.
