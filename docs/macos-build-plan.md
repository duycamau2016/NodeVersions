# Kế hoạch build bản release macOS — Node Version Manager

> Trạng thái quyết định: **Build trên GitHub Actions (`macos-latest`)** · **Bản unsigned** (không code sign / notarize).
> Ứng dụng hiện tại là Electron + React (Vite) + TypeScript, chỉ hỗ trợ Windows.

---

## 1. Tổng quan kiến trúc hiện tại

| Thành phần | File | Ghi chú |
|---|---|---|
| Main process | [src/main/index.ts](../src/main/index.ts) | Tạo `BrowserWindow`, đăng ký IPC. Đã có `process.platform !== 'darwin'` cho `window-all-closed`. |
| Quản lý Node | [src/main/nodeManager.ts](../src/main/nodeManager.ts) | **Phụ thuộc Windows nặng.** |
| Quản lý JDK | [src/main/jdkManager.ts](../src/main/jdkManager.ts) | **Phụ thuộc Windows nặng.** |
| Preload | [src/main/preload.ts](../src/main/preload.ts) | Cross-platform, không cần sửa. |
| Renderer | [src/renderer/](../src/renderer/) | UI React; text/label mô tả PowerShell/PATH cần đổi cho macOS. |
| Build main | [scripts/build-main.js](../scripts/build-main.js) | Dùng `path.join`, cross-platform OK. |
| Dev | [scripts/dev.js](../scripts/dev.js) | Có nhánh bootstrap Node dành riêng Windows. |
| Đóng gói | [package.json](../package.json) | Chỉ có block `win` (nsis). Script `dist` dùng cú pháp `cmd`. |

**Cơ chế cốt lõi (giữ nguyên trên macOS):** tải Node/JDK từ nguồn chính thức → giải nén vào `~/.nodevm/versions` hoặc `~/.jdkvm/versions` → tạo symlink `current` → cấu hình PATH để terminal dùng phiên bản đang active. Ý tưởng không đổi; chỉ có **cách thực hiện từng bước phụ thuộc HĐH** cần viết lại.

---

## 2. Ràng buộc quyết định (đọc trước tiên)

1. **Không thể build .dmg macOS từ Windows.** electron-builder cần `hdiutil`/`codesign` chỉ có trên macOS → dùng runner `macos-latest` của GitHub Actions.
2. **Không verify được bản port từ máy Windows hiện tại.** Mọi kiểm thử chạy trên Mac hoặc trong CI (xem §8).
3. **Bản unsigned:** người dùng macOS sẽ bị Gatekeeper chặn. Phải kèm hướng dẫn `xattr -dr com.apple.quarantine` hoặc chuột phải → Open (xem §7).
4. **Kiến trúc CPU:** macOS có Intel (`x64`) và Apple Silicon (`arm64`). Node dùng chuỗi arch `arm64`, còn API Adoptium dùng `aarch64` — **phải map khác nhau**.

---

## 3. Danh sách điểm phụ thuộc Windows cần sửa

