# BLESSED IS FUCKED

## Short version

`neo-blessed` is not usable in this repo under Deno.

The failure is not caused by our Health pane layout code. The library itself blows up during startup under Deno's npm/CommonJS compatibility layer.

## What we observed

Running the normal app entrypoint with the `neo-blessed`-based TUI produced:

```text
✖ Fatal error: Maximum call stack size exceeded

Stack trace: RangeError: Maximum call stack size exceeded
    at new Screen (.../neo-blessed/0.1.81/lib/widgets/screen.js:1:1)
    at new Screen (.../neo-blessed/0.1.81/lib/widgets/screen.js:1:1)
    at new Screen (.../neo-blessed/0.1.81/lib/widgets/screen.js:1:1)
    ... repeated ...
```

The same problem reproduced in a tiny one-line Deno eval, which means the issue exists before any of our UI wiring matters:

```ts
import blessed from "neo-blessed";
blessed.screen({ smartCSR: true, warnings: false });
```

That also crashes with the same recursive `Screen` stack overflow.

## Why this points at the library, not our code

The direct repro above bypasses our app completely.

Additional runtime inspection showed:

- `blessed.screen === blessed.Screen`
- `Object.getPrototypeOf(blessed.Screen.prototype)?.constructor?.name` was `Object`, not `Node`
- the same broken prototype pattern showed up on `Program`, `Node`, `Element`, `Box`, `Log`, and `Screen`

In other words, the constructor/prototype chain that `blessed`-style widgets expect is not coming up correctly under Deno here.

The first failure mode was recursive `Screen` construction.

After manually patching prototype chains at runtime, the next failure mode moved deeper into the library and became stream/event assumptions such as:

```text
TypeError: this.input.on is not a function
```

and later:

```text
TypeError: this.on is not a function
```

That tells us the problem is broader than a single constructor alias. The package is relying on Node/CommonJS inheritance and stream behavior that is not lining up cleanly in Deno's runtime path for this repo.

## Important detail

This was not just `neo-blessed` specifically.

Testing `blessed@0.1.81` directly under Deno produced the same startup recursion pattern, which strongly suggests the issue is the `blessed` runtime model under Deno rather than our specific package choice.

## Practical conclusion

For this project, the `blessed` / `neo-blessed` path is effectively broken under Deno.

You can summarize it to Claude like this:

> The `neo-blessed` TUI path is fucked under Deno. Even a minimal `blessed.screen()` repro crashes before our app logic runs. The prototype chain for core widgets comes up wrong under Deno's npm/CommonJS interop, causing recursive `Screen` construction and then deeper Node stream/event failures when patched. This is a library/runtime compatibility problem, not a pane layout bug.

## What we did instead

We replaced the runtime `neo-blessed` TUI with a small ANSI/raw-stdin shell that preserves the current Phase 1 and Phase 2 behavior:

- alternate screen
- raw keyboard input
- mode switching with `tab` / `1` / `2` / `3`
- Health screen rendering
- manual `r` refresh
- `q` quit

Current active files:

- `src/tui/main.ts`
- `src/tui/panes/health.ts`

`neo-blessed` is still listed in `deno.json`, but it is no longer part of the runtime path.

## Current status

- `deno check src/tui/main.ts src/tui/panes/health.ts` passes
- `deno task dev` starts successfully in a normal terminal
- sandboxed terminals may still fail raw-mode setup with `EPERM`, but that is separate from the `neo-blessed` crash

## Recommendation

If we want a richer TUI under Deno, we should either:

1. keep extending the current ANSI/raw-stdin shell, or
2. switch to a Deno-native terminal UI approach instead of trying to force `blessed` through Deno's npm/CommonJS layer