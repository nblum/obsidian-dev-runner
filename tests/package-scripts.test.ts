import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRunCommand,
  detectPackageManager,
  formatRunCommand,
  formatRunCommandForPlatform,
  formatWindowsRunCommand,
  isPackageManagerSetting,
  parsePackageMetadata
} from "../src/package-scripts.ts";

interface ReleaseScriptModule {
  updateChangelog(contents: string, version: string, date: string): string;
  validateRemoteTagLookup(status: number | null, stderr: string, version: string): void;
}

/** Loads the release helper through its runtime module boundary. */
async function loadReleaseScript(): Promise<ReleaseScriptModule> {
  const moduleUrl = new URL("../scripts/release.mjs", import.meta.url).href;
  const imported: unknown = await import(moduleUrl);
  if (typeof imported !== "object" || imported === null
    || !("updateChangelog" in imported)
    || typeof imported.updateChangelog !== "function"
    || !("validateRemoteTagLookup" in imported)
    || typeof imported.validateRemoteTagLookup !== "function") {
    throw new Error("Release script does not export its tested helpers.");
  }
  return imported as ReleaseScriptModule;
}

test("parses and sorts non-empty string scripts", () => {
  const metadata = parsePackageMetadata(JSON.stringify({
    packageManager: "pnpm@10.0.0",
    scripts: { test: "vitest", empty: "", build: "astro build", invalid: false }
  }));

  assert.deepEqual(metadata, {
    packageManager: "pnpm@10.0.0",
    scripts: [
      { name: "build", command: "astro build" },
      { name: "test", command: "vitest" }
    ]
  });
});

test("returns null for invalid package JSON or a missing scripts object", () => {
  assert.equal(parsePackageMetadata("{"), null);
  assert.equal(parsePackageMetadata('{"name":"demo"}'), null);
});

test("detects package managers from the declared version before lockfiles", () => {
  assert.equal(detectPackageManager("auto", "yarn@4.6.0", new Set(["pnpm-lock.yaml"])), "yarn");
});

test("detects lockfiles and falls back to npm", () => {
  assert.equal(detectPackageManager("auto", null, new Set(["bun.lock"])), "bun");
  assert.equal(detectPackageManager("auto", null, new Set()), "npm");
});

test("honors an explicitly configured package manager", () => {
  assert.equal(detectPackageManager("pnpm", "npm@11.0.0", new Set()), "pnpm");
});

test("rejects invalid persisted package-manager settings", () => {
  assert.equal(isPackageManagerSetting("pnpm"), true);
  assert.equal(isPackageManagerSetting("deno"), false);
});

test("quotes script names as a single shell argument", () => {
  const command = buildRunCommand("npm", "test:a11y's");
  assert.equal(formatRunCommand(command), `'npm' 'run' 'test:a11y'"'"'s'`);
});

test("formats a Windows package command without POSIX quotes", () => {
  const command = buildRunCommand("npm", "test:a11y");
  assert.equal(formatWindowsRunCommand(command), 'npm "run" "test:a11y"');
  assert.equal(formatRunCommandForPlatform(command, "win32"), 'npm "run" "test:a11y"');
});

test("promotes Unreleased changelog notes into a dated release", async () => {
  const releaseScript = await loadReleaseScript();
  const changelog = "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Fixed release metadata.\n\n## [0.1.2] - 2026-08-31\n";

  assert.equal(
    releaseScript.updateChangelog(changelog, "0.1.3", "2026-09-01"),
    "# Changelog\n\n## [Unreleased]\n\n## [0.1.3] - 2026-09-01\n\n### Fixed\n\n- Fixed release metadata.\n\n## [0.1.2] - 2026-08-31\n"
  );
  assert.throws(
    () => releaseScript.updateChangelog("# Changelog\n\n## [Unreleased]\n\n## [0.1.2] - 2026-08-31\n", "0.1.3", "2026-09-01"),
    /must contain release notes/
  );
});

test("distinguishes an available remote tag from conflicts and lookup failures", async () => {
  const releaseScript = await loadReleaseScript();

  assert.doesNotThrow(() => releaseScript.validateRemoteTagLookup(2, "", "0.1.3"));
  assert.throws(
    () => releaseScript.validateRemoteTagLookup(0, "", "0.1.3"),
    /already exists on origin/
  );
  assert.throws(
    () => releaseScript.validateRemoteTagLookup(128, "network unavailable", "0.1.3"),
    /network unavailable/
  );
});