| # | Vị trí | Hiện tại (Windows) | macOS cần |
|---|---|---|---|
| 1 | `nodeManager.install` | URL `node-*-win-*.zip` | `node-*-darwin-{x64\|arm64}.tar.gz` |
| 2 | Giải nén | PowerShell `Expand-Archive` | `tar -xzf` (giữ bit executable) |
| 3 | Copy | `xcopy /E /I /Q` | `cp -R` / `mv` |
| 4 | Kiểm tra binary Node | `node.exe` (ở gốc thư mục) | `bin/node` |
| 5 | `use()` chuyển version | `mklink /J` (junction), `rmdir` | `fs.symlinkSync(..., 'dir')`, `fs.rmSync` |
| 6 | `_discoverExternal` (Node) | `C:\Program Files\nodejs`, `where node`, `node.exe` | `/usr/local/bin`, `/opt/homebrew/bin`, nvm, `command -v node`, `bin/node` |
| 7 | `setupPath`/`isPathConfigured` | Registry User PATH qua PowerShell | Ghi file rc shell (`~/.zshrc`) — **không có registry** |
| 8 | `setupProfile` | PowerShell `$PROFILE` | Gộp chung với #7 (macOS chỉ 1 bước) |
| 9 | `jdkManager.install` URL | `os=windows&architecture=x64` | `os=mac&architecture={x64\|aarch64}`, đuôi `.tar.gz` |
| 10 | **JDK layout** | `bin/java.exe` ở gốc | **`Contents/Home/bin/java`** — khác biệt lớn nhất |
| 11 | `_findJdkRoot`, `use`, `_jdkLabel`, symlink target, `JAVA_HOME` | trỏ gốc thư mục | tất cả phải trỏ **`Contents/Home`** |
| 12 | `_discoverExternal` (JDK) | quét `Program Files\Java\...`, `javac.exe` | `/Library/Java/JavaVirtualMachines/*/Contents/Home`, `/usr/libexec/java_home -V`, `javac` |
| 13 | `setupEnv`/`isEnvConfigured` (JDK) | Registry JAVA_HOME + PATH | Ghi rc shell |
| 14 | Renderer text | "PowerShell Profile", `%USERPROFILE%\...`, `\` | "Shell profile (~/.zshrc)", `~/...`, `/` |
| 15 | `index.ts` | thiếu handler `activate` | thêm mở lại cửa sổ khi click dock |
| 16 | `dev.js` | `where`, `C:\Program Files\nodejs` | thêm nhánh `which`/đường dẫn macOS |
| 17 | `package.json` build | chỉ `win`, script `dist` cú pháp cmd | thêm block `mac` (dmg/zip) + script `dist:mac` |
| 18 | Icon | không có | thêm `.icns` (bắt buộc cho bản đẹp; nếu bỏ, Electron dùng icon mặc định) |

> [Inference] Điểm #10–#11 (JDK nằm trong `Contents/Home`) dựa trên cấu trúc chuẩn của bản phân phối JDK cho macOS; cần xác nhận thực tế khi giải nén 1 archive Temurin mac đầu tiên.

---

## 4. Kiến trúc đề xuất: tách lớp phụ thuộc HĐH

Hai manager đang **lặp lại** toàn bộ thao tác OS-specific. Thay vì rải `if (platform)` khắp nơi, tách các "đường nối HĐH" ra một lớp mỏng. **Không viết lại toàn bộ** — chỉ rút các seam.

```
src/main/
  platform/
    index.ts        # chọn impl theo process.platform
    types.ts        # interface Platform
    windows.ts      # gom code Windows hiện có
    darwin.ts       # impl macOS mới
  nodeManager.ts    # gọi platform.*, bỏ code OS-specific
  jdkManager.ts     # gọi platform.*, bỏ code OS-specific
