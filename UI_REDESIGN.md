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
- [ ] Replace long/log-like node summary text with concise field values and short diagnostic labels.
- [ ] Rename `Alive` field to `Status` and remove redundant `Yes`/`No` wording (use status token only, e.g. `OK`/`DOWN`/`WARN`).
- [ ] Report S3 endpoint and Admin endpoint checks as separate fields per node.
- [ ] Report actual node host name explicitly in each node card.
- [ ] Add ICMP echo (ping) probe per node and display result in node diagnostics.
- [ ] Add SSH CLI probe per node (non-destructive command) and display result in node diagnostics.
- [ ] Increase node reporting area to accommodate the additional diagnostic fields without truncation.
- [ ] Make Event Log scrollable so newer entries are visible while retaining recent history.
- [ ] Move `CLUSTER`, `REPLICATION`, `STORAGE`, and `API` summary cards above node reporting.

Phase acceptance:
- Health screen shows concise per-node diagnostics without clipped/log-like endpoint text.
- Node cards include host name, status token, S3/Admin checks, ICMP probe, and SSH probe.
- Event log can scroll and summary cards are positioned above node cards.

### Phase 4: Config/State Path Migration (CWD -> HOME)
Goal:
- Move config/state storage to `$HOME/.garage-installer` with safe migration.

TODO checklist:
- [ ] Add `src/wizard/services/paths.ts` for canonical app paths.
- [ ] Update `src/state.ts` to use resolved state path.
- [ ] Update `src/wizard/services/configLoader.ts` default path to resolved config path.
- [ ] Update all direct config path references in workflows/wizard facade.
- [ ] Implement one-time migration from CWD files with `.migrated` backup behavior.
- [ ] Add migration unit tests (new-path exists, old-path exists, neither exists).

Phase acceptance:
- Existing users are transparently migrated.
- New writes go only to `$HOME/.garage-installer` paths.

### Phase 5: Shared TUI State + Cross-Mode Routing
Goal:
- Stabilize app-level state model and pane switching infrastructure.

TODO checklist:
- [ ] Implement `src/tui/state.ts` app state model.
- [ ] Implement reusable tab rendering and mode switch wiring with deno_tui signals.
- [ ] Ensure pane mount/hide/show lifecycle is deterministic.
- [ ] Use reactive updates (`Signal`/`Computed`) instead of manual redraw orchestration.
- [ ] Add smoke tests for mode switching.

Phase acceptance:
- Tabs switch reliably among Config/Validate/Health shells.
- No pane rebuild regressions or focus traps.

### Phase 6: Validate Pane + Step Runner
Goal:
- Port install/validate progress UX into step-based TUI rendering.

TODO checklist:
- [ ] Create `src/tui/panes/validate.ts` with step list UI.
- [ ] Implement spinner frames and active/done/fail transitions.
- [ ] Map existing install + validation workflow stages to step callbacks.
- [ ] Render summary block (duration, pass/fail, counts).
- [ ] Add fail-fast behavior parity tests.

Phase acceptance:
- Validate mode mirrors current sequential behavior and error semantics.

### Phase 7: Config Pane (Read-first, Then Edit)
Goal:
- Add configuration visibility/editing after Health-first value is proven.

TODO checklist:
- [ ] Create `src/tui/panes/config.ts` with cluster/node section rendering.
- [ ] Load values from migrated config path.
- [ ] Add edit mode with existing validation constraints.
- [ ] Add save flow and user feedback without changing schema semantics.
- [ ] Add tests for read/save roundtrip.

Phase acceptance:
- Config pane displays and persists configuration accurately at new path.

### Phase 8: Workflow Injection Cleanup + Legacy Fallback
Goal:
- Ensure workflows are UI-agnostic and callable from both TUI and legacy prompt mode.

TODO checklist:
- [ ] Inject request/confirm abstractions where direct prompt coupling remains.
- [ ] Keep prompt modules as legacy-compatible adapters.
- [ ] Add compatibility tests for TUI adapter and prompt adapter parity.
- [ ] Confirm no behavior drift in install/resume/uninstall/validation/health/admin.

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
