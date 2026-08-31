export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type PackageManagerSetting = "auto" | PackageManager;

export interface PackageScript {
  name: string;
  command: string;
}

export interface PackageMetadata {
  packageManager: string | null;
  scripts: PackageScript[];
}

export interface RunCommand {
  executable: PackageManager;
  args: string[];
}

/** Checks whether a persisted value is a supported package-manager setting. */
export function isPackageManagerSetting(value: unknown): value is PackageManagerSetting {
  return value === "auto" || value === "npm" || value === "pnpm" || value === "yarn" || value === "bun";
}

/** Checks whether a parsed JSON value can be read as a key-value object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses the package metadata needed to render and run package scripts. */
export function parsePackageMetadata(contents: string): PackageMetadata | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.scripts)) {
    return null;
  }

  const scripts = Object.entries(parsed.scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
    .map(([name, command]) => ({ name, command }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

  return {
    packageManager: typeof parsed.packageManager === "string" ? parsed.packageManager : null,
    scripts
  };
}

/** Selects the configured package manager or detects one from package metadata and lockfiles. */
export function detectPackageManager(
  setting: PackageManagerSetting,
  declaredPackageManager: string | null,
  existingFiles: ReadonlySet<string>
): PackageManager {
  if (setting !== "auto") {
    return setting;
  }

  const declaredName = declaredPackageManager?.split("@", 1)[0];
  if (declaredName === "npm" || declaredName === "pnpm" || declaredName === "yarn" || declaredName === "bun") {
    return declaredName;
  }
  if (existingFiles.has("pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (existingFiles.has("yarn.lock")) {
    return "yarn";
  }
  if (existingFiles.has("bun.lock") || existingFiles.has("bun.lockb")) {
    return "bun";
  }
  return "npm";
}

/** Builds the argument vector for one package script without invoking a shell. */
export function buildRunCommand(packageManager: PackageManager, scriptName: string): RunCommand {
  return {
    executable: packageManager,
    args: ["run", scriptName]
  };
}

/** Quotes a value so it remains one literal argument in a POSIX shell command. */
export function quotePosixShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Formats a run command for display or for a safely quoted POSIX shell. */
export function formatRunCommand(command: RunCommand): string {
  return [command.executable, ...command.args].map(quotePosixShellArgument).join(" ");
}

/** Formats the fixed package command and quotes its script name for Windows cmd. */
export function formatWindowsRunCommand(command: RunCommand): string {
  const quotedArgs = command.args.map((argument) => `"${argument.replaceAll("%", "%%").replaceAll('"', '""')}"`);
  return [command.executable, ...quotedArgs].join(" ");
}

/** Formats the exact package-manager invocation for the current platform. */
export function formatRunCommandForPlatform(
  command: RunCommand,
  platform: NodeJS.Platform = process.platform
): string {
  return platform === "win32"
    ? formatWindowsRunCommand(command)
    : formatRunCommand(command);
}
