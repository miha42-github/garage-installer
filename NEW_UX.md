# Garage Installer – Admin UX Redesign

**[← Back to Main README](README.md)**

This document captures the UX problems observed in the Bucket & Key Admin mode and defines a phased plan to address them.

---

## Problems with the Current UX

1. **Banner clutter after connect** — the GARAGE ASCII banner and all install prompts remain on screen after the admin session starts, burying the menu.
2. **No session context visible** — once inside the menu loop there is no reminder of which node, port, or user is active.
3. **Flat menus clip off screen** — a single long Select list overflows the terminal and hides lower items.
4. **Menu and output mixed together** — operation output appears below the menu and both scroll together, making it hard to orient after a result.
5. **No "Back" affordance in flow** — after an output you are immediately re-prompted; there is no pause to read the result.
6. **No breadcrumb** — it is not obvious whether you are at the top level or a sub-menu.

---

## Phase 1 – Quick Wins (Implemented Now)

These are the lowest-effort changes that immediately improve the experience.

### 1a. Clear screen on admin entry

After SSH authentication succeeds, call `console.clear()` before entering the menu loop. This removes the banner clutter.

### 1b. Persistent status bar

Before every top-level category prompt, reprint a compact single-line header:

```
  ══════════════════════════════════════════════════════════
   GARAGE Admin  │  espresso-1:3900  │  user: mihay42
  ══════════════════════════════════════════════════════════
```

This is reprinted (via clear + header) at the start of each main menu render so it always sits at the top.

### 1c. Two-level menus (already done)

Category → action keeps each list to ≤5 items. Already implemented.

### 1d. Output pause

After any operation output, print a blank line and `dim("Press Enter to return to menu…")` and wait for a keypress before re-rendering the menu. This gives the user time to read results.  
Used as a utility: `await pressEnterToContinue()`.

---

## Phase 2 – Scroll Region (Near Term)

Use ANSI terminal escape codes to define a **scroll region** so the header is physically pinned to the top rows of the terminal while output scrolls in a dedicated zone below.

### How it works

ANTML scroll region: `\x1b[{top};{bottom}r`

1. Measure terminal height with `Deno.consoleSize()`.
2. Reserve rows 1–3 for the status bar; set scroll region from row 4 to terminal height.
3. Print the status bar outside the scroll region using cursor-save/restore sequences.
4. All subsequent output (including cliffy prompt rendering) happens inside the scroll region.
5. On exit, reset scroll region with `\x1b[r`.

### Limitations

- cliffy's `Select.prompt` renders its own multi-line UI. If the scroll region top is set too high the prompt arrows may overlap the header. Mitigation: set header height to exactly 3 rows, leave row 4 as a separator.
- Terminal resize events are not handled. On resize, the header must be reprinted.
- Windows `cmd.exe` does not support ANSI scroll regions; should fall back gracefully to Phase 1 behaviour.

### Implementation sketch

