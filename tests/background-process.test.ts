import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import {
  createBackgroundProcessLaunch,
  createShellProcessLaunch,
  createWindowsStopLaunch,
  spawnBackgroundProcess,
  resolveShellExecutable,
  stopBackgroundProcess
} from "../src/background-process.ts";

test("creates a hidden direct process launch in the selected working directory", () => {
  const launch = createBackgroundProcessLaunch(
    { executable: "npm", args: ["run", "test:a11y"] },
    "/vault/Project Folder",
    "linux"
  );

  assert.deepEqual(launch, {
    command: "npm",
    args: ["run", "test:a11y"],
    options: {
      cwd: "/vault/Project Folder",
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  });
});

test("keeps Windows processes attached for taskkill tree termination", () => {
  const launch = createBackgroundProcessLaunch(
    { executable: "npm", args: ["run", "dev"] },
    "C:\\vault",
    "win32"
  );

  assert.deepEqual(launch, {
    command: "cmd.exe",
    args: ["/d", "/c", "npm \"run\" \"dev\""],
    options: {
      cwd: "C:\\vault",
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsVerbatimArguments: true,
      windowsHide: true
    }
  });
  assert.deepEqual(createWindowsStopLaunch(1234), {
    command: "taskkill.exe",
    args: ["/pid", "1234", "/T", "/F"]
  });
});

test("creates a shell launch for multi-line README commands", () => {
  assert.deepEqual(createShellProcessLaunch("npm install\nnpm run dev", "/vault/site", "linux", "/bin/bash"), {
    command: "/bin/bash",
    args: ["-lc", "npm install\nnpm run dev"],
    options: {
      cwd: "/vault/site",
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  });
  assert.equal(resolveShellExecutable("linux", "  /bin/zsh  "), "/bin/zsh");
  assert.equal(resolveShellExecutable("linux", ""), "/bin/bash");
  assert.equal(resolveShellExecutable("win32", "/bin/zsh"), "cmd.exe");
  assert.deepEqual(createShellProcessLaunch("npm run dev", "C:\\vault", "win32"), {
    command: "cmd.exe",
    args: ["/d", "/c", "npm run dev"],
    options: {
      cwd: "C:\\vault",
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsVerbatimArguments: true,
      windowsHide: true
    }
  });
});

test("exposes background process output through pipes", async () => {
  const launch = createBackgroundProcessLaunch(
    { executable: "node", args: ["-e", "console.log('ready')"] },
    process.cwd(),
    process.platform
  );
  const child = spawnBackgroundProcess(launch);
  const chunks: string[] = [];
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    chunks.push(chunk);
  });

  await once(child, "close");

  assert.equal(chunks.join(""), "ready\n");
});

test("stops a detached POSIX background process", { skip: process.platform === "win32" }, async () => {
  const launch = createBackgroundProcessLaunch(
    { executable: process.execPath, args: ["-e", "setInterval(() => {}, 1_000)"] },
    process.cwd(),
    process.platform
  );
  const child = spawnBackgroundProcess(launch);
  await once(child, "spawn");

  await stopBackgroundProcess(child, process.platform, 1_000);

  assert.equal(child.signalCode, "SIGTERM");
});

test("stops a Windows background process tree", { skip: process.platform !== "win32" }, async () => {
  const launch = createBackgroundProcessLaunch(
    { executable: "node", args: ["-e", "setInterval(() => {}, 1_000)"] },
    process.cwd(),
    "win32"
  );
  const child = spawnBackgroundProcess(launch);
  await once(child, "spawn");

  await stopBackgroundProcess(child, "win32", 1_000);
  if (child.exitCode === null && child.signalCode === null) {
    await once(child, "close");
  }

  assert.equal(child.exitCode !== null || child.signalCode !== null, true);
});
