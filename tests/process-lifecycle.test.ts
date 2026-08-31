import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_PROCESS_HISTORY_ENTRIES,
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
  const defaultLimitEntries = Array.from(
    { length: MAX_PROCESS_HISTORY_ENTRIES + 1 },
    (_, index) => ({ id: String(index).padStart(2, "0"), finishedAt: index })
  );
  assert.deepEqual(selectHistoryEntriesToEvict(defaultLimitEntries), ["00"]);
});
