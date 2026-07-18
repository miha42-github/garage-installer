import { Computed, Signal } from "tui";
import { Box, Frame, Label } from "tui/components/mod.ts";
import type { Component } from "tui";
import type { Tui } from "tui";
import type { HealthSnapshot, HealthStatus } from "../adapters/wizardAdapter.ts";
import { C } from "../colors.ts";

type HealthPaneController = {
  setVisible: (visible: boolean) => void;
  clearDisplay: () => void;
  refresh: () => Promise<void>;
  applySnapshot: (snapshot: HealthSnapshot) => void;
  appendEvent: (line: string) => void;
  scrollLogUp: () => void;
  scrollLogDown: () => void;
  destroy: () => void;
};

type HealthMetric = {
  title: string;
  value: string;
  detail: string;
  status: "ok" | "warn" | "down" | "idle";
};

type HealthNode = {
  title: string;
  role: string;
  zone: string;
  host: string;
  statusLabel: string;
  s3: HealthSnapshot["nodes"][number]["s3"];
  admin: HealthSnapshot["nodes"][number]["admin"];
  ping: HealthSnapshot["nodes"][number]["ping"];
  ssh: HealthSnapshot["nodes"][number]["ssh"];
  status: HealthStatus;
};

type HealthPaneOptions = {
  onRefresh?: () => Promise<void>;
};

function statusStyle(status: HealthMetric["status"]) {
  if (status === "ok") return C.green;
  if (status === "down") return C.red;
  if (status === "warn") return C.amber;
  return C.amberMuted;
}

function statusTag(status: HealthMetric["status"]): string {
  if (status === "ok") return "OK";
  if (status === "down") return "DOWN";
  if (status === "warn") return "WARN";
  return "IDLE";
}

function nodeStatusTag(status: HealthStatus): string {
  if (status === "ok") return "OK";
  if (status === "down") return "DOWN";
  return "WARN";
}

