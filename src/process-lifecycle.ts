export const MAX_PROCESS_HISTORY_ENTRIES = 50;

export type FinalProcessStatus = "completed" | "failed" | "stopped";

export interface ProcessHistoryCandidate {
  finishedAt: number;
  id: string;
}

/** Resolves a close event without losing an earlier explicit stop request. */
export function resolveFinalProcessStatus(
  stopRequested: boolean,
  exitCode: number | null
): FinalProcessStatus {
  if (stopRequested) {
    return "stopped";
  }
  return exitCode === 0 ? "completed" : "failed";
}

/** Selects the oldest deterministic history entries beyond the configured limit. */
export function selectHistoryEntriesToEvict(
  entries: readonly ProcessHistoryCandidate[],
  limit: number = MAX_PROCESS_HISTORY_ENTRIES
): string[] {
  const overflow = Math.max(0, entries.length - Math.max(0, limit));
  return [...entries]
    .sort((left, right) => left.finishedAt - right.finishedAt || left.id.localeCompare(right.id))
    .slice(0, overflow)
    .map((entry) => entry.id);
}
