import { assertEquals } from "@std/assert";
import { AppState, MODES } from "./state.ts";

Deno.test("AppState initializes with given mode", () => {
  const state = new AppState("config");
  assertEquals(state.mode.peek(), "config");
});

Deno.test("AppState defaults to health mode", () => {
  const state = new AppState();
  assertEquals(state.mode.peek(), "health");
});

Deno.test("switchMode: calls onHide on previous pane and onMount on next", () => {
  const state = new AppState("config");
  const events: string[] = [];

  state.registerPane("config", {
    onMount: () => { events.push("config:mount"); },
    onHide: () => { events.push("config:hide"); },
  });
  state.registerPane("health", {
    onMount: () => { events.push("health:mount"); },
    onHide: () => { events.push("health:hide"); },
  });

  state.switchMode("health");

  assertEquals(state.mode.peek(), "health");
  assertEquals(events, ["config:hide", "health:mount"]);
});

Deno.test("switchMode: is a no-op when target mode is already active", () => {
  const state = new AppState("health");
  let calls = 0;

  state.registerPane("health", {
    onMount: () => { calls++; },
    onHide: () => { calls++; },
  });

  state.switchMode("health");

  assertEquals(calls, 0);
  assertEquals(state.mode.peek(), "health");
});

Deno.test("switchMode: works when no lifecycle is registered for a pane", () => {
  const state = new AppState("config");

  // No registerPane calls — should not throw
  state.switchMode("health");

  assertEquals(state.mode.peek(), "health");
});

Deno.test("cycleMode: rotates through all modes in declaration order", () => {
  const state = new AppState("config");
  assertEquals(state.mode.peek(), MODES[0]); // config

  state.cycleMode();
  assertEquals(state.mode.peek(), MODES[1]); // validate

  state.cycleMode();
  assertEquals(state.mode.peek(), MODES[2]); // health

  state.cycleMode();
  assertEquals(state.mode.peek(), MODES[0]); // wraps back to config
});

Deno.test("mountInitial: triggers onMount for the starting mode", () => {
  const state = new AppState("validate");
  let mounted = false;

  state.registerPane("validate", {
    onMount: () => { mounted = true; },
    onHide: () => {},
  });

  state.mountInitial();

  assertEquals(mounted, true);
});

Deno.test("mountInitial: is a no-op when no lifecycle registered for starting mode", () => {
  const state = new AppState("config");

  // Should not throw
  state.mountInitial();

  assertEquals(state.mode.peek(), "config");
});