```

Interface tối thiểu:

```ts
// src/main/platform/types.ts
export interface Platform {
  // Node
  nodeBinRelPath: string                 // 'node.exe'  | 'bin/node'
  nodeArchiveName(version: string): string
  nodeDownloadUrl(version: string): string
  // JDK
  javaBinRelPath: string                 // 'bin/java.exe' | 'Contents/Home/bin/java'
  jdkHomeSubdir: string                  // ''            | 'Contents/Home'
  adoptiumOs: string                     // 'windows'     | 'mac'
  adoptiumArch: string                   // 'x64'         | 'x64' | 'aarch64'
  // Thao tác chung
  extract(archive: string, destDir: string): Promise<void>
  copyDir(src: string, dest: string): Promise<void>
  makeCurrentLink(link: string, target: string): void
  removeCurrentLink(link: string): void
  // PATH / môi trường
  discoverExternalNode(): string[]       // trả về danh sách thư mục chứa node
  discoverExternalJdk(): string[]        // trả về danh sách JDK home
  isPathConfigured(marker: string): boolean
  setupShellPath(lines: string[]): { success: boolean; error?: string }
}
```

> Đây là refactor có rủi ro chạm code Windows đang chạy tốt. **Khuyến nghị:** làm §5 (viết thẳng nhánh darwin trong 2 manager) trước để có bản chạy được sớm; refactor thành lớp `platform/` ở phase dọn dẹp (§9 Phase 4) nếu muốn giảm trùng lặp.

---

## 5. Chi tiết thay đổi từng file (code mẫu)

### 5.1 `nodeManager.ts`

**Đường dẫn binary + arch:**

```ts
const isWin = process.platform === 'win32'
const nodeBin = isWin ? 'node.exe' : 'bin/node'
const nodeExe = path.join(dir, ...(isWin ? ['node.exe'] : ['bin', 'node']))
```

**install() — nhánh macOS:**

```ts
async install(version: string, onProgress: (p: number) => void) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'   // macOS
  const fileName = `node-${version}-darwin-${arch}`
  const downloadUrl = `https://nodejs.org/dist/${version}/${fileName}.tar.gz`
  const destDir = path.join(this.versionsDir, version)
  if (fs.existsSync(destDir)) return { success: false, error: `Version ${version} is already installed` }

  const tmpTar = path.join(os.tmpdir(), `${fileName}.tar.gz`)
  const tmpExtract = path.join(os.tmpdir(), `nodevm_${version}`)
  try {
    await this._download(downloadUrl, tmpTar, onProgress)
    fs.mkdirSync(tmpExtract, { recursive: true })
    // tar hệ thống giữ nguyên bit executable của bin/node
    await execAsync(`tar -xzf "${tmpTar}" -C "${tmpExtract}"`)

    const extracted = path.join(tmpExtract, fileName)
    if (!fs.existsSync(extracted)) throw new Error(`Extraction failed at ${extracted}`)
    await execAsync(`cp -R "${extracted}" "${destDir}"`)

    if (!fs.existsSync(path.join(destDir, 'bin', 'node')))
      { fs.rmSync(destDir, { recursive: true, force: true }); throw new Error('bin/node not found') }

    fs.rmSync(tmpTar, { force: true }); fs.rmSync(tmpExtract, { recursive: true, force: true })
    onProgress(100); return { success: true }
  } catch (e) {
    fs.rmSync(tmpTar, { force: true }); return { success: false, error: String(e) }
  }
}
```

**use() — symlink thật thay junction:**

```ts
use(target: string) {
  const versionDir = path.isAbsolute(target) ? path.normalize(target) : path.join(this.versionsDir, target)
  if (!fs.existsSync(path.join(versionDir, 'bin', 'node')))
    return { success: false, error: `No Node install found at ${versionDir}` }
  try {
    if (fs.existsSync(this.symlinkPath) || fs.lstatSync(this.symlinkPath, { throwIfNoEntry: false }))
      fs.rmSync(this.symlinkPath, { recursive: true, force: true })
    fs.symlinkSync(versionDir, this.symlinkPath, 'dir')   // không cần admin trên macOS
    return { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}
```

> Lưu ý: symlink của Node trỏ vào **thư mục version** (root), rồi PATH thêm `~/.nodevm/current/bin`. Với JDK thì symlink nên trỏ **thẳng vào `Contents/Home`** để `JAVA_HOME=~/.jdkvm/current` hợp lệ (xem 5.2).

**_discoverExternal() — nguồn macOS:**

```ts
private _discoverExternalDarwin(managedPaths: Set<string>): InstalledVersion[] {
  const found = new Map<string, InstalledVersion>()
  const add = (binDir?: string) => { /* kiểm tra <binDir>/node, chạy --version, bỏ nếu chứa /.nodevm/ */ }
  ;['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin',
    path.join(os.homedir(), '.nvm')].forEach(add)
  try {
    const out = execSync('command -v node', { shell: '/bin/sh', encoding: 'utf8' }).trim()
    if (out) add(path.dirname(out))
  } catch {}
  return Array.from(found.values())
}
```

**PATH trên macOS — gộp 1 bước (thay `setupPath` + `setupProfile`):**

```ts
private rcFile(): string {
  // zsh là mặc định từ macOS Catalina; fallback bash
  const shell = process.env.SHELL || ''
  if (shell.includes('zsh')) return path.join(os.homedir(), '.zshrc')
  if (shell.includes('bash')) return path.join(os.homedir(), '.bash_profile')
  return path.join(os.homedir(), '.zshrc')
}

setupPath() {
  try {
    const rc = this.rcFile()
    const marker = '# NodeVM — active version on PATH'
    const line = `\n${marker}\nexport PATH="$HOME/.nodevm/current/bin:$PATH"\n`
    const existing = fs.existsSync(rc) ? fs.readFileSync(rc, 'utf8') : ''
    if (existing.includes('.nodevm/current')) return { success: true }
    fs.appendFileSync(rc, line, 'utf8')
    return { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

isPathConfigured() {
  try { return fs.readFileSync(this.rcFile(), 'utf8').includes('.nodevm/current') }
  catch { return false }
}
```

> Trên macOS `setupProfile` trở nên thừa. Giữ IPC `nvm:setup-profile` trả `{ success: true }` (no-op) để không phải sửa preload/renderer nhiều, hoặc ẩn Step 2 ở UI (xem 5.5).

### 5.2 `jdkManager.ts` (nhiều khác biệt nhất — chú ý `Contents/Home`)

**Map arch cho Adoptium (bẫy 404 phổ biến):**

```ts
const adoptiumArch = process.arch === 'arm64' ? 'aarch64' : 'x64'
const adoptiumOs = 'mac'
```

**install():**

```ts
// [Inference] mẫu URL v3 binary API của Adoptium
const downloadUrl =
  `https://api.adoptium.net/v3/binary/version/${encodeURIComponent(version)}` +
  `/${adoptiumOs}/${adoptiumArch}/jdk/hotspot/normal/eclipse?project=jdk`
// ... tải .tar.gz, tar -xzf (giữ bit +x), cp -R
```

**Layout `Contents/Home` — ảnh hưởng dây chuyền:**

```ts
const JDK_HOME_SUB = process.platform === 'darwin' ? path.join('Contents', 'Home') : ''
const javaRel = process.platform === 'win32' ? path.join('bin','java.exe') : path.join('bin','java')

// đường dẫn Java home thực của 1 version đã cài:
const home = (versionDir: string) => path.join(versionDir, JDK_HOME_SUB)

// _findJdkRoot phải tìm 'Contents/Home/bin/java', KHÔNG phải 'bin/java' ở gốc
private _findJdkRoot(dir: string): string | null {
  const check = (d: string) => fs.existsSync(path.join(d, JDK_HOME_SUB, 'bin', 'java'))
  if (check(dir)) return dir
  for (const e of fs.readdirSync(dir)) {
    const c = path.join(dir, e)
    try { if (fs.statSync(c).isDirectory() && check(c)) return c } catch {}
  }
  return null
}
```

**use() + JAVA_HOME:** để `JAVA_HOME=~/.jdkvm/current` dùng được ngay, cho symlink `current` **trỏ thẳng vào `Contents/Home`**:

```ts
use(target: string) {
  const versionDir = path.isAbsolute(target) ? path.normalize(target) : path.join(this.versionsDir, target)
  const javaHome = path.join(versionDir, JDK_HOME_SUB)   // .../Contents/Home
  if (!fs.existsSync(path.join(javaHome, 'bin', 'java')))
    return { success: false, error: `No JDK found at ${javaHome}` }
  fs.rmSync(this.symlinkPath, { recursive: true, force: true })
  fs.symlinkSync(javaHome, this.symlinkPath, 'dir')      // JAVA_HOME = current
  return { success: true }
}
```

**_jdkLabel:** đọc file `release` trong `Contents/Home` (không phải gốc).

**_discoverExternal (macOS) — dùng công cụ hệ thống:**

```ts
// idiomatic: /usr/libexec/java_home -V liệt kê mọi JDK đã cài
private _discoverExternalDarwin(): InstalledVersion[] {
  const roots = new Set<string>()
  try {
    // -X xuất plist; đơn giản hơn: quét thư mục chuẩn
  } catch {}
  const base = '/Library/Java/JavaVirtualMachines'
  for (const d of (fs.existsSync(base) ? fs.readdirSync(base) : [])) {
    const home = path.join(base, d, 'Contents', 'Home')
    if (fs.existsSync(path.join(home, 'bin', 'javac'))) roots.add(home)
  }
  try {
    const jh = execSync('/usr/libexec/java_home', { encoding: 'utf8' }).trim()
    if (jh && fs.existsSync(path.join(jh, 'bin', 'javac'))) roots.add(jh)
  } catch {}
  return [...roots].map(h => ({ version: this._jdkLabel(h), isCurrent: false, path: h, external: true }))
}
```

**setupEnv (macOS):** ghi rc shell:

```ts
const block =
  `\n# JDKVM — JAVA_HOME + PATH\n` +
  `export JAVA_HOME="$HOME/.jdkvm/current"\n` +
  `export PATH="$JAVA_HOME/bin:$PATH"\n`
// append vào ~/.zshrc nếu chưa có '.jdkvm/current'
```

### 5.3 `index.ts` — thêm handler `activate` (chuẩn macOS)

```ts
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
```

### 5.4 `scripts/dev.js` — thêm nhánh macOS cho bootstrap Node

```js
// thay 'where' bằng lệnh theo HĐH
const finder = process.platform === 'win32' ? 'where node' : 'command -v node'
// bỏ qua đường dẫn chứa '.nodevm'; ứng viên macOS: /opt/homebrew/bin/node, /usr/local/bin/node
```

> Phần còn lại của `dev.js` (`spawn`, `wait-on`, Vite/tsc/electron) đã cross-platform.

### 5.5 Renderer — [SettingsTab.tsx](../src/renderer/components/SettingsTab.tsx) & [JdkSettingsTab.tsx](../src/renderer/components/JdkSettingsTab.tsx)

- Trên macOS **gộp còn 1 bước** ("Configure shell profile (`~/.zshrc`)"), ẩn Step 2 PowerShell.
- Đổi mọi text: `PowerShell profile` → `shell profile`; `%USERPROFILE%\.nodevm\...` → `~/.nodevm/...`; junction → symlink; lệnh verify giữ `node --version` / `java -version`.
- Phát hiện HĐH ở renderer: expose `process.platform` qua preload (thêm `platform: process.platform` vào `contextBridge`) và render text theo đó.

```ts
// preload.ts thêm:
contextBridge.exposeInMainWorld('env', { platform: process.platform })
```

### 5.6 `package.json` — block build macOS + script

```jsonc
"scripts": {
  "dist": "npm run build && set CSC_IDENTITY_AUTO_DISCOVERY=false&& electron-builder --win",
  "dist:mac": "npm run build && CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac"
},
"build": {
  "appId": "com.nodeversions.app",
  "productName": "Node Version Manager",
  "directories": { "output": "release" },
  "files": ["dist/**/*", "node_modules/**/*", "package.json"],
  "win": { "target": "nsis" },
  "mac": {
    "target": [{ "target": "dmg", "arch": ["x64", "arm64"] },
               { "target": "zip", "arch": ["x64", "arm64"] }],
    "category": "public.app-category.developer-tools",
    "icon": "build/icon.icns",
    "identity": null                 // unsigned: bỏ qua code signing
  }
}
```

> `identity: null` + `CSC_IDENTITY_AUTO_DISCOVERY=false` → electron-builder tạo bản **ad-hoc/unsigned**, không lỗi thiếu cert. Build 2 arch riêng (không universal) để nhẹ và đơn giản; có thể đổi sang `"arch": ["universal"]` sau.

### 5.7 Icon `.icns`

Tạo `build/icon.icns` (1024×1024 nguồn). Trên CI có thể sinh từ PNG bằng `iconutil`. Nếu tạm bỏ, xóa dòng `"icon"` — Electron dùng icon mặc định.

---

## 6. GitHub Actions workflow (build trên macOS)

`.github/workflows/build-mac.yml`:

```yaml
name: Build macOS
on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build-mac:
    runs-on: macos-latest        # Apple Silicon runner
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run dist:mac
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: false   # unsigned
      - uses: actions/upload-artifact@v4
        with:
          name: nodeversions-macos
          path: |
            release/*.dmg
            release/*.zip
```

> [Unverified] Cần chạy thử để chốt version runner/Node; runner `macos-latest` hiện là Apple Silicon nên `arch x64` được build qua cross-compile của electron-builder — xác nhận artifact x64 chạy được trên máy Intel khi kiểm thử.

---

## 7. Xử lý Gatekeeper cho bản unsigned (bắt buộc ghi vào README)

App unsigned sẽ bị macOS chặn ("app is damaged / cannot be opened"). Hướng dẫn người dùng:

- **Cách 1:** chuột phải vào app → **Open** → Open (chỉ cần 1 lần).
- **Cách 2 (nếu báo "damaged"):** chạy:
  ```bash
  xattr -dr com.apple.quarantine "/Applications/Node Version Manager.app"
  ```

> Đây là hệ quả của việc **không** code sign/notarize. Nếu sau này có tài khoản Apple Developer ID, bổ sung `notarize` + entitlements để bỏ hẳn bước này.

---

## 8. Kế hoạch kiểm thử (chạy trên Mac/CI, không verify được từ Windows)

| Hạng mục | Cách kiểm |
|---|---|
| Build ra artifact | CI xanh, có `.dmg` + `.zip` cho x64 & arm64 |
| Mở app | Chạy trên Mac thật (Intel + Apple Silicon nếu có), qua bước Gatekeeper §7 |
| Node: list remote | Danh sách hiện đúng từ `nodejs.org/dist/index.json` |
| Node: install | Tải `.tar.gz`, giải nén, `~/.nodevm/versions/vX/bin/node --version` chạy được (bit +x còn) |
| Node: use | symlink `current` đổi đúng, `node --version` sau khi mở terminal mới |
| Node: discover external | Thấy Node của Homebrew/nvm |
| JDK: install | Tải Temurin mac, thấy `.../Contents/Home/bin/java` |
| JDK: use + JAVA_HOME | `echo $JAVA_HOME` = `~/.jdkvm/current`, `java -version` đúng |
| JDK: discover external | Thấy JDK trong `/Library/Java/JavaVirtualMachines` |
| Setup PATH | Dòng export được thêm đúng vào `~/.zshrc`, không trùng lặp khi bấm lại |

---

## 9. Lộ trình thực hiện (phân phase)

- **Phase 0 — Chuẩn bị (½ ngày):** thêm block `mac` + `dist:mac` vào package.json; tạo workflow CI; build thử bản HIỆN TẠI trên CI để xác nhận toolchain macOS chạy (dù chức năng chưa hoạt động).
- **Phase 1 — Node port (1–1.5 ngày):** viết nhánh darwin cho `install/use/discover/setupPath` trong `nodeManager.ts` + `index.ts` `activate`. Kiểm thử §8 phần Node.
- **Phase 2 — JDK port (1.5–2 ngày):** xử lý `Contents/Home`, map arch `aarch64`, `install/use/discover/setupEnv`. Đây là phần rủi ro nhất → kiểm thử kỹ.
- **Phase 3 — Renderer + trải nghiệm (½–1 ngày):** đổi text UI theo HĐH, gộp bước setup, expose `platform` qua preload, icon `.icns`, README mục Gatekeeper.
- **Phase 4 — Dọn dẹp (tùy chọn, 1 ngày):** refactor sang lớp `platform/` (§4) để bỏ trùng lặp giữa 2 manager.

**Tổng ước lượng: ~4–6 ngày công.** [Inference] dựa trên khối lượng code hiện tại; phần JDK `Contents/Home` và kiểm thử cross-arch dễ phát sinh thêm.

---

## 10. Rủi ro & lưu ý

- **JDK `Contents/Home`** là nguồn lỗi phổ biến nhất — phải nhất quán ở symlink target, kiểm tra `bin/java`, `JAVA_HOME`, đọc `release`, và discover.
- **Bit executable** khi giải nén: bắt buộc dùng `tar` hệ thống, không dùng thư viện unzip JS thuần.
- **Arch string:** Node = `arm64`; Adoptium = `aarch64`. Sai → 404 âm thầm.
- **Cross-arch build:** runner Apple Silicon build bản x64 → phải test trên máy Intel thật.
- **Không code sign:** mỗi lần cập nhật app, người dùng có thể phải lặp lại bước Gatekeeper.
- **Refactor `platform/`** đụng vào code Windows đang chạy tốt → làm sau cùng, có kiểm thử regression Windows.
