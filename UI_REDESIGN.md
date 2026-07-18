# UI Redesign Implementation Plan

## Objective
Replace the current prompt-driven CLI interaction with a deno_tui-based TUI while preserving existing behavior and operational flow.

Revision note for this version:
- `neo-blessed`/`blessed` are not viable in this repo under Deno due to runtime compatibility issues.
- The current ANSI/raw-input shell is a temporary bridge, not the target architecture.
- The target UI stack is `deno_tui` + `crayon` (pure Deno, no npm/CommonJS interop).

Priority adjustment for this revision:
- Deliver Health mode first as a proof-of-value slice.
- Render both nodes visually with status callouts so runtime benefits are immediately observable.
- Defer configuration editing until after Health mode baseline is stable.

This plan is tailored to the current codebase layout after wizard modularization:
- Entry: mod.ts
- Orchestration facade: src/wizard.ts and src/wizard/index.ts
- Workflows: src/wizard/workflows/*
- Prompt modules: src/wizard/prompts/*
- Shared services: src/wizard/services/*
- Output helpers: src/wizard/output/successMessage.ts

Also included: migration of installer config/state artifacts from CWD into a user-scoped directory.

## Non-Goals
- No change to deployment semantics (SSH, Docker, Garage admin commands, state transitions).
- No change to persisted schema semantics beyond file locations and migration support.
- No new operational features beyond UI redesign.

## Current Baseline Summary
Current UI model is a mix of legacy prompt flow and an interim ANSI shell:
- Input primitives: @cliffy/prompt in mod.ts and workflow/prompt modules.
- Output: console.log/color helpers plus manual ANSI rendering for the temporary TUI shell.
- Flow sequencing already modularized in workflows.

Current temporary TUI baseline:
- `src/tui/main.ts` handles alternate-screen, raw input, and mode keybindings.
- `src/tui/panes/health.ts` renders static Health callouts and event-log lines.
- This baseline is functional but intentionally transitional until deno_tui migration.

Current file paths using CWD:
- Cluster config: garage-cluster-config.json
- State file: .garage-installer-state.json

Primary integration leverage:
- Workflow modules already express use-case boundaries.
- Services isolate config loading and endpoint checks.
- This enables adapter-style migration from prompt calls to TUI actions with minimal behavior drift.

## Target Architecture
Introduce a deno_tui app shell and bridge existing workflow logic through UI adapters.

### Target UI stack
- `tui`: `https://deno.land/x/tui@2.1.11/mod.ts`
- `crayon`: `https://deno.land/x/crayon@3.3.3/mod.ts`
- deno_tui reactive primitives: `Signal`, `Computed`
- deno_tui input handlers: `handleInput`, `handleKeyboardControls`, `handleMouseControls`

### New top-level modules
- src/tui/main.ts
- src/tui/state.ts
- src/tui/colors.ts
- src/tui/panes/config.ts
- src/tui/panes/validate.ts
- src/tui/panes/health.ts
- src/tui/components/tabBar.ts
- src/tui/components/stepItem.ts
- src/tui/components/metricCard.ts
- src/tui/adapters/wizardAdapter.ts

### Existing modules to update
- mod.ts: switch from Select-based command menu to TUI launch path.
- src/wizard/workflows/*: add optional non-interactive dependency injection where prompt calls still exist.
- src/wizard/prompts/*: keep as compatibility layer for non-TUI fallback and tests.
- src/state.ts and src/wizard/services/configLoader.ts: path migration support.

### deno_tui migration constraints
- Do not introduce npm-based UI dependencies.
- Keep mode switching and exit behavior equivalent to current shell (`q`, `tab`, `1/2/3`).
- Keep Health-first delivery order.

## Config/State Path Migration (Required)
Adopt a user-scoped data directory:
- Root: $HOME/.garage-installer
- Config: $HOME/.garage-installer/config.json
- State: $HOME/.garage-installer/state.json
- Optional logs: $HOME/.garage-installer/logs/garage-installer.log

### Migration behavior
On startup, perform one-time migration checks:
1. If new-path file exists, use it.
2. Else if old CWD file exists, copy to new path and keep old as backup with suffix .migrated.
3. Else create directories/files lazily on first write.

### Implementation steps
- Add path resolver utility: src/wizard/services/paths.ts.
- Update src/state.ts to use resolved state path instead of static .garage-installer-state.json.
- Update src/wizard/services/configLoader.ts default path to resolved config path.
- Update all explicit config file references in src/wizard.ts and workflows to consume path resolver.
- Add migration unit tests.

## Phase Tracking Protocol
- Every phase below contains checkbox TODOs.
- A phase is complete only when all checkboxes in that phase are checked.
- Keep the checkboxes in this file as the source of truth during implementation.

## Phased Plan (Health-First)

### Phase 1: TUI Shell + Safe Toggle
Goal:
- Boot a minimal deno_tui shell without changing operational behavior.

TODO checklist:
- [x] Add `tui` and `crayon` imports in deno.json.
- [x] Implement deno_tui root in `src/tui/main.ts` (`Tui`, input handlers, run loop).
- [x] Implement header, tab bar, content box, and hint bar as deno_tui components.
- [x] Preserve mode keys and legacy fallback behavior in `mod.ts`.
- [x] Run `deno check` for touched files.

Phase acceptance:
- TUI opens and closes without running install logic by default.
- Legacy prompt flow remains callable.

### Phase 2: Health Pane Baseline with Node Callouts (Priority Slice)
Goal:
- Deliver a visible, useful Health screen first, including node rendering with status callouts.

TODO checklist:
- [x] Create `src/tui/panes/health.ts` and render static layout skeleton.
- [x] Render Node 0 and Node 1 as dedicated visual blocks/cards.
- [x] Add status callouts per node (alive/down, role, zone, endpoint state).
- [x] Add cluster metric cards (cluster, replication, storage, API) using spec styling.
- [x] Add event log component area (deno_tui `Frame` + reactive `Label` rows) in pane.
- [x] Add manual refresh action and keybinding.
- [x] Confirm behavior is read-only (no config edits, no deploy side effects).

Rebaseline note:
- Phase 1 and Phase 2 are now tracked as deno_tui-only deliverables.
- Any prior progress from the interim ANSI shell does not count as completion for these phases.

Phase acceptance:
- Operator can open Health mode and immediately see both nodes with status callouts.
- Health screen demonstrates TUI value without requiring configuration changes.

### Phase 3: Health Polling + Data Adapter Integration
Goal:
- Replace static Health placeholders with real data via existing services/workflow helpers.

TODO checklist:
- [x] Create `src/tui/adapters/wizardAdapter.ts` health adapter methods.
- [x] Feed health pane with endpoint/tool checks from existing services.
- [x] Add 5s polling loop with proper enter/leave cleanup.
- [x] Populate event log entries on refresh/poll transitions.
- [x] Add tests for poll start/stop lifecycle and adapter mapping.

Phase acceptance:
- Health values update on interval without leaking timers.
- Node callouts update based on current probe results.

### Phase 3.1: Health UI Cleanup + Signal Clarity
Goal:
- Clean up Health mode presentation so node diagnostics are concise, actionable, and visually balanced.

TODO checklist:
- [x] Replace long/log-like node summary text with concise field values and short diagnostic labels.
- [x] Rename `Alive` field to `Status` and remove redundant `Yes`/`No` wording (use status token only, e.g. `OK`/`DOWN`/`WARN`).
- [x] Report S3 endpoint and Admin endpoint checks as separate fields per node.
- [x] Report actual node host name explicitly in each node card.
- [x] Add ICMP echo (ping) probe per node and display result in node diagnostics.
- [x] Add SSH CLI probe per node (non-destructive command) and display result in node diagnostics.
- [x] Increase node reporting area to accommodate the additional diagnostic fields without truncation.
- [x] Make Event Log scrollable so newer entries are visible while retaining recent history.
- [x] Move `CLUSTER`, `REPLICATION`, `STORAGE`, and `API` summary cards above node reporting.

Implementation notes:
- `nodeHeight` raised 9 → 10 so the SSH line (lineIndex 7) no longer lands on the Frame bottom border row.
- Metric detail labels now clamp to `metricWidth - 2` chars in a `Computed` to prevent bleed into adjacent cards.
- STORAGE metric is now live: probes `GET /health` on the admin port (unauthenticated Garage endpoint).
  Returns `storageNodes`/`storageNodesOk` from the Garage health JSON; falls back to "NOT PROBED" if unreachable.
  Probe function is injected via `AdapterOptions.checkGarageHealth` for testability.
- API detail shortened to "local tooling only" (≤18 chars) to stay within card bounds at all terminal widths.
- Three new unit tests added for the storage probe path.

Phase acceptance:
- Health screen shows concise per-node diagnostics without clipped/log-like endpoint text.
- Node cards include host name, status token, S3/Admin checks, ICMP probe, and SSH probe.
- Event log can scroll and summary cards are positioned above node cards.

### Phase 4: Config/State Path Migration (CWD -> HOME)
Goal:
- Move config/state storage to `$HOME/.garage-installer` with safe migration.

TODO checklist:
- [x] Add `src/wizard/services/paths.ts` for canonical app paths.
- [x] Update `src/state.ts` to use resolved state path.
- [x] Update `src/wizard/services/configLoader.ts` default path to resolved config path.
- [x] Update all direct config path references in workflows/wizard facade.
- [x] Implement one-time migration from CWD files with `.migrated` backup behavior.
- [x] Add migration unit tests (new-path exists, old-path exists, neither exists).

Implementation notes:
- New paths: `$HOME/.garage-installer/config.json` and `$HOME/.garage-installer/state.json`.
- `paths.ts` exports `getConfigPath()`, `getStatePath()`, `getAppDir()`, `ensureAppDir()`, `migrateIfNeeded()`.
- Migration is lazy and idempotent: runs on first use of `configLoader` or `StateManager`,
  copies CWD file to HOME path, renames CWD file to `*.migrated` as a backup.
- Cross-device rename failures are swallowed; migration still succeeds (copy completed).
- `configLoader.ts` and `state.ts` each track a module-level flag to skip the migration
  `Deno.stat` on subsequent calls within the same process.
- `wizardAdapter.ts` now passes `options.configFile` through directly (undefined = HOME default).
- All four legacy-CLI workflows updated: `validation`, `uninstall`, `bucketAdmin`, `healthReport`.
- `wizard.ts` post-install write path updated; calls `ensureAppDir()` before write.
- Three migration unit tests in `src/wizard/services/paths.test.ts`.

Bug fix (same session): `q` keypress did not release the terminal.
- Root cause: in-flight probe tasks (3–4 s timeouts), the polling `setInterval`, and a
  persistent SIGINT listener from `mod.ts` all kept the Deno event loop alive after
  `tui.destroy()` returned.
- Fix: `Deno.exit(0)` added at the end of the `tui.on("destroy")` handler in `src/tui/main.ts`.
  By this point the poller is stopped and health pane components are destroyed, so exit is clean.

Phase acceptance:
- Existing users are transparently migrated.
- New writes go only to `$HOME/.garage-installer` paths.

### Phase 5: Shared TUI State + Cross-Mode Routing
Goal:
- Stabilize app-level state model and pane switching infrastructure.

TODO checklist:
- [x] Implement `src/tui/state.ts` app state model.
- [x] Implement reusable tab rendering and mode switch wiring with deno_tui signals.
- [x] Ensure pane mount/hide/show lifecycle is deterministic.
- [x] Use reactive updates (`Signal`/`Computed`) instead of manual redraw orchestration.
- [x] Add smoke tests for mode switching.

Implementation notes:
- `src/tui/state.ts` exports `UIMode`, `MODES`, `PaneLifecycle`, and `AppState`.
  `AppState` holds `mode: Signal<UIMode>` and a `Map<UIMode, PaneLifecycle>`.
  `switchMode()` calls `onHide()` on the departing pane then `onMount()` on the
  arriving pane; it is a no-op when the mode is unchanged. `cycleMode()` rotates
  through MODES in order. `mountInitial()` fires the starting pane's `onMount`.
- `src/tui/components/tabBar.ts` extracts the tab bar into a standalone factory.
  The tab label text is a `Computed` derived from `mode: Signal<UIMode>`, so the
  tab highlight updates reactively without any manual redraw call.
- `src/tui/main.ts` rewritten cleanly:
  - The `let setMode = stub; ... setMode = real` anti-pattern is gone.
  - `contentBox` and `contentLabel` now start hidden (initial mode is health) and
    are shown/hidden through `registerPane` lifecycle callbacks — fixing the bug
    where the content box overlapped the health pane.
  - `modePlaceholder()` returns `""` for health mode (was unreachable but now
    explicit).
  - All keyPress routing goes through `appState.switchMode()` /
    `appState.cycleMode()`.
- Adapter tests (`wizardAdapter.test.ts`) updated to use self-contained temp config
  files instead of depending on a CWD `garage-cluster-config.json`; makes them
  environment-independent.
- `deno.json` test task expanded to cover `src/tui/state.test.ts` and
  `src/tui/adapters/*.test.ts`.
- 8 new smoke tests in `src/tui/state.test.ts`: init, switchMode lifecycle order,
  no-op on same mode, unregistered pane safety, cycleMode wrap-around, mountInitial.

Phase acceptance:
- Tabs switch reliably among Config/Validate/Health shells.
- No pane rebuild regressions or focus traps.

### Phase 6: Validate Pane + Step Runner
Goal:
- Port install/validate progress UX into step-based TUI rendering.

TODO checklist:
- [x] Create `src/tui/panes/validate.ts` with step list UI.
- [x] Implement spinner frames and active/done/fail transitions.
- [x] Map existing install + validation workflow stages to step callbacks.
- [x] Render summary block (duration, pass/fail, counts).
- [x] Add fail-fast behavior parity tests.

Implementation notes:
- `runStepSequence()` is exported as a pure async function (no TUI dependency) for testing.
  It takes `StepDef[]` + `onUpdate` callback; drives `pending → running → done/fail/skip` transitions.
- Fail-fast: on any step failure, remaining steps are immediately marked `"skip"` and the loop breaks.
- `createValidatePane()` wraps `runStepSequence` with Signal-driven rendering: `stepStates`, `runStatus`,
  `spinnerFrame` (120ms interval while running), and a `summaryLine` Signal.
- `buildValidatePreflightSteps()` added to `wizardAdapter.ts`: 5 steps sharing closure state
  (config loaded once, S3/Admin URLs shared with endpoint steps). Steps: load config, S3 API,
  Admin API, AWS CLI, curl.
- `StepDef` type lives in `wizardAdapter.ts`; re-exported from `validate.ts` for test imports.
- Validate pane auto-runs on mount (guarded by `isRunning()`) and re-runs on `r` keypress.
- All step row Labels use single-line text Computeds (no `\n`) so no deno_tui TextObject
  line-count drift issue.
- 5 unit tests in `src/tui/panes/validate.test.ts`; 31/31 total tests passing.

Phase acceptance:
- Validate mode mirrors current sequential behavior and error semantics.

### Phase 7: Config Pane (Read-first, Then Edit)
Goal:
- Add configuration visibility/editing after Health-first value is proven.

TODO checklist:
- [x] Create `src/tui/panes/config.ts` with cluster/node section rendering.
- [x] Load values from migrated config path.
- [x] Add edit mode with existing validation constraints.
- [x] Add save flow and user feedback without changing schema semantics.
- [x] Add tests for read/save roundtrip.

Implementation notes:
- `CONFIG_FIELDS: ConfigFieldDef[]` (9 entries) is exported from `config.ts` for testing.
  Each field has `label`, `get`, `set` (immutable update), and `validate` (returns null=ok or error string).
  Fields: node0.name/host, node1.name/host, replicationFactor, s3Api/admin/rpc/s3Web ports.
- Three-phase edit state machine: `view` → `nav` (j/k navigation) → `type` (character input).
  `handleKey(key): boolean` is called by `main.ts` before global mode-switch keys so that "1"/"tab"/etc.
  are captured while typing.
- `saveGarageClusterConfig(config, configFile?)` added to `configLoader.ts`; writes pretty JSON.
- Credentials (adminToken) shown as `[SET]` / `[NOT SET]` — never displayed or edited in plain text.
- `saveStatus` Signal shows "Saved at HH:MM:SS" on success; `errorMsg` Signal shows validation errors.
- All field Labels are single-line, no multi-line Computed — avoids the deno_tui TextObject drift bug.
- 10 unit tests in `src/tui/panes/config.test.ts`: getters, defaults, setters, validation, and two
  save/load roundtrip tests via temp files. 41/41 total tests passing.

Phase acceptance:
- Config pane displays and persists configuration accurately at new path.

### Phase 8: Workflow Injection Cleanup + Legacy Fallback
Goal:
- Ensure workflows are UI-agnostic and callable from both TUI and legacy prompt mode.

TODO checklist:
- [x] Inject request/confirm abstractions where direct prompt coupling remains.
- [x] Keep prompt modules as legacy-compatible adapters.
- [x] Add compatibility tests for TUI adapter and prompt adapter parity.
- [x] Confirm no behavior drift in install/resume/uninstall/validation/health/admin.

Implementation notes:
- `src/wizard/services/interaction.ts` defines the `Interaction` interface:
  `confirm(msg, default?) → Promise<boolean>`, `input(msg, default?) → Promise<string>`,
  `secret(msg) → Promise<string>`. The `cliInteraction` default wraps @cliffy prompts.
- `runHealthReportWorkflow` updated to accept `{ interaction?, configFile? }` options.
  All `Confirm.prompt` and `Input.prompt` calls are routed through the injected `Interaction`,
  allowing the workflow to run without a real terminal. `NumberPrompt` calls in the
  no-config fallback path remain CLI-bound (not reachable when a config file is supplied).
- `clusterPrompts.ts` and `nodePrompts.ts` remain as-is; they are legacy-CLI adapters only,
  not called from the TUI path.
- `install.ts`, `uninstall.ts`, `validation.ts`, `bucketAdmin.ts` remain fully prompt-coupled;
  the TUI does not call them — it uses dedicated adapter functions instead.
- 3 new tests in `src/wizard/workflows/healthReport.test.ts` verify the injection path
  runs end-to-end without terminal interaction.
- 4 new parity tests in `src/tui/adapters/wizardAdapter.test.ts`:
  - `buildValidateFullSteps` step count and label sequence match the S3 validation protocol
    documented in the legacy `validation.ts` create-mode path.
  - `buildValidatePreflightSteps` step labels match the legacy health-report probe set.
  - Independent calls produce isolated closure state (no shared mutable state leakage).
  - `collectHealthSnapshot` snapshot shape exposes the same 4 probe dimensions (S3, admin,
    ping, ssh) that the legacy health-report workflow reports.
- All 48 tests pass (7 new + 41 prior).
- `deno.json` test task extended to include `src/wizard/workflows/*.test.ts`.

Phase acceptance:
- Workflows are shared, with no duplicated business logic between UIs.

### Phase 9: Final Hardening, Docs, and Default Switch
Goal:
- Complete rollout with clear documentation and regression confidence.

TODO checklist:
- [ ] Update README/docs with TUI usage and migration notes.
- [ ] Add changelog entries for TUI and path migration.
- [ ] Run full test suite + regression checklist.
- [ ] Switch default entry to TUI (keep legacy override for one release cycle).
- [ ] Capture known limitations and follow-up backlog items.

Phase acceptance:
- TUI is default, legacy fallback remains available, regression checks are green.

## Testing Strategy

### Unit
- Path resolver and migration behavior.
- TUI state reducers/helpers.
- Adapter function contracts.
- Existing services tests remain green.

### Integration-light
- TUI bootstrap smoke test.
- Health polling start/stop lifecycle test.
- Node callout rendering test (node cards + status badges/callouts visible).
- deno_tui keybinding parity test (`q`, `tab`, `1/2/3`, `r`).
- Validate step state transitions using mocked adapter operations.

### Manual regression checklist
- Health mode first-run experience: node callouts are immediately visible without config edits.
- Health updates and log scrolling.
- Install from Config pane.
- Validate flow from Validate pane.
- Uninstall confirmation and execution.
- Resume behavior with migrated state file.

## Risk Register
- Prompt-behavior drift during adapter injection.
  - Mitigation: preserve validation logic in shared helpers and compare outputs in tests.
- Path migration mistakes causing missing config/state.
  - Mitigation: non-destructive copy with backup suffix and startup diagnostics.
- TUI rendering edge cases on narrow terminals.
  - Mitigation: deno_tui rectangle computation + min width checks + clipped layout fallback.
- Poller leaks in Health mode.
  - Mitigation: explicit teardown contract and tests.

## Rollout Plan
1. Land shell + health pane baseline with node callouts.
2. Land health polling integration.
3. Land path migration.
4. Land validate + config panes.
5. Switch default entry to TUI after regression pass.
6. Keep legacy mode for one release cycle.

## Definition of Done
- TUI is the default interactive experience.
- Existing install/validate/health/uninstall behavior is preserved.
- Health screen ships first and renders both nodes with live status callouts.
- Config/state artifacts are stored in $HOME/.garage-installer with migration from CWD.
- Workflow modules are UI-agnostic via injected interaction dependencies.
- Automated and manual regression checks pass.
