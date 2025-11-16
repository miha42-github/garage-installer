#!/usr/bin/env -S deno run --allow-read --allow-write

import { StateManager } from "./src/state.ts";

console.log("Testing StateManager...\n");

// Create a new state manager
const sm = new StateManager();

// Test 1: Check if state exists (should be false initially)
console.log("1. Checking if state exists...");
const exists1 = await sm.exists();
console.log(`   Result: ${exists1 ? "EXISTS" : "NOT FOUND"}\n`);

// Test 2: Initialize state
console.log("2. Initializing state...");
sm.initializeState();
console.log("   ✓ State initialized\n");

// Test 3: Create a new state
console.log("3. Updating phases...");
sm.updatePhase("nodeConfig", "completed");
sm.updatePhase("connectivity", "completed");
sm.updatePhase("preflightChecks", "in-progress");

// Test 4: Update nodes
console.log("4. Updating nodes...");
sm.updateNodes([
  {
    name: "node1",
    host: "192.168.1.100",
    port: 22,
    username: "test",
    authMethod: "password",
  },
  {
    name: "node2",
    host: "192.168.1.101",
    port: 22,
    username: "test",
    authMethod: "key",
    keyPath: "/home/test/.ssh/id_rsa",
  },
]);

// Test 5: Update cluster config
console.log("5. Updating cluster config...");
sm.updateCluster({
  garageVersion: "v2.1.0",
  workdir: "/home/test/garage",
  dataDir: "/home/test/garage/data",
  metaDir: "/home/test/garage/meta",
  replicationFactor: 2,
  rpcSecret: "test-secret-123",
  capacity: "1T",
  ports: {
    s3Api: 3900,
    rpc: 3901,
    s3Web: 3902,
    admin: 3903,
  },
});

// Test 6: Save state
console.log("6. Saving state...");
await sm.save();
console.log("   ✓ State saved\n");

// Test 7: Check if state exists after save...
console.log("7. Checking if state exists after save...");
const exists2 = await sm.exists();
console.log(`   Result: ${exists2 ? "EXISTS" : "NOT FOUND"}\n`);

// Test 8: Load state
console.log("8. Loading state...");
await sm.load();
const state = sm.getState();
console.log(`   ✓ State loaded\n`);

// Test 8: Display state details
console.log("8. State details:");
console.log(`   Version: ${state?.version}`);
console.log(`   Nodes: ${state?.nodes?.length || 0}`);
if (state?.nodes) {
  state.nodes.forEach((node, i) => {
    console.log(`     Node ${i + 1}: ${node.name} (${node.host})`);
  });
}
console.log(`   Cluster workdir: ${state?.cluster?.workdir}`);
console.log(`   Phases:`);
if (state?.phases) {
  for (const [phase, status] of Object.entries(state.phases)) {
    console.log(`     ${phase}: ${status}`);
  }
}
console.log();

// Test 9: Check phase status
console.log("9. Testing phase status methods:");
console.log(`   Is complete: ${sm.isComplete()}`);
console.log(`   Is in progress: ${sm.isInProgress()}`);
console.log(`   Last completed: ${sm.getLastCompletedPhase()}`);
console.log(`   Next pending: ${sm.getNextPendingPhase()}\n`);

// Test 10: Clear state
console.log("10. Clearing state...");
await sm.clear();
console.log("    ✓ State cleared\n");

// Test 11: Verify state deleted
console.log("11. Checking if state exists after clear...");
const exists3 = await sm.exists();
console.log(`    Result: ${exists3 ? "EXISTS" : "NOT FOUND"}\n`);

console.log("✓ All tests completed!");
