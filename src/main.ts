import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Plugin,
  TFolder,
  moment,
  type Command,
  type Menu,
  type Tasks,
  type WorkspaceLeaf
} from "obsidian";
import {
  buildRunCommand,
  detectPackageManager,
  formatRunCommandForPlatform,
  formatRunCommandLabel,
  parsePackageMetadata,
  type PackageManager,
  type PackageMetadata,
  type PackageScript
} from "./package-scripts.ts";
import {
  createBackgroundProcessLaunch,
  createShellProcessLaunch,
  resolveShellExecutable,
  spawnBackgroundProcess,
  stopBackgroundProcess
} from "./background-process.ts";
import { appendOutputTail } from "./output-buffer.ts";
import {
  createArgvProcessIdentity,
  createShellProcessIdentity
} from "./process-identity.ts";
import {
  createReadmeCommandKey,
  createReadmeCommandLabel,
  isReadmePath,
  parseExecutableReadmeCommands
} from "./readme-command-model.ts";
import {
  addReadmeCommandButtons,
  type ReadmeCommandButtonState,
  type ReadmeCommandDefinition
} from "./readme-commands.ts";
import {
  createProjectFingerprint,
  createScriptTrustKey,
  type ProjectTrustFile
} from "./script-security.ts";
import { requestScriptWarning } from "./script-warning.ts";
import { DevRunnerSettingTab } from "./settings-tab.ts";
import {
  DEFAULT_SETTINGS,
  isLanguagePreference,
  readDevRunnerSettings,
  type DevRunnerSettings
} from "./settings.ts";
import {
  createTranslator,
  resolveLanguage,
  type Language,
  type TranslationVariables,
  type Translator
} from "./i18n.ts";
import {
  DevRunnerProcessView,
  PROCESS_VIEW_TYPE,
  type ProcessViewEntry,
  type ProcessViewHost,
  type ProcessViewStatus
} from "./process-view.ts";
import {
  resolveFinalProcessStatus,
  selectHistoryEntriesToEvict,
  type FinalProcessStatus,
  type ProcessHistoryCandidate
} from "./process-lifecycle.ts";

interface ResolvedScriptDefinition {
  packageManager: PackageManager;
  script: PackageScript;
}

interface ManagedProcessRecord {
  child: ChildProcess | null;
  directoryPath: string;
  finalStatus: FinalProcessStatus | null;
  finishedAt: number | null;
  identityKey: string;
  key: string;
  label: string;
  output: string;
  pid: number | null;
  started: boolean;
  stopRequested: boolean;
  stopping: boolean;
}

interface RunningScript extends ManagedProcessRecord {
  packageManager: PackageManager;
  restartDefinition: ResolvedScriptDefinition | null;
  script: PackageScript;
}

interface RunningReadmeCommand extends ManagedProcessRecord {
  definition: ReadmeCommandDefinition;
  restarting: boolean;
}

interface ShutdownCoordinator {
  pending: Promise<void> | null;
}

/** Reads mutable stop state again after an asynchronous confirmation. */
function isProcessStopping(runningProcess: ManagedProcessRecord): boolean {
  return runningProcess.stopping;
}

/** Reads mutable completion state again after asynchronous process termination. */
function isProcessFinished(runningProcess: ManagedProcessRecord): boolean {
  return runningProcess.finalStatus !== null;
}

const SHUTDOWN_COORDINATOR_KEY = Symbol.for("obsidian-dev-runner.shutdown");

/** Returns the renderer-wide shutdown coordinator shared across plugin reloads. */
function getShutdownCoordinator(): ShutdownCoordinator {
  const windowRecord = window as unknown as Record<symbol, unknown>;
  const existing = windowRecord[SHUTDOWN_COORDINATOR_KEY];
  if (typeof existing === "object" && existing !== null && "pending" in existing) {
    const pending = existing.pending;
    if (pending === null || pending instanceof Promise) {
      return existing as ShutdownCoordinator;
    }
  }
  const coordinator: ShutdownCoordinator = { pending: null };
  windowRecord[SHUTDOWN_COORDINATOR_KEY] = coordinator;
  return coordinator;
}

const LOCKFILES = ["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"] as const;
const PROJECT_TRUST_FILES = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  ...LOCKFILES
] as const;
const README_HISTORY_PREFIX = "readme\u0000";
const SCRIPT_HISTORY_PREFIX = "script\u0000";
const MAX_OUTPUT_LENGTH = 12_000;

