# Changelog

All notable changes to Dev Runner are documented here.

## [0.1.0] - 2026-08-31

### Added

- Added package-script discovery to folder context menus with npm, pnpm, Yarn, and Bun detection.
- Added background process execution, recent output capture, complete process-tree termination, and restart controls.
- Added a process sidebar with active state and in-memory session history.
- Added executable Play buttons for shell blocks in rendered README files.
- Added automatic README reading mode with a configurable default.
- Added security confirmations, fingerprinted approvals, and an approval reset action.
- Added configurable automatic sidebar opening and security-warning behavior.
- Added German and English translations with automatic Obsidian-language detection and a manual language setting.
- Added strict TypeScript, ESLint, unit tests, manifest validation, CI, and release workflows.

### Fixed

- Prevented equivalent package-menu and README commands from starting duplicate processes.
- Synchronized README Play and Stop buttons with the shared process state.
