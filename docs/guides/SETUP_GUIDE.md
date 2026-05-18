# Development Environment Setup Guide

> **Last Updated**: 2026-01-25  
> **Target Platform**: macOS (ARM64/Intel)  
> **Development Status**: Active Development

## Quick Start

### System Requirements
- **Operating System**: macOS 12+ (macOS 14+ recommended for full HDR support)
- **Architecture**: Apple Silicon (ARM64) or Intel
- **Memory**: 8GB+ (16GB recommended)
- **Disk Space**: 10GB+ for dependencies and build

### Required Tools
1. **Node.js**: 20.x (recommended via [nvm](https://github.com/nvm-sh/nvm))
2. **Xcode Command Line Tools**: `xcode-select --install`
3. **Python**: 3.9+ (for node-gyp)
4. **Meson & Ninja**: (for building mpv submodules)
5. **Git**: (for version control and submodules)

---

## Environment Configuration

### 1. Install Node.js and npm
```bash
# Use nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Reload shell or run
source ~/.zshrc  # or ~/.bashrc

# Install Node.js 20.x
nvm install 20
nvm use 20
```

### 2. Install Build Tools
```bash
# Xcode Command Line Tools
xcode-select --install

# If already installed, ensure it's up to date
sudo xcode-select --switch /Library/Developer/CommandLineTools

# Verify installation
xcode-select -p
```

### 3. Install Python and Build Tools
```bash
# macOS comes with Python 3, but verify version
python3 --version  # Should show 3.9+

# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Meson and Ninja
brew install meson ninja pkg-config

# Verify installation
meson --version
ninja --version
```

### 4. Configure npm (optional, speed up downloads)
```bash
# Set Electron mirror (if in China)
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

# Or set permanently
echo 'export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/' >> ~/.zshrc
source ~/.zshrc
```

---

## Project Setup

### 1. Clone Repository
```bash
# Clone main repository
git clone <repository-url>
cd mpv-player

# Initialize submodules
git submodule update --init --recursive
```

### 2. Install Node.js Dependencies
```bash
npm install

# If Electron download is slow, use mirror
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

### 3. Build mpv Submodule
```bash
# Run build script
./build_mpv.sh

# Script will:
# 1. Configure mpv using meson
# 2. Build libmpv.2.dylib
# 3. Copy to vendor/mpv/darwin-arm64/lib/
# 4. Fix dependency paths to @loader_path relative paths
```

**Details**: See [VENDOR_MANAGEMENT.md](VENDOR_MANAGEMENT.md) for vendor dependency management details.

### 4. Build Native Addon
```bash
# Build native addon (Node.js native module)
npm run build:native

# Or use node-gyp directly
cd native
node-gyp rebuild
```

### 5. Verify Build
```bash
# Check if libmpv is correctly built
ls -la vendor/mpv/darwin-arm64/lib/

# Check native addon
ls -la native/build/Release/

# Test native addon loading
node -e "require('./native/build/Release/mpv_binding.node'); console.log('Native addon loaded successfully')"
```

---

## Development Workflow

### Start Development Server
```bash
npm run dev

# Development server will:
# 1. Start Electron main process and renderer process
# 2. Enable hot reload
# 3. Open developer tools
```

### Build Production Version
```bash
# Build application
npm run build

# Build output in dist/ directory
ls -la dist/
```

### Code Checks
```bash
# TypeScript type check (if configured)
npm run type-check

# ESLint (if configured)
npm run lint

# Build check
npm run build:check
```

### Test Commands
```bash
# Unit tests (if configured)
npm test

# Integration tests (if configured)
npm run test:e2e
```

---

## Environment Verification

### Verify All Tools
```bash
#!/bin/bash
# scripts/verify_environment.sh

echo "=== Development Environment Verification ==="

# Node.js
echo "Node.js: $(node --version)"
echo "npm: $(npm --version)"

# Build tools
echo "Python: $(python3 --version)"
echo "Meson: $(meson --version 2>/dev/null || echo 'Not installed')"
echo "Ninja: $(ninja --version 2>/dev/null || echo 'Not installed')"

# Xcode
echo "Xcode CLI: $(xcode-select -p 2>/dev/null || echo 'Not installed')"

# Git submodules
if [ -f "mpv/.git" ]; then
    echo "mpv submodule initialized"
else
    echo "mpv submodule not initialized"
fi

# libmpv
if [ -f "vendor/mpv/darwin-arm64/lib/libmpv.2.dylib" ]; then
    echo "libmpv built"
else
    echo "libmpv not built"
fi

# Native addon
if [ -f "native/build/Release/mpv_binding.node" ]; then
    echo "Native addon built"
else
    echo "Native addon not built"
fi

echo "=== Verification Complete ==="
```

### Common Environment Issues

#### Issue 1: node-gyp Build Failed
**Error**: `gyp: No Xcode or CLT version detected!`

**Solution**:
```bash
# Reinstall Xcode Command Line Tools
sudo rm -rf $(xcode-select -print-path)
xcode-select --install
```

#### Issue 2: Python Version Issues
**Error**: `Python executable "python" is v2.7, which is not supported by gyp`

**Solution**:
```bash
# Ensure using python3
npm config set python python3

# Or set globally
export PYTHON=python3
```

#### Issue 3: Meson/Ninja Not Found
**Error**: `meson: command not found`

**Solution**:
```bash
brew install meson ninja
```

#### Issue 4: Electron Download Slow
**Solution**:
```bash
# Set mirror
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install

# Or use cnpm
npm install -g cnpm --registry=https://registry.npmmirror.com
cnpm install
```

---

## Project Structure

```
mpv-player/
├── src/                    # Source code
│   ├── main/              # Electron main process
│   │   ├── corePlayer.ts     # Core player controller
│   │   ├── libmpv.ts         # MPV native binding interface
│   │   ├── renderManager.ts  # Render loop management
│   │   ├── playerState.ts    # State machine implementation
│   │   ├── videoPlayerApp.ts # App entry and window management
│   │   ├── ipcHandlers.ts    # IPC communication handling
│   │   └── nativeHelper.ts   # Platform window handle retrieval
│   ├── renderer/          # Vue renderer process
│   │   ├── src/views/        # Page components
│   │   ├── src/composables/  # Composition functions
│   │   └── src/router.ts     # Route configuration
│   └── preload/           # Preload scripts
│       └── preload.ts        # electronAPI exposure
├── native/                # Native binding layer
│   ├── binding.cc         # C++ N-API binding
│   ├── mpv_render_gl.mm   # macOS OpenGL rendering + HDR configuration
│   └── binding.gyp        # Build configuration
├── vendor/                # Prebuilt dependency libraries
│   └── mpv/darwin-arm64/lib/  # libmpv dynamic library
├── mpv/                   # mpv submodule (gpu-next backend)
├── docs/                  # Documentation
└── build_mpv.sh           # mpv build script
```

---

## Debug Configuration

### VSCode Debug Configuration
```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Main Process",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron",
      "windows": {
        "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron.cmd"
      },
      "args": ["."],
      "outputCapture": "std",
      "console": "integratedTerminal"
    },
    {
      "name": "Debug Renderer Process",
      "type": "chrome",
      "request": "attach",
      "port": 9222,
      "webRoot": "${workspaceFolder}/src/renderer",
      "timeout": 30000
    }
  ]
}
```

### Chrome Developer Tools
- Main process: `Cmd+Shift+I` or via code `mainWindow.webContents.openDevTools()`
- Renderer process: automatically opened by default in dev mode

### Native Addon Debugging
```bash
# Use lldb to debug native addon
lldb -- node -e "require('./native/build/Release/mpv_binding.node')"

