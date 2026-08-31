import { createHash } from "node:crypto";

interface ExecutableFence {
  length: number;
  marker: "`" | "~";
}

/** Parses a supported README opening fence without accepting language prefixes. */
function readExecutableFence(line: string): ExecutableFence | null {
  const match = line.match(/^(`{3,}|~{3,})(?:bash|sh|shell|zsh)(?:\s+.*)?$/i);
  const fence = match?.[1];
  if (fence === undefined) {
    return null;
  }
  return {
    length: fence.length,
    marker: fence[0] as "`" | "~"
  };
}

/** Checks whether a line closes the matching fence with sufficient width. */
function isClosingFence(line: string, openingFence: ExecutableFence): boolean {
  const match = line.match(/^(`+|~+)\s*$/);
  const fence = match?.[1];
  return fence !== undefined
    && fence[0] === openingFence.marker
    && fence.length >= openingFence.length;
}

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
  const lines = contents.replace(/\r\n?/g, "\n").split("\n");
  const commands: string[] = [];
  for (let openingIndex = 0; openingIndex < lines.length; openingIndex += 1) {
    const openingFence = readExecutableFence(lines[openingIndex] ?? "");
    if (openingFence === null) {
      continue;
    }
    for (let closingIndex = openingIndex + 1; closingIndex < lines.length; closingIndex += 1) {
      if (!isClosingFence(lines[closingIndex] ?? "", openingFence)) {
        continue;
      }
      const command = normalizeReadmeCommand(lines.slice(openingIndex + 1, closingIndex).join("\n"));
      if (command.length > 0) {
        commands.push(command);
      }
      openingIndex = closingIndex;
      break;
    }
  }
  return commands;
}
