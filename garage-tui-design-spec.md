# Garage Installer — TUI Design Spec v3
**For:** GitHub Copilot implementation  
**Stack:** Deno + deno_tui (Im-Beast/deno_tui) + crayon  
**Aesthetic:** Retro terminal (amber/green on black)

---

## Why this version exists

`neo-blessed` (and upstream `blessed`) are **not usable in this repo under Deno**. The CommonJS/Node prototype chain that blessed depends on does not reconstruct correctly under Deno's npm interop layer. The failure is a recursive `Screen` constructor stack overflow that occurs before any app logic runs — it is a library/runtime compatibility problem, not a pane layout bug. Patching prototype chains at runtime shifts the failure to `TypeError: this.input.on is not a function` and deeper stream/event assumptions. The path is a dead end.

This spec targets **deno_tui** (`https://deno.land/x/tui@2.1.11`) — a pure-Deno, zero-npm-dependency TUI framework by Im-Beast. No CommonJS, no Node stream assumptions, no interop layer.

---

## Table of contents

1. [Project context](#1-project-context)
2. [Tech stack and dependencies](#2-tech-stack-and-dependencies)
3. [deno_tui core concepts](#3-deno_tui-core-concepts)
4. [Color and style tokens](#4-color-and-style-tokens)
5. [Global layout](#5-global-layout)
6. [Mode: Config](#6-mode-config)
7. [Mode: Validate](#7-mode-validate)
8. [Mode: Health](#8-mode-health)
9. [State model](#9-state-model)
10. [Component patterns](#10-component-patterns)
11. [Coding hints for Copilot](#11-coding-hints-for-copilot)
12. [File structure](#12-file-structure)

---

## 1. Project context

This is a **redesign** of an existing TUI for a two-node [Garage](https://garagehq.deuxfleurs.fr/) S3-compatible object store installer. The existing raw-mode ANSI shell in `src/tui/main.ts` and `src/tui/panes/health.ts` is the working baseline. This spec replaces the UI layer with deno_tui widgets while keeping the existing operation logic (`src/operations/`) intact.

### What the installer does

| Operation | Description |
|---|---|
| Install | Write node configs, start node processes, apply cluster layout |
| Validate | PUT/GET/DELETE test objects against each bucket |
| Create buckets | Create named S3 buckets via the Garage admin API |
| Health check | Poll node status, replication state, API latency |
| Uninstall | Stop processes, remove data/meta directories |

### Two-node topology

- **Node 0** — Primary, `127.0.0.1:3901`, zone `dc1`
- **Node 1** — Secondary, `127.0.0.1:3902`, zone `dc1`
- Replication factor: 2
- Both nodes run locally during development

---

## 2. Tech stack and dependencies

```typescript
// deno.json imports
{
  "imports": {
    "tui":         "https://deno.land/x/tui@2.1.11/mod.ts",
    "tui/":        "https://deno.land/x/tui@2.1.11/src/",
    "crayon":      "https://deno.land/x/crayon@3.3.3/mod.ts"
  }
}
```

```typescript
// Core imports used throughout the app
import {
  Tui, Signal, Computed,
  handleInput, handleKeyboardControls, handleMouseControls
} from "tui";
import { Box, Frame, Label, Button, Text, ProgressBar } from "tui/components/mod.ts";
import { crayon } from "crayon";
```

### Why deno_tui

- Pure Deno TypeScript — no npm, no CommonJS, no Node interop
- Zero external dependencies (crayon is optional but well-integrated)
- Reactive via `Signal` / `Computed` — component content updates automatically when signals change
- OOP component model: `new Button({ parent, rectangle, theme, label })`
- Built-in: `Box`, `Frame`, `Label`, `Button`, `Text`, `ProgressBar`, `Table`, `Input`, `Slider`, `CheckBox`
- Required permissions: **none** for the TUI layer itself

### Deno permissions for the full app

```jsonc
// deno.json tasks
{
  "tasks": {
    "dev": "deno run --allow-run --allow-read --allow-write --allow-net src/tui/main.ts"
  }
}
```

---

## 3. deno_tui core concepts

Understanding these five concepts is the key to writing deno_tui correctly.

### 3.1 Tui — the root

`Tui` is the root element. Everything is a child of it (directly or transitively). It owns the canvas, the event loop, and terminal I/O.

```typescript
const tui = new Tui({
  style: crayon.bgBlack,   // background style for the entire canvas
  refreshRate: 1000 / 60,  // 60fps render loop
});

tui.dispatch();            // register CTRL+C handler to destroy tui and exit
tui.run();                 // start the render loop (async, returns when tui is destroyed)
```

### 3.2 Signal and Computed — reactivity

deno_tui is reactive. Component properties that accept `Signal<T>` or `Computed<T>` will re-render automatically when the value changes. This is the correct way to drive dynamic content — do not manually redraw components.

```typescript
// A mutable reactive value
const stepName = new Signal("Preflight checks");

// A derived value — recomputes automatically when stepName changes
const stepLabel = new Computed(() => `> ${stepName.value}`);

// Read the current value synchronously (safe outside reactive context)
const current = stepName.peek();

// Update — triggers re-render of any component observing this signal
stepName.value = "Write configs";
```

### 3.3 Rectangle — positioning

All components use `rectangle: { column, row, width, height }`. These are **terminal cell coordinates**, not pixels. `column` = x (0-based from left), `row` = y (0-based from top).

```typescript
rectangle: {
  column: 2,    // 2 chars from left
  row: 3,       // 3 rows from top
  width: 40,    // 40 chars wide
  height: 1,    // 1 row tall
}
```

For full-width components, use a `Computed` that reads `tui.rectangle`:

```typescript
rectangle: new Computed(() => ({
  column: 0,
  row: 0,
  width: tui.rectangle.peek().width,
  height: 1,
})),
```

### 3.4 Theme — styling

Component themes use crayon style functions. Each component has at minimum `base`, `focused`, and `active` theme states.

```typescript
theme: {
  base:    crayon.bgBlack.hex("#c8a228"),          // normal state
  focused: crayon.bgBlack.hex("#c8a228").bold,     // keyboard focus
  active:  crayon.bgBlack.hex("#4ecb6e").bold,     // pressed/activated
}
```

For non-interactive display components (`Label`, `Text`, `Box`), only `base` is needed.

### 3.5 Input handling

deno_tui separates input wiring from the component tree. You must call all three handlers after creating `tui` but before `tui.run()`:

```typescript
handleInput(tui);            // read stdin
handleMouseControls(tui);    // mouse click/drag events on components
handleKeyboardControls(tui); // tab focus, enter/space activation
```

For custom key bindings (mode switching, quit), listen on `tui`:

```typescript
tui.on("keyPress", ({ key, ctrl }) => {
  if (ctrl && key === "c") Deno.exit(0);
  if (key === "tab")  cycleMode();
  if (key === "1")    switchMode("config");
  if (key === "2")    switchMode("validate");
  if (key === "3")    switchMode("health");
  if (key === "q")    confirmQuit();
});
```

---

## 4. Color and style tokens

All colors are hardcoded hex — retro terminal aesthetic, not system-theme aware.

```typescript
// src/tui/colors.ts
import { crayon } from "crayon";

export const C = {
  // Amber — primary accent
  amber:      crayon.bgBlack.hex("#c8a228"),
  amberDim:   crayon.bgBlack.hex("#8a7820"),
  amberMuted: crayon.bgBlack.hex("#7a6a10"),
  amberFaint: crayon.bgBlack.hex("#5a5000"),
  amberGhost: crayon.bgBlack.hex("#3a3200"),

  // Green — ok / success
  green:      crayon.bgBlack.hex("#4ecb6e"),
  greenDim:   crayon.bgBlack.hex("#2a5030"),
  greenFaint: crayon.bgBlack.hex("#1a3020"),

  // Red — error / danger
  red:        crayon.bgBlack.hex("#cb4e4e"),
  redDim:     crayon.bgBlack.hex("#5a2010"),
  redFaint:   crayon.bgBlack.hex("#2e1000"),

  // Structural
  bg:         crayon.bgBlack,
  bgPanel:    crayon.bgHex("#0d0d00"),
  bgField:    crayon.bgHex("#111000"),
  bgNode:     crayon.bgHex("#0e0d00"),
  bgLog:      crayon.bgHex("#080800"),
  bgHealthOk: crayon.bgHex("#090d09"),
  sectionLbl: crayon.bgBlack.hex("#5a5000"),
  tabInact:   crayon.bgBlack.hex("#4a4000"),
  logTs:      crayon.bgBlack.hex("#222000"),
  logOk:      crayon.bgBlack.hex("#2a5030"),
  logWarn:    crayon.bgBlack.hex("#5a4800"),
  logErr:     crayon.bgBlack.hex("#5a2010"),
  logInfo:    crayon.bgBlack.hex("#3a5030"),
} as const;
```

### Hex values reference

| Role | Hex |
|---|---|
| Amber primary | `#c8a228` |
| Amber dim | `#8a7820` |
| Green ok | `#4ecb6e` |
| Red error | `#cb4e4e` |
| BG main | `#000000` (crayon.bgBlack) |
| BG panel | `#0d0d00` |
| BG field | `#111000` |
| Section label | `#5a5000` |
| Tab inactive | `#4a4000` |

---

## 5. Global layout

```
row 0:  ┌─────────────────────────────────────────────────┐
        │  GARAGE INSTALLER  v3 · deno_tui                │  ← header Label (height 1)
row 1:  ├──────────┬────────────┬───────────────────────-─┤
        │ [CONFIG] │ [VALIDATE] │ [HEALTH]                 │  ← tab bar Label (height 1)
row 2:  ├──────────┴────────────┴─────────────────────────┤
        │                                                  │
        │               ACTIVE PANE                        │  ← content Box (fills remaining)
        │                                                  │
row N-1:├──────────────────────────────────────────────────┤
        │  [q] quit  [tab] mode  [1] config  [2] validate  │  ← hint bar Label (height 1)
        └──────────────────────────────────────────────────┘
```

### Screen setup

```typescript
import {
  Tui, Signal, Computed,
  handleInput, handleKeyboardControls, handleMouseControls
} from "tui";
import { Label, Box } from "tui/components/mod.ts";
import { C } from "./colors.ts";

const tui = new Tui({
  style: C.bg,
  refreshRate: 1000 / 60,
});

handleInput(tui);
handleMouseControls(tui);
handleKeyboardControls(tui);
tui.dispatch();

// Header bar
new Label({
  parent: tui,
  zIndex: 0,
  rectangle: new Computed(() => ({
    column: 0, row: 0,
    width: tui.rectangle.peek().width,
    height: 1,
  })),
  theme: { base: C.bgPanel.hex("#c8a228").bold },
  label: { text: new Signal(" GARAGE INSTALLER  v3 · deno_tui") },
});

// Tab bar — driven by activeMode signal
const activeMode = new Signal<"config" | "validate" | "health">("config");

new Label({
  parent: tui,
  zIndex: 0,
  rectangle: new Computed(() => ({
    column: 0, row: 1,
    width: tui.rectangle.peek().width,
    height: 1,
  })),
  theme: { base: C.bgPanel.hex("#c8a228") },
  label: {
    text: new Computed(() => {
      const m = activeMode.value;
      const tab = (id: string, label: string) =>
        m === id ? `[${label}]` : ` ${label} `;
      return `${tab("config","⬡ CONFIG")}  ${tab("validate","◈ VALIDATE")}  ${tab("health","◉ HEALTH")}`;
    }),
  },
});

// Content box — panes are children of this
const contentBox = new Box({
  parent: tui,
  zIndex: 0,
  rectangle: new Computed(() => {
    const r = tui.rectangle.peek();
    return { column: 0, row: 2, width: r.width, height: r.height - 3 };
  }),
  theme: { base: C.bg },
});

// Hint bar
new Label({
  parent: tui,
  zIndex: 0,
  rectangle: new Computed(() => ({
    column: 0,
    row: tui.rectangle.peek().height - 1,
    width: tui.rectangle.peek().width,
    height: 1,
  })),
  theme: { base: C.bgPanel.hex("#5a5000") },
  label: { text: new Signal(" [q] quit  [tab] mode  [1] config  [2] validate  [3] health") },
});

// Key bindings
tui.on("keyPress", ({ key, ctrl }) => {
  if (ctrl && key === "c") Deno.exit(0);
  if (key === "q")   { confirmQuit(tui); return; }
  if (key === "tab") {
    const modes = ["config", "validate", "health"] as const;
    activeMode.value = modes[(modes.indexOf(activeMode.peek()) + 1) % modes.length];
  }
  if (key === "1") activeMode.value = "config";
  if (key === "2") activeMode.value = "validate";
  if (key === "3") activeMode.value = "health";
});

await tui.run();
```

---

## 6. Mode: Config

### Purpose

Display current configuration. Provide the primary install CTA. Inline edit mode toggled by "Edit Config" button.

### Layout (80-col reference)

```
row 0:  CLUSTER
row 1:    cluster_id         garage-local-01
row 2:    replication_factor 2
row 3:    rpc_bind_addr      0.0.0.0:3901
row 5:  NODES
row 6:  ┌─ NODE 0 · Primary ──────────────────────┐
row 7:  │  rpc_public_addr   127.0.0.1:3901        │
row 8:  │  data_dir          /tmp/garage-node0/..  │
row 9:  │  metadata_dir      /tmp/garage-node0/..  │
row 10: │  capacity_gb       100                   │
row 11: │  zone              dc1                   │
row 12: └─────────────────────────────────────────-┘
        ... NODE 1 similarly ...
row 20: BUCKETS
row 21:   bucket_names  my-bucket, test-bucket
row 23: [ ▶ Install & Validate ]  [ ✎ Edit ]  [ ⌦ Uninstall ]
```

### Implementation

```typescript
// src/tui/panes/config.ts
import { Signal, Computed } from "tui";
import { Label, Button, Frame, Box } from "tui/components/mod.ts";
import { C } from "../colors.ts";
import type { GarageConfig } from "../state.ts";

export function buildConfigPane(parent: Box, config: GarageConfig) {
  const all: { destroy(): void; visible: Signal<boolean> }[] = [];

  function lbl(text: string, row: number, col = 2, color = C.amberFaint) {
    const c = new Label({
      parent, zIndex: 0,
      rectangle: { column: col, row, width: text.length + 2, height: 1 },
      theme: { base: color },
      label: { text: new Signal(text) },
    });
    all.push(c);
    return c;
  }

  function field(name: string, value: string, row: number) {
    lbl(name, row, 4, C.amberMuted);
    lbl(value, row, 28, C.amber);
  }

  let row = 0;

  lbl("CLUSTER", row++, 2, C.sectionLbl);
  field("cluster_id",           config.clusterId,                  row++);
  field("replication_factor",   String(config.replicationFactor),  row++);
  field("rpc_bind_addr",        config.rpcBindAddr,                row++);
  row++;

  lbl("NODES", row++, 2, C.sectionLbl);

  for (const [i, node] of config.nodes.entries()) {
    const nodeTitle = i === 0 ? "NODE 0 · Primary" : "NODE 1 · Secondary";
    const frame = new Frame({
      parent, zIndex: 0,
      rectangle: { column: 2, row, width: 60, height: 7 },
      theme: { base: C.amberGhost },
      label: { text: new Signal(` ${nodeTitle} `) },
    });
    all.push(frame);
    field("rpc_public_addr", node.rpcPublicAddr,      row + 1);
    field("data_dir",        node.dataDir,             row + 2);
    field("metadata_dir",    node.metadataDir,         row + 3);
    field("capacity_gb",     String(node.capacityGb),  row + 4);
    field("zone",            node.zone,                row + 5);
    row += 8;
  }

  lbl("BUCKETS", row++, 2, C.sectionLbl);
  field("bucket_names", config.buckets.join(", "), row++);
  row += 2;

  const btnInstall = new Button({
    parent, zIndex: 1,
    rectangle: { column: 2, row, width: 24, height: 1 },
    theme: {
      base:    C.bgPanel.hex("#c8a228"),
      focused: C.bgPanel.hex("#c8a228").bold,
      active:  C.bgPanel.hex("#4ecb6e").bold,
    },
    label: { text: new Signal(" ▶ Install & Validate ") },
  });

  const btnEdit = new Button({
    parent, zIndex: 1,
    rectangle: { column: 28, row, width: 12, height: 1 },
    theme: { base: C.amberGhost, focused: C.amberDim, active: C.amber },
    label: { text: new Signal(" ✎ Edit ") },
  });

  const btnUninstall = new Button({
    parent, zIndex: 1,
    rectangle: { column: 42, row, width: 14, height: 1 },
    theme: { base: C.redFaint, focused: C.redDim, active: C.red },
    label: { text: new Signal(" ⌦ Uninstall ") },
  });

  all.push(btnInstall, btnEdit, btnUninstall);

  return {
    btnInstall,
    btnEdit,
    btnUninstall,
    setVisible: (v: boolean) => all.forEach(c => { c.visible.value = v; }),
    destroy:    () => all.forEach(c => c.destroy()),
  };
}
```

### Config type

```typescript
// src/tui/state.ts
export interface NodeConfig {
  rpcPublicAddr: string;
  dataDir: string;
  metadataDir: string;
  capacityGb: number;
  zone: string;
}

export interface GarageConfig {
  clusterId: string;
  replicationFactor: number;
  rpcBindAddr: string;
  nodes: [NodeConfig, NodeConfig];
  buckets: string[];
}

export const DEFAULT_CONFIG: GarageConfig = {
  clusterId: "garage-local-01",
  replicationFactor: 2,
  rpcBindAddr: "0.0.0.0:3901",
  nodes: [
    {
      rpcPublicAddr: "127.0.0.1:3901",
      dataDir: "/tmp/garage-node0/data",
      metadataDir: "/tmp/garage-node0/meta",
      capacityGb: 100,
      zone: "dc1",
    },
    {
      rpcPublicAddr: "127.0.0.1:3902",
      dataDir: "/tmp/garage-node1/data",
      metadataDir: "/tmp/garage-node1/meta",
      capacityGb: 100,
      zone: "dc1",
    },
  ],
  buckets: ["my-bucket", "test-bucket"],
};
```

---

## 7. Mode: Validate

### Purpose

Run the install + validation sequence. Show spinner-per-step with inline status. On completion, display a summary block. No raw stdout — output is step-level only.

### Step states

| State | Icon | Color |
|---|---|---|
| `wait` | `○` | `#2a2a1a` |
| `active` | `◌` (spinning) | `#c8a228` |
| `done` | `✓` | `#4ecb6e` |
| `fail` | `✗` | `#cb4e4e` |

### Step definitions

```typescript
export type StepState = "wait" | "active" | "done" | "fail";

export interface Step {
  id: string;
  name: string;
  state: Signal<StepState>;
  detailText: Signal<string>;
  spinFrame: Signal<string>;
}

export function makeSteps(): Step[] {
  return [
    { id: "preflight",  name: "Preflight checks",      detail: "deno ≥1.40, garage binary, ports clear" },
    { id: "configs",    name: "Write configs",          detail: "node0.toml, node1.toml → /tmp"          },
    { id: "processes",  name: "Start node processes",   detail: "PID assignment pending"                 },
    { id: "layout",     name: "Apply cluster layout",   detail: "Connect nodes, assign roles"            },
    { id: "buckets",    name: "Create buckets",         detail: "my-bucket, test-bucket"                 },
    { id: "validate",   name: "Validate bucket access", detail: "PUT / GET / DELETE test objects"        },
    { id: "health",     name: "Health check",           detail: "Node replication, API endpoints"        },
  ].map(s => ({
    id: s.id,
    name: s.name,
    state: new Signal<StepState>("wait"),
    detailText: new Signal(s.detail),
    spinFrame: new Signal("◌"),
  }));
}
```

### Spinner

```typescript
const SPINNER_FRAMES = ["◌", "◍", "◎", "●", "◎", "◍"];

export function startSpinner(spinFrame: Signal<string>): number {
  let i = 0;
  return setInterval(() => {
    spinFrame.value = SPINNER_FRAMES[i++ % SPINNER_FRAMES.length];
  }, 100);
}

export function stopSpinner(id: number) {
  clearInterval(id);
}
```

### Step row rendering

Each step row is three `Label` components driven by signals. State changes trigger automatic re-renders.

```typescript
function renderStepRow(parent: Box, step: Step, row: number) {
  // Icon column
  new Label({
    parent, zIndex: 0,
    rectangle: { column: 2, row, width: 2, height: 1 },
    theme: {
      base: new Computed(() => ({
        wait: C.amberGhost, active: C.amber, done: C.green, fail: C.red,
      }[step.state.value])),
    },
    label: {
      text: new Computed(() => {
        if (step.state.value === "active") return step.spinFrame.value;
        return { wait: "○", done: "✓", fail: "✗" }[step.state.value] ?? "○";
      }),
    },
  });

  // Step name
  new Label({
    parent, zIndex: 0,
    rectangle: { column: 5, row, width: 30, height: 1 },
    theme: {
      base: new Computed(() => ({
        wait: C.amberGhost, active: C.amber, done: C.green, fail: C.red,
      }[step.state.value])),
    },
    label: { text: new Signal(step.name) },
  });

  // Detail text
  new Label({
    parent, zIndex: 0,
    rectangle: { column: 36, row, width: 44, height: 1 },
    theme: {
      base: new Computed(() => ({
        wait:   C.amberGhost,
        active: C.amberMuted,
        done:   C.greenDim,
        fail:   C.redDim,
      }[step.state.value])),
    },
    label: { text: step.detailText },
  });
}
```

### Step execution

```typescript
async function runStep(step: Step, fn: () => Promise<void>): Promise<boolean> {
  step.state.value = "active";
  const spinId = startSpinner(step.spinFrame);

  try {
    await fn();
    stopSpinner(spinId);
    step.state.value = "done";
    step.detailText.value = buildDoneDetail(step.id);
    return true;
  } catch (err) {
    stopSpinner(spinId);
    step.state.value = "fail";
    step.detailText.value = err instanceof Error ? err.message : String(err);
    return false;
  }
}

async function runInstallAndValidate(
  steps: Step[],
  operations: Record<string, () => Promise<void>>,
): Promise<ValidationSummary> {
  const start = Date.now();
  for (const step of steps) {
    const ok = await runStep(step, operations[step.id]);
    if (!ok) break; // remaining steps stay in "wait"
  }
  return {
    nodesStarted:    2,
    nodesTotal:      2,
    bucketsCreated:  2,
    bucketsTotal:    2,
    passed:          steps.every(s => s.state.peek() === "done"),
    durationMs:      Date.now() - start,
  };
}
```

### Summary block

```typescript
function renderSummary(parent: Box, summary: ValidationSummary, startRow: number) {
  new Frame({
    parent, zIndex: 0,
    rectangle: { column: 2, row: startRow, width: 50, height: 6 },
    theme: { base: summary.passed ? C.greenFaint : C.redFaint },
    label: { text: new Signal(" Summary ") },
  });

  const lines = [
    `Nodes started:    ${summary.nodesStarted} / ${summary.nodesTotal}`,
    `Buckets created:  ${summary.bucketsCreated} / ${summary.bucketsTotal}`,
    `Validation:       ${summary.passed ? "PASSED" : "FAILED"}`,
    `Duration:         ${(summary.durationMs / 1000).toFixed(1)}s`,
  ];

  lines.forEach((line, i) => {
    new Label({
      parent, zIndex: 1,
      rectangle: { column: 4, row: startRow + 1 + i, width: 46, height: 1 },
      theme: { base: summary.passed ? C.green : C.red },
      label: { text: new Signal(line) },
    });
  });
}
```

---

## 8. Mode: Health

### Purpose

Live ops dashboard. Polls Garage status on a 5-second interval. Shows cluster state, replication, storage, API latency, bucket accessibility, and a rolling event log.

### Layout

```
row 0:  ┌─ NODE 0 ──────────┐  ┌─ NODE 1 ──────────┐
row 1:  │ a1b2c3d4e5f6       │  │ 7890abcdef12       │
row 2:  │ Primary · dc1      │  │ Secondary · dc1    │
row 3:  └───────────────────-┘  └────────────────────┘
row 5:  ┌─ CLUSTER ──┐  ┌─ REPLICATION ┐  ┌─ STORAGE ──┐  ┌─ API ──────┐
row 6:  │ 2/2  [OK]  │  │ 100%  [OK]   │  │ 68% [WARN] │  │ 12ms [OK]  │
row 7:  │ nodes ok   │  │ replicated   │  │ 136/200 GB │  │ avg latency│
row 8:  │ ██████████ │  │ ██████████   │  │ ██████░░░░ │  │ ██░░░░░░░░ │
row 9:  └────────────┘  └─────────────┘  └────────────┘  └────────────┘
row 11: BUCKETS
row 12:   my-bucket    ● accessible
row 13:   test-bucket  ● accessible
row 15: EVENT LOG
        ┌─────────────────────────────────────────────────────────────────┐
        │ 09:14:02 [node0] replication sync complete                      │
        │ 09:14:01 [node1] layout applied, role=secondary                 │
        └─────────────────────────────────────────────────────────────────┘
row N:  [ ↺ Refresh ]  [ ⬡ Config ]  [ ⌦ Uninstall ]
```

### Metric card component

```typescript
export type HealthStatus = "ok" | "warn" | "err";

function metricCardColors(status: HealthStatus) {
  return {
    ok:   { border: C.greenFaint, val: C.green,  badge: "OK"   },
    warn: { border: C.amberGhost, val: C.amber,  badge: "WARN" },
    err:  { border: C.redFaint,   val: C.red,    badge: "ERR"  },
  }[status];
}

function renderMetricCard(
  parent: Box,
  col: number,
  row: number,
  width: number,
  name: string,
  valueSignal: Signal<string>,
  detailSignal: Signal<string>,
  statusSignal: Signal<HealthStatus>,
  barSignal: Signal<number>,  // 0–100
) {
  const colors = new Computed(() => metricCardColors(statusSignal.value));

  new Frame({
    parent, zIndex: 0,
    rectangle: { column: col, row, width, height: 5 },
    theme: { base: new Computed(() => colors.value.border) },
    label: { text: new Signal(` ${name} `) },
  });

  // Value + badge
  new Label({
    parent, zIndex: 1,
    rectangle: { column: col + 1, row: row + 1, width: width - 2, height: 1 },
    theme: { base: new Computed(() => colors.value.val) },
    label: {
      text: new Computed(() => `${valueSignal.value}  [${colors.value.badge}]`),
    },
  });

  // Detail line
  new Label({
    parent, zIndex: 1,
    rectangle: { column: col + 1, row: row + 2, width: width - 2, height: 1 },
    theme: { base: C.amberFaint },
    label: { text: detailSignal },
  });

  // ASCII progress bar
  new Label({
    parent, zIndex: 1,
    rectangle: { column: col + 1, row: row + 3, width: width - 2, height: 1 },
    theme: { base: new Computed(() => colors.value.val) },
    label: {
      text: new Computed(() => {
        const w = width - 2;
        const filled = Math.round((barSignal.value / 100) * w);
        return "█".repeat(filled) + "░".repeat(w - filled);
      }),
    },
  });
}
```

### Event log

deno_tui has no built-in scrollable log widget. Implement as a fixed-height `Frame` with `Label` rows driven by a `Signal<LogEntry[]>`, showing the last N lines.

```typescript
export interface LogEntry {
  ts: string;
  msg: string;
  level: "ok" | "warn" | "err" | "info";
}

function renderEventLog(
  parent: Box,
  row: number,
  height: number,
  entriesSignal: Signal<LogEntry[]>,
) {
  const LOG_ROWS = height - 2;

  new Frame({
    parent, zIndex: 0,
    rectangle: { column: 2, row, width: 76, height },
    theme: { base: C.amberGhost },
    label: { text: new Signal(" Event log ") },
  });

  for (let i = 0; i < LOG_ROWS; i++) {
    const lineIdx = i;
    new Label({
      parent, zIndex: 1,
      rectangle: { column: 3, row: row + 1 + lineIdx, width: 74, height: 1 },
      theme: {
        base: new Computed(() => {
          const entries = entriesSignal.value;
          const entry = entries[entries.length - LOG_ROWS + lineIdx];
          if (!entry) return C.bg;
          return { ok: C.logOk, warn: C.logWarn, err: C.logErr, info: C.logInfo }[entry.level];
        }),
      },
      label: {
        text: new Computed(() => {
          const entries = entriesSignal.value;
          const entry = entries[entries.length - LOG_ROWS + lineIdx];
          return entry ? `${entry.ts} ${entry.msg}` : "";
        }),
      },
    });
  }
}

export function appendLog(sig: Signal<LogEntry[]>, entry: LogEntry, max = 200) {
  const next = [...sig.peek(), entry];
  if (next.length > max) next.splice(0, next.length - max);
  sig.value = next;
}
```

### Health polling

```typescript
export async function startHealthPolling(
  hs: HealthSignals,
  logSig: Signal<LogEntry[]>,
  intervalMs = 5000,
): Promise<() => void> {
  async function poll() {
    try {
      const s = await fetchClusterStatus();
      hs.clusterValue.value     = `${s.aliveNodes}/2`;
      hs.clusterStatus.value    = s.aliveNodes === 2 ? "ok" : "err";
      hs.clusterBar.value       = (s.aliveNodes / 2) * 100;
      hs.replicationPct.value   = `${s.replicationPct}%`;
      hs.replicationStatus.value= s.replicationPct === 100 ? "ok" : "warn";
      hs.replicationBar.value   = s.replicationPct;
      hs.storageValue.value     = `${s.storageUsedPct}%`;
      hs.storageDetail.value    = `${s.storageUsedGb} / ${s.storageTotalGb} GB`;
      hs.storageStatus.value    = s.storageUsedPct > 80 ? "warn" : "ok";
      hs.storageBar.value       = s.storageUsedPct;
      hs.apiValue.value         = `${s.apiLatencyMs}ms`;
      hs.apiStatus.value        = s.apiLatencyMs > 500 ? "warn" : "ok";
      hs.apiBar.value           = Math.min(s.apiLatencyMs / 10, 100);
      appendLog(logSig, {
        ts: new Date().toLocaleTimeString("en-US", { hour12: false }),
        msg: `[cluster] poll ok — ${s.aliveNodes}/2 nodes alive`,
        level: "ok",
      });
    } catch (err) {
      appendLog(logSig, {
        ts: new Date().toLocaleTimeString("en-US", { hour12: false }),
        msg: `[poll] error: ${err instanceof Error ? err.message : String(err)}`,
        level: "err",
      });
    }
  }

  await poll();
  const id = setInterval(poll, intervalMs);
  return () => clearInterval(id);
}
```

---

## 9. State model

```typescript
// src/tui/state.ts

export interface AppState {
  mode:             Signal<"config" | "validate" | "health">;
  config:           GarageConfig;
  editMode:         Signal<boolean>;
  steps:            Step[];
  summary:          Signal<ValidationSummary | null>;
  operationRunning: Signal<boolean>;
  health:           HealthSignals;
  eventLog:         Signal<LogEntry[]>;
}

export interface HealthSignals {
  clusterValue:       Signal<string>;
  clusterDetail:      Signal<string>;
  clusterStatus:      Signal<HealthStatus>;
  clusterBar:         Signal<number>;
  replicationPct:     Signal<string>;
  replicationStatus:  Signal<HealthStatus>;
  replicationBar:     Signal<number>;
  storageValue:       Signal<string>;
  storageDetail:      Signal<string>;
  storageStatus:      Signal<HealthStatus>;
  storageBar:         Signal<number>;
  apiValue:           Signal<string>;
  apiDetail:          Signal<string>;
  apiStatus:          Signal<HealthStatus>;
  apiBar:             Signal<number>;
  nodes:              Signal<NodeHealth[]>;
  buckets:            Signal<BucketHealth[]>;
}

export interface NodeHealth {
  id: string;
  role: "primary" | "secondary";
  zone: string;
  alive: boolean;
}

export interface BucketHealth {
  name: string;
  accessible: boolean;
}

export interface ValidationSummary {
  nodesStarted: number;
  nodesTotal: number;
  bucketsCreated: number;
  bucketsTotal: number;
  passed: boolean;
  durationMs: number;
}

export function makeHealthSignals(): HealthSignals {
  return {
    clusterValue:       new Signal("—"),
    clusterDetail:      new Signal("nodes healthy"),
    clusterStatus:      new Signal<HealthStatus>("ok"),
    clusterBar:         new Signal(0),
    replicationPct:     new Signal("—"),
    replicationStatus:  new Signal<HealthStatus>("ok"),
    replicationBar:     new Signal(0),
    storageValue:       new Signal("—"),
    storageDetail:      new Signal("—"),
    storageStatus:      new Signal<HealthStatus>("ok"),
    storageBar:         new Signal(0),
    apiValue:           new Signal("—"),
    apiDetail:          new Signal("avg latency"),
    apiStatus:          new Signal<HealthStatus>("ok"),
    apiBar:             new Signal(0),
    nodes:              new Signal([]),
    buckets:            new Signal([]),
  };
}
```

---

## 10. Component patterns

### Pane visibility switching

Build all panes once at startup. Toggle `component.visible` rather than destroying and rebuilding:

```typescript
// Each pane module returns a setVisible helper
export interface Pane {
  setVisible(v: boolean): void;
  destroy(): void;
}

// In main.ts
const panes: Record<string, Pane> = {
  config:   buildConfigPane(contentBox, state.config),
  validate: buildValidatePane(contentBox, state.steps),
  health:   buildHealthPane(contentBox, state.health, state.eventLog),
};

// Hide all panes except the active one
function showPane(mode: "config" | "validate" | "health") {
  for (const [id, pane] of Object.entries(panes)) {
    pane.setVisible(id === mode);
  }
}

// Wire to mode signal
activeMode.subscribe(showPane);
showPane(activeMode.peek()); // initial render
```

### Confirmation dialog

```typescript
export function confirmUninstall(tui: Tui, onConfirm: () => void) {
  const r = tui.rectangle.peek();
  const dw = 46, dh = 7;
  const dc = Math.floor((r.width  - dw) / 2);
  const dr = Math.floor((r.height - dh) / 2);

  const toDestroy: { destroy(): void }[] = [];

  function cleanup() { toDestroy.forEach(c => c.destroy()); }

  const frame = new Frame({
    parent: tui, zIndex: 10,
    rectangle: { column: dc, row: dr, width: dw, height: dh },
    theme: { base: C.redFaint },
    label: { text: new Signal(" ⚠ CONFIRM UNINSTALL ") },
  });
  toDestroy.push(frame);

  const line1 = new Label({
    parent: tui, zIndex: 10,
    rectangle: { column: dc + 2, row: dr + 1, width: dw - 4, height: 1 },
    theme: { base: C.redDim },
    label: { text: new Signal("This will stop all nodes and remove") },
  });
  toDestroy.push(line1);

  const line2 = new Label({
    parent: tui, zIndex: 10,
    rectangle: { column: dc + 2, row: dr + 2, width: dw - 4, height: 1 },
    theme: { base: C.redDim },
    label: { text: new Signal("all data. This cannot be undone.") },
  });
  toDestroy.push(line2);

  const btnConfirm = new Button({
    parent: tui, zIndex: 10,
    rectangle: { column: dc + 2, row: dr + 5, width: 14, height: 1 },
    theme: { base: C.redFaint, focused: C.red, active: C.red.bold },
    label: { text: new Signal(" ⌦ Uninstall ") },
  });
  toDestroy.push(btnConfirm);

  const btnCancel = new Button({
    parent: tui, zIndex: 10,
    rectangle: { column: dc + 18, row: dr + 5, width: 10, height: 1 },
    theme: { base: C.amberGhost, focused: C.amber, active: C.amber.bold },
    label: { text: new Signal(" Cancel ") },
  });
  toDestroy.push(btnCancel);

  btnConfirm.state.when("active", () => { cleanup(); onConfirm(); });
  btnCancel.state.when("active",  () => { cleanup(); });
}
```

---

## 11. Coding hints for Copilot

### Signal mutation drives rendering — no manual render calls

Unlike neo-blessed (which required `screen.render()` after every change), deno_tui re-renders automatically at the configured `refreshRate`. Mutate signal values; the canvas loop handles the rest.

```typescript
// CORRECT
stepState.value = "done";

// WRONG — screen.render() does not exist in deno_tui
```

### Use peek() outside reactive contexts

`signal.value` creates a reactive dependency (only safe inside `Computed` or `Effect`). `signal.peek()` reads without tracking. In async functions and event handlers, always use `peek()`:

```typescript
// Inside Computed callback — use .value
const label = new Computed(() => `step: ${step.state.value}`);

// Inside async operation / event handler — use .peek()
const current = steps[0].state.peek();
```

### Visibility not destroy for pane switching

Destroying and rebuilding component trees on every mode switch leaks listeners and causes flicker. Toggle `component.visible.value` instead:

```typescript
// Hide
myComponent.visible.value = false;

// Show
myComponent.visible.value = true;
```

### Rectangle content area inside a Frame

A `Frame` renders a single-char border on all sides. Content components inside a frame at `{ column: C, row: R, width: W, height: H }` should start at `column: C+1, row: R+1` and have max width `W-2`, max height `H-2`.

### Spinner with Signal

```typescript
const FRAMES = ["◌", "◍", "◎", "●", "◎", "◍"];
const spinIcon = new Signal("◌");
const spinId = setInterval(() => {
  spinIcon.value = FRAMES[Date.now() % FRAMES.length];
}, 100);
// On completion:
clearInterval(spinId);
spinIcon.value = "✓"; // or "✗"
```

### Health polling cleanup on mode switch

```typescript
let stopPolling: (() => void) | null = null;

activeMode.subscribe((mode) => {
  if (mode === "health") {
    stopPolling = startHealthPolling(state.health, state.eventLog);
  } else {
    stopPolling?.();
    stopPolling = null;
  }
});
```

### Garage admin API calls

```typescript
// src/garage/api.ts
const ADMIN = "http://127.0.0.1:3903/v1";

export async function fetchClusterStatus() {
  const res = await fetch(`${ADMIN}/status`);
  if (!res.ok) throw new Error(`Garage API ${res.status}`);
  return res.json() as Promise<GarageClusterStatus>;
}

export async function createBucket(name: string) {
  const res = await fetch(`${ADMIN}/bucket`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ globalAlias: name }),
  });
  if (!res.ok) throw new Error(`create bucket '${name}': ${res.status}`);
}
```

---

## 12. File structure

```
src/tui/
├── main.ts                   ← Tui setup, input handlers, mode routing
├── state.ts                  ← AppState, GarageConfig, Signal factories, all types
├── colors.ts                 ← C token object (crayon style instances)
├── panes/
│   ├── config.ts             ← buildConfigPane()
│   ├── validate.ts           ← buildValidatePane(), runInstallAndValidate()
│   └── health.ts             ← buildHealthPane(), startHealthPolling()
├── components/
│   ├── stepRow.ts            ← renderStepRow(), startSpinner(), stopSpinner()
│   ├── metricCard.ts         ← renderMetricCard()
│   ├── eventLog.ts           ← renderEventLog(), appendLog()
│   └── confirmDialog.ts      ← confirmUninstall(), confirmQuit()
src/operations/
│   ├── preflight.ts
│   ├── writeConfigs.ts
│   ├── startNodes.ts
│   ├── applyLayout.ts
│   ├── createBuckets.ts
│   ├── validateBuckets.ts
│   ├── healthCheck.ts
│   └── uninstall.ts
src/garage/
    ├── api.ts                ← typed fetch wrappers for Garage admin HTTP API
    └── config.ts             ← TOML generation for node configs
```

---

## Appendix A: deno_tui API quick reference

| Task | API |
|---|---|
| Create root | `new Tui({ style, refreshRate })` |
| Wire input | `handleInput(tui)` + `handleMouseControls(tui)` + `handleKeyboardControls(tui)` |
| Start loop | `await tui.run()` |
| Auto-quit CTRL+C | `tui.dispatch()` |
| Key events | `tui.on("keyPress", ({ key, ctrl }) => ...)` |
| Reactive value | `new Signal(initialValue)` |
| Derived value | `new Computed(() => expr using signal.value)` |
| Read without tracking | `signal.peek()` |
| React to value | `signal.when(value, cb)` |
| React to any change | `signal.subscribe(cb)` |
| Box / panel | `new Box({ parent, rectangle, theme })` |
| Bordered frame | `new Frame({ parent, rectangle, theme, label })` |
| Text label | `new Label({ parent, rectangle, theme, label: { text } })` |
| Button | `new Button({ parent, rectangle, theme, label })` |
| Progress bar | `new ProgressBar({ parent, rectangle, theme })` |
| Table | `import { Table } from "tui/components/mod.ts"` |
| Input field | `import { Input } from "tui/components/mod.ts"` |
| Hide component | `component.visible.value = false` |
| Remove component | `component.destroy()` |
| Button pressed | `btn.state.when("active", handler)` |
| Mouse press | `component.on("mousePress", handler)` |

## Appendix B: crayon style reference

```typescript
import { crayon } from "crayon";

// Background + foreground
crayon.bgBlack.hex("#c8a228")              // black bg, amber text
crayon.bgHex("#0d0d00").hex("#4ecb6e")     // custom bg, green text

// Modifiers (chain after color)
crayon.bgBlack.hex("#c8a228").bold
crayon.bgBlack.hex("#c8a228").underline

// Use in component theme
theme: {
  base:    crayon.bgBlack.hex("#c8a228"),
  focused: crayon.bgBlack.hex("#c8a228").bold,
  active:  crayon.bgBlack.hex("#4ecb6e").bold,
}
```

---

*End of spec. All implementation decisions not covered here should default to the simplest working option consistent with the retro-amber aesthetic, deno_tui's Signal-reactive model, and zero-npm-dependency operation.*
