import assert from "node:assert/strict";
import { test } from "node:test";
import { appendOutputTail } from "../src/output-buffer.ts";

test("appends text and buffer output", () => {
  const text = appendOutputTail("first\n", Buffer.from("second\n"), 100);

  assert.equal(text, "first\nsecond\n");
});

test("removes ANSI sequences and normalizes carriage returns", () => {
  const text = appendOutputTail("", "\u001B[31merror\u001B[0m\rprogress", 100);

  assert.equal(text, "error\nprogress");
});

test("retains only the configured output tail", () => {
  const text = appendOutputTail("12345", "67890", 7);

  assert.equal(text, "…\n67890");
  assert.equal(text.length, 7);
});
