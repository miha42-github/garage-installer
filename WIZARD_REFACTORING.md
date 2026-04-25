# Wizard Refactoring Plan

## Goal
Reduce complexity in `src/wizard.ts` (currently ~3000 lines) by splitting orchestration, workflows, and shared utilities into focused modules while preserving behavior and CLI UX.

## Current Pain Points
- Multiple workflows are mixed in one class (`install`, `resume`, `uninstall`, `validation`, `health report`, `bucket admin`).
- Repeated concerns exist across flows: config loading, SSH key detection, endpoint probing, prompt handling, and logging setup.
- Long methods combine UI prompts, business logic, remote execution, and persistence updates.
- Hard to test safely because side effects are tightly coupled to prompt/SSH/file operations.

## Refactoring Principles
- Keep behavior unchanged first; improve structure before changing features.
- Prefer extraction over rewrite.
- Keep each module single-purpose and dependency-injected where possible.
- Preserve public CLI entry points and existing state file format.
- Ship in small PR-sized phases with runnable checkpoints.

## Target Structure

```text
src/
  wizard/
    index.ts                    # thin facade used by mod.ts
    types.ts                    # NodeConfig, ClusterConfig, shared DTOs
    context.ts                  # runtime context (logger/display/state/cleanup)
    prompts/
      nodePrompts.ts            # node input flows
      clusterPrompts.ts         # cluster config prompts
    services/
      configLoader.ts           # garage-cluster-config.json + fallback loading
      sshDefaults.ts            # detect key/user/port defaults
      endpointChecks.ts         # commandExists + reachability helpers
      stateProgress.ts          # state phase transitions
    workflows/
      install.ts                # run + resume core install path
      uninstall.ts              # uninstall flow
      validation.ts             # runValidation + runValidationPreflight + runValidationTest
      healthReport.ts           # runHealthReport
      bucketAdmin.ts            # runBucketAdmin and menu actions
    output/
      successMessage.ts         # success + AWS CLI setup display blocks
```

Notes:
- Existing modules (`state.ts`, `cleanup.ts`, `garage/*`, `docker/*`, `checks/*`) remain source-of-truth for domain behavior.
- `src/wizard.ts` becomes a compatibility shim during migration, then is minimized or replaced by `src/wizard/index.ts` export.

## Method Migration Map

### Install workflow
- `run` -> `workflows/install.ts` (`runInstall`)
- `resumeInstallation` -> `workflows/install.ts` (`resumeInstall`)
- `collectNodeInfo`, `testConnectivity`, `runPreflightChecks`, `testInterNodeConnectivity`, `configureCluster`, `showSummary`, `deployCluster`, `postInstall`, `runPostInstallValidation` -> split between:
  - `prompts/*` for interactive collection
  - `workflows/install.ts` for orchestration
  - `services/*` for shared side-effect helpers

### Uninstall workflow
- `runUninstall` -> `workflows/uninstall.ts`

### Validation and health workflows
- `runValidation`, `runValidationPreflight`, `runValidationTest` -> `workflows/validation.ts`
- `runHealthReport` -> `workflows/healthReport.ts`

### Bucket admin workflow
- `runBucketAdmin` -> `workflows/bucketAdmin.ts`

### Shared utilities/output
- `commandExists`, `checkEndpointReachability` -> `services/endpointChecks.ts`
- `showSuccessMessage`, `showAWSCLISetup` -> `output/successMessage.ts`
- `closeConnections` -> `context.ts` or `services/stateProgress.ts` cleanup helper
- `testHostResolution` -> `services/endpointChecks.ts`

## Phased Implementation Plan

## Phase 0: Safety Net and Baseline
Scope:
- Add a lightweight regression harness for critical command paths:
  - Installer starts and reaches node prompts.
  - Uninstall path initializes and handles cancellation.
  - Validation preflight error path when AWS CLI missing.
- Capture baseline snapshots of key output sections and state phase transitions.

