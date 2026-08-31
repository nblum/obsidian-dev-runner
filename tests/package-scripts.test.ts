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
