import { createHash } from "node:crypto";

const EXECUTABLE_FENCE_PATTERN = /^(`{3,}|~{3,})(?:bash|sh|shell|zsh)[^\n]*\n([\s\S]*?)^\1\s*$/gim;

/** Returns whether a vault path points to a README Markdown file. */
export function isReadmePath(sourcePath: string): boolean {
  const filename = sourcePath.split("/").pop();
  return filename?.toLowerCase() === "readme.md";
}

/** Normalizes rendered and source commands to the same line endings. */
export function normalizeReadmeCommand(command: string): string {
  return command.replace(/\r\n?/g, "\n").trim();
}

/** Creates a stable process key for one README path and command block. */
export function createReadmeCommandKey(sourcePath: string, command: string): string {
  const digest = createHash("sha256").update(command).digest("hex");
  return `readme:${sourcePath}\u0000${digest}`;
}

/** Creates a concise label from the first non-empty command line. */
export function createReadmeCommandLabel(command: string, fallbackLabel = "Command"): string {
  const firstLine = command.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? fallbackLabel;
  const suffix = command.includes("\n") ? " …" : "";
  const maxLength = 56 - suffix.length;
  return `README: ${firstLine.length > maxLength ? `${firstLine.slice(0, maxLength - 1)}…` : firstLine}${suffix}`;
}

/** Extracts executable shell command blocks from README Markdown source. */
export function parseExecutableReadmeCommands(contents: string): string[] {
  return [...contents.matchAll(EXECUTABLE_FENCE_PATTERN)]
    .map((match) => normalizeReadmeCommand(match[2] ?? ""))
    .filter((command) => command.length > 0);
}
