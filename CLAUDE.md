# Garage Cluster Installer — Claude Context

## What This Is

Interactive CLI wizard that deploys a two-node S3-compatible object storage cluster using [Garage](https://garagehq.deuxfleurs.fr/). Targets development and lab environments. Produces a single binary (Deno-compiled TypeScript) with no runtime dependencies.

**Not for production.** 2-node clusters have no fault tolerance.

---

## Quick Commands

```bash
deno task dev           # Run from source (all permissions)
deno task test          # Unit tests (services layer only)
deno task compile       # Build binary for current platform
deno task build-all     # Cross-compile Linux/macOS/Windows

# Run with legacy CLI instead of TUI
GARAGE_USE_LEGACY_CLI=1 deno task dev
```

---

## Architecture

```
mod.ts                          Entry point; routes to TUI or legacy wizard
src/
  wizard.ts                     Wizard facade; maintains node1/node2/clusterConfig
  wizard/
    workflows/
      install.ts                7-phase installation orchestration
      uninstall.ts              Cluster teardown
      validation.ts             Health check workflow
      healthReport.ts           Real-time health metric collection
      bucketAdmin.ts            Interactive bucket/key management
    services/
      configLoader.ts           Load garage-cluster-config.json
      sshDefaults.ts            Auto-detect SSH key/user/port
      endpointChecks.ts         Reachability + command probes
    prompts/
      nodePrompts.ts            SSH node discovery prompts
      clusterPrompts.ts         Storage/port/version prompts
    types.ts                    NodeConfig, ClusterConfig interfaces
    context.ts                  WizardContext (shared runtime state)
  tui/
    main.ts                     deno_tui shell; keyboard nav; mode switching
    panes/health.ts             Health monitoring pane (active debug focus)
    adapters/wizardAdapter.ts   collectHealthSnapshot(); createPollingController()
    colors.ts                   Color scheme (C.green, C.red, C.amber, etc.)
  ssh/connection.ts             SSHConnection wrapper over npm:ssh2
  docker/manager.ts             DockerManager — image pull, compose deploy, health checks
  garage/
    admin.ts                    GarageAdmin — bucket/key CRUD via CLI
    cluster.ts                  GarageCluster — layout config, RPC secret gen
  checks/system.ts              SystemChecker — OS, Docker, disk, ports
  state.ts                      StateManager — JSON checkpoint/resume
  cleanup.ts                    CleanupManager — rollback on failure
  logger.ts                     Timestamped file logger → garage-installer.log
  ui/
    display.ts                  Tables, color helpers
    spinner.ts                  withSpinner() progress wrapper
```

### Execution paths

- **New (default):** `mod.ts → runTUI() → src/tui/main.ts → wizardAdapter → workflows`
- **Legacy:** `mod.ts → Wizard class → workflows` (set `GARAGE_USE_LEGACY_CLI=1`)

---

## Key Types

```typescript
// src/wizard/types.ts
NodeConfig    { host, user, authMethod, keyPath?, password?, port }
ClusterConfig { storageGb, garageVersion, s3Port, adminPort, rpcPort, rpcSecret }

// src/tui/adapters/wizardAdapter.ts
HealthSnapshot {
  nodes: Array<{ host, role, zone, ssh, s3, admin, ping, status: HealthStatus }>
  buckets: number
  keys: number
  clusterReachable: boolean
}
HealthStatus  "ok" | "degraded" | "down" | "unknown"
```

---

## State Files (auto-generated, git-ignored)

| File | Purpose |
|------|---------|
| `.garage-installer-state.json` | 7-phase install checkpoint |
| `garage-cluster-config.json` | Post-install cluster config (host, ports, keys) |
| `garage-installer.log` | Runtime audit log |

---

## Current Work: Health Screen Debugging

**Branch:** `feature/V0.1/hardening`

The TUI health pane (`src/tui/panes/health.ts`) is under active debugging against a live cluster. The main adapter bridging real cluster data to the pane is `src/tui/adapters/wizardAdapter.ts`.

Key functions to focus on:
- `collectHealthSnapshot()` in `wizardAdapter.ts` — gathers live metrics
- `createPollingController()` in `wizardAdapter.ts` — auto-refresh logic
- `createHealthPane()` in `panes/health.ts` — renders node status boxes and event log

The health pane displays:
- Per-node status boxes (SSH reachability, S3 endpoint, admin API, ping)
- Cluster-wide metrics (bucket count, key count)
- Scrollable event log

**Keyboard controls in TUI:** `q` quit · `Tab` switch mode · `r` force refresh · `↑/↓` scroll log

---

## Dependencies

```
npm:ssh2@^1.15.0          SSH client
deno.land/x/tui@2.1.11   Terminal UI framework
deno.land/x/cliffy@v1.0.0 Interactive prompts + tables
jsr:@std/assert           Testing
jsr:@std/fmt              ANSI colors (legacy path)
deno.land/x/crayon@3.3.3  ANSI colors (TUI path)
figlet@1.7.0              ASCII banner
```

---

## Testing

Tests cover the services layer only. Integration tests require live SSH targets.

```bash
deno task test
# Runs: src/wizard/services/*.test.ts + src/tui/adapters/wizardAdapter.test.ts
```

Do **not** mock SSH/Docker in tests — the project avoids mock/prod divergence.

---

## Conventions

- **No sudo.** Docker is accessed via the docker group; containers run non-root.
- **Passwords never written to disk.** Only SSH key paths are persisted.
- **Graceful SIGINT.** Ctrl+C triggers cleanup before exit.
- **Log everything.** Use `ctx.logger` for audit trail; `ctx.display` for user-facing output.
- **Resume-friendly.** State checkpoints after each phase; partial installs can be resumed.
- **TypeScript strict mode off** — `deno.json` uses `deno.window` + `deno.unstable` libs.
- Comments only for non-obvious WHY — not what.

---

## Docs

| Path | Contents |
|------|---------|
| `docs/architecture.md` | System design |
| `docs/troubleshooting.md` | Common issues |
| `docs/state-persistence.md` | Checkpoint/resume details |
| `FUTURES.md` | Roadmap (3+ nodes, TLS, monitoring) |
| `garage-tui-design-spec.md` | Full TUI mock-ups and interaction spec |
| `UI_REDESIGN.md` | TUI implementation strategy |
