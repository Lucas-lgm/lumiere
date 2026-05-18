# Contributing to Lumiere

Thank you for your interest! This project is focused on macOS HDR video playback with libmpv embedding in Electron.

## What We Need Help With

- **macOS HDR/EDR**: Display calibration, tone mapping improvements, Dolby Vision edge cases
- **libmpv embedding**: Render API stability, performance, cross-platform support
- **UI/UX**: Player controls, playlist management, accessibility
- **Bug reports**: Clear steps to reproduce, video samples if applicable

## Before You Start

Open an issue to discuss significant changes before investing time. Small fixes and docs improvements are welcome directly.

## HDR Bug Reports

When reporting HDR issues, include:

- macOS version and display model
- EDR capability: `screen.maximumPotentialExtendedDynamicRangeColorComponentValue`
- Video format (codec, container, HDR type: HDR10 / Dolby Vision / HLG)
- Output of `debug-hdr-status` IPC command
- Screenshot of the issue

## Code Style

- TypeScript strict mode, no `any`
- Native code: Objective-C++ (.mm) for macOS-specific logic, C++ for cross-platform
- Use `prettier` for formatting (config in repo)

## Pull Request Process

1. Branch from `main`
2. Keep changes focused — one PR per feature/fix
3. Update docs if changing public API or build process
4. PRs require at least one review

## License

By contributing, you agree that your contributions will be licensed under the GPL v3 License.