/** Runs project commands and manages their complete background-process lifecycle. */
export default class DevRunnerPlugin extends Plugin implements ProcessViewHost {
  preferences: DevRunnerSettings = DEFAULT_SETTINGS;
  private language: Language = "en";
  private translator: Translator = createTranslator("en");
  private readonly runningScripts = new Map<string, RunningScript>();
  private readonly readmeCommands = new Map<string, RunningReadmeCommand>();
  private readonly activeProcessesByIdentity = new Map<string, ManagedProcessRecord>();
  private readonly processChangeListeners = new Set<() => void>();
  private processViewCommand: Command | null = null;
  private ribbonIconEl: HTMLElement | null = null;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  /** Loads settings and registers the folder context menu integration. */
  override async onload(): Promise<void> {
    await getShutdownCoordinator().pending;
    await this.loadSettings();
    this.registerView(PROCESS_VIEW_TYPE, (leaf) => new DevRunnerProcessView(leaf, this));
    this.registerMarkdownPostProcessor((element, context) => {
      addReadmeCommandButtons(element, context, {
        getState: (definition) => this.getReadmeCommandButtonState(definition),
        runCommand: (definition) => { void this.runReadmeCommand(definition); },
        stopCommand: (definition) => { void this.stopReadmeCommandDefinition(definition); },
        subscribe: (listener) => this.subscribeToProcessChanges(listener),
        translate: (key, variables) => this.translate(key, variables)
      });
    });
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      this.openReadmeInPreview(leaf);
    }));
    this.app.workspace.onLayoutReady(() => {
      this.openReadmeInPreview(this.app.workspace.getMostRecentLeaf());
    });
    this.ribbonIconEl = this.addRibbonIcon("play", this.translate("ribbon.showProcesses"), () => {
      this.openProcessView();
    });
    this.processViewCommand = this.addCommand({
      id: "show-processes",
      name: this.translate("commands.showProcesses"),
      callback: () => { this.openProcessView(); }
    });
    this.addSettingTab(new DevRunnerSettingTab(this.app, this));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof TFolder) {
        this.addPackageScriptsMenu(menu, file);
      }
    }));
    this.registerEvent(this.app.workspace.on("quit", (tasks: Tasks) => {
      tasks.addPromise(this.stopAllProcesses());
    }));
  }

  /** Stops all processes that were started by this plugin before it unloads. */
  override onunload(): void {
    void this.stopAllProcesses();
    this.processChangeListeners.clear();
  }

  /** Returns sorted display snapshots for the process sidebar. */
  getProcessViewEntries(): readonly ProcessViewEntry[] {
    return [
      ...this.runningScripts.entries(),
      ...this.readmeCommands.entries()
    ]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, runningProcess]) => ({
        key,
        label: runningProcess.label,
        directoryPath: runningProcess.directoryPath,
        output: runningProcess.output,
        pid: runningProcess.pid,
        finishedAt: runningProcess.finishedAt,
        status: this.getManagedProcessStatus(runningProcess)
      }));
  }

  /** Subscribes a sidebar view to process state and output changes. */
  subscribeToProcessChanges(listener: () => void): () => void {
    this.processChangeListeners.add(listener);
    return () => { this.processChangeListeners.delete(listener); };
  }

  /** Returns the currently active UI language. */
  getLanguage(): Language {
    return this.language;
  }

  /** Translates one UI key using the active language. */
  translate(key: string, variables: TranslationVariables = {}): string {
    return this.translator(key, variables);
  }

  /** Applies a language preference and refreshes localized runtime labels. */
  updateLanguage(preference: string): void {
    this.preferences.language = isLanguagePreference(preference) ? preference : "auto";
    this.language = resolveLanguage(this.preferences.language, moment.locale());
    this.translator = createTranslator(this.language);
    this.updateLocalizedLabels();
    this.notifyProcessChanges();
  }

  /** Updates labels retained by Obsidian outside rendered plugin views. */
  private updateLocalizedLabels(): void {
    if (this.processViewCommand !== null) {
      this.processViewCommand.name = this.translate("commands.showProcesses");
    }
    const ribbonLabel = this.translate("ribbon.showProcesses");
    this.ribbonIconEl?.setAttribute("aria-label", ribbonLabel);
    this.ribbonIconEl?.setAttribute("title", ribbonLabel);
  }

  /** Stops one managed process selected from a menu or sidebar. */
  async stopProcess(key: string): Promise<void> {
    const runningScript = this.runningScripts.get(key);
    if (runningScript === undefined) {
      await this.stopReadmeCommand(key);
      return;
    }
    if (runningScript.finalStatus !== null || runningScript.stopping) {
      return;
    }
    const child = runningScript.child;
    if (child === null) {
      return;
    }

    runningScript.stopping = true;
    runningScript.stopRequested = true;
    runningScript.restartDefinition = null;
    this.notifyProcessChanges();
    this.openProcessViewForInteraction();
    new Notice(this.translate("notice.processStopping", { label: runningScript.label }));
    try {
      await stopBackgroundProcess(child);
    } catch (error) {
      if (this.runningScripts.get(key) !== runningScript || isProcessFinished(runningScript)) {
        return;
      }
      runningScript.stopping = false;
      this.notifyProcessChanges();
      console.error("Dev Runner konnte das Skript nicht beenden.", error);
      new Notice(this.translate("notice.processStopFailed", { label: runningScript.label }));
    }
  }

  /** Stops and starts one managed process with the same command and directory. */
  async restartProcess(key: string): Promise<void> {
    const runningScript = this.runningScripts.get(key);
    if (runningScript === undefined) {
      await this.restartReadmeCommand(key);
      return;
    }
    if (runningScript.stopping) {
      return;
    }
    let definition = this.resolveCurrentScript(runningScript.directoryPath, runningScript.script.name);
    if (definition === null) {
      new Notice(this.translate("notice.scriptMissing", { name: runningScript.script.name }));
      return;
    }
    if (!(await this.confirmScriptRun(
      runningScript.directoryPath,
      definition.packageManager,
      definition.script
    ))) {
      return;
    }
    definition = this.resolveCurrentScript(runningScript.directoryPath, runningScript.script.name);
    if (definition === null) {
      new Notice(this.translate("notice.scriptMissing", { name: runningScript.script.name }));
      return;
    }
    if (this.runningScripts.get(key) !== runningScript || isProcessStopping(runningScript)) {
      return;
    }
    const identityKey = this.createScriptIdentity(
      runningScript.directoryPath,
      definition.packageManager,
      definition.script.name
    );
    const conflictingProcess = this.activeProcessesByIdentity.get(identityKey);
    if (conflictingProcess !== undefined && conflictingProcess !== runningScript) {
      new Notice(this.translate("notice.alreadyRunning", { label: conflictingProcess.label }));
      return;
    }
    if (runningScript.finalStatus !== null) {
      this.startScript(runningScript.directoryPath, definition.packageManager, definition.script);
      return;
    }
    const child = runningScript.child;
    if (child === null) {
      return;
    }

    runningScript.stopping = true;
    runningScript.stopRequested = false;
    runningScript.restartDefinition = definition;
    this.notifyProcessChanges();
    this.openProcessViewForInteraction();
    new Notice(this.translate("notice.processRestarting", { label: runningScript.label }));
    try {
      await stopBackgroundProcess(child);
    } catch (error) {
      if (this.runningScripts.get(key) !== runningScript || isProcessFinished(runningScript)) {
        return;
      }
      runningScript.stopping = false;
      runningScript.restartDefinition = null;
      this.notifyProcessChanges();
      console.error("Dev Runner konnte das Skript nicht neu starten.", error);
      new Notice(this.translate("notice.processRestartFailed", { label: runningScript.label }));
    }
  }

  /** Loads persisted settings while retaining defaults for missing values. */
  async loadSettings(): Promise<void> {
    const saved: unknown = await this.loadData();
    this.preferences = readDevRunnerSettings(saved);
    this.language = resolveLanguage(this.preferences.language, moment.locale());
    this.translator = createTranslator(this.language);
  }

  /** Persists the current plugin settings. */
  async saveSettings(): Promise<void> {
    await this.saveData(this.preferences);
  }

  /** Adds one menu action per script when the selected folder contains package.json. */
  private addPackageScriptsMenu(menu: Menu, folder: TFolder): void {
    const directoryPath = this.getDirectoryPath(folder);
    if (directoryPath === null) {
      return;
    }
    const metadata = this.readPackageMetadata(directoryPath);
    if (metadata === null || metadata.scripts.length === 0) {
      return;
    }

    const packageManager = this.resolvePackageManager(directoryPath, metadata);
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(this.translate("menu.packageScripts")).setIsLabel(true));
    for (const script of metadata.scripts) {
      const runCommand = buildRunCommand(packageManager, script.name);
      const menuLabel = formatRunCommandLabel(runCommand);
      const identityKey = createArgvProcessIdentity(
        directoryPath,
        runCommand.executable,
        runCommand.args
      );
      const runningProcess = this.activeProcessesByIdentity.get(identityKey);
      menu.addItem((item) => {
        if (runningProcess !== undefined) {
          item
            .setTitle(this.translate(
              runningProcess.stopping ? "menu.stopping" : "menu.stop",
              { label: menuLabel }
            ))
            .setIcon("square")
            .setDisabled(runningProcess.stopping)
            .onClick(() => { void this.stopProcess(runningProcess.key); });
          return;
        }
        item
          .setTitle(menuLabel)
          .setIcon("play")
          .onClick(() => { void this.runScript(directoryPath, script.name); });
      });
    }
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(this.translate("menu.showProcesses"))
      .setIcon("play")
      .onClick(() => { this.openProcessView(); }));
  }

  /** Creates a stable key for one script in one project directory. */
  private createScriptKey(directoryPath: string, scriptName: string): string {
    return `${directoryPath}\u0000${scriptName}`;
  }

  /** Creates the cross-source identity for one package-manager invocation. */
  private createScriptIdentity(
    directoryPath: string,
    packageManager: PackageManager,
    scriptName: string
  ): string {
    const runCommand = buildRunCommand(packageManager, scriptName);
    return createArgvProcessIdentity(directoryPath, runCommand.executable, runCommand.args);
  }

  /** Resolves an Obsidian folder to its absolute desktop filesystem path. */
  private getDirectoryPath(folder: TFolder): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return null;
    }
    return adapter.getFullPath(folder.path);
  }

  /** Reads and validates package.json synchronously while the context menu is being built. */
  private readPackageMetadata(directoryPath: string): PackageMetadata | null {
    const packagePath = join(directoryPath, "package.json");
    if (!existsSync(packagePath)) {
      return null;
    }
    try {
      return parsePackageMetadata(readFileSync(packagePath, "utf8"));
    } catch (error) {
      console.error("Dev Runner konnte package.json nicht lesen.", error);
      return null;
    }
  }

  /** Detects the project package manager from settings, metadata, and lockfiles. */
  private resolvePackageManager(directoryPath: string, metadata: PackageMetadata): PackageManager {
    const existingLockfiles = new Set(LOCKFILES.filter((file) => existsSync(join(directoryPath, file))));
    return detectPackageManager(this.preferences.packageManager, metadata.packageManager, existingLockfiles);
  }

  /** Runs the selected script in the background and tracks it until completion. */
  private async runScript(directoryPath: string, scriptName: string): Promise<void> {
    const definition = this.resolveCurrentScript(directoryPath, scriptName);
    if (definition === null) {
      new Notice(this.translate("notice.scriptMissing", { name: scriptName }));
      return;
    }
    let { packageManager, script } = definition;
    let identityKey = this.createScriptIdentity(directoryPath, packageManager, script.name);
    const existingProcess = this.activeProcessesByIdentity.get(identityKey);
    if (existingProcess !== undefined) {
      new Notice(this.translate("notice.alreadyRunning", { label: existingProcess.label }));
      return;
    }

    if (!(await this.confirmScriptRun(directoryPath, packageManager, script))) {
      return;
    }
    const latestDefinition = this.resolveCurrentScript(directoryPath, scriptName);
    if (latestDefinition === null) {
      new Notice(this.translate("notice.scriptMissing", { name: scriptName }));
      return;
    }
    ({ packageManager, script } = latestDefinition);
    identityKey = this.createScriptIdentity(directoryPath, packageManager, script.name);
    const currentProcess = this.activeProcessesByIdentity.get(identityKey);
    if (currentProcess !== undefined) {
      new Notice(this.translate("notice.alreadyRunning", { label: currentProcess.label }));
      return;
    }
    this.startScript(directoryPath, packageManager, script);
  }

  /** Starts an already-confirmed script and replaces its previous history entry. */
  private startScript(directoryPath: string, packageManager: PackageManager, script: PackageScript): void {
    const key = this.createScriptKey(directoryPath, script.name);
    const runCommand = buildRunCommand(packageManager, script.name);
    const identityKey = createArgvProcessIdentity(directoryPath, runCommand.executable, runCommand.args);
    const label = formatRunCommandForPlatform(runCommand);
    const existingProcess = this.activeProcessesByIdentity.get(identityKey);
    if (existingProcess !== undefined) {
      new Notice(this.translate("notice.alreadyRunning", { label: existingProcess.label }));
      return;
    }

    try {
      const launch = createBackgroundProcessLaunch(runCommand, directoryPath);
      const child = spawnBackgroundProcess(launch);
      const runningScript: RunningScript = {
        child,
        directoryPath,
        finalStatus: null,
        finishedAt: null,
        identityKey,
        key,
        label,
        output: "",
        packageManager,
        pid: child.pid ?? null,
        restartDefinition: null,
        script,
        started: false,
        stopRequested: false,
        stopping: false
      };
      this.runningScripts.set(key, runningScript);
      this.registerActiveProcess(runningScript);
      this.captureProcessOutput(runningScript);
      this.notifyProcessChanges();
      this.openProcessViewForInteraction();
      child.once("spawn", () => {
        if (this.runningScripts.get(key) === runningScript) {
          runningScript.started = true;
          this.notifyProcessChanges();
          new Notice(this.translate("notice.processStarted", { label }));
        }
      });
      child.once("error", (error: Error) => {
        if (this.runningScripts.get(key) !== runningScript) {
          return;
        }
        runningScript.finalStatus = "failed";
        runningScript.finishedAt = Date.now();
        runningScript.child = null;
        runningScript.output = appendOutputTail(
          runningScript.output,
          `\n${this.translate("output.startError", { message: error.message })}\n`,
          MAX_OUTPUT_LENGTH
        );
        this.unregisterActiveProcess(runningScript);
        this.pruneProcessHistory();
        this.notifyProcessChanges();
        console.error("Dev Runner konnte das Skript nicht starten.", error);
        new Notice(this.translate("notice.processStartFailed", { label }));
      });
      child.once("close", (code, signal) => {
        this.handleProcessClose(runningScript, code, signal);
      });
    } catch (error) {
      console.error("Dev Runner konnte das Skript nicht starten.", error);
      new Notice(this.translate("notice.processStartFailed", { label }));
    }
  }

  /** Returns the shared action state for one rendered README command button. */
  private getReadmeCommandButtonState(definition: ReadmeCommandDefinition): ReadmeCommandButtonState {
    const directoryPath = this.getReadmeCommandDirectory(definition);
    if (directoryPath === null) {
      return "run";
    }
    const identityKey = createShellProcessIdentity(directoryPath, definition.command);
    const runningProcess = this.activeProcessesByIdentity.get(identityKey);
    if (runningProcess === undefined) {
      return "run";
    }
    return runningProcess.stopping ? "stopping" : "stop";
  }

  /** Stops the active cross-source process represented by a README command. */
  private async stopReadmeCommandDefinition(definition: ReadmeCommandDefinition): Promise<void> {
    const directoryPath = this.getReadmeCommandDirectory(definition);
    if (directoryPath === null) {
      return;
    }
    const identityKey = createShellProcessIdentity(directoryPath, definition.command);
    const runningProcess = this.activeProcessesByIdentity.get(identityKey);
    if (runningProcess !== undefined) {
      await this.stopProcess(runningProcess.key);
    }
  }

  /** Confirms and starts one executable shell block rendered from a README. */
  private async runReadmeCommand(definition: ReadmeCommandDefinition): Promise<void> {
    const directoryPath = this.resolveReadmeCommandDirectory(definition);
    if (directoryPath === null) {
      new Notice(this.translate("notice.readmeMissing"));
      return;
    }
    const identityKey = createShellProcessIdentity(directoryPath, definition.command);
    const existingProcess = this.activeProcessesByIdentity.get(identityKey);
    if (existingProcess !== undefined) {
      new Notice(this.translate("notice.alreadyRunning", { label: existingProcess.label }));
      return;
    }
    if (!(await this.confirmReadmeCommand(directoryPath, definition))) {
      return;
    }
    if (this.resolveReadmeCommandDirectory(definition) === null) {
      new Notice(this.translate("notice.readmeChanged"));
      return;
    }
    const currentProcess = this.activeProcessesByIdentity.get(identityKey);
    if (currentProcess !== undefined) {
      new Notice(this.translate("notice.alreadyRunning", { label: currentProcess.label }));
      return;
    }
    this.startReadmeCommand(directoryPath, definition);
  }

  /** Starts an already-confirmed README shell block in its project directory. */
  private startReadmeCommand(directoryPath: string, definition: ReadmeCommandDefinition): void {
    const key = createReadmeCommandKey(definition.sourcePath, definition.command);
    const identityKey = createShellProcessIdentity(directoryPath, definition.command);
    const label = createReadmeCommandLabel(
      definition.command,
      this.translate("readme.commandFallback")
    );
    const existingProcess = this.activeProcessesByIdentity.get(identityKey);
    if (existingProcess !== undefined) {
      new Notice(this.translate("notice.alreadyRunning", { label: existingProcess.label }));
      return;
    }
    try {
      const launch = createShellProcessLaunch(definition.command, directoryPath);
      const child = spawnBackgroundProcess(launch);
      const runningCommand: RunningReadmeCommand = {
        child,
        definition,
        directoryPath,
        finalStatus: null,
        finishedAt: null,
        identityKey,
        key,
        label,
        output: "",
        pid: child.pid ?? null,
        restarting: false,
        started: false,
        stopRequested: false,
        stopping: false
      };
      this.readmeCommands.set(key, runningCommand);
      this.registerActiveProcess(runningCommand);
      this.captureProcessOutput(runningCommand);
      this.notifyProcessChanges();
      this.openProcessViewForInteraction();
      child.once("spawn", () => {
        if (this.readmeCommands.get(key) === runningCommand) {
          runningCommand.started = true;
          this.notifyProcessChanges();
          new Notice(this.translate("notice.processStarted", { label }));
        }
      });
      child.once("error", (error: Error) => {
        if (this.readmeCommands.get(key) !== runningCommand) {
          return;
        }
        runningCommand.finalStatus = "failed";
        runningCommand.finishedAt = Date.now();
        runningCommand.child = null;
        runningCommand.output = appendOutputTail(
          runningCommand.output,
          `\n${this.translate("output.startError", { message: error.message })}\n`,
          MAX_OUTPUT_LENGTH
        );
        this.unregisterActiveProcess(runningCommand);
        this.pruneProcessHistory();
        this.notifyProcessChanges();
        console.error("Dev Runner konnte den README-Befehlsblock nicht starten.", error);
        new Notice(this.translate("notice.processStartFailed", { label }));
      });
      child.once("close", (code, signal) => {
        this.handleReadmeCommandClose(runningCommand, code, signal);
      });
    } catch (error) {
      console.error("Dev Runner konnte den README-Befehlsblock nicht starten.", error);
      new Notice(this.translate("notice.processStartFailed", { label }));
    }
  }

  /** Stops one active README command while retaining its history entry. */
  private async stopReadmeCommand(key: string): Promise<void> {
    const runningCommand = this.readmeCommands.get(key);
    if (runningCommand === undefined || runningCommand.finalStatus !== null || runningCommand.stopping) {
      return;
    }
    const child = runningCommand.child;
    if (child === null) {
      return;
    }
    runningCommand.stopping = true;
    runningCommand.stopRequested = true;
    runningCommand.restarting = false;
    this.notifyProcessChanges();
    this.openProcessViewForInteraction();
    new Notice(this.translate("notice.processStopping", { label: runningCommand.label }));
    try {
      await stopBackgroundProcess(child);
    } catch (error) {
      if (this.readmeCommands.get(key) !== runningCommand || isProcessFinished(runningCommand)) {
        return;
      }
      runningCommand.stopping = false;
      this.notifyProcessChanges();
      console.error("Dev Runner konnte den README-Befehlsblock nicht beenden.", error);
      new Notice(this.translate("notice.processStopFailed", { label: runningCommand.label }));
    }
  }

  /** Restarts one README command from the process sidebar. */
  private async restartReadmeCommand(key: string): Promise<void> {
    const runningCommand = this.readmeCommands.get(key);
    if (runningCommand === undefined || runningCommand.stopping) {
      return;
    }
    const directoryPath = this.resolveReadmeCommandDirectory(runningCommand.definition);
    if (directoryPath === null) {
      new Notice(this.translate("notice.readmeMissing"));
      return;
    }
    if (!(await this.confirmReadmeCommand(directoryPath, runningCommand.definition))) {
      return;
    }
    if (this.readmeCommands.get(key) !== runningCommand || isProcessStopping(runningCommand)) {
      return;
    }
    const identityKey = createShellProcessIdentity(directoryPath, runningCommand.definition.command);
    const conflictingProcess = this.activeProcessesByIdentity.get(identityKey);
    if (conflictingProcess !== undefined && conflictingProcess !== runningCommand) {
      new Notice(this.translate("notice.alreadyRunning", { label: conflictingProcess.label }));
      return;
    }
    if (runningCommand.finalStatus !== null) {
      this.startReadmeCommand(directoryPath, runningCommand.definition);
      return;
    }
    const child = runningCommand.child;
    if (child === null) {
      return;
    }
    runningCommand.stopping = true;
    runningCommand.stopRequested = false;
    runningCommand.restarting = true;
    this.notifyProcessChanges();
    this.openProcessViewForInteraction();
    new Notice(this.translate("notice.processRestarting", { label: runningCommand.label }));
    try {
      await stopBackgroundProcess(child);
    } catch (error) {
      if (this.readmeCommands.get(key) !== runningCommand || isProcessFinished(runningCommand)) {
        return;
      }
      runningCommand.stopping = false;
      runningCommand.restarting = false;
      this.notifyProcessChanges();
      console.error("Dev Runner konnte den README-Befehlsblock nicht neu starten.", error);
      new Notice(this.translate("notice.processRestartFailed", { label: runningCommand.label }));
    }
  }

  /** Finalizes a README command and handles a requested restart. */
  private handleReadmeCommandClose(
    runningCommand: RunningReadmeCommand,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    if (this.readmeCommands.get(runningCommand.key) !== runningCommand || runningCommand.finalStatus !== null) {
      return;
    }
    if (runningCommand.restarting) {
      const directoryPath = this.resolveReadmeCommandDirectory(runningCommand.definition);
      runningCommand.child = null;
      this.unregisterActiveProcess(runningCommand);
      this.readmeCommands.delete(runningCommand.key);
      this.notifyProcessChanges();
      if (directoryPath === null) {
        new Notice(this.translate("notice.readmeMissing"));
        return;
      }
      this.startReadmeCommand(directoryPath, runningCommand.definition);
      return;
    }
    runningCommand.finalStatus = resolveFinalProcessStatus(runningCommand.stopRequested, code);
    runningCommand.finishedAt = Date.now();
    runningCommand.child = null;
    runningCommand.started = false;
    runningCommand.stopping = false;
    this.unregisterActiveProcess(runningCommand);
    this.pruneProcessHistory();
    this.notifyProcessChanges();
    this.showCompletionNotice(runningCommand, code, signal);
  }

  /** Confirms an untrusted README command and optionally remembers its fingerprint. */
  private async confirmReadmeCommand(
    directoryPath: string,
    definition: ReadmeCommandDefinition
  ): Promise<boolean> {
    if (this.preferences.disableSecurityWarnings) {
      return true;
    }
    const trustKey = createScriptTrustKey({
      command: definition.command,
      directoryPath,
      packageManager: resolveShellExecutable(),
      projectFingerprint: this.getProjectFingerprint(directoryPath),
      scriptName: `README:${definition.sourcePath}`
    });
    if (this.preferences.trustedScriptKeys.includes(trustKey)) {
      return true;
    }
    const decision = await requestScriptWarning(this.app, {
      command: definition.command,
      directoryPath,
      label: createReadmeCommandLabel(
        definition.command,
        this.translate("readme.commandFallback")
      )
    }, (key, variables) => this.translate(key, variables));
    if (!decision.confirmed || this.resolveReadmeCommandDirectory(definition) === null) {
      return false;
    }
    const latestTrustKey = createScriptTrustKey({
      command: definition.command,
      directoryPath,
      packageManager: resolveShellExecutable(),
      projectFingerprint: this.getProjectFingerprint(directoryPath),
      scriptName: `README:${definition.sourcePath}`
    });
    if (latestTrustKey !== trustKey) {
      new Notice(this.translate("notice.projectChanged"));
      return this.confirmReadmeCommand(directoryPath, definition);
    }
    if (decision.remember) {
      this.preferences.trustedScriptKeys = [...new Set([
        ...this.preferences.trustedScriptKeys,
        trustKey
      ])].sort();
      await this.saveSettings();
    }
    return true;
  }

  /** Resolves and validates the project directory for a rendered README command. */
  private resolveReadmeCommandDirectory(definition: ReadmeCommandDefinition): string | null {
    const directoryPath = this.getReadmeCommandDirectory(definition);
    if (directoryPath === null) {
      return null;
    }
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return null;
    }
    const readmePath = adapter.getFullPath(definition.sourcePath);
    try {
      const commands = parseExecutableReadmeCommands(readFileSync(readmePath, "utf8"));
      return commands.includes(definition.command) ? directoryPath : null;
    } catch (error) {
      console.error("Dev Runner konnte die README nicht prüfen.", error);
      return null;
    }
  }

  /** Resolves a README source path without re-reading its command blocks. */
  private getReadmeCommandDirectory(definition: ReadmeCommandDefinition): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return null;
    }
    return dirname(adapter.getFullPath(definition.sourcePath));
  }

  /** Captures stdout and stderr from one process into its bounded output tail. */
  private captureProcessOutput(runningProcess: ManagedProcessRecord): void {
    const child = runningProcess.child;
    if (child === null) {
      return;
    }
    const streams = [child.stdout, child.stderr];
    for (const stream of streams) {
      if (stream === null) {
        continue;
      }
      stream.setEncoding("utf8");
      stream.on("data", (chunk: unknown) => {
        this.appendProcessOutput(runningProcess, chunk);
      });
    }
  }

  /** Appends output only while the process record remains current. */
  private appendProcessOutput(runningProcess: ManagedProcessRecord, chunk: unknown): void {
    if (!this.isCurrentProcess(runningProcess)) {
      return;
    }
    runningProcess.output = appendOutputTail(runningProcess.output, chunk, MAX_OUTPUT_LENGTH);
    this.notifyProcessChanges();
  }

  /** Removes a completed process and performs a pending restart when requested. */
  private handleProcessClose(
    runningScript: RunningScript,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    if (this.runningScripts.get(runningScript.key) !== runningScript) {
      return;
    }
    if (runningScript.finalStatus !== null) {
      return;
    }
    if (runningScript.restartDefinition !== null) {
      const restartDefinition = runningScript.restartDefinition;
      runningScript.child = null;
      this.unregisterActiveProcess(runningScript);
      this.runningScripts.delete(runningScript.key);
      this.notifyProcessChanges();
      this.startScript(
        runningScript.directoryPath,
        restartDefinition.packageManager,
        restartDefinition.script
      );
      return;
    }
    runningScript.finalStatus = resolveFinalProcessStatus(runningScript.stopRequested, code);
    runningScript.finishedAt = Date.now();
    runningScript.child = null;
    runningScript.started = false;
    runningScript.stopping = false;
    this.unregisterActiveProcess(runningScript);
    this.pruneProcessHistory();
    this.notifyProcessChanges();
    this.showCompletionNotice(runningScript, code, signal);
  }

  /** Returns the current status used by the process sidebar. */
  private getManagedProcessStatus(runningProcess: RunningScript | RunningReadmeCommand): ProcessViewStatus {
    if (runningProcess.finalStatus !== null) {
      return runningProcess.finalStatus;
    }
    if ("restartDefinition" in runningProcess && runningProcess.restartDefinition !== null) {
      return "restarting";
    }
    if ("restarting" in runningProcess && runningProcess.restarting) {
      return "restarting";
    }
    if (runningProcess.stopping) {
      return "stopping";
    }
    return runningProcess.started ? "running" : "starting";
  }

  /** Returns whether a process record is still current in either process registry. */
  private isCurrentProcess(runningProcess: ManagedProcessRecord): boolean {
    return this.runningScripts.get(runningProcess.key) === runningProcess
      || this.readmeCommands.get(runningProcess.key) === runningProcess;
  }

  /** Registers one active command under its cross-source execution identity. */
  private registerActiveProcess(runningProcess: ManagedProcessRecord): void {
    this.activeProcessesByIdentity.set(runningProcess.identityKey, runningProcess);
  }

  /** Removes an active identity only when it still points to this process record. */
  private unregisterActiveProcess(runningProcess: ManagedProcessRecord): void {
    if (this.activeProcessesByIdentity.get(runningProcess.identityKey) === runningProcess) {
      this.activeProcessesByIdentity.delete(runningProcess.identityKey);
    }
  }

  /** Evicts the oldest finished records and releases their retained output. */
  private pruneProcessHistory(): void {
    const candidates: ProcessHistoryCandidate[] = [];
    for (const [key, runningScript] of this.runningScripts) {
      if (runningScript.finishedAt !== null) {
        candidates.push({ id: `${SCRIPT_HISTORY_PREFIX}${key}`, finishedAt: runningScript.finishedAt });
      }
    }
    for (const [key, runningCommand] of this.readmeCommands) {
      if (runningCommand.finishedAt !== null) {
        candidates.push({ id: `${README_HISTORY_PREFIX}${key}`, finishedAt: runningCommand.finishedAt });
      }
    }
    for (const id of selectHistoryEntriesToEvict(candidates)) {
      if (id.startsWith(SCRIPT_HISTORY_PREFIX)) {
        this.runningScripts.delete(id.slice(SCRIPT_HISTORY_PREFIX.length));
      } else if (id.startsWith(README_HISTORY_PREFIX)) {
        this.readmeCommands.delete(id.slice(README_HISTORY_PREFIX.length));
      }
    }
  }

  /** Confirms execution unless this exact script definition was trusted previously. */
  private async confirmScriptRun(
    directoryPath: string,
    packageManager: PackageManager,
    script: PackageScript
  ): Promise<boolean> {
    if (this.preferences.disableSecurityWarnings) {
      return true;
    }
    const trustKey = this.getScriptTrustKey(directoryPath, packageManager, script);
    if (this.preferences.trustedScriptKeys.includes(trustKey)) {
      return true;
    }

    const decision = await requestScriptWarning(this.app, {
      command: script.command,
      directoryPath,
      label: formatRunCommandForPlatform(buildRunCommand(packageManager, script.name))
    }, (key, variables) => this.translate(key, variables));
    if (!decision.confirmed) {
      return false;
    }
    const latestDefinition = this.resolveCurrentScript(directoryPath, script.name);
    if (latestDefinition === null) {
      new Notice(this.translate("notice.scriptMissing", { name: script.name }));
      return false;
    }
    const latestTrustKey = this.getScriptTrustKey(
      directoryPath,
      latestDefinition.packageManager,
      latestDefinition.script
    );
    if (latestTrustKey !== trustKey) {
      new Notice(this.translate("notice.projectChanged"));
      return this.confirmScriptRun(directoryPath, latestDefinition.packageManager, latestDefinition.script);
    }
    if (decision.remember) {
      this.preferences.trustedScriptKeys = [...new Set([
        ...this.preferences.trustedScriptKeys,
        trustKey
      ])].sort();
      await this.saveSettings();
    }
    return true;
  }

  /** Creates the trust key for one current project and script definition. */
  private getScriptTrustKey(
    directoryPath: string,
    packageManager: PackageManager,
    script: PackageScript
  ): string {
    return createScriptTrustKey({
      command: script.command,
      directoryPath,
      packageManager,
      projectFingerprint: this.getProjectFingerprint(directoryPath),
      scriptName: script.name
    });
  }

  /** Resolves the latest package manager and script definition from package.json. */
  private resolveCurrentScript(directoryPath: string, scriptName: string): ResolvedScriptDefinition | null {
    const metadata = this.readPackageMetadata(directoryPath);
    const script = metadata?.scripts.find((candidate) => candidate.name === scriptName);
    if (metadata === null || script === undefined) {
      return null;
    }
    return {
      packageManager: this.resolvePackageManager(directoryPath, metadata),
      script
    };
  }

  /** Fingerprints package.json and available lockfiles for script trust decisions. */
  private getProjectFingerprint(directoryPath: string): string {
    const files: ProjectTrustFile[] = [];
    for (const name of PROJECT_TRUST_FILES) {
      const filePath = join(directoryPath, name);
      if (!existsSync(filePath)) {
        continue;
      }
      try {
        files.push({ name, contents: readFileSync(filePath) });
      } catch (error) {
        console.error(`Dev Runner konnte ${name} nicht für die Freigabe lesen.`, error);
      }
    }
    return createProjectFingerprint(files);
  }

  /** Notifies all open process views that their snapshots changed. */
  private notifyProcessChanges(): void {
    for (const listener of this.processChangeListeners) {
      try {
        listener();
      } catch (error) {
        console.error("Dev Runner konnte eine Prozessansicht nicht aktualisieren.", error);
      }
    }
  }

  /** Opens or reveals the process view in the right sidebar. */
  private openProcessView(): void {
    void this.activateProcessView().catch((error: unknown) => {
      console.error("Dev Runner konnte die Prozessansicht nicht öffnen.", error);
      new Notice(this.translate("notice.processViewOpenFailed"));
    });
  }

  /** Opens the process sidebar after a user interaction when enabled. */
  private openProcessViewForInteraction(): void {
    if (this.preferences.openProcessViewOnInteraction) {
      this.openProcessView();
    }
  }

  /** Switches newly activated README Markdown views to reading mode when enabled. */
  private openReadmeInPreview(leaf: WorkspaceLeaf | null): void {
    if (!this.preferences.openReadmesInPreview || leaf === null) {
      return;
    }
    if (!(leaf.view instanceof MarkdownView) || leaf.view.getMode() === "preview") {
      return;
    }
    const sourcePath = leaf.view.file?.path;
    if (sourcePath === undefined || !isReadmePath(sourcePath)) {
      return;
    }

    const viewState = leaf.getViewState();
    void leaf.setViewState({
      ...viewState,
      state: {
        ...viewState.state,
        mode: "preview"
      }
    }).catch((error: unknown) => {
      console.error("Dev Runner konnte die README nicht im Lesemodus öffnen.", error);
    });
  }

  /** Activates the existing process view or creates it in the right sidebar. */
  private async activateProcessView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(PROCESS_VIEW_TYPE)[0];
    if (existingLeaf !== undefined) {
      await this.app.workspace.revealLeaf(existingLeaf);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf === null) {
      throw new Error("Die rechte Seitenleiste ist nicht verfügbar.");
    }
    await leaf.setViewState({ type: PROCESS_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Stops every managed process once during plugin unload or app shutdown. */
  private stopAllProcesses(): Promise<void> {
    if (this.shutdownPromise !== null) {
      return this.shutdownPromise;
    }

    this.shuttingDown = true;
    const runningProcesses = [
      ...this.runningScripts.values(),
      ...this.readmeCommands.values()
    ].filter((runningScript) => runningScript.finalStatus === null);
    const stopTargets: Array<{ child: ChildProcess; process: ManagedProcessRecord }> = [];
    for (const runningScript of runningProcesses) {
      runningScript.stopping = true;
      runningScript.stopRequested = true;
      if ("restartDefinition" in runningScript) {
        runningScript.restartDefinition = null;
      } else {
        runningScript.restarting = false;
      }
      if (runningScript.child !== null) {
        stopTargets.push({ child: runningScript.child, process: runningScript });
      }
    }
    this.notifyProcessChanges();

    const coordinator = getShutdownCoordinator();
    const shutdownPromise = Promise.allSettled(
      stopTargets.map(async ({ child, process: runningProcess }) => {
        try {
          await stopBackgroundProcess(child);
        } catch (error) {
          console.error(`Dev Runner konnte ${runningProcess.label} nicht beenden.`, error);
        }
      })
    ).then(() => {
      for (const runningProcess of runningProcesses) {
        this.unregisterActiveProcess(runningProcess);
        runningProcess.child = null;
      }
      this.runningScripts.clear();
      this.readmeCommands.clear();
      this.activeProcessesByIdentity.clear();
      this.notifyProcessChanges();
    });
    this.shutdownPromise = shutdownPromise;
    coordinator.pending = shutdownPromise;
    void shutdownPromise.then(() => {
      if (coordinator.pending === shutdownPromise) {
        coordinator.pending = null;
      }
    });
    return shutdownPromise;
  }

  /** Shows the final status after a managed script exits. */
  private showCompletionNotice(runningProcess: ManagedProcessRecord, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.shuttingDown) {
      return;
    }
    if (runningProcess.finalStatus === "stopped") {
      new Notice(this.translate("notice.processStopped", { label: runningProcess.label }));
      return;
    }
    if (code === 0) {
      new Notice(this.translate("notice.processCompleted", { label: runningProcess.label }));
      return;
    }
    if (code !== null) {
      new Notice(this.translate("notice.processExitedCode", {
        code,
        label: runningProcess.label
      }));
      return;
    }
    new Notice(this.translate("notice.processExitedSignal", {
      label: runningProcess.label,
      signal: signal ?? "unknown"
    }));
  }
}
