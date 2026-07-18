import { assertEquals, assert } from "@std/assert";
import { runStepSequence } from "./validate.ts";
import type { StepState } from "./validate.ts";

Deno.test("runStepSequence: all steps pass — correct counts and status", async () => {
  const snapshots: StepState[][] = [];

  const result = await runStepSequence(
    [
      { label: "alpha", run: async () => "detail-a" },
      { label: "beta", run: async () => "detail-b" },
      { label: "gamma", run: async () => undefined },
    ],
    (states) => snapshots.push([...states]),
  );

  assertEquals(result.passed, 3);
  assertEquals(result.failed, 0);
  assertEquals(result.skipped, 0);
  assert(result.totalMs >= 0);

  const final = snapshots[snapshots.length - 1];
  assertEquals(final[0].status, "done");
  assertEquals(final[0].detail, "detail-a");
  assertEquals(final[1].status, "done");
  assertEquals(final[1].detail, "detail-b");
  assertEquals(final[2].status, "done");
  assertEquals(final[2].detail, "ok");
});

Deno.test("runStepSequence: fail-fast — failed step skips all remaining", async () => {
  let ranThird = false;
  const snapshots: StepState[][] = [];

  const result = await runStepSequence(
    [
      { label: "step1", run: async () => "ok" },
      { label: "step2", run: async () => { throw new Error("network error"); } },
      { label: "step3", run: async () => { ranThird = true; } },
      { label: "step4", run: async () => "ok" },
    ],
    (states) => snapshots.push([...states]),
  );

  assertEquals(result.passed, 1);
  assertEquals(result.failed, 1);
  assertEquals(result.skipped, 2);
  assertEquals(ranThird, false);

  const final = snapshots[snapshots.length - 1];
  assertEquals(final[0].status, "done");
  assertEquals(final[1].status, "fail");
  assertEquals(final[1].detail, "network error");
  assertEquals(final[2].status, "skip");
  assertEquals(final[3].status, "skip");
});

Deno.test("runStepSequence: first step failure skips all others", async () => {
  const result = await runStepSequence(
    [
      { label: "step1", run: async () => { throw new Error("boom"); } },
      { label: "step2", run: async () => "ok" },
    ],
    () => {},
  );

  assertEquals(result.passed, 0);
  assertEquals(result.failed, 1);
  assertEquals(result.skipped, 1);
});

Deno.test("runStepSequence: step duration is recorded", async () => {
  const snapshots: StepState[][] = [];

  await runStepSequence(
    [{
      label: "slow",
      run: async () => {
        await new Promise((r) => setTimeout(r, 15));
        return "done";
      },
    }],
    (states) => snapshots.push([...states]),
  );

  const final = snapshots[snapshots.length - 1];
  assert(final[0].durationMs >= 15, `expected ≥15ms, got ${final[0].durationMs}ms`);
});

Deno.test("runStepSequence: onUpdate receives running state before done", async () => {
  const statuses: string[] = [];

  await runStepSequence(
    [{ label: "step", run: async () => "ok" }],
    (states) => statuses.push(states[0].status),
  );

  assertEquals(statuses[0], "pending");
  assertEquals(statuses[1], "running");
  assertEquals(statuses[2], "done");
});
