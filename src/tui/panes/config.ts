import { Computed, Signal } from "tui";
import { Box, Label } from "tui/components/mod.ts";
import type { Component, Tui } from "tui";
import { C } from "../colors.ts";
import type { GarageClusterFile } from "../../wizard/services/configLoader.ts";
import { loadGarageClusterConfig, saveGarageClusterConfig } from "../../wizard/services/configLoader.ts";

// ── Field definitions (exported for tests) ────────────────────────────────

export type ConfigFieldDef = {
  label: string;
  get: (cfg: GarageClusterFile) => string;
  set: (cfg: GarageClusterFile, val: string) => GarageClusterFile;
  validate: (val: string) => string | null;
};

function setNode(cfg: GarageClusterFile, i: number, patch: Partial<{ name: string; host: string }>): GarageClusterFile {
  const nodes = [...(cfg.nodes ?? [])];
  while (nodes.length <= i) nodes.push({ name: "", host: "" });
  nodes[i] = { ...nodes[i], ...patch };
  return { ...cfg, nodes };
}

function setPorts(cfg: GarageClusterFile, patch: Partial<NonNullable<GarageClusterFile["cluster"]>["ports"]>): GarageClusterFile {
  return { ...cfg, cluster: { ...cfg.cluster, ports: { ...cfg.cluster?.ports, ...patch } } };
}

function nonEmpty(v: string): string | null {
  return v.trim() ? null : "required";
}

function portRange(v: string): string | null {
  const n = parseInt(v, 10);
  return !isNaN(n) && n >= 1 && n <= 65535 ? null : "must be 1–65535";
}

export const CONFIG_FIELDS: ConfigFieldDef[] = [
  {
    label: "  node 0   name",
    get: (c) => c.nodes?.[0]?.name ?? "",
    set: (c, v) => setNode(c, 0, { name: v }),
    validate: nonEmpty,
  },
  {
    label: "           host",
    get: (c) => c.nodes?.[0]?.host ?? "",
    set: (c, v) => setNode(c, 0, { host: v }),
    validate: nonEmpty,
  },
  {
    label: "  node 1   name",
    get: (c) => c.nodes?.[1]?.name ?? "",
    set: (c, v) => setNode(c, 1, { name: v }),
    validate: nonEmpty,
  },
  {
    label: "           host",
    get: (c) => c.nodes?.[1]?.host ?? "",
    set: (c, v) => setNode(c, 1, { host: v }),
    validate: nonEmpty,
  },
  {
    label: "  replication",
    get: (c) => String(c.cluster?.replicationFactor ?? 2),
    set: (c, v) => ({ ...c, cluster: { ...c.cluster, replicationFactor: parseInt(v, 10) } }),
    validate: (v) => {
      const n = parseInt(v, 10);
      return !isNaN(n) && n >= 1 && n <= 10 ? null : "must be 1–10";
    },
  },
  {
    label: "  s3 api port",
    get: (c) => String(c.cluster?.ports?.s3Api ?? 3900),
    set: (c, v) => setPorts(c, { s3Api: parseInt(v, 10) }),
    validate: portRange,
  },
  {
    label: "  admin port",
    get: (c) => String(c.cluster?.ports?.admin ?? 3903),
    set: (c, v) => setPorts(c, { admin: parseInt(v, 10) }),
    validate: portRange,
  },
  {
    label: "  rpc port",
    get: (c) => String(c.cluster?.ports?.rpc ?? 3901),
    set: (c, v) => setPorts(c, { rpc: parseInt(v, 10) }),
    validate: portRange,
  },
  {
    label: "  web port",
    get: (c) => String(c.cluster?.ports?.s3Web ?? 3902),
    set: (c, v) => setPorts(c, { s3Web: parseInt(v, 10) }),
    validate: portRange,
  },
];

// ── Pane ──────────────────────────────────────────────────────────────────

export type ConfigPaneController = {
  setVisible: (v: boolean) => void;
  reload: (configFile?: string) => Promise<void>;
  handleKey: (key: string) => boolean;
  destroy: () => void;
};

type EditPhase = "view" | "nav" | "type";

function modeLabel(phase: EditPhase, hasConfig: boolean): string {
  if (!hasConfig) return "NO CONFIG";
  if (phase === "view") return "VIEWING";
  if (phase === "nav") return "EDITING";
  return "TYPING";
}

