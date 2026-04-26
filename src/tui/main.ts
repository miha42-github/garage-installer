import {
  Computed,
  Signal,
  Tui,
  handleInput,
  handleKeyboardControls,
  handleMouseControls,
} from "tui";
import { Box, Label } from "tui/components/mod.ts";
import { collectHealthSnapshot, createPollingController } from "./adapters/wizardAdapter.ts";
import { C } from "./colors.ts";
import { createHealthPane } from "./panes/health.ts";

type UIMode = "config" | "validate" | "health";

const MODES: UIMode[] = ["config", "validate", "health"];

function cycleMode(current: UIMode): UIMode {
  const index = MODES.indexOf(current);
  return MODES[(index + 1) % MODES.length];
}

function modeHint(mode: UIMode): string {
  if (mode === "health") {
    return " [q] quit  [tab] mode  [1] config  [2] validate  [3] health  [r] refresh  [j/k] log";
  }

  return " [q] quit  [tab] mode  [1] config  [2] validate  [3] health";
}

function modePlaceholder(mode: UIMode): string {
  if (mode === "config") {
    return "CONFIG\n\nConfiguration editing lands in a later phase.\n\nThis Phase 1 shell is read-only.";
  }

  if (mode === "validate") {
    return "VALIDATE\n\nStep runner wiring lands in a later phase.\n\nThis Phase 1 shell is read-only.";
  }

  return "HEALTH\n\nHealth pane is active in this mode.";
}

export async function runTUI(): Promise<void> {
  const tui = new Tui({
    style: C.bg,
    refreshRate: 1000 / 60,
  });

  const root = tui.rectangle.peek();
  const width = Math.max(40, root.width);
  const height = Math.max(10, root.height);

  const mode = new Signal<UIMode>("health");
  const contentText = new Computed(() => {
    if (mode.value === "health") {
      return "";
    }
    return modePlaceholder(mode.value);
  });
  const hintText = new Computed(() => modeHint(mode.value));

  let setMode = (nextMode: UIMode): void => {
    mode.value = nextMode;
  };

  handleInput(tui);
  handleMouseControls(tui);
  handleKeyboardControls(tui);
  tui.dispatch();

  new Label({
    parent: tui,
    zIndex: 0,
    rectangle: {
      column: 0,
      row: 0,
      width,
      height: 1,
    },
    theme: { base: C.header },
    text: new Signal(" GARAGE INSTALLER  v3 · deno_tui"),
  });

  new Label({
    parent: tui,
    zIndex: 0,
    rectangle: {
      column: 0,
      row: 1,
      width,
      height: 1,
    },
    theme: { base: C.tab },
    text: new Computed(() => {
      const active = mode.value;
      const tab = (tabMode: UIMode, label: string): string => {
        return active === tabMode ? `[${label}]` : ` ${label} `;
      };
      return `${tab("config", "CONFIG")}  ${tab("validate", "VALIDATE")}  ${tab("health", "HEALTH")}`;
    }),
  });

  const contentBox = new Box({
    parent: tui,
    zIndex: 0,
    rectangle: {
      column: 0,
      row: 2,
      width,
      height: Math.max(1, height - 3),
    },
    theme: { base: C.panel },
  });

  new Label({
    parent: contentBox,
    zIndex: 1,
    rectangle: {
      column: 2,
      row: 1,
      width: Math.max(1, width - 4),
      height: Math.max(1, height - 5),
    },
    theme: { base: C.content },
    text: contentText,
  });

  const healthPane = createHealthPane(
    tui,
    width,
    Math.max(1, height - 3),
    true,
    0,
    2,
    {
      onRefresh: async () => {
        await refreshHealthSnapshot("manual");
      },
    },
  );

  const poller = createPollingController(async () => {
    await refreshHealthSnapshot("poll");
  }, 5000);

  let previousNodeStatuses: string[] = [];

  async function refreshHealthSnapshot(source: "poll" | "manual" | "initial"): Promise<void> {
    const snapshot = await collectHealthSnapshot();
    healthPane.applySnapshot(snapshot);

    const statusLine = snapshot.nodes
      .map((node) => `${node.title}:${node.status.toUpperCase()}`)
      .join(" ");

    if (source !== "poll") {
      healthPane.appendEvent(`[${snapshot.refreshedAt}] ${source} snapshot ${statusLine}`);
    }

    const currentStatuses = snapshot.nodes.map((node) => node.status);
    if (previousNodeStatuses.length) {
      snapshot.nodes.forEach((node, index) => {
        if (previousNodeStatuses[index] !== node.status) {
          healthPane.appendEvent(
            `[${snapshot.refreshedAt}] ${node.title} transitioned ${previousNodeStatuses[index]?.toUpperCase() ?? "UNKNOWN"} -> ${node.status.toUpperCase()}`,
          );
        }
      });
    }
    previousNodeStatuses = currentStatuses;
  }

  void refreshHealthSnapshot("initial");
  poller.start();

  setMode = (nextMode: UIMode): void => {
    mode.value = nextMode;
    const inHealthMode = nextMode === "health";
    healthPane.setVisible(inHealthMode);
    if (inHealthMode) {
      poller.start();
      void refreshHealthSnapshot("initial");
      return;
    }
    poller.stop();
  };

  new Label({
    parent: tui,
    zIndex: 0,
    rectangle: {
      column: 0,
      row: height - 1,
      width,
      height: 1,
    },
    theme: { base: C.hint },
    text: hintText,
  });

  tui.on("keyPress", ({ key, ctrl }: { key: string; ctrl: boolean }) => {
    if ((ctrl && key === "c") || key === "q") {
      tui.destroy();
      return;
    }

    if (key === "tab") {
      setMode(cycleMode(mode.peek()));
      return;
    }

    if (key === "1") {
      setMode("config");
      return;
    }

    if (key === "2") {
      setMode("validate");
      return;
    }

    if (key === "3") {
      setMode("health");
      return;
    }

    if (key === "r" && mode.peek() === "health") {
      void healthPane.refresh();
      return;
    }

    if (mode.peek() === "health" && (key === "j" || key === "down")) {
      healthPane.scrollLogUp();
      return;
    }

    if (mode.peek() === "health" && (key === "k" || key === "up")) {
      healthPane.scrollLogDown();
    }
  });

  tui.on("destroy", () => {
    poller.stop();
    healthPane.destroy();
  });

  tui.run();
}