Deliverables:
- Minimal tests (unit or integration-light with mocks) for top-level workflow entry points.
- A baseline runbook in docs for manual verification.

Acceptance:
- Existing CLI behavior verified before structural moves.

## Phase 1: Extract Shared Types and Context
Scope:
- Move `NodeConfig` and `ClusterConfig` to `src/wizard/types.ts`.
- Introduce `WizardContext` with logger/display/state/cleanup references.
- Keep `Wizard` API unchanged while delegating internals.

Deliverables:
- `src/wizard/types.ts`
- `src/wizard/context.ts`
- `src/wizard.ts` imports updated to consume extracted modules.

Acceptance:
- No behavior changes; build/type-check passes.

## Phase 2: Utility Service Extraction
Scope:
- Extract duplicated logic for:
  - SSH defaults/key detection
  - config file loading
  - endpoint reachability
  - command existence checks
  - state phase transition helpers

Deliverables:
- `services/sshDefaults.ts`
- `services/configLoader.ts`
- `services/endpointChecks.ts`
- `services/stateProgress.ts`

Acceptance:
- `src/wizard.ts` line count reduced significantly without altering flow order.

## Phase 3: Workflow Modules (No Public API Change)
Scope:
- Move each top-level command flow to dedicated workflow module:
  - install/resume
  - uninstall
  - validation
  - health
  - bucket admin
- Keep `Wizard` class as thin facade that forwards calls.

Deliverables:
- `workflows/install.ts`
- `workflows/uninstall.ts`
- `workflows/validation.ts`
- `workflows/healthReport.ts`
- `workflows/bucketAdmin.ts`

Acceptance:
- `Wizard` public methods still exist and return same behavior.
- Smoke tests and manual flows pass.

## Phase 4: Prompt Layer Isolation
Scope:
- Move prompt-heavy sections into `prompts/nodePrompts.ts` and `prompts/clusterPrompts.ts`.
- Keep workflow modules focused on sequencing and decisions.

Deliverables:
- prompt modules with pure validation helpers where possible.

Acceptance:
- Prompt defaults and validation messages unchanged.

## Phase 5: Output/Presentation Cleanup
Scope:
- Move success and setup messaging to dedicated output module.
- Normalize formatting helpers and reduce repeated `console.log` patterns.

Deliverables:
- `output/successMessage.ts`
- Reduced duplicated display blocks.

Acceptance:
- User-facing text remains functionally equivalent (or intentionally improved in a separate PR).

## Phase 6: Finalize Entry Point and Compatibility
Scope:
- Introduce `src/wizard/index.ts` as canonical export.
- Optionally keep `src/wizard.ts` as backwards-compatible re-export (or thin wrapper) until next major release.

Deliverables:
- Updated `mod.ts` imports if needed.
- Changelog note for internal module structure changes.

Acceptance:
- Public CLI usage unchanged.

## Suggested PR Breakdown
1. Types/context extraction.
2. Shared services extraction.
3. Validation + health workflow extraction.
4. Uninstall + bucket admin extraction.
5. Install/resume extraction.
6. Prompt/output cleanup and entrypoint finalization.

Each PR should keep changes reviewable and maintain a green build.

## Risk Register
- Risk: Prompt behavior drift.
  - Mitigation: snapshot expected prompt defaults/messages in tests.
- Risk: State transition regressions during install/resume.
  - Mitigation: assertions around phase updates and persisted state checkpoints.
- Risk: SSH/config fallback behavior changes.
  - Mitigation: explicit tests for config-present vs config-missing branches.
- Risk: Large, hard-to-review PRs.
  - Mitigation: strict phased PR boundaries above.

## Non-Goals
- Changing installer UX flow order.
- Altering persisted state schema.
- Introducing new runtime dependencies unless required for testability.

## Definition of Done
- `src/wizard.ts` is reduced to a thin orchestrator/facade (or replaced by modular index).
- Workflows are isolated by responsibility.
- Shared helpers are reusable and covered by tests.
- Install, resume, uninstall, validation, health report, and bucket admin paths are verified.
