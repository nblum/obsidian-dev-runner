# Contributing

Thanks for contributing to **Dev Runner**. Keep changes focused because this desktop plugin starts arbitrary local
processes and is responsible for stopping their descendant trees safely.

## Development environment

- Obsidian `1.8.7` or later for manual UI checks
- Node.js 22.6 or later for TypeScript execution through `node:test`
- npm for dependency installation and project scripts

Install dependencies once:

```bash
npm install
```

The repository should live at `.obsidian/plugins/dev-runner/` in a test vault. After source changes, run
`npm run build`, then reload the plugin or Obsidian.

## Project layout

- `src/main.ts` – Obsidian entry point and process orchestration
- `src/package-scripts.ts` – package metadata, manager detection, and command construction
- `src/readme-command-model.ts` – pure README command parsing and identity
- `src/readme-commands.ts` – rendered Markdown Play buttons
- `src/background-process.ts` – platform-specific process launch and tree termination
- `src/process-identity.ts` – cross-source command identity and literal shell parsing
- `src/process-view.ts` – process sidebar and session history
- `src/output-buffer.ts` – normalized bounded output tail
- `src/script-security.ts` – project fingerprints and remembered approvals
- `src/script-warning.ts` – security confirmation modal
- `src/settings.ts` – validated persistent setting model
- `src/settings-tab.ts` – Obsidian settings controls
- `tests/` – deterministic TypeScript unit tests
- `scripts/validate-manifest.mjs` – release metadata validation
- `.github/workflows/` – CI and release asset automation

`main.js` is generated and intentionally ignored by Git. Releases attach the generated bundle alongside
`manifest.json` and `styles.css`.

## Working style

- Use strict TypeScript and explicit types at module boundaries.
- Avoid `any`; narrow `unknown` values before use.
- Give each new class a short responsibility docblock and each function a concise intent comment.
- Keep process state transitions centralized and deterministic.
- Never interpolate package script names into a shell string on POSIX.
- Revalidate commands after asynchronous confirmation dialogs.
- Preserve complete process-tree termination on Windows, macOS, and Linux.
- Keep security warnings factual and avoid implying that confirmation provides a sandbox.
- Update documentation for visible behavior or settings.

## Quality checks

Run the same checks as CI:

```bash
npm run validate:manifest
npm run typecheck
npm run lint
npm test
npm run build
```

Unit tests cover command construction, package-manager detection, cross-source identity, README parsing, process launch and termination,
output normalization, trust fingerprints, and persisted setting validation. UI behavior still requires a manual
Obsidian check.

## Manual checklist

- Start and stop a package script from a folder context menu.
- Run a single-line and multi-line README block.
- Start the same command from the menu and README and verify that both surfaces show one shared Stop action.
- Confirm, remember, and reset a command approval.
- Verify sidebar state, recent output, stop, restart, and session history.
- Disable automatic sidebar opening and security warnings independently.
- Toggle automatic README reading mode and manually switch back to editing.
- Reload the plugin with an active process and verify that the process tree stops.
- Close Obsidian normally with an active process and verify that shutdown waits for termination.

## Contribution checklist

- [ ] The change has a focused purpose.
- [ ] Affected pure behavior has tests.
- [ ] Security and lifecycle implications were reviewed.
- [ ] Manifest validation, typecheck, lint, tests, and production build pass.
- [ ] README and FEATURES are current.
- [ ] Manual UI checks were completed when applicable.
- [ ] `git diff --check` reports no whitespace errors.