```typescript
function setScrollRegion(top: number, bottom: number) {
  Deno.stdout.writeSync(enc(`\x1b[${top};${bottom}r`));
}
function resetScrollRegion() {
  Deno.stdout.writeSync(enc(`\x1b[r`));
}
function moveCursorTo(row: number, col: number) {
  Deno.stdout.writeSync(enc(`\x1b[${row};${col}H`));
}
function printHeaderAtTop(nodeHost: string, port: number, user: string) {
  const w = Deno.consoleSize().columns;
  const title = ` GARAGE Admin  │  ${nodeHost}:${port}  │  user: ${user}`;
  Deno.stdout.writeSync(enc(`\x1b7`));           // save cursor
  moveCursorTo(1, 1);
  Deno.stdout.writeSync(enc(`\x1b[2K${bold(title.padEnd(w))}`));
  moveCursorTo(2, 1);
  Deno.stdout.writeSync(enc(`\x1b[2K${"─".repeat(w)}`));
  Deno.stdout.writeSync(enc(`\x1b8`));           // restore cursor
}
```

---

## Phase 3 – Full TUI (Future)

For a truly polished experience the admin mode should be rewritten as a TUI (Terminal User Interface) with:

- **Fixed header pane** (node context, mode breadcrumb).
- **Scrollable output pane** (command results, paginated with Up/Down).
- **Fixed footer/menu pane** (current action choices, always visible at the bottom).
- **Keyboard shortcuts** (e.g. `b` for Buckets, `k` for Keys, `q` to quit).

### Technology options for Deno

| Option | Notes |
|---|---|
| Raw ANSI (custom) | Full control; no dependency; significant implementation effort |
| `npm:blessed` | Mature Node.js TUI, works in Deno via npm compat; complex API |
| `npm:ink` + React | React-based terminal UI; requires JSX; large dependency |
| Custom pane engine | Build a lightweight 3-pane render loop on top of `Deno.consoleSize()` and ANSI codes; ~300 LOC; most aligned with the current codebase style |

**Recommendation**: Build a lightweight custom 3-pane engine using raw ANSI. The existing `Spinner` class already uses ANSI escape codes, so the pattern is established. Estimated effort: 1–2 days.

### Pane layout

```
┌─ GARAGE Admin ─────────────── espresso-1:3900 ─── mihay42 ─┐  ← pinned row 1
├─────────────────────────────────────────────────────────────┤  ← pinned row 2
│  [output scrolls here]                                      │  ← rows 3..N-4
│                                                             │
├─────────────────────────────────────────────────────────────┤  ← pinned row N-3
│  > Buckets   Keys   Permissions   Guided   Exit             │  ← pinned row N-2
│  > List buckets   Create bucket   Bucket info   Delete …   │  ← pinned row N-1
└─────────────────────────────────────────────────────────────┘  ← pinned row N
```

---

## Other UX Improvements (Any Phase)

### Breadcrumb display
Show current navigation path before each sub-menu prompt:
```
  Bucket & Key Admin › Permissions › Grant
```

### Colour-coded output parsing
Parse Garage CLI output sections (`==== BUCKET INFORMATION ====`) and render them with structured colour coding rather than raw text.

### Confirmation summary panel
Before destructive operations show a structured summary box:
```
  ┌──────────── Confirm Delete ──────────────────┐
  │  Bucket : zetaris-backups                    │
  │  Action : Delete ALL contents then bucket   │
  │  Impact : Permanent, cannot be undone        │
  └──────────────────────────────────────────────┘
  Proceed? (y/N)
```

### Key secret display
After key creation, render the secret in a clearly bounded box with a copy-hint, not inline with other output:
```
  ┌──────────── New Access Key ──────────────────┐
  │  Key ID    : GK70a963c1c3ce25edff874def      │
  │  Secret    : xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx │
  │  ⚠  Save this now – it will NOT be shown again│
  └──────────────────────────────────────────────┘
```

### Input history
Pre-fill repeated prompts (e.g. bucket name, key ID) with the last value used in the session, reducing re-typing.

### Output pagination
For `bucket list` and `key list` with many results, paginate output instead of dumping all lines at once.

---

## Implementation Priority

| Item | Phase | Effort | Value |
|---|---|---|---|
| Clear screen on connect | 1 | Trivial | High |
| Persistent status bar | 1 | Low | High |
| Output pause (press Enter) | 1 | Trivial | High |
| Confirmation summary panel | 1 | Low | Medium |
| Key secret display box | 1 | Low | High |
| Breadcrumb display | 1 | Low | Medium |
| ANSI scroll region header | 2 | Medium | High |
| Terminal resize handling | 2 | Medium | Low |
| Full 3-pane TUI engine | 3 | High | High |
| Keyboard shortcuts | 3 | Medium | Medium |
| Output pagination | 3 | Medium | Medium |
