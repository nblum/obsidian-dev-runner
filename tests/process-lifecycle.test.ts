import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveFinalProcessStatus,
  selectHistoryEntriesToEvict
} from "../src/process-lifecycle.ts";

test("keeps an explicit stop status after a termination error", () => {
  assert.equal(resolveFinalProcessStatus(true, 1), "stopped");
  assert.equal(resolveFinalProcessStatus(false, 0), "completed");
  assert.equal(resolveFinalProcessStatus(false, null), "failed");
});

test("evicts the oldest history entries with deterministic tie breaking", () => {
  const entries = [
    { id: "new", finishedAt: 20 },
    { id: "old-b", finishedAt: 10 },
    { id: "old-a", finishedAt: 10 }
  ];

  assert.deepEqual(selectHistoryEntriesToEvict(entries, 1), ["old-a", "old-b"]);
  assert.deepEqual(selectHistoryEntriesToEvict(entries, 10), []);
});