# Add logging in code
console.log('[native] debug info');
```

---

## Learning Resources

### Core Technology Stack
- **Electron**: https://www.electronjs.org/
- **Vue 3**: https://vuejs.org/
- **TypeScript**: https://www.typescriptlang.org/
- **libmpv**: https://mpv.io/
- **libplacebo (gpu-next)**: https://code.videolan.org/videolan/libplacebo

### Project Related Documentation
- [Architecture Design](../ARCHITECTURE.md) - Complete architecture description
- [API Reference](./API_REFERENCE.md) - Core API quick reference
- [Deployment Guide](../deployment/DEPLOYMENT.md) - Packaging and distribution guide
- [HDR Guide](../features/HDR_GUIDE.md) - HDR and Dolby Vision configuration

### Community Support
- **GitHub Issues**: Project issue tracking
- **Electron Discord**: Real-time discussion
- **Vue.js Forum**: Vue-related questions

---

## Troubleshooting

### Cannot Start Development Server
```bash
# Clean and reinstall
rm -rf node_modules
npm cache clean --force
npm install

# Check port usage
lsof -i :3000  # Default dev port
```

### Video Won't Play
1. Check if mpv was built successfully
2. Check if native addon is loaded
3. Check console error messages
4. Run `npm run build:native` to rebuild

### HDR Content Displays Incorrectly
1. Check macOS version (needs 14.0+ for full EDR support)
2. Check if display supports HDR
3. Run HDR debug command
4. See [HDR Guide](../features/HDR_GUIDE.md)

---

## Updating Environment

### Update Dependencies
```bash
# Update npm packages
npm update

# Update submodules
git submodule update --remote
cd mpv
git pull origin release/0.41
cd ..
./build_mpv.sh
```

### Clean Build
```bash
# Clean all build files
npm run clean

# Or manually clean
rm -rf node_modules
rm -rf vendor/mpv/darwin-arm64/lib/*
rm -rf native/build
rm -rf dist
```

---

## Completion Check

After completing all setup, run full verification:
```bash
# Run verification script
./scripts/verify_environment.sh

# Start development server
npm run dev

# Test basic functionality
# 1. Application starts normally
# 2. Can open video files
# 3. Playback controls work
# 4. HDR content displays correctly (if supported)
```

If all checks pass, the development environment is ready!

---

## Change Log

| Date | Changes |
|------|---------|
| 2026-01-25 | Created development environment setup guide |
| 2026-01-21 | Initial environment requirements recorded in README.md |

## Contributing

Found environment setup issues or content that needs supplementing?
- Submit an Issue to report problems
- Submit a Pull Request to improve documentation
- Share your experience in the discussion forum
