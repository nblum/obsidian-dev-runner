import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SETTINGS,
  readDevRunnerSettings
} from "../src/settings.ts";

test("uses secure interaction defaults for missing settings", () => {
  assert.deepEqual(readDevRunnerSettings(null), DEFAULT_SETTINGS);
});

test("loads persisted warning and sidebar options", () => {
  const settings = readDevRunnerSettings({
    disableSecurityWarnings: true,
    language: "en",
    openProcessViewOnInteraction: false,
    openReadmesInPreview: false,
    packageManager: "pnpm",
    trustedScriptKeys: []
  });

  assert.equal(settings.disableSecurityWarnings, true);
  assert.equal(settings.language, "en");
  assert.equal(settings.openProcessViewOnInteraction, false);
  assert.equal(settings.openReadmesInPreview, false);
  assert.equal(settings.packageManager, "pnpm");
});

test("rejects invalid boolean option values", () => {
  const settings = readDevRunnerSettings({
    disableSecurityWarnings: "true",
    language: "fr",
    openProcessViewOnInteraction: 0,
    openReadmesInPreview: "yes"
  });

  assert.equal(settings.disableSecurityWarnings, false);
  assert.equal(settings.language, "auto");
  assert.equal(settings.openProcessViewOnInteraction, true);
  assert.equal(settings.openReadmesInPreview, true);
});
