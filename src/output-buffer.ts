const ESCAPE_CHARACTER = String.fromCharCode(0x1B);
const BELL_CHARACTER = String.fromCharCode(0x07);
const ANSI_SEQUENCE_PATTERN = new RegExp(
  `${ESCAPE_CHARACTER}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BELL_CHARACTER}]*(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\))`,
  "g"
);

/** Converts supported stream chunks into displayable UTF-8 text. */
function readOutputChunk(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString("utf8");
  }
  return "";
}

/** Removes terminal control sequences and normalizes in-place carriage returns. */
function cleanOutputChunk(chunk: unknown): string {
  return readOutputChunk(chunk)
    .replace(ANSI_SEQUENCE_PATTERN, "")
    .replace(/\r(?!\n)/g, "\n");
}

/** Appends process output while retaining only the configured tail. */
export function appendOutputTail(current: string, chunk: unknown, maxLength: number): string {
  if (maxLength <= 0) {
    return "";
  }

  const combined = `${current}${cleanOutputChunk(chunk)}`;
  if (combined.length <= maxLength) {
    return combined;
  }

  const marker = "…\n";
  if (maxLength <= marker.length) {
    return combined.slice(-maxLength);
  }
  return `${marker}${combined.slice(-(maxLength - marker.length))}`;
}
