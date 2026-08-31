import { resolve } from "node:path";

const UNSAFE_UNQUOTED_CHARACTERS = new Set(["&", "|", ";", "<", ">", "(", ")", "$", "`", "#", "*", "?", "[", "]"]);

/** Parses one shell line only when it contains a plain executable and literal arguments. */
function parseLiteralShellArguments(command: string): string[] | null {
  if (command.includes("\n") || command.includes("\r")) {
    return null;
  }

  const argumentsList: string[] = [];
  let current = "";
  let quote: "single" | "double" | null = null;
  let escaping = false;
  let tokenStarted = false;

  for (const character of command.trim()) {
    if (escaping) {
      current += character;
      escaping = false;
      tokenStarted = true;
      continue;
    }
    if (quote === "single") {
      if (character === "'") {
        quote = null;
      } else {
        current += character;
      }
      tokenStarted = true;
      continue;
    }
    if (quote === "double") {
      if (character === '"') {
        quote = null;
      } else if (character === "\\") {
        escaping = true;
      } else if (character === "$" || character === "`") {
        return null;
      } else {
        current += character;
      }
      tokenStarted = true;
      continue;
    }
    if (character === "\\") {
      escaping = true;
      tokenStarted = true;
      continue;
    }
    if (character === "'") {
      quote = "single";
      tokenStarted = true;
      continue;
    }
    if (character === '"') {
      quote = "double";
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (tokenStarted) {
        argumentsList.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }
    if (UNSAFE_UNQUOTED_CHARACTERS.has(character)) {
      return null;
    }
    current += character;
    tokenStarted = true;
  }

  if (escaping || quote !== null) {
    return null;
  }
  if (tokenStarted) {
    argumentsList.push(current);
  }
  return argumentsList.length > 0 ? argumentsList : null;
}

/** Creates one stable identity for a direct executable and literal arguments. */
export function createArgvProcessIdentity(
  directoryPath: string,
  executable: string,
  args: readonly string[]
): string {
  return JSON.stringify([resolve(directoryPath), "argv", executable, ...args]);
}

/** Creates a shell identity that matches a direct launch only for a plain literal command. */
export function createShellProcessIdentity(directoryPath: string, command: string): string {
  const normalizedCommand = command.replace(/\r\n?/g, "\n").trim();
  const literalArguments = parseLiteralShellArguments(normalizedCommand);
  if (literalArguments !== null) {
    const [executable, ...args] = literalArguments;
    if (executable !== undefined) {
      return createArgvProcessIdentity(directoryPath, executable, args);
    }
  }
  return JSON.stringify([resolve(directoryPath), "shell", normalizedCommand]);
}
