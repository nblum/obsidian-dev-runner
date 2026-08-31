import {
  Notice,
  Plugin,
  PluginSettingTab,
  requireApiVersion,
  Setting,
  type App,
  type SettingDefinitionItem
} from "obsidian";
import { isPackageManagerSetting } from "./package-scripts.ts";
import type { TranslationVariables } from "./i18n.ts";
import {
  DEFAULT_SETTINGS,
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
type DevRunnerControlKey = Exclude<keyof DevRunnerSettings, "trustedScriptKeys">;

/** Renders and persists the Dev Runner settings controls. */
export class DevRunnerSettingTab extends PluginSettingTab {
  private readonly plugin: DevRunnerSettingsPlugin;

  /** Stores the plugin instance used by the settings controls. */
  constructor(app: App, plugin: DevRunnerSettingsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** Describes searchable settings for Obsidian 1.13 and later. */
  override getSettingDefinitions(): SettingDefinitionItem<DevRunnerControlKey>[] {
    const trustedScriptCount = this.plugin.preferences.trustedScriptKeys.length;
    return [
      {
        name: this.plugin.translate("settings.about.name"),
        desc: this.createAboutDescription()
      },
      {
        name: this.plugin.translate("settings.language.name"),
        desc: this.plugin.translate("settings.language.description"),
        control: {
          type: "dropdown",
          key: "language",
          defaultValue: DEFAULT_SETTINGS.language,
          options: {
            auto: this.plugin.translate("settings.language.auto"),
            de: this.plugin.translate("settings.language.de"),
            en: this.plugin.translate("settings.language.en")
          }
        }
      },
      {
        name: this.plugin.translate("settings.packageManager.name"),
        desc: this.plugin.translate("settings.packageManager.description"),
        control: {
          type: "dropdown",
          key: "packageManager",
          defaultValue: DEFAULT_SETTINGS.packageManager,
          options: {
            auto: this.plugin.translate("settings.packageManager.auto"),
            npm: "npm",
            pnpm: "pnpm",
            yarn: "Yarn",
            bun: "Bun"
          }
        }
      },
      {
        name: this.plugin.translate("settings.openPanel.name"),
        desc: this.plugin.translate("settings.openPanel.description"),
        control: {
          type: "toggle",
          key: "openProcessViewOnInteraction",
          defaultValue: DEFAULT_SETTINGS.openProcessViewOnInteraction
        }
      },
      {
        name: this.plugin.translate("settings.readmePreview.name"),
        desc: this.plugin.translate("settings.readmePreview.description"),
        control: {
          type: "toggle",
          key: "openReadmesInPreview",
          defaultValue: DEFAULT_SETTINGS.openReadmesInPreview
        }
      },
      {
        name: this.plugin.translate("settings.warnings.name"),
        desc: this.plugin.translate("settings.warnings.description"),
        control: {
          type: "toggle",
          key: "disableSecurityWarnings",
          defaultValue: DEFAULT_SETTINGS.disableSecurityWarnings
        }
      },
      {
        name: this.plugin.translate("settings.trust.name"),
        desc: this.getTrustDescription(trustedScriptCount),
        render: (setting): void => {
          setting.addButton((button) => button
            .setButtonText(this.plugin.translate("settings.trust.reset"))
            .setDisabled(trustedScriptCount === 0)
            .onClick(async () => {
              await this.resetTrustedScripts();
              if (requireApiVersion("1.13.0")) {
                this.update();
              }
            }));
        }
      }
    ];
  }

  /** Reads one declarative control from the plugin's custom settings store. */
  override getControlValue(key: string): unknown {
    if (key === "language"
      || key === "packageManager"
      || key === "openProcessViewOnInteraction"
      || key === "openReadmesInPreview"
      || key === "disableSecurityWarnings") {
      return this.plugin.preferences[key];
    }
    return undefined;
  }

  /** Validates and persists one declarative settings control change. */
  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "language" && isLanguagePreference(value)) {
      this.plugin.updateLanguage(value);
      await this.plugin.saveSettings();
      if (requireApiVersion("1.13.0")) {
        this.update();
      }
      return;
    }
    if (key === "packageManager" && isPackageManagerSetting(value)) {
      this.plugin.preferences.packageManager = value;
      await this.plugin.saveSettings();
      return;
    }
    if ((key === "openProcessViewOnInteraction"
      || key === "openReadmesInPreview"
      || key === "disableSecurityWarnings")
      && typeof value === "boolean") {
      this.plugin.preferences[key] = value;
      await this.plugin.saveSettings();
      return;
    }
    throw new Error(`Invalid value for Dev Runner setting ${key}.`);
  }

  /** Builds the legacy settings UI on Obsidian versions before 1.13. */
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
    new Setting(containerEl)
      .setName(this.plugin.translate("settings.trust.name"))
      .setDesc(this.getTrustDescription(trustedScriptCount))
      .addButton((button) => button
        .setButtonText(this.plugin.translate("settings.trust.reset"))
        .setDisabled(trustedScriptCount === 0)
        .onClick(async () => {
          await this.resetTrustedScripts();
          this.renderSettings();
        }));
  }

  /** Returns the localized saved-approval description for the current count. */
  private getTrustDescription(trustedScriptCount: number): string {
    const key = trustedScriptCount === 1
      ? "settings.trust.description.one"
      : "settings.trust.description.many";
    return this.plugin.translate(key, { count: trustedScriptCount });
  }

  /** Clears every saved command approval and persists the change. */
  private async resetTrustedScripts(): Promise<void> {
    this.plugin.preferences.trustedScriptKeys = [];
    await this.plugin.saveSettings();
    new Notice(this.plugin.translate("notice.trustReset"));
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
