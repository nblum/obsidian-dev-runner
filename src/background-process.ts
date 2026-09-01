import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  clearTimeout as clearNodeTimeout,
  setTimeout as setNodeTimeout
} from "node:timers";

const STOP_TIMEOUT_MS = 3_000;
const WINDOWS_STOP_ATTEMPTS = 2;
const processStartIdentities = new WeakMap<ChildProcess, string>();

export interface ProcessCommand {
  executable: string;
  args: readonly string[];
}

export interface BackgroundProcessLaunch {
  command: string;
  args: string[];
  options: {
    cwd: string;
    detached: boolean;
    stdio: ["ignore", "pipe", "pipe"];
    windowsVerbatimArguments?: boolean;
    windowsHide: boolean;
  };
}

export interface StopProcessLaunch {
  command: string;
  args: string[];
}

/** Formats a fixed command and its arguments for execution by Windows cmd.exe. */
function formatWindowsCommand(command: ProcessCommand): string {
  const quotedArgs = command.args.map((argument) => `"${argument.replaceAll("%", "%%").replaceAll('"', '""')}"`);
  return [command.executable, ...quotedArgs].join(" ");
}

/** Creates a hidden platform-specific launch without opening a terminal window. */
export function createBackgroundProcessLaunch(
  command: ProcessCommand,
  cwd: string,
  platform: NodeJS.Platform = process.platform
): BackgroundProcessLaunch {
  if (platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/c", formatWindowsCommand(command)],
      options: {
        cwd,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
        // cmd.exe must receive its command string without Node's C-runtime escaping.
        windowsVerbatimArguments: true,
        windowsHide: true
      }
    };
  }

  return {
    command: command.executable,
    args: [...command.args],
    options: {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  };
}

/** Creates a hidden shell launch for a confirmed multi-line README command block. */
export function createShellProcessLaunch(
  command: string,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  userShell: string | undefined = process.env.SHELL
): BackgroundProcessLaunch {
  const shell = resolveShellExecutable(platform, userShell);
  if (platform === "win32") {
    return {
      command: shell,
      args: ["/d", "/c", command],
      options: {
        cwd,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
        // Preserve shell quoting because cmd.exe does not interpret backslash escapes.
        windowsVerbatimArguments: true,
        windowsHide: true
      }
    };
  }

  return {
    command: shell,
    args: ["-lc", command],
    options: {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  };
}

/** Resolves the exact shell executable used for README commands and trust keys. */
export function resolveShellExecutable(
  platform: NodeJS.Platform = process.platform,
  userShell: string | undefined = process.env.SHELL
): string {
  if (platform === "win32") {
    return "cmd.exe";
  }
  const configuredShell = userShell?.trim();
  return configuredShell !== undefined && configuredShell.length > 0
    ? configuredShell
    : "/bin/bash";
}

/** Starts a background process that remains attached to the plugin lifecycle. */
export function spawnBackgroundProcess(launch: BackgroundProcessLaunch): ChildProcess {
  const child = spawn(launch.command, launch.args, launch.options);
  const pid = child.pid;
  if (pid !== undefined && process.platform !== "win32") {
    const identity = readProcessStartIdentity(pid, process.platform);
    if (identity !== null) {
      processStartIdentities.set(child, identity);
    }
  }
  return child;
}

/** Builds the Windows command used to terminate a process and all descendants. */
export function createWindowsStopLaunch(pid: number): StopProcessLaunch {
  return {
    command: "taskkill.exe",
    args: ["/pid", String(pid), "/T", "/F"]
  };
}

/** Returns whether a spawned process has not reported an exit status or signal yet. */
function isProcessRunning(child: ChildProcess): boolean {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

/** Starts a renderer-owned timeout with a Node fallback for unit tests. */
function setProcessTimeout(callback: () => void, timeoutMs: number): number {
  if (typeof window === "undefined") {
    return Number(setNodeTimeout(callback, timeoutMs));
  }
  return window.setTimeout(callback, timeoutMs);
}

/** Clears a process timeout through the host that created it. */
function clearProcessTimeout(timeout: number): void {
  if (typeof window === "undefined") {
    clearNodeTimeout(timeout);
    return;
  }
  window.clearTimeout(timeout);
}

/** Waits briefly for a process close event and reports whether it exited in time. */
function waitForProcessClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (!isProcessRunning(child)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const onClose = (): void => {
      clearProcessTimeout(timeout);
      resolve(true);
    };
    const timeout = setProcessTimeout(() => {
      child.removeListener("close", onClose);
      resolve(!isProcessRunning(child));
    }, timeoutMs);
    child.once("close", onClose);
  });
}

/** Reads an OS start marker that changes when a PID is reused. */
function readProcessStartIdentity(pid: number, platform: NodeJS.Platform): string | null {
  if (platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
      const startTime = fields[19];
      return startTime === undefined ? null : `${String(pid)}:${startTime}`;
    } catch {
      return null;
    }
  }
  if (platform === "win32") {
    return null;
  }
  const result = spawnSync("ps", ["-o", "lstart=", "-o", "pgid=", "-p", String(pid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true
  });
  const marker = result.status === 0 ? result.stdout.trim() : "";
  return marker.length > 0 ? `${String(pid)}:${marker}` : null;
}

/** Confirms that a detached process-group leader still has its original OS identity. */
function isOriginalProcessGroup(child: ChildProcess, pid: number, platform: NodeJS.Platform): boolean {
  const expectedIdentity = processStartIdentities.get(child);
  if (expectedIdentity === undefined) {
    return false;
  }
  return readProcessStartIdentity(pid, platform) === expectedIdentity;
}

/** Signals only the verified detached POSIX process group. */
function signalProcessGroup(
  child: ChildProcess,
  pid: number,
  signal: NodeJS.Signals,
  platform: NodeJS.Platform
): void {
  if (!isOriginalProcessGroup(child, pid, platform)) {
    if (!isProcessRunning(child)) {
      return;
    }
    throw new Error(`Process group ${String(pid)} changed identity before termination.`);
  }
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

/** Runs the Windows process-tree termination command and returns its exit code. */
function runWindowsStopCommand(launch: StopProcessLaunch): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const terminator = spawn(launch.command, launch.args, {
      stdio: "ignore",
      windowsHide: true
    });
    terminator.once("error", reject);
    terminator.once("close", resolve);
  });
}

/** Stops a managed process tree, escalating to SIGKILL on POSIX after a timeout. */
export async function stopBackgroundProcess(
  child: ChildProcess,
  platform: NodeJS.Platform = process.platform,
  timeoutMs: number = STOP_TIMEOUT_MS
): Promise<void> {
  if (!isProcessRunning(child)) {
    return;
  }
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }

  if (platform === "win32") {
    let exitCode: number | null = null;
    for (let attempt = 0; attempt < WINDOWS_STOP_ATTEMPTS && isProcessRunning(child); attempt += 1) {
      exitCode = await runWindowsStopCommand(createWindowsStopLaunch(pid));
      if (exitCode === 0 || await waitForProcessClose(child, timeoutMs)) {
        return;
      }
    }
    if (isProcessRunning(child)) {
      throw new Error(`taskkill.exe exited with code ${String(exitCode)}.`);
    }
    return;
  }

  signalProcessGroup(child, pid, "SIGTERM", platform);
  if (await waitForProcessClose(child, timeoutMs)) {
    return;
  }

  signalProcessGroup(child, pid, "SIGKILL", platform);
  if (!(await waitForProcessClose(child, timeoutMs))) {
    throw new Error(`Process group ${String(pid)} could not be stopped.`);
  }
}
