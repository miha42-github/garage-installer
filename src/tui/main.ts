import {
  Computed,
  Signal,
  Tui,
  handleInput,
  handleKeyboardControls,
  handleMouseControls,
} from "tui";
import { Label } from "tui/components/mod.ts";
// Signal is used for the header Label text
import { collectHealthSnapshot, createPollingController, buildValidateFullSteps } from "./adapters/wizardAdapter.ts";
import { C } from "./colors.ts";
import { createHealthPane } from "./panes/health.ts";
import { createValidatePane } from "./panes/validate.ts";
import { createConfigPane } from "./panes/config.ts";
import { AppState } from "./state.ts";
import { createTabBar } from "./components/tabBar.ts";
import type { UIMode } from "./state.ts";

function modeHint(mode: UIMode): string {
  if (mode === "health") {
    return " [q] quit  [tab] mode  [1] config  [2] validate  [3] health  [r] refresh  [j/k] log";
  }
  if (mode === "validate") {
    return " [q] quit  [tab] mode  [1] config  [2] validate  [3] health  [r] re-run";
  }
  return " [q] quit  [tab] mode  [1] config  [2] validate  [3] health";
}

export async function runTUI(): Promise<void> {
  const tui = new Tui({
    style: C.bg,
    refreshRate: 1000 / 60,
  });

  const root = tui.rectangle.peek();
  const width = Math.max(40, root.width);
  const height = Math.max(10, root.height);

  const appState = new AppState("health");

  const hintText = new Computed(() => modeHint(appState.mode.value));

  handleInput(tui);
  handleMouseControls(tui);
  handleKeyboardControls(tui);
  tui.dispatch();

  new Label({
    parent: tui,
    zIndex: 0,
    rectangle: { column: 0, row: 0, width, height: 1 },
    theme: { base: C.header },
    text: new Signal(" GARAGE INSTALLER  v3 · deno_tui"),
  });

  createTabBar(tui, appState.mode, width);

  const configPane = createConfigPane(
    tui,
    width,
    Math.max(1, height - 3),
    false,
    0,
    2,
  );

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

  const validatePane = createValidatePane(
    tui,
    width,
    Math.max(1, height - 3),
    false,
    0,
    2,
  );

  const poller = createPollingController(async () => {
    await refreshHealthSnapshot("poll");
  }, 5000);

  let previousNodeStatuses: string[] = [];

  async function refreshHealthSnapshot(source: "poll" | "manual" | "initial"): Promise<void> {
    const snapshot = await collectHealthSnapshot();
    // Discard stale result if user switched away while request was in-flight.
    // Without this guard, health TextObjects update their canvas cells even when
    // visible=false, bleeding through onto whichever pane is now active.
    if (appState.mode.peek() !== "health") return;
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
            `[${snapshot.refreshedAt}] ${node.title} transitioned ${
              previousNodeStatuses[index]?.toUpperCase() ?? "UNKNOWN"
            } -> ${node.status.toUpperCase()}`,
          );
        }
      });
    }
    previousNodeStatuses = currentStatuses;
  }

  appState.registerPane("health", {
    onMount: async () => {
      configPane.setVisible(false);
      validatePane.setVisible(false);
      healthPane.setVisible(true);
      poller.start();
      await refreshHealthSnapshot("initial");
    },
    onHide: () => {
      // Clear while still visible so TextObjects write blank content to the
      // canvas before we hide. Prevents stale health data bleeding through.
      healthPane.clearDisplay();
      healthPane.setVisible(false);
      poller.stop();
    },
  });

  appState.registerPane("config", {
    onMount: async () => {
      healthPane.setVisible(false);
      validatePane.setVisible(false);
      // Load data before making the pane visible. Without this, configData.value
      // is still null when setVisible(true) fires, so deno_tui has nothing to
      // draw and shows a blank canvas region.
      await configPane.reload();
      configPane.setVisible(true);
    },
    onHide: () => {
      configPane.setVisible(false);
    },
  });

  appState.registerPane("validate", {
    onMount: () => {
      healthPane.setVisible(false);
      configPane.setVisible(false);
      validatePane.setVisible(true);
      if (!validatePane.isRunning()) {
        void validatePane.runSteps(buildValidateFullSteps());
      }
    },
    onHide: () => {
      validatePane.setVisible(false);
    },
  });

  appState.mountInitial();

  new Label({
    parent: tui,
    zIndex: 0,
    rectangle: { column: 0, row: height - 1, width, height: 1 },
    theme: { base: C.hint },
    text: hintText,
  });

  tui.on("keyPress", ({ key, ctrl }: { key: string; ctrl: boolean }) => {
    if ((ctrl && key === "c") || key === "q") {
      tui.emit("destroy");
      return;
    }

    // Config pane captures keys first when in edit/typing state so that
    // "1", "2", "tab", etc. don't trigger mode switches while the user is typing.
    if (appState.mode.peek() === "config") {
      if (configPane.handleKey(key)) return;
    }

    if (key === "tab") { appState.cycleMode(); return; }
    if (key === "1") { appState.switchMode("config"); return; }
    if (key === "2") { appState.switchMode("validate"); return; }
    if (key === "3") { appState.switchMode("health"); return; }

    if (appState.mode.peek() === "health") {
      if (key === "r") { void healthPane.refresh(); return; }
      if (key === "j" || key === "down") { healthPane.scrollLogUp(); return; }
      if (key === "k" || key === "up") { healthPane.scrollLogDown(); return; }
    }

    if (appState.mode.peek() === "validate") {
      if (key === "r") {
        void validatePane.runSteps(buildValidateFullSteps());
        return;
      }
    }
  });

  tui.on("destroy", () => {
    poller.stop();
    healthPane.destroy();
    validatePane.destroy();
    configPane.destroy();
    Deno.exit(0);
  });

  tui.run();
}
