# /dev

Start the installer in development mode (TUI by default).

```bash
deno task dev
```

To force the legacy CLI wizard instead:

```bash
GARAGE_USE_LEGACY_CLI=1 deno task dev
```

Logs are written to `garage-installer.log` in the working directory. Tail it in another terminal for real-time debug output:

```bash
tail -f garage-installer.log
```
