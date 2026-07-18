import { Computed } from "tui";
import { Signal } from "tui";
import { Label } from "tui/components/mod.ts";
import type { Tui } from "tui";
import { C } from "../colors.ts";
import { MODES } from "../state.ts";
import type { UIMode } from "../state.ts";

const LABELS: Record<UIMode, string> = {
  config: "CONFIG",
  validate: "VALIDATE",
  health: "HEALTH",
};

export function createTabBar(parent: Tui, mode: Signal<UIMode>, width: number): void {
  new Label({
    parent,
    zIndex: 0,
    rectangle: { column: 0, row: 1, width, height: 1 },
    theme: { base: C.tab },
    text: new Computed(() => {
      const active = mode.value;
      return MODES
        .map((m) => active === m ? `[${LABELS[m]}]` : ` ${LABELS[m]} `)
        .join("  ");
    }),
  });
}
