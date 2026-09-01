# Features and requirements

This document defines the implemented scope of **Dev Runner** and the acceptance criteria for future changes.

## Goal

Dev Runner executes explicit development commands from project metadata or documentation while keeping process state,
output, termination, and security decisions visible inside Obsidian.

## Package scripts

- A folder context menu is added only when the folder contains a readable `package.json` with non-empty scripts.
- Script names are sorted deterministically.
- Package-manager detection prefers the declared `packageManager`, then project lockfiles, and finally npm.
- Users can override automatic detection with npm, pnpm, Yarn, or Bun.
- Script names are passed as one argument and not interpolated into a POSIX shell command.
- An active script is represented by a Stop action; a finished script can be started again.
- A matching Markdown command and package-menu script share one active process identity and Stop action.

## Markdown commands

- Files whose final path component is `README.md`, case-insensitively, receive command buttons automatically.
- Other Markdown files require `dev-runner: true` frontmatter unless the global setting is enabled; Obsidian text
  properties serialized as `"true"` are accepted as an explicit opt-in.
- The global all-Markdown setting is disabled by default and persisted values must be actual booleans.
- Rendered `bash`, `sh`, `shell`, and `zsh` fences receive a Play button.
- The complete normalized code block runs as one shell command in the Markdown file's directory.
- The source Markdown and its current opt-in are re-read before execution and restart; removed, changed, or disabled blocks are rejected.
- Markdown buttons react to shared process changes and switch between Play, Stop, and disabled stopping state.
- Enabled Markdown files open in reading mode by default, but users can disable the behavior or manually enter editing mode.

## Process lifecycle

- Commands run without a visible terminal window and keep stdout and stderr connected to the plugin.
- The same normalized working directory and literal argument vector can have at most one active process.
- Compound or multi-line shell commands remain separate identities and are never treated as direct package launches.
- POSIX commands use detached process groups so the complete descendant tree can receive termination signals.
- POSIX process-group signals verify the original OS process-start identity before targeting a PID.
- Windows commands remain attached and are stopped with `taskkill /T /F`.
- A transient Windows `taskkill` failure is retried before the stop action fails.
- Stop first requests graceful POSIX termination and escalates after a bounded timeout.
- Plugin unload and normal application shutdown stop every active process without opening the sidebar.
- Start, stop, and restart interactions open the process sidebar by default when the setting is enabled.

## Process view and history

- Active entries show starting, running, stopping, or restarting state.
- The 50 most recent finished entries show completed, failed, or stopped state and remain until plugin unload.
- Finished entries release their `ChildProcess` references and older history entries are evicted deterministically.
- Entries display a label, working directory, PID when available, and the latest combined output.
- Output is normalized for terminal control sequences and bounded to 12,000 characters per entry.
- Restart revalidates and reconfirms the current command before replacing the previous history entry.
- Ordering is deterministic for stable rendering.
- Process cards are keyed and unchanged cards are retained across output refreshes.

## Security

- Untrusted commands require an explicit confirmation that shows command and working directory.
- Package-manager invocations are displayed with platform-appropriate argument quoting.
- A remembered approval hashes the exact command, directory, execution environment, project fingerprint, and source name.
- Package fingerprints include `package.json` and available npm, pnpm, Yarn, and Bun lockfiles.
- Project changes during an open warning invalidate the decision and require confirmation again.
- Saved approvals can be reset from settings.
- Security warnings can be disabled explicitly; the secure default is to keep them enabled.
- The UI and documentation state that confirmation does not sandbox a command.
- Direct filesystem reads are limited to project metadata and enabled Markdown files inside the selected vault directory.
- Linux process termination reads `/proc/<pid>/stat` only to verify the original process identity before signaling it.
- Runtime code does not directly write project files; confirmed child processes retain the user's system permissions.

## Settings

- Invalid or missing persisted values fall back to documented defaults.
- The interface is available in German and English; automatic selection follows Obsidian and falls back to English.
- Users can override automatic language selection with an explicit German or English preference.
- Package-manager values are validated before use.
- Boolean values are accepted only when persisted as actual booleans.
- Trust keys are validated, deduplicated, and sorted before use.
- Obsidian 1.13 and later receive searchable declarative definitions for every setting.
- Obsidian versions from 1.8.7 through 1.12 retain the equivalent imperative settings interface.

## Technical requirements

- Obsidian `1.8.7` or later on desktop.
- CI validates linting, tests, and production builds on Windows, macOS, and Linux.
- Node.js child-process and filesystem APIs available through the desktop application.
- TypeScript strict mode with checked indexed access and exact optional properties.
- Deterministic unit tests must not require an Obsidian runtime.
- Release builds contain no runtime dependencies other than the Obsidian API and built-in Node.js modules.
- German and English translation tables expose identical keys and are embedded in the production bundle.

## Acceptance criteria

A behavior change is complete when:

1. relevant pure logic has focused unit coverage,
2. `npm run validate:manifest`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass,
3. user-visible behavior and security implications are reflected in README and this document,
4. process shutdown and command revalidation guarantees remain intact,
5. `git diff --check` reports no whitespace errors.
