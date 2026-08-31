import {
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  type App
} from "obsidian";
import { isPackageManagerSetting } from "./package-scripts.ts";
import type { TranslationVariables } from "./i18n.ts";
import {
  isLanguagePreference,
  type DevRunnerSettings
} from "./settings.ts";

const AUTHOR_WEBSITE_URL = "https://blum-nico.de";
const GITHUB_REPOSITORY_URL = "https://github.com/nblum/obsidian-dev-runner";
const GITHUB_FEEDBACK_URL = `${GITHUB_REPOSITORY_URL}/issues/new`;

export interface DevRunnerSettingsHost {
  preferences: DevRunnerSettings;
  saveSettings(): Promise<void>;
  translate(key: string, variables?: TranslationVariables): string;
  updateLanguage(preference: string): void;
}

type DevRunnerSettingsPlugin = Plugin & DevRunnerSettingsHost;

/** Renders and persists the Dev Runner settings controls. */
export class DevRunnerSettingTab extends PluginSettingTab {
  private readonly plugin: DevRunnerSettingsPlugin;

  /** Stores the plugin instance used by the settings controls. */
  constructor(app: App, plugin: DevRunnerSettingsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** Builds the plugin settings UI. */
  override display(): void {
    this.renderSettings();
  }

  /** Renders current preference values without invoking deprecated tab refresh APIs. */
  private renderSettings(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName(this.plugin.translate("settings.about.name"))
      .setDesc(this.createAboutDescription());

    new Setting(containerEl)
      .setName(this.plugin.translate("settings.language.name"))
      .setDesc(this.plugin.translate("settings.language.description"))
      .addDropdown((dropdown) => dropdown
        .addOption("auto", this.plugin.translate("settings.language.auto"))
        .addOption("de", this.plugin.translate("settings.language.de"))
        .addOption("en", this.plugin.translate("settings.language.en"))
        .setValue(this.plugin.preferences.language)
        .onChange(async (value) => {
          if (!isLanguagePreference(value)) {
            return;
          }
          this.plugin.updateLanguage(value);
          await this.plugin.saveSettings();
          this.renderSettings();
        }));

    new Setting(containerEl)
      .setName(this.plugin.translate("settings.packageManager.name"))
      .setDesc(this.plugin.translate("settings.packageManager.description"))
      .addDropdown((dropdown) => dropdown
        .addOption("auto", this.plugin.translate("settings.packageManager.auto"))
        .addOption("npm", "npm")
        .addOption("pnpm", "pnpm")
        .addOption("yarn", "Yarn")
        .addOption("bun", "Bun")
        .setValue(this.plugin.preferences.packageManager)
        .onChange(async (value) => {
          if (!isPackageManagerSetting(value)) {
            return;
          }
          this.plugin.preferences.packageManager = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(this.plugin.translate("settings.openPanel.name"))
      .setDesc(this.plugin.translate("settings.openPanel.description"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.preferences.openProcessViewOnInteraction)
        .onChange(async (value) => {
          this.plugin.preferences.openProcessViewOnInteraction = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(this.plugin.translate("settings.readmePreview.name"))
      .setDesc(this.plugin.translate("settings.readmePreview.description"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.preferences.openReadmesInPreview)
        .onChange(async (value) => {
          this.plugin.preferences.openReadmesInPreview = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(this.plugin.translate("settings.warnings.name"))
      .setDesc(this.plugin.translate("settings.warnings.description"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.preferences.disableSecurityWarnings)
        .onChange(async (value) => {
          this.plugin.preferences.disableSecurityWarnings = value;
          await this.plugin.saveSettings();
        }));

    const trustedScriptCount = this.plugin.preferences.trustedScriptKeys.length;
    const trustDescriptionKey = trustedScriptCount === 1
      ? "settings.trust.description.one"
      : "settings.trust.description.many";
    new Setting(containerEl)
      .setName(this.plugin.translate("settings.trust.name"))
      .setDesc(this.plugin.translate(trustDescriptionKey, { count: trustedScriptCount }))
      .addButton((button) => button
        .setButtonText(this.plugin.translate("settings.trust.reset"))
        .setDisabled(trustedScriptCount === 0)
        .onClick(async () => {
          this.plugin.preferences.trustedScriptKeys = [];
          await this.plugin.saveSettings();
          new Notice(this.plugin.translate("notice.trustReset"));
          this.renderSettings();
        }));
  }

  /** Builds the about text and its external links. */
  private createAboutDescription(): DocumentFragment {
    return createFragment((fragment) => {
      fragment.appendText(this.plugin.translate("settings.about.description"));
      fragment.createEl("br");
      fragment.appendText(this.plugin.translate("settings.about.support"));
      fragment.createEl("br");
      this.appendExternalLink(fragment, this.plugin.translate("settings.about.website"), AUTHOR_WEBSITE_URL);
      fragment.appendText(" · ");
      this.appendExternalLink(fragment, this.plugin.translate("settings.about.star"), GITHUB_REPOSITORY_URL);
      fragment.appendText(" · ");
      this.appendExternalLink(fragment, this.plugin.translate("settings.about.feedback"), GITHUB_FEEDBACK_URL);
    });
  }

  /** Appends an external link that opens without access to the Obsidian window. */
  private appendExternalLink(parent: DocumentFragment, label: string, href: string): void {
    parent.createEl("a", {
      text: label,
      href,
      attr: {
        target: "_blank",
        rel: "noopener"
      }
    });
  }
}
