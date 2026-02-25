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
    - 在 `mpv/` 目录中使用 `meson setup build` + `meson compile -C build` 构建 `libmpv.2.dylib`
    - 调用 `copy_dependencies.sh`（不带参数，默认 `arm64`）复制依赖
    - 输出位置：`vendor/mpv/darwin-arm64`

- `build_mpv_macos_x64.sh`
  - 目标平台：**macOS x64 (Intel)**  
  - 依赖前提：通过 `/usr/local` 安装的 ffmpeg / ffmpeg-full（Intel Homebrew 默认前缀）
  - 行为：
    - 在 `mpv/` 目录中使用与 `build_mpv.sh` 相同的 Meson 配置构建 `libmpv.2.dylib`
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
- 最近一次更新：增加 macOS x64 构建脚本 `build_mpv_macos_x64.sh`，并将 `copy_dependencies.sh` 参数化以支持多架构输出。