function modeHint(phase: EditPhase, hasConfig: boolean): string {
  if (!hasConfig) return "Run install to generate a config file.";
  if (phase === "view") return "[e] edit  [r] reload";
  if (phase === "nav") return "[j/k] move  [Enter] edit field  [s] save  [Esc] exit edit";
  return "[chars] type  [Backspace] delete  [Enter] confirm  [Esc] cancel";
}

// Row offsets for the field Labels within the content area (relative to offsetRow).
// Gaps between sections are interleaved here.
const FIELD_ROW: number[] = [
  5,  // node0 name
  6,  // node0 host
  8,  // node1 name
  9,  // node1 host
  13, // replication
  14, // s3 api port
  15, // admin port
  16, // rpc port
  17, // web port
];

export function createConfigPane(
  parent: Box | Tui,
  width: number,
  _height: number,
  visible: boolean,
  offsetColumn = 0,
  offsetRow = 0,
  configFile?: string,
): ConfigPaneController {
  const components: Component[] = [];
  const Z_BG = 10;
  const Z = 11;

  const add = <T extends Component>(c: T): T => {
    components.push(c);
    return c;
  };

  const innerWidth = Math.max(20, width - 4);

  add(new Box({
    parent,
    zIndex: Z_BG,
    rectangle: { column: offsetColumn, row: offsetRow, width, height: Math.max(1, _height) },
    theme: { base: C.bg },
  }));

  // ── State ──
  const configData = new Signal<GarageClusterFile | null>(null);
  const phase = new Signal<EditPhase>("view");
  const focusedField = new Signal(0);
  const typingField = new Signal(-1);
  const editBuffer = new Signal("");
  const saveStatus = new Signal(" ");
  const errorMsg = new Signal(" ");

  // ── Labels ──
  add(new Label({
    parent, zIndex: Z,
    rectangle: { column: 2 + offsetColumn, row: 1 + offsetRow, width: innerWidth, height: 1 },
    theme: { base: C.amber },
    text: new Computed(() => {
      const cfg = configData.value;
      return `CONFIG  [${modeLabel(phase.value, cfg !== null)}]`;
    }),
  }));

  add(new Label({
    parent, zIndex: Z,
    rectangle: { column: 2 + offsetColumn, row: 2 + offsetRow, width: innerWidth, height: 1 },
    theme: { base: C.amberMuted },
    text: new Computed(() => modeHint(phase.value, configData.value !== null)),
  }));

  // Section headers (static text)
  const staticRows: Array<[number, string]> = [
    [4, "NODES"],
    [7, ""],
    [11, "CLUSTER"],
    [18, "CREDENTIALS  (read-only)"],
  ];
  for (const [row, text] of staticRows) {
    add(new Label({
      parent, zIndex: Z,
      rectangle: { column: 2 + offsetColumn, row: row + offsetRow, width: innerWidth, height: 1 },
      theme: { base: C.amberFaint },
      text: new Signal(text),
    }));
  }

  // Editable field Labels
  for (let fi = 0; fi < CONFIG_FIELDS.length; fi++) {
    const fieldIndex = fi;
    add(new Label({
      parent, zIndex: Z,
      rectangle: {
        column: 2 + offsetColumn,
        row: FIELD_ROW[fieldIndex] + offsetRow,
        width: innerWidth,
        height: 1,
      },
      theme: { base: C.amberMuted },
      text: new Computed(() => {
        const cfg = configData.value;
        const focused = phase.value !== "view" && focusedField.value === fieldIndex;
        const typing = typingField.value === fieldIndex;
        const f = CONFIG_FIELDS[fieldIndex];
        const prefix = focused ? ">" : " ";
        const raw = cfg ? f.get(cfg) : "(no config)";
        const valueStr = typing ? `[${editBuffer.value}_]` : raw;
        const padLabel = f.label.padEnd(16);
        const line = `${prefix}${padLabel}  ${valueStr}`;
        return line.length > innerWidth ? line.slice(0, innerWidth) : line;
      }),
    }));
  }

  // Read-only: admin token
  add(new Label({
    parent, zIndex: Z,
    rectangle: { column: 2 + offsetColumn, row: 19 + offsetRow, width: innerWidth, height: 1 },
    theme: { base: C.amberFaint },
    text: new Computed(() => {
      const cfg = configData.value;
      const token = cfg?.cluster?.adminToken;
      return `   admin token   ${token ? "[SET]" : "[NOT SET]"}`;
    }),
  }));

  // Status / error rows
  add(new Label({
    parent, zIndex: Z,
    rectangle: { column: 2 + offsetColumn, row: 21 + offsetRow, width: innerWidth, height: 1 },
    theme: { base: C.green },
    text: saveStatus,
  }));

  add(new Label({
    parent, zIndex: Z,
    rectangle: { column: 2 + offsetColumn, row: 22 + offsetRow, width: innerWidth, height: 1 },
    theme: { base: C.red },
    text: errorMsg,
  }));

  // ── Helpers ──
  const clearMessages = () => {
    saveStatus.value = " ";
    errorMsg.value = " ";
  };

  const reload = async (file?: string): Promise<void> => {
    const cfg = await loadGarageClusterConfig(file ?? configFile);
    configData.value = cfg;
    phase.value = "view";
    focusedField.value = 0;
    typingField.value = -1;
    editBuffer.value = "";
    clearMessages();
  };

  const save = async (): Promise<void> => {
    const cfg = configData.peek();
    if (!cfg) return;
    try {
      await saveGarageClusterConfig(cfg, configFile);
      saveStatus.value = `Saved at ${new Date().toLocaleTimeString()}`;
      errorMsg.value = " ";
    } catch (err) {
      errorMsg.value = err instanceof Error ? err.message : String(err);
    }
  };

  const confirmEdit = (): void => {
    const fi = typingField.peek();
    if (fi < 0) return;
    const val = editBuffer.peek();
    const field = CONFIG_FIELDS[fi];
    const validErr = field.validate(val);
    if (validErr) {
      errorMsg.value = validErr;
      return;
    }
    const cfg = configData.peek();
    if (!cfg) return;
    configData.value = field.set(cfg, val);
    typingField.value = -1;
    editBuffer.value = "";
    saveStatus.value = "Unsaved changes";
    errorMsg.value = " ";
  };

  const cancelEdit = (): void => {
    typingField.value = -1;
    editBuffer.value = "";
    errorMsg.value = " ";
  };

  // ── Key handler (called by main.ts in config mode) ──
  const handleKey = (key: string): boolean => {
    const currentPhase = phase.peek();
    const cfg = configData.peek();

    if (currentPhase === "view") {
      if (key === "e" && cfg) {
        phase.value = "nav";
        clearMessages();
        return true;
      }
      if (key === "r") {
        void reload();
        return true;
      }
      return false;
    }

    if (currentPhase === "nav") {
      if (key === "escape" || key === "esc") {
        phase.value = "view";
        clearMessages();
        return true;
      }
      if (key === "j" || key === "down") {
        focusedField.value = Math.min(CONFIG_FIELDS.length - 1, focusedField.peek() + 1);
        return true;
      }
      if (key === "k" || key === "up") {
        focusedField.value = Math.max(0, focusedField.peek() - 1);
        return true;
      }
      if (key === "return" || key === "enter" || key === "\r") {
        const fi = focusedField.peek();
        const value = cfg ? CONFIG_FIELDS[fi].get(cfg) : "";
        typingField.value = fi;
        editBuffer.value = value;
        phase.value = "type";
        clearMessages();
        return true;
      }
      if (key === "s") {
        void save();
        return true;
      }
      return true; // absorb all keys in nav mode
    }

    if (currentPhase === "type") {
      if (key === "escape" || key === "esc") {
        cancelEdit();
        phase.value = "nav";
        return true;
      }
      if (key === "return" || key === "enter" || key === "\r") {
        confirmEdit();
        phase.value = "nav";
        return true;
      }
      if (key === "backspace") {
        const buf = editBuffer.peek();
        editBuffer.value = buf.slice(0, -1);
        return true;
      }
      // Printable character
      if (key.length === 1) {
        editBuffer.value = editBuffer.peek() + key;
        return true;
      }
      if (key === "space") {
        editBuffer.value = editBuffer.peek() + " ";
        return true;
      }
      return true; // absorb all keys while typing
    }

    return false;
  };

  const setVisible = (v: boolean): void => {
    for (const c of components) c.visible.value = v;
  };

  setVisible(visible);

  return {
    setVisible,
    reload,
    handleKey,
    destroy: () => components.forEach((c) => c.destroy()),
  };
}
