# Kế hoạch đóng gói thành VS Code Extension — Node Version Manager

> **Giả định nền tảng:** app Electron desktop **vẫn tiếp tục phát hành** song song. Extension là kênh phân phối thứ hai, không thay thế.
> Nếu quyết định bỏ hẳn bản desktop, kiến trúc ở §3 rút gọn còn 1 package duy nhất — xem §12 (Quyết định mở).
>
> Trạng thái: **đã implement** (2026-08-06). Xem §15 để biết chính xác cái gì đã chạy được và cái gì chưa verify.
> Khác biệt so với kế hoạch: **không** move manager sang `src/core/` — extension import thẳng
> `../src/main/*Manager.ts`, để app Electron không phải sửa một dòng nào.

---

## 1. Kết luận đánh giá khả thi

**Port này rẻ hơn bình thường rất nhiều**, vì phần logic nghiệp vụ đã sạch Electron:

| File | Import thực tế | Chạy được trong Extension Host? |
|---|---|---|
| [src/main/nodeManager.ts](../src/main/nodeManager.ts) | `fs`, `path`, `https`, `child_process`, `os`, `util` | ✅ Nguyên xi, không sửa |
| [src/main/jdkManager.ts](../src/main/jdkManager.ts) | `fs`, `path`, `https`, `child_process`, `os`, `util` | ✅ Nguyên xi, không sửa |
| [src/main/portManager.ts](../src/main/portManager.ts) | `child_process`, `util` | ✅ Nguyên xi, không sửa |
| [src/main/index.ts](../src/main/index.ts) | `electron`, `electron-updater` | ❌ Viết lại (host layer) |
| [src/main/preload.ts](../src/main/preload.ts) | `electron` (`contextBridge`, `ipcRenderer`) | ❌ Viết lại (RPC shim) |
| [src/renderer/](../src/renderer/) (React UI) | thuần React | ✅ Không sửa component nào (xem §4) |

Extension Host của VS Code là một tiến trình Node.js đầy đủ → 1.316 dòng logic ở 3 manager dùng lại 100%.

**Khối lượng code mới ước tính:** ~350–450 dòng (RPC shim + activation + webview HTML + manifest).

---

## 2. Ràng buộc quyết định (đọc trước tiên)

1. **Không convert package.json gốc tại chỗ.** Ba xung đột cứng:
   - `main`: Electron trỏ `dist/main/index.js`; VS Code dùng `main` làm entrypoint activate. Một field, hai ý nghĩa.
   - Key `build` (electron-builder) vs `contributes` / `engines` / `activationEvents`.
   - Deps `electron` + `electron-builder` + `electron-updater` vs `@types/vscode` + `@vscode/vsce`.
   → **Bắt buộc tách package riêng.**

2. **IPC của Electron ≠ postMessage của Webview.** `ipcRenderer.invoke()` trả Promise; `webview.postMessage()` là one-way fire-and-forget. Phải tự viết lớp correlate request/response bằng id (§4).

3. **Auto-update bị xoá hoàn toàn.** Marketplace lo việc cập nhật. Toàn bộ `electron-updater`, `updatevm`, [UpdateBanner.tsx](../src/renderer/components/UpdateBanner.tsx), [UpdateSection.tsx](../src/renderer/components/UpdateSection.tsx) không port.

4. **Sửa PATH / biến môi trường hệ thống từ extension là hành vi xâm lấn.** `setupPath()` / `setupEnv()` ghi registry (Windows) hoặc shell profile (macOS). Từ desktop app thì bình thường; từ extension thì phải **opt-in có xác nhận** và ghi rõ trong README.

5. **[Unverified] Chưa xác minh publisher ID còn trống.** `publisher` + `name` tạo thành identity vĩnh viễn trên Marketplace và **không thể thu hồi sau khi gỡ**. Phải check trước khi publish.

---

## 3. Kiến trúc đích

> ⚠️ **Phần này đã bị thay thế khi implement.** Bản thực tế **không** tạo `src/core/` —
> `extension/src/managers.ts` import thẳng `../src/main/*Manager.ts`, nên `src/main/` không
> phải sửa gì cả. Xem §15.1 cho cây thư mục thật.

