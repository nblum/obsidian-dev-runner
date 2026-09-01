import {
  isPackageManagerSetting,
  type PackageManagerSetting
} from "./package-scripts.ts";
import type { LanguagePreference } from "./i18n.ts";
import { readScriptTrustKeys } from "./script-security.ts";

export interface DevRunnerSettings {
  disableSecurityWarnings: boolean;
  enableAllMarkdownFiles: boolean;
  language: LanguagePreference;
  openProcessViewOnInteraction: boolean;
  openReadmesInPreview: boolean;
  packageManager: PackageManagerSetting;
  trustedScriptKeys: string[];
}

export const DEFAULT_SETTINGS: DevRunnerSettings = {
  disableSecurityWarnings: false,
  enableAllMarkdownFiles: false,
  language: "auto",
  openProcessViewOnInteraction: true,
  openReadmesInPreview: true,
  packageManager: "auto",
  trustedScriptKeys: []
};

/** Returns whether a persisted value is a supported language preference. */
export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "auto" || value === "de" || value === "en";
}

/** Reads persisted settings and applies safe defaults to missing or invalid values. */
export function readDevRunnerSettings(value: unknown): DevRunnerSettings {
  const savedSettings = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};

  return {
    disableSecurityWarnings: typeof savedSettings.disableSecurityWarnings === "boolean"
      ? savedSettings.disableSecurityWarnings
      : DEFAULT_SETTINGS.disableSecurityWarnings,
    enableAllMarkdownFiles: typeof savedSettings.enableAllMarkdownFiles === "boolean"
      ? savedSettings.enableAllMarkdownFiles
      : DEFAULT_SETTINGS.enableAllMarkdownFiles,
    language: isLanguagePreference(savedSettings.language)
      ? savedSettings.language
      : DEFAULT_SETTINGS.language,
    openProcessViewOnInteraction: typeof savedSettings.openProcessViewOnInteraction === "boolean"
      ? savedSettings.openProcessViewOnInteraction
      : DEFAULT_SETTINGS.openProcessViewOnInteraction,
    openReadmesInPreview: typeof savedSettings.openReadmesInPreview === "boolean"
      ? savedSettings.openReadmesInPreview
      : DEFAULT_SETTINGS.openReadmesInPreview,
    packageManager: isPackageManagerSetting(savedSettings.packageManager)
      ? savedSettings.packageManager
      : DEFAULT_SETTINGS.packageManager,
    trustedScriptKeys: readScriptTrustKeys(savedSettings.trustedScriptKeys)
  };
}
