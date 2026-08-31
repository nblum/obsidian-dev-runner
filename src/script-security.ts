import { createHash } from "node:crypto";

export interface ScriptTrustDetails {
  command: string;
  directoryPath: string;
  packageManager: string;
  projectFingerprint: string;
  scriptName: string;
}

export interface ProjectTrustFile {
  contents: Uint8Array;
  name: string;
}

/** Hashes project metadata files in deterministic filename order. */
export function createProjectFingerprint(files: readonly ProjectTrustFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    hash.update(`${String(file.name.length)}:`);
    hash.update(file.name);
    hash.update(`${String(file.contents.byteLength)}:`);
    hash.update(file.contents);
  }
  return hash.digest("hex");
}

/** Creates a stable trust key that changes with the project or script definition. */
export function createScriptTrustKey(details: ScriptTrustDetails): string {
  const serialized = JSON.stringify([
    details.directoryPath,
    details.packageManager,
    details.projectFingerprint,
    details.scriptName,
    details.command
  ]);
  return createHash("sha256").update(serialized).digest("hex");
}

/** Validates, deduplicates, and sorts persisted script trust keys. */
export function readScriptTrustKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((entry): entry is string => (
    typeof entry === "string" && /^[a-f0-9]{64}$/.test(entry)
  )))].sort();
}
