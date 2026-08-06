# Changelog

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
