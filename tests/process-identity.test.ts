import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createArgvProcessIdentity,
  createShellProcessIdentity
} from "../src/process-identity.ts";

test("matches a README package command to the equivalent direct package launch", () => {
  const direct = createArgvProcessIdentity("/vault/project", "npm", ["run", "dev"]);

  assert.equal(createShellProcessIdentity("/vault/project", "npm run dev"), direct);
  assert.equal(createShellProcessIdentity("/vault/project", " 'npm'   \"run\" dev "), direct);
});

test("keeps different working directories and commands separate", () => {
  const direct = createArgvProcessIdentity("/vault/project", "npm", ["run", "dev"]);

  assert.notEqual(createShellProcessIdentity("/vault/other", "npm run dev"), direct);
  assert.notEqual(createShellProcessIdentity("/vault/project", "npm run build"), direct);
});

test("keeps compound and multi-line shell blocks separate from direct launches", () => {
  const direct = createArgvProcessIdentity("/vault/project", "npm", ["run", "dev"]);

  assert.notEqual(createShellProcessIdentity("/vault/project", "npm run dev && echo ready"), direct);
  assert.notEqual(createShellProcessIdentity("/vault/project", "npm install\nnpm run dev"), direct);
});
