import { Confirm, Input, Secret } from "@cliffy/prompt";

/**
 * UI-agnostic interaction interface. Implement this to drive workflow prompts
 * from any UI — CLI, TUI, or tests. The default cliInteraction wraps @cliffy.
 */
export type Interaction = {
  confirm: (message: string, defaultValue?: boolean) => Promise<boolean>;
  input: (message: string, defaultValue?: string) => Promise<string>;
  secret: (message: string) => Promise<string>;
};

export const cliInteraction: Interaction = {
  confirm: (message, defaultValue = false) =>
    Confirm.prompt({ message, default: defaultValue }),

  input: (message, defaultValue) =>
    Input.prompt({
      message,
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    }),

  secret: (message) => Secret.prompt({ message }),
};
