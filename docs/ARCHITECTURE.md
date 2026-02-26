## 项目架构概览

本项目是基于 Electron + libmpv 的播放器，底层通过预编译好的 mpv 原生库（`libmpv`）以及其依赖实现多平台播放能力，前端使用 Web 技术实现 UI。

## Native 依赖与 mpv 架构

### mpv 子模块与构建流程

- 源码位置：`mpv/`（git submodule）
- 构建工具：Meson + Ninja
- 本仓库提供多平台的构建脚本，用于在本机构建 `libmpv` 并同步其依赖到 `vendor/mpv` 目录，供 Electron 原生模块使用。

### 构建脚本一览

- `build_mpv.sh`
  - 目标平台：**macOS ARM64**（Apple Silicon）
  - 依赖前提：通过 `/opt/homebrew` 安装的 ffmpeg / ffmpeg-full
  - 行为：
    - 在 `mpv/` 目录中使用 `meson setup build` + `meson compile -C build` 构建 **纯 libmpv 内核**（`-Dlibmpv=true -Dcplayer=false`，不包含 mpv CLI）
    - 显式禁用 mpv 自带的 macOS GUI / Cocoa / Swift 集成：`-Dcocoa=disabled -Dmacos-cocoa-cb=disabled -Dmacos-media-player=disabled -Dmacos-touchbar=disabled -Dswift-build=disabled`
    - 为减小体积与依赖，额外禁用：`cdda/dvdnav/dvbin/libarchive/libbluray/vapoursynth/x11-clipboard/javascript/cplugins`，以及 `build-date/manpage/html/pdf-build`
    - 调用 `copy_dependencies.sh`（不带参数，默认 `arm64`）复制依赖
    - 输出位置：`vendor/mpv/darwin-arm64`

- `build_mpv_macos_x64.sh`
  - 目标平台：**macOS x64 (Intel)**  
  - 依赖前提：通过 `/usr/local` 安装的 ffmpeg / ffmpeg-full（Intel Homebrew 默认前缀）
  - 行为：
    - 在 `mpv/` 目录中使用与 `build_mpv.sh` 相同的「无 GUI、最小依赖」Meson 配置构建 `libmpv.2.dylib`（同上：禁用 Cocoa/Swift 及 cdda/dvdnav/vapoursynth 等可选功能）
    - 调用 `copy_dependencies.sh x64` 复制依赖
    - 输出位置：`vendor/mpv/darwin-x64`

- `build_mpv_windows_msys2.sh`
  - 目标平台：**Windows x64**（MSYS2 环境）
  - 行为：
    - 在 MSYS2 CLANG64/UCRT64 环境构建静态或动态版 libmpv
    - 输出位置：`vendor/mpv/win32-x64`
    - 同时复制所需 DLL 和头文件到对应目录

### 依赖复制与 vendor 目录结构

- `copy_dependencies.sh`
  - 入口参数：
    - 无参数：默认 `arch=arm64`，输出到 `vendor/mpv/darwin-arm64`
    - `copy_dependencies.sh x64`：`arch=x64`，输出到 `vendor/mpv/darwin-x64`
  - 输入：
    - 主库路径固定为：`mpv/build/libmpv.2.dylib`
  - 行为：
    - 复制 `libmpv.2.dylib` 到目标 vendor 目录
    - 使用 `otool -L` 分析非系统依赖，并递归复制到 `vendor/mpv/darwin-<arch>/lib`
    - 使用 `install_name_tool` 统一修正 `install_name` 和依赖路径为 `@rpath/<库名>`
    - 为带完整版本号的 `.dylib` 创建符号链接（简化版本号）
    - 对 vendor 目录中所有 `.dylib` 进行一次最终依赖路径修复，确保整体可分发

### vendor/mpv 目录结构（摘要）

- `vendor/mpv/darwin-arm64`
  - `lib/`：macOS ARM64 版本 `libmpv.2.dylib` 及其依赖
  - `include/mpv/`：mpv 头文件
- `vendor/mpv/darwin-x64`
  - `lib/`：macOS x64 版本 `libmpv.2.dylib` 及其依赖
  - `include/mpv/`：可与 ARM64 共享或按需同步
- `vendor/mpv/win32-x64`
  - `lib/`：`libmpv.lib` / `libmpv-2.dll` 及 FFmpeg 等依赖 DLL
  - `include/mpv/`：mpv 头文件

## 文档更新说明

- 本文档会随着构建脚本和 vendor 目录结构的变更同步更新。
### CoreAudio 崩溃与兜底方案（macOS 26 / 嵌入式 libmpv）

- **现象**：在无 GUI 的 libmpv 构建下，于 macOS 26（或部分嵌入式场景）初始化 CoreAudio 时，在 `ca_select_device` 路径发生崩溃（PC=0，空函数指针调用）。栈指向 `libmpv.2.dylib ca_select_device` → `init` → `ao_init` → `ao_init_best`。
- **根因**：可能来自 (1) 日志路径中 `mp_log_buffer` 的 `wakeup_cb` 为空时仍被调用；(2) 或系统在 `kAudioHardwarePropertyDeviceForUID` 查询路径内存在未初始化函数指针。前者已在 mpv 源码中通过调用前对 `wakeup_cb` 做空指针检查修复；后者通过“强制使用默认设备”兜底。
- **代码修改（mpv 子模块）**：
  - `common/msg.c`：在 `write_msg_to_buffers` 中，仅当 `wakeup && buffer->wakeup_cb` 时才调用 `buffer->wakeup_cb(...)`，避免空指针调用。
  - `audio/out/ao_coreaudio_utils.c`：在 `ca_select_device` 中，若环境变量 `MPV_COREAUDIO_FORCE_DEFAULT` 已设置，则跳过按 UID 选择设备，仅使用系统默认输出设备，从而避开可能崩溃的 UID 查询路径。
- **使用方式**：
  - 主进程在启动时（`main/envPatch.ts`）在 macOS 上自动设置 `process.env.MPV_COREAUDIO_FORCE_DEFAULT=1`，确保 libmpv 初始化 CoreAudio 时只走默认设备路径，不触发 UID 查询崩溃。
  - 同时在 `LibMPVController.initialize` 中，macOS 默认使用 `vo=libmpv` + `ao=avfoundation`，完全绕过 CoreAudio AO（`ao=coreaudio`），进一步减少触发 `ca_select_device` 的机会。
  - 若使用自行构建的 libmpv，需包含上述 mpv 子模块中的两处修改（`msg.c` 的 wakeup_cb 检查与 `ao_coreaudio_utils.c` 的 getenv 兜底）。

- 最近一次更新：
  - 增加 macOS x64 构建脚本 `build_mpv_macos_x64.sh`，并将 `copy_dependencies.sh` 参数化以支持多架构输出。
  - 在 `LibMPVController` 中默认禁用 mpv 的键盘输入（`input-default-bindings` / `input-vo-keyboard` / `input-media-keys`），并使 `keypress()` 成为空实现，键盘事件只由上层 UI 处理，不再直接转发给 mpv。
  - 记录 CoreAudio 崩溃根因与兜底方案（`wakeup_cb` 空检查、`MPV_COREAUDIO_FORCE_DEFAULT`）。
  - 构建脚本增加最小化选项（cdda/dvdnav/dvbin/libarchive/libbluray/vapoursynth/x11-clipboard/javascript/cplugins/build-date 等禁用），.gitignore 增加 `mpv/build/`、`report.txt`、`mpv.zip`。

