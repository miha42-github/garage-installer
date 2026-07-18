import { Computed, Signal } from "tui";
import { Frame, Label } from "tui/components/mod.ts";
import type { Box } from "tui/components/mod.ts";
import type { Component, Tui } from "tui";
import type { StepDef } from "../adapters/wizardAdapter.ts";
import { C } from "../colors.ts";

export type { StepDef };

export type StepStatus = "pending" | "running" | "done" | "fail" | "skip";

export type StepState = {
  label: string;
  status: StepStatus;
  detail: string;
  durationMs: number;
};

export type StepRunResult = {
  passed: number;
  failed: number;
  skipped: number;
  totalMs: number;
};

export type ValidatePaneController = {
  setVisible: (visible: boolean) => void;
  runSteps: (steps: StepDef[]) => Promise<void>;
  reset: () => void;
  isRunning: () => boolean;
  destroy: () => void;
};

type RunStatus = "idle" | "running" | "done" | "fail";

const SPINNER_FRAMES = ["-", "\\", "|", "/"];
const MAX_STEP_ROWS = 10;

function stepIcon(status: StepStatus, frame: number): string {
  if (status === "done") return "✓";
  if (status === "fail") return "✗";
  if (status === "running") return SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
  if (status === "skip") return "-";
  return "·";
}

function runStatusLabel(s: RunStatus): string {
  if (s === "running") return "RUNNING";
  if (s === "done") return "DONE";
  if (s === "fail") return "FAIL";
  return "IDLE";
}

/**
 * Exported pure step runner — testable without TUI.
 * Runs stepDefs sequentially; stops and marks remaining as "skip" on first failure.
 */
export async function runStepSequence(
  stepDefs: StepDef[],
  onUpdate: (states: StepState[]) => void,
): Promise<StepRunResult> {
  const states: StepState[] = stepDefs.map((s) => ({
    label: s.label,
    status: "pending" as StepStatus,
    detail: "",
    durationMs: 0,
  }));
  onUpdate([...states]);

  const startTime = Date.now();
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < stepDefs.length; i++) {
    states[i] = { ...states[i], status: "running" };
    onUpdate([...states]);

    const stepStart = Date.now();
    let detail = "";
    let ok = true;

    try {
      const result = await stepDefs[i].run();
      detail = typeof result === "string" ? result : "ok";
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
      ok = false;
    }

    states[i] = {
      ...states[i],
      status: ok ? "done" : "fail",
      detail,
      durationMs: Date.now() - stepStart,
    };

    if (ok) {
      passed++;
    } else {
      failed++;
      for (let j = i + 1; j < stepDefs.length; j++) {
        states[j] = { ...states[j], status: "skip" };
        skipped++;
      }
      onUpdate([...states]);
      break;
    }
    onUpdate([...states]);
  }

  return { passed, failed, skipped, totalMs: Date.now() - startTime };
}

