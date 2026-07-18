import { Signal } from "tui";

export type UIMode = "config" | "validate" | "health";

export const MODES: UIMode[] = ["config", "validate", "health"];

export type PaneLifecycle = {
  onMount: () => void | Promise<void>;
  onHide: () => void;
};

export class AppState {
  readonly mode: Signal<UIMode>;
  private readonly panes = new Map<UIMode, PaneLifecycle>();

  constructor(initialMode: UIMode = "health") {
    this.mode = new Signal<UIMode>(initialMode);
  }

  registerPane(mode: UIMode, lifecycle: PaneLifecycle): void {
    this.panes.set(mode, lifecycle);
  }

  switchMode(next: UIMode): void {
    const current = this.mode.peek();
    if (current === next) return;
    this.panes.get(current)?.onHide();
    this.mode.value = next;
    void this.panes.get(next)?.onMount();
  }

  cycleMode(): void {
    const idx = MODES.indexOf(this.mode.peek());
    this.switchMode(MODES[(idx + 1) % MODES.length]);
  }

  mountInitial(): void {
    void this.panes.get(this.mode.peek())?.onMount();
  }
}