export function createHealthPane(
  parent: Box | Tui,
  width: number,
  height: number,
  visible: boolean,
  offsetColumn = 0,
  offsetRow = 0,
  options: HealthPaneOptions = {},
): HealthPaneController {
  const components: Component[] = [];
  const Z_FRAME = 8;
  const Z_TEXT = 9;
  const eventLog = new Signal<string[]>([
    "[boot] Health pane mounted.",
    "[mode] Polling is enabled in Health mode (5s interval).",
  ]);
  const eventScroll = new Signal(0);
  const lastRefresh = new Signal("pending");

  const add = <T extends Component>(component: T): T => {
    components.push(component);
    return component;
  };

  const viewWidth = Math.max(40, width);
  const viewHeight = Math.max(10, height);
  const innerWidth = Math.max(20, viewWidth - 4);

  add(new Label({
    parent,
    zIndex: Z_TEXT,
    rectangle: {
      column: 2,
      row: 1 + offsetRow,
      width: innerWidth,
      height: 1,
    },
    theme: { base: C.amber },
    text: new Computed(() => `HEALTH OVERVIEW  [READ-ONLY]  Last refresh ${lastRefresh.value}`),
  }));

  add(new Label({
    parent,
    zIndex: Z_TEXT,
    rectangle: {
      column: 2,
      row: 2 + offsetRow,
      width: innerWidth,
      height: 1,
    },
    theme: { base: C.amberMuted },
    text: "Press r for manual refresh. Polling runs every 5s in Health mode.",
  }));

  const nodes = new Signal<HealthNode[]>([
    {
      title: "NODE 0",
      host: "pending",
      role: "Primary",
      zone: "dc1",
      statusLabel: "WARN",
      s3: { status: "warn", summary: "WARN pending" },
      admin: { status: "warn", summary: "WARN pending" },
      ping: { status: "warn", summary: "WARN pending" },
      ssh: { status: "warn", summary: "WARN pending" },
      status: "warn",
    },
    {
      title: "NODE 1",
      host: "pending",
      role: "Secondary",
      zone: "dc1",
      statusLabel: "WARN",
      s3: { status: "warn", summary: "WARN pending" },
      admin: { status: "warn", summary: "WARN pending" },
      ping: { status: "warn", summary: "WARN pending" },
      ssh: { status: "warn", summary: "WARN pending" },
      status: "warn",
    },
  ]);

  const metricsTop = 4;
  const metricCols = viewWidth >= 108 ? 4 : 2;
  const metricWidth = Math.max(20, Math.floor((innerWidth - (metricCols - 1) * 2) / metricCols));
  const metricRows = Math.ceil(4 / metricCols);
  const nodeTop = metricsTop + metricRows * 4 + 1;
  const nodeHeight = 10;
  const twoColumns = viewWidth >= 92;
  const nodeWidth = twoColumns
    ? Math.max(20, Math.floor((innerWidth - 2) / 2))
    : innerWidth;

  const metrics = new Signal<HealthMetric[]>([
    { title: "CLUSTER", value: "DISCOVERY", detail: "static shell", status: "warn" },
    { title: "REPLICATION", value: "2x TARGET", detail: "design baseline", status: "ok" },
    { title: "STORAGE", value: "NOT PROBED", detail: "adapter pending", status: "idle" },
    { title: "API", value: "MANUAL ONLY", detail: "refresh is local only", status: "warn" },
  ]);

  [0, 1, 2, 3].forEach((index) => {
    const metric = new Computed(() => metrics.value[index]);
    const metricRow = metricsTop + Math.floor(index / metricCols) * 4;
    const metricColumn = 2 + (index % metricCols) * (metricWidth + 2);

    add(new Frame({
      parent,
      zIndex: Z_FRAME,
      charMap: "sharp",
      rectangle: {
        column: metricColumn + offsetColumn,
        row: metricRow + offsetRow,
        width: metricWidth,
        height: 3,
      },
      theme: { base: C.amberGhost },
    }));

    add(new Label({
      parent,
      zIndex: Z_TEXT,
      rectangle: {
        column: metricColumn + offsetColumn,
        row: metricRow + offsetRow,
        width: metricWidth,
        height: 1,
      },
      theme: { base: C.amberFaint },
      text: new Computed(() => metric.value.title),
    }));

    add(new Label({
      parent,
      zIndex: Z_TEXT,
      rectangle: {
        column: metricColumn + 1 + offsetColumn,
        row: metricRow + 1 + offsetRow,
        width: metricWidth - 2,
        height: 1,
      },
      theme: { base: C.amber },
      text: new Computed(() => `${metric.value.value} [${statusTag(metric.value.status)}]`),
    }));

    add(new Label({
      parent,
      zIndex: Z_TEXT,
      rectangle: {
        column: metricColumn + 1 + offsetColumn,
        row: metricRow + 2 + offsetRow,
        width: metricWidth - 2,
        height: 1,
      },
      theme: { base: C.amberMuted },
      text: new Computed(() => {
        const d = metric.value.detail;
        const max = metricWidth - 2;
        return d.length > max ? d.slice(0, max) : d;
      }),
    }));
  });

  [0, 1].forEach((index) => {
    const node = new Computed(() => nodes.value[index]);
    const row = twoColumns ? nodeTop : nodeTop + index * (nodeHeight + 1);
    const column = twoColumns ? 2 + index * (nodeWidth + 2) : 2;

    add(new Frame({
      parent,
      zIndex: Z_FRAME,
      charMap: "sharp",
      rectangle: {
        column: column + offsetColumn,
        row: row + offsetRow,
        width: nodeWidth,
        height: nodeHeight,
      },
      theme: { base: C.amberGhost },
    }));

    add(new Label({
      parent,
      zIndex: Z_TEXT,
      rectangle: {
        column: column + offsetColumn,
        row: row + offsetRow,
        width: nodeWidth,
        height: 1,
      },
      theme: { base: C.amber },
      text: new Computed(() => {
        const current = node.value;
        return `${current.title} [${nodeStatusTag(current.status)}]`;
      }),
    }));

    [0, 1, 2, 3, 4, 5, 6, 7].forEach((lineIndex) => {
      add(new Label({
        parent,
        zIndex: Z_TEXT,
        rectangle: {
          column: column + 1 + offsetColumn,
          row: row + 1 + lineIndex + offsetRow,
          width: nodeWidth - 2,
          height: 1,
        },
        theme: { base: lineIndex < 4 ? C.amberMuted : C.amberFaint },
        text: new Computed(() => {
          const current = node.value;
          if (lineIndex === 0) return `Status: ${current.statusLabel}`;
          if (lineIndex === 1) return `Role:     ${current.role}`;
          if (lineIndex === 2) return `Zone:     ${current.zone}`;
          if (lineIndex === 3) return `Host:     ${current.host}`;
          if (lineIndex === 4) return `S3:       ${current.s3.summary}`;
          if (lineIndex === 5) return `Admin:    ${current.admin.summary}`;
          if (lineIndex === 6) return `Ping:     ${current.ping.summary}`;
          return `SSH:      ${current.ssh.summary}`;
        }),
      }));
    });
  });

  const logTop = nodeTop + (twoColumns ? nodeHeight : nodes.peek().length * (nodeHeight + 1)) + 1;
  const logHeight = Math.max(6, viewHeight - logTop - 2);
  const logLines = Math.max(1, logHeight - 2);

  add(new Frame({
    parent,
    zIndex: Z_FRAME,
    charMap: "sharp",
    rectangle: {
      column: 2 + offsetColumn,
      row: logTop + offsetRow,
      width: innerWidth,
      height: logHeight,
    },
    theme: { base: C.amberGhost },
  }));

  add(new Label({
    parent,
    zIndex: Z_TEXT,
    rectangle: {
      column: 2 + offsetColumn,
      row: logTop + offsetRow,
      width: innerWidth,
      height: 1,
    },
    theme: { base: C.amberFaint },
    text: new Computed(() => {
      const older = eventScroll.value;
      return older > 0 ? `EVENT LOG [j/k scroll ${older}]` : "EVENT LOG [j/k scroll]";
    }),
  }));

  for (let lineIndex = 0; lineIndex < logLines; lineIndex++) {
    add(new Label({
      parent,
      zIndex: Z_TEXT,
      rectangle: {
        column: 3 + offsetColumn,
        row: logTop + 1 + lineIndex + offsetRow,
        width: innerWidth - 2,
        height: 1,
      },
      theme: { base: C.amberMuted },
      text: new Computed(() => {
        const logs = eventLog.value;
        const maxOffset = Math.max(0, logs.length - logLines);
        const offset = Math.min(eventScroll.value, maxOffset);
        const start = Math.max(0, logs.length - logLines - offset);
        return logs[start + lineIndex] ?? "";
      }),
    }));
  }

  const appendEvent = (line: string): void => {
    eventLog.value = [
      ...eventLog.peek(),
      line,
    ].slice(-200);
    if (eventScroll.peek() === 0) {
      eventScroll.value = 0;
    }
  };

  const applySnapshot = (snapshot: HealthSnapshot): void => {
    lastRefresh.value = snapshot.refreshedAt;
    nodes.value = snapshot.nodes.slice(0, 2).map((node, index) => ({
      title: node.title || `NODE ${index}`,
      host: node.host,
      role: node.role,
      zone: node.zone,
      statusLabel: node.statusLabel,
      s3: node.s3,
      admin: node.admin,
      ping: node.ping,
      ssh: node.ssh,
      status: node.status,
    }));
    metrics.value = snapshot.metrics.slice(0, 4).map((metric) => ({
      title: metric.title,
      value: metric.value,
      detail: metric.detail,
      status: metric.status,
    }));
  };

  const refresh = async (): Promise<void> => {
    const at = new Date().toLocaleTimeString();
    appendEvent(`[${at}] Manual refresh requested.`);

    if (!options.onRefresh) {
      appendEvent(`[${at}] No refresh handler configured.`);
      return;
    }

    try {
      await options.onRefresh();
      appendEvent(`[${new Date().toLocaleTimeString()}] Manual refresh completed.`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      appendEvent(`[${new Date().toLocaleTimeString()}] Refresh failed: ${err.message}`);
    }
  };

  const setVisible = (nextVisible: boolean): void => {
    for (const component of components) {
      component.visible.value = nextVisible;
    }
  };

  // Call BEFORE setVisible(false). While components are still visible, this
  // forces their TextObjects to write idle/blank content to the canvas so
  // stale health data doesn't bleed through onto other panes.
  const clearDisplay = (): void => {
    lastRefresh.value = "---";
    const blank = nodes.peek().map((n) => ({
      ...n,
      statusLabel: "---",
      s3: { status: "warn" as const, summary: "---" },
      admin: { status: "warn" as const, summary: "---" },
      ping: { status: "warn" as const, summary: "---" },
      ssh: { status: "warn" as const, summary: "---" },
      status: "warn" as const,
    }));
    nodes.value = blank;
    metrics.value = metrics.peek().map((m) => ({ ...m, value: "---", detail: "---", status: "idle" as const }));
  };

  const scrollLogUp = (): void => {
    const maxOffset = Math.max(0, eventLog.peek().length - logLines);
    eventScroll.value = Math.min(maxOffset, eventScroll.peek() + 1);
  };

  const scrollLogDown = (): void => {
    eventScroll.value = Math.max(0, eventScroll.peek() - 1);
  };

  setVisible(visible);

  return {
    setVisible,
    clearDisplay,
    applySnapshot,
    appendEvent,
    scrollLogUp,
    scrollLogDown,
    refresh,
    destroy: () => components.forEach((component) => component.destroy()),
  };
}