export function createValidatePane(
  parent: Box | Tui,
  width: number,
  height: number,
  visible: boolean,
  offsetColumn = 0,
  offsetRow = 0,
): ValidatePaneController {
  const components: Component[] = [];
  const Z_FRAME = 8;
  const Z_TEXT = 9;

  const add = <T extends Component>(c: T): T => {
    components.push(c);
    return c;
  };

  const viewWidth = Math.max(40, width);
  const innerWidth = Math.max(20, viewWidth - 4);

  const stepStates = new Signal<StepState[]>([]);
  const runStatus = new Signal<RunStatus>("idle");
  const spinnerFrame = new Signal(0);
  const summaryLine = new Signal(" ");
  let spinnerInterval: ReturnType<typeof setInterval> | undefined;
  let _running = false;

  add(new Label({
    parent,
    zIndex: Z_TEXT,
    rectangle: { column: 2 + offsetColumn, row: 1 + offsetRow, width: innerWidth, height: 1 },
    theme: { base: C.amber },
    text: new Computed(() => `VALIDATE  [${runStatusLabel(runStatus.value)}]`),
  }));

  add(new Label({
    parent,
    zIndex: Z_TEXT,
    rectangle: { column: 2 + offsetColumn, row: 2 + offsetRow, width: innerWidth, height: 1 },
    theme: { base: C.amberMuted },
    text: "End-to-end S3 validation.  Press r to re-run.",
  }));

  const stepAreaTop = 4 + offsetRow;
  const stepRows = Math.min(MAX_STEP_ROWS, Math.max(1, height - stepAreaTop - 4));
  const frameHeight = stepRows + 2;

  add(new Frame({
    parent,
    zIndex: Z_FRAME,
    charMap: "sharp",
    rectangle: {
      column: 2 + offsetColumn,
      row: stepAreaTop,
      width: innerWidth,
      height: frameHeight,
    },
    theme: { base: C.amberGhost },
  }));

  add(new Label({
    parent,
    zIndex: Z_TEXT,
    rectangle: { column: 2 + offsetColumn, row: stepAreaTop, width: innerWidth, height: 1 },
    theme: { base: C.amberFaint },
    text: "STEPS",
  }));

  for (let rowIndex = 0; rowIndex < stepRows; rowIndex++) {
    const ri = rowIndex;
    add(new Label({
      parent,
      zIndex: Z_TEXT,
      rectangle: {
        column: 3 + offsetColumn,
        row: stepAreaTop + 1 + ri,
        width: innerWidth - 2,
        height: 1,
      },
      theme: { base: C.amberMuted },
      text: new Computed(() => {
        const states = stepStates.value;
        const frame = spinnerFrame.value;
        if (ri >= states.length) return " ";
        const s = states[ri];
        const icon = stepIcon(s.status, frame);
        const dur = s.durationMs > 0 ? `  ${s.durationMs}ms` : "";
        const det = s.detail ? `  ${s.detail}` : "";
        const raw = `${icon} ${s.label}${dur}${det}`;
        const max = innerWidth - 2;
        return raw.length > max ? raw.slice(0, max) : raw;
      }),
    }));
  }

  const summaryRow = stepAreaTop + frameHeight + 1;
  add(new Label({
    parent,
    zIndex: Z_TEXT,
    rectangle: { column: 2 + offsetColumn, row: summaryRow, width: innerWidth, height: 1 },
    theme: { base: C.amberFaint },
    text: summaryLine,
  }));

  const setVisible = (v: boolean): void => {
    for (const c of components) c.visible.value = v;
  };

  const reset = (): void => {
    stepStates.value = [];
    runStatus.value = "idle";
    spinnerFrame.value = 0;
    summaryLine.value = " ";
    if (spinnerInterval !== undefined) {
      clearInterval(spinnerInterval);
      spinnerInterval = undefined;
    }
  };

  const runSteps = async (stepDefs: StepDef[]): Promise<void> => {
    if (_running) return;
    _running = true;
    reset();
    runStatus.value = "running";

    spinnerInterval = setInterval(() => {
      spinnerFrame.value = (spinnerFrame.peek() + 1) % SPINNER_FRAMES.length;
    }, 120);

    try {
      const result = await runStepSequence(stepDefs, (states) => {
        stepStates.value = states;
      });

      runStatus.value = result.failed > 0 ? "fail" : "done";
      const total = result.passed + result.failed + result.skipped;
      const failStr = result.failed > 0 ? `  ${result.failed} failed` : "";
      const skipStr = result.skipped > 0 ? `  ${result.skipped} skipped` : "";
      summaryLine.value = `${result.passed}/${total} passed${failStr}${skipStr}  ${result.totalMs}ms`;
    } finally {
      _running = false;
      if (spinnerInterval !== undefined) {
        clearInterval(spinnerInterval);
        spinnerInterval = undefined;
      }
    }
  };

  setVisible(visible);

  return {
    setVisible,
    runSteps,
    reset,
    isRunning: () => _running,
    destroy: () => components.forEach((c) => c.destroy()),
  };
}
