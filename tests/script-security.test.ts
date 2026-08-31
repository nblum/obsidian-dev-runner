import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createProjectFingerprint,
  createScriptTrustKey,
  readScriptTrustKeys
} from "../src/script-security.ts";

test("creates stable trust keys for unchanged script definitions", () => {
  const details = {
    command: "astro dev",
    directoryPath: "/vault/site",
    packageManager: "npm",
    projectFingerprint: "project-v1",
    scriptName: "dev"
  };

  assert.equal(createScriptTrustKey(details), createScriptTrustKey(details));
  assert.notEqual(createScriptTrustKey(details), createScriptTrustKey({ ...details, command: "astro build" }));
  assert.notEqual(createScriptTrustKey(details), createScriptTrustKey({ ...details, directoryPath: "/vault/other" }));
  assert.notEqual(createScriptTrustKey(details), createScriptTrustKey({ ...details, projectFingerprint: "project-v2" }));
});

test("fingerprints project files independently of their input order", () => {
  const packageFile = { name: "package.json", contents: Buffer.from("{}") };
  const lockFile = { name: "package-lock.json", contents: Buffer.from("lock") };

  assert.equal(
    createProjectFingerprint([packageFile, lockFile]),
    createProjectFingerprint([lockFile, packageFile])
  );
  assert.notEqual(
    createProjectFingerprint([packageFile, lockFile]),
    createProjectFingerprint([packageFile, { ...lockFile, contents: Buffer.from("changed") }])
  );
});

test("validates and sorts persisted trust keys", () => {
  const first = "a".repeat(64);
  const second = "b".repeat(64);

  assert.deepEqual(readScriptTrustKeys([second, "invalid", first, second, false]), [first, second]);
  assert.deepEqual(readScriptTrustKeys(null), []);
});