```
NodeVersions/
├─ src/
│  ├─ core/                 ← MOVE: nodeManager.ts, jdkManager.ts, portManager.ts
│  │                          (nguyên xi, không sửa nội dung)
│  ├─ main/                 ← Electron host, import từ ../core
│  └─ renderer/             ← React UI, DÙNG CHUNG cho cả hai host
├─ extension/
│  ├─ package.json          ← manifest VS Code riêng (§8)
│  ├─ tsconfig.json
│  ├─ .vscodeignore
│  ├─ README.md             ← README riêng, ảnh dùng URL HTTPS (§9)
│  ├─ CHANGELOG.md
│  ├─ LICENSE
│  ├─ icon.png              ← 128×128 (§9)
│  └─ src/
│     ├─ extension.ts       ← activate/deactivate, đăng ký command
│     ├─ panel.ts           ← WebviewPanel + bảng handler (thay index.ts)
│     ├─ statusBar.ts       ← hiển thị version đang active
│     └─ terminalEnv.ts     ← environmentVariableCollection (§6)
└─ package.json             ← giữ nguyên cho Electron
```

**Nguyên tắc:** `src/core/` là biên giới. Không file nào trong `core/` được import `electron` hay `vscode`.

---

## 4. Lớp RPC shim — phần code mới thực sự

Đây là mảnh duy nhất đòi hỏi thiết kế. Mục tiêu: **giữ nguyên chữ ký API trong [types.ts](../src/renderer/types.ts) để không component React nào phải sửa.**

### 4.1 Phía webview (thay thế `preload.ts`)

```ts
// src/renderer/vscodeBridge.ts — dựng window.nodevm / jdkvm / portvm
const vscode = acquireVsCodeApi()
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()
let seq = 0

function invoke(channel: string, ...args: any[]) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    vscode.postMessage({ kind: 'invoke', id, channel, args })
  })
}

// Event push (progress) giữ nguyên mô hình callback như preload cũ
const listeners = new Map<string, ((data: any) => void)[]>()

window.addEventListener('message', (e) => {
  const msg = e.data
  if (msg.kind === 'response') {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result)
  } else if (msg.kind === 'event') {
    for (const cb of listeners.get(msg.channel) ?? []) cb(msg.data)
  }
})

window.nodevm = {
  listInstalled: () => invoke('nvm:list-installed'),
  listRemote: () => invoke('nvm:list-remote'),
  getCurrent: () => invoke('nvm:current'),
  use: (t) => invoke('nvm:use', t),
  install: (v) => invoke('nvm:install', v),
  uninstall: (v) => invoke('nvm:uninstall', v),
  openInstallDir: () => invoke('nvm:open-install-dir'),
  onInstallProgress: (cb) => on('nvm:install-progress', cb),
  removeInstallProgressListener: () => listeners.delete('nvm:install-progress'),
  setupPath: () => invoke('nvm:setup-path'),
  checkPath: () => invoke('nvm:check-path'),
  setupProfile: () => invoke('nvm:setup-profile'),
  checkProfile: () => invoke('nvm:check-profile'),
} satisfies NodeApi
```

Đúng cấu trúc `NodeApi` / `JdkApi` / `PortApi` hiện có → [App.tsx](../src/renderer/App.tsx) và mọi component chạy y nguyên.

### 4.2 Phía extension (thay thế block `ipcMain.handle`)

