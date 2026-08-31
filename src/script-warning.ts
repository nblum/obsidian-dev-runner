import { ButtonComponent, Modal, Setting, type App } from "obsidian";
import type { Translator } from "./i18n.ts";

export interface ScriptWarningDetails {
  command: string;
  directoryPath: string;
  label: string;
}

export interface ScriptWarningDecision {
  confirmed: boolean;
  remember: boolean;
}

/** Warns before arbitrary command code is executed with Obsidian's permissions. */
class ScriptWarningModal extends Modal {
  private remember = false;
  private resolved = false;
  private readonly details: ScriptWarningDetails;
  private readonly resolveDecision: (decision: ScriptWarningDecision) => void;
  private readonly translate: Translator;

  /** Stores the warning details and decision callback. */
  constructor(
    app: App,
    details: ScriptWarningDetails,
    translate: Translator,
    resolveDecision: (decision: ScriptWarningDecision) => void
  ) {
    super(app);
    this.details = details;
    this.translate = translate;
    this.resolveDecision = resolveDecision;
  }

  /** Renders the security warning and confirmation controls. */
  override onOpen(): void {
    this.setTitle(this.translate("warning.title"));
    this.contentEl.addClass("dev-runner-warning");
    this.contentEl.createEl("p", {
      text: this.translate("warning.description")
    });

    const details = this.contentEl.createDiv({ cls: "dev-runner-warning__details" });
    details.createEl("strong", { text: this.details.label });
    details.createEl("pre", { text: this.details.command });
    details.createDiv({
      cls: "dev-runner-warning__path",
      text: this.details.directoryPath,
      attr: { title: this.details.directoryPath }
    });
    this.contentEl.createEl("p", {
      cls: "dev-runner-warning__hint",
      text: this.translate("warning.lifecycleHint")
    });

    new Setting(this.contentEl)
      .setName(this.translate("warning.remember.name"))
      .setDesc(this.translate("warning.remember.description"))
      .addToggle((toggle) => toggle
        .setValue(this.remember)
        .onChange((value) => {
          this.remember = value;
        }));

    const actions = this.contentEl.createDiv({ cls: "dev-runner-warning__actions" });
    new ButtonComponent(actions)
      .setButtonText(this.translate("warning.cancel"))
      .onClick(() => { this.finish(false); });
    new ButtonComponent(actions)
      .setButtonText(this.translate("warning.run"))
      .setCta()
      .onClick(() => { this.finish(true); });
  }

  /** Resolves a dismissed modal as a cancelled execution. */
  override onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolveDecision({ confirmed: false, remember: false });
    }
  }

  /** Resolves the selected decision and closes the modal. */
  private finish(confirmed: boolean): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolveDecision({ confirmed, remember: confirmed && this.remember });
    this.close();
  }
}

/** Opens the command warning and resolves with the user's decision. */
export function requestScriptWarning(
  app: App,
  details: ScriptWarningDetails,
  translate: Translator
): Promise<ScriptWarningDecision> {
  return new Promise((resolve) => {
    new ScriptWarningModal(app, details, translate, resolve).open();
  });
}
