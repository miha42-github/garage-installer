# /health-debug

Debug the TUI health pane against the live cluster.

## Files to focus on

- `src/tui/panes/health.ts` — rendering (node boxes, event log, scroll)
- `src/tui/adapters/wizardAdapter.ts` — `collectHealthSnapshot()`, `createPollingController()`
- `src/tui/main.ts` — mode switching, keyboard handling, refresh loop

## Typical debug session

1. Read the current state of `wizardAdapter.ts:collectHealthSnapshot()` — this is where live data is gathered
2. Read `health.ts:applySnapshot()` — this is where data flows into the TUI signals
3. Run `deno task dev` and exercise the health pane with `Tab` to switch to health mode, `r` to force refresh
4. Check `garage-installer.log` for SSH/probe errors that don't surface in the TUI

## Common failure points

- SSH connection reuse: `SSHConnection` in `src/ssh/connection.ts` may time out silently; check `keepAlive` settings
- Garage admin API probe: port 3903 may be firewalled between nodes; check `endpointChecks.ts`
- Signal updates: deno_tui `Signal` updates must happen on the right tick; check if `applySnapshot()` is called after `tui.dispatch()`
- Polling controller: `createPollingController()` uses `setInterval`; verify cleanup on pane hide to avoid ghost polls

## Keyboard controls (in TUI)

`q` quit · `Tab` switch mode · `r` force refresh · `↑/↓` scroll event log