Bảng handler là bản sao gần như verbatim của [index.ts:105-168](../src/main/index.ts#L105-L168):

```ts
// extension/src/panel.ts
const handlers: Record<string, (...a: any[]) => any> = {
  'nvm:list-installed': () => nodeManager.listInstalled(),
  'nvm:list-remote':    () => nodeManager.listRemote(),
  'nvm:current':        () => nodeManager.getCurrent(),
  'nvm:use':            (t) => nodeManager.use(t),
  'nvm:install':        (v) => nodeManager.install(v, (p) => post({ kind: 'event', channel: 'nvm:install-progress', data: { version: v, progress: p } })),
  'nvm:uninstall':      (v) => nodeManager.uninstall(v),
  'nvm:open-install-dir': () => vscode.env.openExternal(vscode.Uri.file(nodeManager.versionsDir)),
  // ... jvm:* và port:* tương tự
}

panel.webview.onDidReceiveMessage(async (msg) => {
  if (msg.kind !== 'invoke') return
  try {
    const result = await handlers[msg.channel]?.(...msg.args)
    post({ kind: 'response', id: msg.id, result })
  } catch (err: any) {
    post({ kind: 'response', id: msg.id, error: String(err?.message ?? err) })
  }
})
```

### 4.3 Bảng ánh xạ API Electron → VS Code

| Electron | VS Code |
|---|---|
| `shell.openPath(dir)` | `vscode.env.openExternal(vscode.Uri.file(dir))` hoặc command `revealFileInOS` |
| `win.webContents.send(ch, data)` | `panel.webview.postMessage({ kind: 'event', channel, data })` |
| `ipcMain.handle` | bảng `handlers` + `onDidReceiveMessage` |
| `app.getVersion()` | `context.extension.packageJSON.version` |
| `autoUpdater.*` | **xoá** — Marketplace tự lo |
| Progress bar trong UI | giữ nguyên **+** bọc thêm `vscode.window.withProgress` cho tác vụ dài |

### 4.4 Tiêu chí thành công (bắt buộc kiểm)

> Không có file nào trong [src/renderer/components/](../src/renderer/components/) bị sửa, ngoài việc **xoá** `UpdateBanner` / `UpdateSection`.

---

## 5. Cơ chế webview — những chỗ chắc chắn vướng

1. **`base: './'` trong [vite.config.ts](../vite.config.ts) không dùng được trong webview.** Mọi asset phải đi qua `webview.asWebviewUri()`.

2. **CSP + nonce bắt buộc.** HTML wrapper do extension sinh ra:
   ```html
   <meta http-equiv="Content-Security-Policy"
         content="default-src 'none';
                  img-src ${webview.cspSource} https: data:;
                  style-src ${webview.cspSource} 'unsafe-inline';
                  script-src 'nonce-${nonce}';">
   ```

3. **Ghim tên file output** để extension dựng URI mà không phải parse manifest:
   ```ts
   build: {
     outDir: 'dist/webview',
     rollupOptions: { output: {
       entryFileNames: 'assets/index.js',
       assetFileNames: 'assets/[name][extname]',
     }},
   }
   ```

4. **`import logo from './assets/logo.svg'` trong [App.tsx:10](../src/renderer/App.tsx#L10)** → inline thành data URI (hoặc React component) để khỏi phải rewrite URI. Ghi chú: SVG **trong webview** không sao; chỉ **icon Marketplace** mới bắt buộc PNG (§9).

5. **State khi ẩn tab.** Webview bị dispose khi tab bị ẩn, trừ khi bật `retainContextWhenHidden: true` (tốn RAM). Khuyến nghị: **không bật**, thay bằng `vscode.getState()` / `setState()` lưu tab đang mở + tool đang chọn (`node` / `java`).

6. **`localResourceRoots`** phải trỏ tới `dist/webview` khi tạo panel.

---

## 6. Giá trị riêng của bản extension (không phải nice-to-have)

Nếu chỉ nhét UI cũ vào webview thì extension **kém hơn** app desktop. Ba thứ sau là lý do tồn tại của nó:

### 6.1 `environmentVariableCollection` — quan trọng nhất

```ts
context.environmentVariableCollection.description = 'Node/JDK version đang active'
context.environmentVariableCollection.prepend('PATH', `${currentNodeBin}${path.delimiter}`)
context.environmentVariableCollection.replace('JAVA_HOME', currentJdkDir)
```

Đã xác minh từ VS Code API docs: thay đổi này **áp dụng cho terminal mới tạo**, không ảnh hưởng terminal đang mở.

Không có nó, user bấm "Use v20", mở terminal tích hợp, gõ `node -v` vẫn ra version cũ → user sẽ hiểu là **lỗi**. Phải làm ngay ở Phase 2, không để sau.

### 6.2 Status bar item

`⬢ v22.13.0 | ☕ 21` ở góc dưới, click mở panel. Cập nhật sau mỗi `use()`.

### 6.3 Command palette

`NodeVersions: Open Panel` · `Switch Node Version` (QuickPick) · `Switch JDK Version` · `List Listening Ports` · `Kill Process on Port`.

QuickPick cho phép đổi version **không cần mở webview** — nhanh hơn app desktop.

### 6.4 `extensionKind: ["workspace"]`

Extension phải chạy nơi có filesystem + terminal thật, không phải trên UI client khi dùng Remote-SSH / WSL / Dev Container.

---

## 7. Danh sách xoá / giữ

| Thành phần | Quyết định |
|---|---|
| `electron-updater`, `updatevm`, `UpdateBanner`, `UpdateSection` | **Xoá** |
| `setupPath` / `setupEnv` (ghi registry/profile) | **Giữ**, nhưng bọc `showWarningMessage` xác nhận + ghi rõ trong README |
| `BrowserWindow`, `app.whenReady`, `window-all-closed` | Xoá (thay bằng `activate`) |
| `preload.ts` | Thay bằng `vscodeBridge.ts` |
| `nodeManager` / `jdkManager` / `portManager` | Giữ nguyên 100% |
| Toàn bộ `src/renderer/components/` (trừ 2 file update) | Giữ nguyên 100% |
| [browserMock.ts](../src/renderer/browserMock.ts) | Giữ — vẫn hữu ích để dev UI trong browser |

---

## 8. Manifest extension (`extension/package.json`)

```jsonc
{
  "name": "nodeversions",              // TODO: check trùng trên Marketplace
  "displayName": "Node & JDK Version Manager",
  "description": "Quản lý version Node.js và JDK ngay trong VS Code — cài, đổi version, theo dõi port",
  "version": "1.0.0",
  "publisher": "<TODO>",               // TODO: tạo publisher, phải khớp PAT
  "license": "ISC",
  "icon": "icon.png",                  // 128×128 PNG
  "repository": { "type": "git", "url": "https://github.com/duycamau2016/NodeVersions.git" },
  "engines": { "vscode": "^1.90.0" },  // phải khớp version @types/vscode cài đặt
  "categories": ["Other"],
  "keywords": ["node", "nvm", "jdk", "java", "version manager", "port"],
  "extensionKind": ["workspace"],
  "main": "./dist/extension.js",
  "activationEvents": [],              // command trong contributes tự sinh activation
  "contributes": {
    "commands": [
      { "command": "nodeversions.openPanel",  "title": "Open Panel",            "category": "NodeVersions" },
      { "command": "nodeversions.switchNode", "title": "Switch Node Version",   "category": "NodeVersions" },
      { "command": "nodeversions.switchJdk",  "title": "Switch JDK Version",    "category": "NodeVersions" },
      { "command": "nodeversions.listPorts",  "title": "List Listening Ports",  "category": "NodeVersions" }
    ],
    "configuration": {
      "title": "Node & JDK Version Manager",
      "properties": {
        "nodeversions.autoUpdateTerminalEnv": {
          "type": "boolean", "default": true,
          "description": "Tự cập nhật PATH/JAVA_HOME cho terminal mới mở khi đổi version"
        },
        "nodeversions.showStatusBar": { "type": "boolean", "default": true }
      }
    }
  },
  "scripts": {
    "build:webview": "vite build --config ../vite.vscode.config.ts",
    "build:ext": "tsc -p ./",
    "package": "npm run build:webview && npm run build:ext && vsce package"
  }
}
```

---

## 9. Checklist Marketplace — các mục repo **hiện đang thiếu** (đã kiểm tra thực tế)

| Mục | Trạng thái hiện tại | Việc cần làm |
|---|---|---|
| `LICENSE` file | ❌ **Không tồn tại** (dù `package.json` khai ISC) | Tạo `LICENSE` ở root + copy vào `extension/` |
| `repository` field | ❌ **Không có** trong [package.json](../package.json) | Thêm (remote hiện tại: `github.com/duycamau2016/NodeVersions`) |
| Ảnh trong README | ❌ **Đường dẫn tương đối** — `assets/logo.png`, `assets/screenshots/*.png` (5 chỗ trong [README.md](../README.md)) | Docs yêu cầu **ảnh phải resolve ra HTTPS**. Viết `extension/README.md` riêng dùng URL `raw.githubusercontent.com`, hoặc `vsce package --baseContentUrl` |
| Icon 128×128 PNG | ⚠️ `build/icon.png` là **1024×1024**, `assets/logo.png` là **512×512** | Docs ghi **tối thiểu** 128×128 → 1024×1024 hợp lệ; vẫn nên xuất bản `extension/icon.png` 128×128 cho gọn |
| `CHANGELOG.md` | ❌ Không có | Tạo |
| `.vscodeignore` | ❌ Không có | Loại `node_modules/`, `release/`, `dist/main/`, `src/`, `assets/screenshots/` |
| `publisher` + `name` | ❌ Chưa có | **[Unverified]** phải check trống trên Marketplace trước |
| `engines.vscode` | ❌ Chưa có | Đặt khớp version `@types/vscode` |
| Keywords | — | Docs giới hạn **tối đa 30** |

---

## 10. Quy trình publish (đã verify từ docs VS Code, 2026-08-06)

```bash
npm install -g @vscode/vsce
```

1. **Azure DevOps PAT** — scope bắt buộc:
   - Organization: **All accessible organizations**
   - Authorized Scopes: **Marketplace (Manage)**
2. **Tạo publisher** tại <https://marketplace.visualstudio.com/manage> → nhập **ID** (định danh, dùng trong `package.json`) và **Name** (tên hiển thị).
3. **Đăng nhập & publish:**
   ```bash
   vsce login <publisher_id>     # dán PAT
   vsce package                  # sinh .vsix để test trước
   vsce publish                  # hoặc: vsce publish minor
   ```

> **[Unverified]** UI của Azure DevOps thay đổi theo thời gian. Xác nhận lại tại
> <https://code.visualstudio.com/api/working-with-extensions/publishing-extension> ngay tại thời điểm publish.

---

## 11. Lộ trình thực thi

| Phase | Nội dung | Ước lượng |
|---|---|---|
| **P0 — Tách core** | Move 3 manager sang `src/core/`, sửa import trong [index.ts](../src/main/index.ts), chạy `npm run build` + `npm run dist` xác nhận **bản Electron không hỏng** | 1h |
| **P1 — Khung extension** | `extension/` scaffold, `package.json`, `tsconfig`, `.vscodeignore`, `activate()` mở panel rỗng, F5 chạy được | 2h |
| **P2 — RPC shim** | `vscodeBridge.ts` + bảng `handlers`, vite config webview, CSP/nonce, `asWebviewUri`. **Chốt: UI cũ chạy đủ 4 tab** | 4h |
| **P3 — Native integration** | `environmentVariableCollection`, status bar, 4 command + QuickPick, `withProgress` | 3h |
| **P4 — Dọn dẹp** | Xoá update UI, confirm dialog cho `setupPath`/`setupEnv`, `getState/setState` | 2h |
| **P5 — Chuẩn bị publish** | LICENSE, CHANGELOG, README riêng (ảnh HTTPS), icon 128px, `repository`, publisher | 2h |
| **P6 — Test & ship** | Vòng verify §12 → `vsce publish` | 2h |

Tổng: **~16h**. P0→P2 là đường găng; P3 quyết định extension có đáng dùng không.

---

## 12. Vòng verify (bắt buộc, không bỏ bước cuối)

1. **F5 → Extension Development Host** — chạy đủ install / use / uninstall Node và JDK, list + kill port.
2. Kiểm `environmentVariableCollection`: đổi version → mở terminal **mới** → `node -v` / `java -version` phải khớp.
3. Kiểm state: ẩn tab panel → mở lại → đúng tab và đúng tool đang chọn.
4. **`vsce package` → `code --install-extension nodeversions-1.0.0.vsix`** — cài bản `.vsix` thật.
   > Bước này mới là bước quan trọng. F5 **che giấu** lỗi `.vscodeignore` và lỗi đường dẫn asset — hai loại lỗi hay gặp nhất.
5. Test trên cả Windows và macOS (logic manager khác nhau theo OS — xem [macos-build-plan.md](./macos-build-plan.md)).
6. Nếu có thể: test trong Remote-WSL để xác nhận `extensionKind: ["workspace"]` đúng.

---

## 13. Rủi ro

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Publisher/name đã bị chiếm | Trung bình | Check sớm ở P1, không đợi tới P5 |
| Marketplace review từ chối vì extension sửa PATH hệ thống | Thấp–TB | Opt-in + confirm dialog + mô tả rõ trong README |
| Webview asset path sai chỉ lộ ra ở bản `.vsix` | Cao | Bước 4 §12 là bắt buộc |
| Trôi code giữa 2 host (sửa `core/` làm hỏng Electron) | Trung bình | P0 chốt biên giới; build cả 2 target trong CI ([.github/workflows/release.yml](../.github/workflows/release.yml)) |
| `install()` chạy lâu block extension host | Thấp | Code hiện đã async (`promisify(exec)`); thêm `withProgress` + nút cancel |

---

## 14. Quyết định mở (cần user chốt)

1. **Giữ app Electron hay thay thế hoàn toàn?** Kế hoạch này giả định **giữ**. Nếu bỏ → gộp về 1 package, tiết kiệm ~2h ở P0 và bỏ được rủi ro "trôi code".
2. **Publisher ID** dùng gì?
3. **Extension có publish version độc lập** với app desktop (`1.0.0`) hay đồng bộ (`1.2.0`)? Kế hoạch đang để độc lập.

---

## 15. Kết quả implement (2026-08-06)

### 15.1 Đã build được gì

```
extension/
├─ package.json            manifest, publisher = duycamau2016
├─ build.js                vite (webview) + esbuild (host) + copy icon
├─ vite.config.ts          build ../src/renderer -> dist/webview, pin tên file
├─ tsconfig.json           typecheck host  (+ 3 manager)
├─ tsconfig.webview.json   typecheck webview (+ ../src/renderer)
├─ .vscodeignore  .vscode/{launch,tasks}.json  README.md  CHANGELOG.md  LICENSE
├─ src/
│  ├─ extension.ts   activate, 5 command, serializer, config watcher
│  ├─ panel.ts       WebviewPanel + bảng handler RPC + CSP/nonce
│  ├─ managers.ts    nơi DUY NHẤT import sang ../src/main
│  ├─ terminalEnv.ts environmentVariableCollection
│  ├─ statusBar.ts   hiển thị version active
│  └─ commands.ts    QuickPick switch version / kill port
└─ webview/
   ├─ bridge.ts      RPC shim + shim confirm()/alert()
   ├─ main.tsx       entry (thứ tự import là load-bearing)
   ├─ webview.css    override riêng cho webview
   └─ index.html     entry của vite (không đi vào .vsix)
```

**Artefact:** `extension/nodeversions-1.0.0.vsix` — 10 file, **243.89 KB**.

### 15.2 Đã verify bằng cách chạy thật

| Kiểm tra | Kết quả |
|---|---|
| `npx tsc -p extension/` (host + 3 manager) | ✅ 0 lỗi |
| `npx tsc -p extension/tsconfig.webview.json` (webview + toàn bộ `src/renderer`) | ✅ 0 lỗi |
| `node build.js` — vite + esbuild | ✅ webview 214 KB, host 30.6 KB |
| `vsce package` | ✅ 243.89 KB |
| `activate()` với stub `vscode` | ✅ 5 command + serializer đăng ký, 8 subscription |
| `environmentVariableCollection` sinh giá trị đúng | ✅ `PATH += ~/.nodevm/versions/v24.16.0`, `JAVA_HOME = C:\Program Files\Java\jdk-21` |
| RPC round-trip qua `onDidReceiveMessage` | ✅ `nvm:current` → `"v24.16.0"`, `jvm:current` → `"jdk-21"`, `port:list` → 3 port thật |
| Channel không tồn tại | ✅ trả `error: Unknown channel: …` đúng id |
| HTML sinh ra: CSP + nonce meta khớp nonce script + `nvm-platform` + đúng đường dẫn asset | ✅ |
| Asset (logo.svg) inline thành data URI, CSS không còn `url()` ngoài | ✅ |

### 15.3 Đã cài `.vsix` thật và verify

`code --install-extension nodeversions-1.0.0.vsix` → **thành công**, VS Code 1.131.0.

| Kiểm tra trên bản đã cài | Kết quả |
|---|---|
| `code --list-extensions` | ✅ `duycamau2016.nodeversions@1.0.0` |
| Cây file trên đĩa khớp với đường dẫn `panel.ts` dựng | ✅ `dist/webview/assets/{index.js,index.css}` |
| Nạp `dist/extension.js` đã cài + `activate()` | ✅ |
| RPC round-trip trên bản đã cài | ✅ `nvm:current` → `"v24.16.0"`, `port:list` → 3 port thật |
| **URI asset trong HTML trỏ tới file có thật** | ✅ cả `index.js` lẫn `index.css` — đây là cửa ải mà F5 KHÔNG bắt được |
| `nvm-platform` meta | ✅ `win32` |

### 15.4 CHƯA verify — phải làm trước khi publish

1. **Chưa nhìn thấy React render trong webview thật.** Mọi thứ quanh nó đã verify (HTML đúng, CSP/nonce khớp, asset tồn tại, RPC chạy), nhưng bản thân việc UI vẽ ra 4 tab thì chưa ai nhìn. Cách kiểm: **Reload Window** rồi chạy `NodeVersions: Open Panel`.
2. **Chưa test macOS.**
3. **[Unverified]** Giả định webview VS Code không có `allow-modals` nên `confirm()`/`alert()` không dùng được. Đã xử lý phòng thủ (shim ở `bridge.ts` + modal native ở `panel.ts`) nên đúng trong cả hai trường hợp. `bridge.ts` còn tự kiểm tra xem việc override có "dính" không và báo lỗi ra `showErrorMessage` nếu không — biến lỗi im lặng thành lỗi nhìn thấy được.
4. **Publisher `duycamau2016` chưa được tạo** tại <https://marketplace.visualstudio.com/manage>. `vsce publish` sẽ fail bằng lỗi auth khó hiểu nếu quên bước này.

### 15.5 Đã đụng vào code dùng chung (đúng 3 file, đều đã verify không ảnh hưởng Electron)

| File | Thay đổi | Vì sao an toàn |
|---|---|---|
| [src/renderer/types.ts](../src/renderer/types.ts) | thêm `__NVM_HOST__?: 'vscode'` (optional) | chỉ là khai báo type |
| [src/renderer/App.tsx](../src/renderer/App.tsx) | `{!IS_VSCODE && <UpdateBanner />}` và `<UpdateSection />` | `IS_VSCODE` = `false` trong Electron → render y hệt cũ |
| [src/renderer/components/InstalledTab.tsx](../src/renderer/components/InstalledTab.tsx) | `${version}` → `${v.version}` | sửa bug CÓ SẴN gây `ReferenceError` khi uninstall thành công (có xác nhận của chủ repo) |

`src/main/` **không bị sửa một dòng nào.** Extension import trực tiếp `nodeManager.ts` / `jdkManager.ts` / `portManager.ts`.

### 15.6 Trạng thái baseline của app Electron

Trước khi làm gì, `npm run build` **đã fail sẵn**:

```
src/main/index.ts(3,29):  error TS2307: Cannot find module 'electron-updater'
src/main/index.ts(59,39): error TS7006: Parameter 'info' implicitly has an 'any' type
src/main/index.ts(65,40): error TS7006: Parameter 'p'    implicitly has an 'any' type
src/main/index.ts(68,40): error TS7006: Parameter 'info' implicitly has an 'any' type
src/main/index.ts(71,28): error TS7006: Parameter 'err'  implicitly has an 'any' type
```

Nguyên nhân gốc: `electron-updater` khai trong `dependencies` nhưng **chưa `npm install`** → 4 lỗi TS7006 là hệ quả của lỗi TS2307. Chạy `npm install` ở root nhiều khả năng dọn sạch cả 5.

Sau khi thêm extension: **vẫn đúng 5 lỗi đó, không thêm lỗi nào.** `npm run build:renderer` pass. Lỗi `InstalledTab.tsx` của renderer đã hết vì được sửa ở §15.4.

### 15.7 Lệnh thường dùng

```bash
cd extension
npm install              # lần đầu — chỉ @types/vscode, typescript, vsce
npm run build            # webview + host
npm run typecheck        # host
npm run typecheck:webview
npm run package          # -> nodeversions-1.0.0.vsix
npm run publish          # cần vsce login duycamau2016 trước
```

Mở `extension/` như một workspace riêng rồi **F5** để chạy Extension Development Host.
