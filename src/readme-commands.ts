import {
  MarkdownRenderChild,
  setIcon,
  type MarkdownPostProcessorContext
} from "obsidian";
import {
  isReadmePath,
  normalizeReadmeCommand
} from "./readme-command-model.ts";
import type { TranslationVariables } from "./i18n.ts";

const EXECUTABLE_LANGUAGES = ["bash", "sh", "shell", "zsh"] as const;

export interface ReadmeCommandDefinition {
  command: string;
  kind: "readme";
  sourcePath: string;
}

export type ReadmeCommandButtonState = "run" | "stop" | "stopping";

export interface ReadmeCommandController {
  getState(definition: ReadmeCommandDefinition): ReadmeCommandButtonState;
  runCommand(definition: ReadmeCommandDefinition): void;
  stopCommand(definition: ReadmeCommandDefinition): void;
  subscribe(listener: () => void): () => void;
  translate(key: string, variables?: TranslationVariables): string;
}

/** Manages one rendered README command button with the Markdown section lifecycle. */
class ReadmeCommandButton extends MarkdownRenderChild {
  private readonly button: HTMLButtonElement;
  private readonly controller: ReadmeCommandController;
  private readonly definition: ReadmeCommandDefinition;

  /** Stores the button, command definition, and process-state controller. */
  constructor(
    containerEl: HTMLElement,
    button: HTMLButtonElement,
    definition: ReadmeCommandDefinition,
    controller: ReadmeCommandController
  ) {
    super(containerEl);
    this.button = button;
    this.definition = definition;
    this.controller = controller;
  }

  /** Registers click and process-state handlers while the Markdown block exists. */
  override onload(): void {
    this.registerDomEvent(this.button, "click", () => {
      const state = this.controller.getState(this.definition);
      if (state === "run") {
        this.controller.runCommand(this.definition);
      } else if (state === "stop") {
        this.controller.stopCommand(this.definition);
      }
    });
    this.register(this.controller.subscribe(() => { this.render(); }));
    this.render();
  }

  /** Reflects the shared command state through icon, label, and disabled state. */
  private render(): void {
    const state = this.controller.getState(this.definition);
    const stopping = state === "stopping";
    const label = state === "run"
      ? this.controller.translate("readme.run")
      : stopping
        ? this.controller.translate("readme.stopping")
        : this.controller.translate("readme.stop");
    this.button.disabled = stopping;
    this.button.classList.toggle("is-stopping", stopping);
    this.button.setAttribute("title", label);
    this.button.setAttribute("aria-label", label);
    setIcon(this.button, state === "run" ? "play" : "square");
  }
}

/** Returns the supported shell-language selector used for rendered code blocks. */
function getExecutableCodeSelector(): string {
  return EXECUTABLE_LANGUAGES.map((language) => `pre > code.language-${language}`).join(", ");
}

/** Adds Play buttons to supported shell blocks in a rendered README section. */
export function addReadmeCommandButtons(
  containerEl: HTMLElement,
  context: MarkdownPostProcessorContext,
  controller: ReadmeCommandController
): void {
  if (!isReadmePath(context.sourcePath)) {
    return;
  }

  for (const codeElement of containerEl.querySelectorAll<HTMLElement>(getExecutableCodeSelector())) {
    const pre = codeElement.parentElement;
    const command = normalizeReadmeCommand(codeElement.textContent);
    if (pre === null || command.length === 0) {
      continue;
    }
    if (pre.querySelector(".dev-runner-readme-command__run") !== null) {
      continue;
    }

    pre.addClass("dev-runner-readme-command");
    const runLabel = controller.translate("readme.run");
    const button = pre.createEl("button", {
      cls: "clickable-icon dev-runner-readme-command__run",
      attr: {
        type: "button",
        title: runLabel,
        "aria-label": runLabel
      }
    });
    setIcon(button, "play");
    context.addChild(new ReadmeCommandButton(
      pre,
      button,
      { command, kind: "readme", sourcePath: context.sourcePath },
      controller
    ));
  }
}
