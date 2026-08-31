import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import type { Language, TranslationVariables } from "./i18n.ts";

export const PROCESS_VIEW_TYPE = "dev-runner-processes";

const RENDER_DELAY_MS = 100;

export type ProcessViewStatus =
  | "completed"
  | "failed"
  | "restarting"
  | "running"
  | "starting"
  | "stopped"
  | "stopping";

export interface ProcessViewEntry {
  key: string;
  label: string;
  directoryPath: string;
  finishedAt: number | null;
  output: string;
  pid: number | null;
  status: ProcessViewStatus;
}

export interface ProcessViewHost {
  /** Returns the language used for locale-aware process metadata. */
  getLanguage(): Language;
  /** Returns immutable display data for all currently managed processes. */
  getProcessViewEntries(): readonly ProcessViewEntry[];
  /** Subscribes to process state and output changes. */
  subscribeToProcessChanges(listener: () => void): () => void;
  /** Stops one managed process. */
  stopProcess(key: string): Promise<void>;
  /** Restarts one managed process. */
  restartProcess(key: string): Promise<void>;
  /** Translates one process-view label. */
  translate(key: string, variables?: TranslationVariables): string;
}

interface ProcessCardState {
  element: HTMLElement;
  renderKey: string;
}

interface ProcessViewLayout {
  activeList: HTMLElement;
  activeSection: HTMLElement;
  activeTitle: HTMLElement;
  empty: HTMLElement;
  historyList: HTMLElement;
  historySection: HTMLElement;
  historyTitle: HTMLElement;
}

/** Displays managed project commands and their recent output in a sidebar. */
export class DevRunnerProcessView extends ItemView {
  private readonly cards = new Map<string, ProcessCardState>();
  private layout: ProcessViewLayout | null = null;
  private renderTimer: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly host: ProcessViewHost;

  /** Stores the process host used to render and control entries. */
  constructor(leaf: WorkspaceLeaf, host: ProcessViewHost) {
    super(leaf);
    this.host = host;
  }

  /** Returns the stable workspace view identifier. */
  override getViewType(): string {
    return PROCESS_VIEW_TYPE;
  }

  /** Returns the title shown on the sidebar tab. */
  override getDisplayText(): string {
    return "Dev Runner";
  }

  /** Returns the icon shown on the sidebar tab. */
  override getIcon(): string {
    return "play";
  }

  /** Subscribes to process updates and renders the initial panel content. */
  protected override onOpen(): Promise<void> {
    this.contentEl.addClass("dev-runner-process-view");
    this.contentEl.addEventListener("click", this.handleClick);
    this.unsubscribe = this.host.subscribeToProcessChanges(this.requestRender);
    this.render();
    return Promise.resolve();
  }

  /** Releases panel listeners and pending render work. */
  protected override onClose(): Promise<void> {
    this.contentEl.removeEventListener("click", this.handleClick);
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.renderTimer !== null) {
      window.clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    this.cards.clear();
    this.layout = null;
    return Promise.resolve();
  }

  /** Handles delegated stop and restart button clicks. */
  private readonly handleClick = (event: MouseEvent): void => {
    const target = event.target;
    const ownerWindow = this.contentEl.ownerDocument.defaultView;
    if (ownerWindow === null || !(target instanceof ownerWindow.Element)) {
      return;
    }
    const button = target.closest<HTMLButtonElement>("button[data-process-action]");
    if (button === null || !this.contentEl.contains(button)) {
      return;
    }

    const encodedKey = button.dataset.processKey;
    const action = button.dataset.processAction;
    if (encodedKey === undefined) {
      return;
    }
    let key: string;
    try {
      key = decodeURIComponent(encodedKey);
    } catch {
      return;
    }
    if (action === "stop") {
      void this.host.stopProcess(key);
    } else if (action === "restart") {
      void this.host.restartProcess(key);
    }
  };

