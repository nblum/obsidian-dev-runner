# Changelog

All notable changes to Dev Runner are documented here.

## [Unreleased]

## [0.1.6] - 2026-09-01

### Fixed

- Preserved `cmd.exe` arguments verbatim so Windows commands execute correctly and expose their output.
- Gated GitHub release creation on successful Linux, macOS, and Windows CI jobs.

## [0.1.5] - 2026-09-01

### Added

- Added per-file `dev-runner: true` frontmatter opt-in, including Obsidian text properties, and an opt-in setting for
  commands in all Markdown files.
- Added Windows, macOS, and Linux CI coverage with platform-specific background-process lifecycle tests.

### Fixed

- Unified frontmatter parsing for rendered and revalidated Markdown commands and refreshed open reading views when
  changing the global Markdown setting.

## [0.1.4] - 2026-08-31

### Added

- Added a self-contained Dev Runner teaser image for the Obsidian community listing.

### Fixed

- Hosted the README installation badge locally and linked it to the Dev Runner community plugin page.
- Removed unnecessary shell quoting from package-script context-menu labels.
- Improved popout-window compatibility for process timers and reload coordination.
- Added searchable declarative settings on Obsidian 1.13 while retaining the legacy settings UI for older versions.

## [0.1.3] - 2026-08-31

### Added

- Added an atomic release task that synchronizes metadata, validates, commits, tags, and pushes a release.

### Fixed

- Prevented conflicting historical tags from blocking preparation of a new release.

## [0.1.2] - 2026-08-31

### Fixed

- Allowed manifest validation in GitHub Actions and other repository checkouts whose directory name differs from the plugin ID.
- Synchronized all release metadata after the unsuccessful `0.1.1` tag.

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
- Hardened process shutdown across plugin reloads, PID reuse, delayed exits, and transient Windows stop failures.
- Bounded session history, released completed child-process references, and retained unchanged sidebar cards.
- Corrected wide README fence parsing and validated package-manager dropdown values.
- Reused shell resolution for trust decisions and displayed safely quoted package commands.