  /** Coalesces frequent output events into bounded panel refreshes. */
  private readonly requestRender = (): void => {
    if (this.renderTimer !== null) {
      return;
    }
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, RENDER_DELAY_MS);
  };

  /** Renders the current process list and output tails. */
  private render(): void {
    const layout = this.ensureLayout();
    const entries = this.host.getProcessViewEntries();
    const activeEntries = entries.filter((entry) => !this.isHistoryStatus(entry.status));
    const historyEntries = entries
      .filter((entry) => this.isHistoryStatus(entry.status))
      .sort((left, right) => (right.finishedAt ?? 0) - (left.finishedAt ?? 0));
    const currentKeys = new Set(entries.map((entry) => entry.key));
    for (const [key, card] of this.cards) {
      if (!currentKeys.has(key)) {
        card.element.remove();
        this.cards.delete(key);
      }
    }
    for (const entry of activeEntries) {
      this.renderEntry(layout.activeList, entry);
    }
    for (const entry of historyEntries) {
      this.renderEntry(layout.historyList, entry);
    }
    layout.empty.setText(this.host.translate("processView.empty"));
    layout.activeTitle.setText(this.host.translate("processView.section.active"));
    layout.historyTitle.setText(this.host.translate("processView.section.history"));
    layout.empty.hidden = entries.length > 0;
    layout.activeSection.hidden = activeEntries.length === 0;
    layout.historySection.hidden = historyEntries.length === 0;
  }

  /** Creates the stable sidebar sections once per view lifecycle. */
  private ensureLayout(): ProcessViewLayout {
    if (this.layout !== null) {
      return this.layout;
    }
    this.contentEl.empty();
    const empty = this.contentEl.createDiv({ cls: "dev-runner-process-view__empty" });
    const activeSection = this.contentEl.createDiv({ cls: "dev-runner-process-view__section" });
    const activeTitle = activeSection.createEl("h4", {
      cls: "dev-runner-process-view__section-title",
      text: this.host.translate("processView.section.active")
    });
    const activeList = activeSection.createDiv({ cls: "dev-runner-process-view__list" });
    const historySection = this.contentEl.createDiv({ cls: "dev-runner-process-view__section" });
    const historyTitle = historySection.createEl("h4", {
      cls: "dev-runner-process-view__section-title",
      text: this.host.translate("processView.section.history")
    });
    const historyList = historySection.createDiv({ cls: "dev-runner-process-view__list" });
    this.layout = {
      activeList,
      activeSection,
      activeTitle,
      empty,
      historyList,
      historySection,
      historyTitle
    };
    return this.layout;
  }

  /** Updates one keyed process card only when its display data changed. */
  private renderEntry(container: HTMLElement, entry: ProcessViewEntry): void {
    let cardState = this.cards.get(entry.key);
    if (cardState === undefined) {
      cardState = {
        element: container.createDiv({ cls: "dev-runner-process-view__card" }),
        renderKey: ""
      };
      this.cards.set(entry.key, cardState);
    }
    container.appendChild(cardState.element);
    const renderKey = this.createEntryRenderKey(entry);
    if (cardState.renderKey === renderKey) {
      return;
    }
    cardState.renderKey = renderKey;
    this.renderEntryContent(cardState.element, entry);
  }

  /** Rebuilds the contents of one changed process card. */
  private renderEntryContent(card: HTMLElement, entry: ProcessViewEntry): void {
    card.empty();
    const header = card.createDiv({ cls: "dev-runner-process-view__header" });
    header.createEl("strong", { text: entry.label });
    header.createSpan({
      cls: `dev-runner-process-view__status is-${entry.status}`,
      text: this.getStatusLabel(entry.status)
    });

    const pidLabel = entry.pid === null
      ? entry.finishedAt === null ? this.host.translate("processView.pidPending") : null
      : this.host.translate("processView.pid", { pid: entry.pid });
    const finishedLabel = entry.finishedAt === null
      ? null
      : this.host.translate("processView.finished", { time: this.formatFinishedAt(entry.finishedAt) });
    card.createDiv({
      cls: "dev-runner-process-view__meta",
      text: [pidLabel, finishedLabel, entry.directoryPath].filter((part) => part !== null).join(" · "),
      attr: { title: entry.directoryPath }
    });

    const actions = card.createDiv({ cls: "dev-runner-process-view__actions" });
    const changing = entry.status === "stopping" || entry.status === "restarting";
    const stopped = this.isHistoryStatus(entry.status);
    this.createActionButton(
      actions,
      entry.key,
      "stop",
      "square",
      this.host.translate("processView.action.stop"),
      changing || stopped
    );
    this.createActionButton(
      actions,
      entry.key,
      "restart",
      "refresh-cw",
      this.host.translate("processView.action.restart"),
      changing
    );

    card.createDiv({
      cls: "dev-runner-process-view__output-label",
      text: this.host.translate("processView.output")
    });
    const output = card.createEl("pre", { cls: "dev-runner-process-view__output" });
    output.setText(entry.output.trimEnd() || this.host.translate("processView.noOutput"));
    output.scrollTop = output.scrollHeight;
  }

  /** Creates a stable fingerprint for one localized process-card rendering. */
  private createEntryRenderKey(entry: ProcessViewEntry): string {
    return JSON.stringify([
      this.host.getLanguage(),
      entry.directoryPath,
      entry.finishedAt,
      entry.label,
      entry.output,
      entry.pid,
      entry.status
    ]);
  }

  /** Creates an accessible process action button. */
  private createActionButton(
    container: HTMLElement,
    key: string,
    action: "stop" | "restart",
    icon: string,
    label: string,
    disabled: boolean
  ): void {
    const button = container.createEl("button", {
      cls: "dev-runner-process-view__action",
      attr: {
        type: "button",
        title: label,
        "aria-label": label,
        "data-process-action": action,
        "data-process-key": encodeURIComponent(key)
      }
    });
    button.disabled = disabled;
    const iconElement = button.createSpan({ cls: "dev-runner-process-view__action-icon" });
    setIcon(iconElement, icon);
    button.createSpan({ text: label });
  }

  /** Maps an internal process state to its localized label. */
  private getStatusLabel(status: ProcessViewStatus): string {
    return this.host.translate(`processView.status.${status}`);
  }

  /** Returns whether a status belongs in the process history. */
  private isHistoryStatus(status: ProcessViewStatus): boolean {
    return status === "completed" || status === "failed" || status === "stopped";
  }

  /** Formats a completion timestamp for the history metadata. */
  private formatFinishedAt(timestamp: number): string {
    const locale = this.host.getLanguage() === "de" ? "de-DE" : "en-US";
    return new Date(timestamp).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }
}
