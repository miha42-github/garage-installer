# State Persistence & Resume Capability

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**

The Garage Installer includes comprehensive state persistence and checkpoint/resume capability, making it resilient to failures and enabling recovery from any point in the installation process.

## Table of Contents
- [Overview](#overview)
- [State File Format](#state-file-format)
- [Installation Phases](#installation-phases)
- [Resume Capability](#resume-capability)
- [Recovery Scenarios](#recovery-scenarios)
- [State Management](#state-management)
- [Security Considerations](#security-considerations)
- [Advanced Usage](#advanced-usage)

---

## Overview

### Key Features

**1. Automatic State Saving**
- State saved after each major phase completes
- Incremental progress tracking
- Atomic file writes (prevents corruption)
- Automatic .gitignore entry

**2. Resume from Checkpoint**
- Detects incomplete installations on startup
- Shows last completed phase and next step
- Skips completed phases on resume
- Prompts only for missing information

**3. Uninstall Auto-Load**
- Reads node details from state file
- No need to re-enter SSH information
- Quick cleanup after failed installations

**4. Rollback Support**
- Tracks deployed resources per node
- Enables automatic cleanup on failure
- Integrates with CleanupManager

### When State is Saved

State is persisted after completing each of these operations:
- ✅ Node configuration collection
- ✅ SSH connectivity tests
- ✅ Preflight checks pass
- ✅ Cluster configuration chosen
- ✅ Each node deployment completes
- ✅ Cluster configuration applied
- ✅ Post-installation validation

State is **cleared** when:
- ✅ Installation completes successfully
- ✅ User chooses "Start Fresh"
- ✅ Uninstall completes successfully

---

## State File Format

### File Location

**Path**: `.garage-installer-state.json` (in current directory)

**Permissions**: Readable by user only (recommended: `chmod 600`)

**Version Control**: Automatically added to `.gitignore`

### Complete Schema

```json
{
  "version": "1.0.0",
  "nodes": [
    {
      "name": "node1",
      "host": "192.168.1.100",
      "port": 22,
      "username": "ubuntu",
      "authMethod": "key",
      "keyPath": "/home/user/.ssh/id_rsa"
    },
    {
      "name": "node2",
      "host": "192.168.1.101",
      "port": 22,
      "username": "ubuntu",
      "authMethod": "password"
    }
  ],
  "cluster": {
    "rpcSecret": "abc123...",
    "adminToken": "def456...",
    "capacityPerNode": "100G",
    "dataDir": "/home/ubuntu/garage/data",
    "metaDir": "/home/ubuntu/garage/meta",
    "workdir": "/home/ubuntu/garage",
    "garageVersion": "v2.1.0",
    "replicationFactor": 2,
    "ports": {
      "s3Api": 3900,
      "rpc": 3901,
      "s3Web": 3902,
      "admin": 3903
    }
  },
  "phases": {
    "nodeConfig": "completed",
    "connectivity": "completed",
    "preflightChecks": "completed",
    "clusterConfig": "completed",
    "deployment": "in-progress",
    "configuration": "not-started",
    "postInstall": "not-started"
  },
  "nodeState": {
    "node1": {
      "containerDeployed": true,
      "configWritten": true,
      "nodeIdRetrieved": true,
      "nodeId": "abc123456789...",
      "clusterConfigured": false
    },
    "node2": {
      "containerDeployed": false,
      "configWritten": false,
      "nodeIdRetrieved": false,
      "nodeId": null,
      "clusterConfigured": false
    }
  },
  "lastUpdated": "2025-11-16T10:30:00.000Z"
}
```

### Field Descriptions

**version**
- State file format version
- Used for migration if format changes
- Current: `1.0.0`

**nodes[]**
- Array of node configurations
- `authMethod`: Either `"key"` or `"password"`
- `keyPath`: Path to SSH private key (if key auth)
- ⚠️ `password` field is **never** stored

**cluster**
- Cluster-wide configuration
- `rpcSecret`: Generated cryptographically (32-byte hex)
- `adminToken`: Admin API bearer token
- `capacityPerNode`: Human-readable format (100G, 1T, etc.)
- Directory paths on remote nodes
- Port configuration

**phases**
- Installation phase tracking
- States: `"not-started"`, `"in-progress"`, `"completed"`, `"failed"`
- Phases executed in order

**nodeState**
- Per-node deployment tracking
- Helps determine cleanup scope
- Enables partial deployments

**lastUpdated**
- ISO 8601 timestamp
- Shows when state was last modified
- Displayed to user on resume

---

## Installation Phases

The installer tracks progress through 7 distinct phases:

### 1. nodeConfig
**Purpose**: Collect SSH details for both nodes

**Saved**:
- Hostnames/IPs
- SSH ports
- Usernames
- Authentication method
- Key paths (not password)

**Resume Skip**: If completed, restored from state

### 2. connectivity
**Purpose**: Test SSH connections to both nodes

**Saved**:
- Connection success status

**Resume Skip**: If completed, connections re-established but not re-tested

### 3. preflightChecks
**Purpose**: Validate system requirements on both nodes

**Checks**:
- Operating system compatibility
- Docker installed
- Docker permissions
- Disk space (16GB+)
- Port availability (3900-3903)
- Docker Compose present

**Resume Skip**: If completed, checks not re-run (assumes still valid)

### 4. clusterConfig
**Purpose**: Configure cluster parameters

**Saved**:
- RPC secret (generated)
- Admin token (generated)
- Garage version
- Capacity per node
- Replication factor
- Port configuration
- Directory paths

**Resume Skip**: If completed, configuration restored from state

### 5. deployment
**Purpose**: Deploy Garage containers on both nodes

**Per-Node Operations**:
- Create working directory
- Generate garage.toml
- Generate docker-compose.yml
- Pull Docker image
- Deploy container
- Wait for healthy
- Retrieve node ID

**Saved (per node)**:
- `containerDeployed`: Container running
- `configWritten`: Files created
- `nodeIdRetrieved`: Node ID obtained
- `nodeId`: Actual node ID value

**Resume Behavior**: Skips completed nodes, continues with incomplete

### 6. configuration
**Purpose**: Configure Garage cluster

**Operations**:
- Update configs with bootstrap peers
- Restart containers
- Connect nodes via Garage CLI
- Apply cluster layout
- Wait for convergence

**Saved (per node)**:
- `clusterConfigured`: Layout applied

**Resume Behavior**: Re-applies if incomplete

### 7. postInstall
**Purpose**: Validate installation and test

**Operations**:
- Check cluster status
- Create admin key
- Test S3 API with AWS CLI
- Display credentials

**Saved**: Completion status

**Resume Skip**: Re-runs validation even if previously completed

---

## Resume Capability

### Detection Flow

```
┌─────────────────────────────────────┐
│ Installer Starts                    │
└──────────────┬──────────────────────┘
               │
        ┌──────▼──────┐
        │ Check for   │
        │ state file  │
        └──────┬──────┘
               │
        ┌──────▼──────┐
        │  Exists?    │
        └──────┬──────┘
         ╱            ╲
       No              Yes
       │               │
       ▼               ▼
┌──────────┐    ┌─────────────┐
│ Normal   │    │ Load state  │
│ install  │    │ Display info│
└──────────┘    └──────┬──────┘
                       │
                ┌──────▼──────┐
                │ Prompt user │
                └──────┬──────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    ┌────▼────┐   ┌───▼────┐   ┌───▼────┐
    │ Resume  │   │ Fresh  │   │ Cancel │
    └────┬────┘   └───┬────┘   └───┬────┘
         │            │            │
         │      ┌─────▼─────┐      │
         │      │ Clear     │      │
         │      │ state     │      │
         │      └─────┬─────┘      │
         │            │            │
         └────────────┼────────────┘
                      │
                ┌─────▼──────┐
                │  Continue  │
                │installation│
                └────────────┘
```

### User Experience

**On Startup with Existing State**:
```
⚠️  Found previous installation in progress
   Last completed: deployment
   Next step: configuration
   Last updated: 2025-11-16T10:30:00Z

What would you like to do?
  > Resume installation from last checkpoint
    Start fresh (clear previous state)
    Cancel
```

**If Resume Selected**:
```
📂 Loading saved state...
✓ Restored node configurations (2 nodes)
✓ Restored cluster configuration

🔐 Re-entering credentials...
Enter password for ubuntu@node1: ********

⏭  Skipping completed phases:
✓ Node Configuration
✓ Connectivity Test
✓ Preflight Checks
✓ Cluster Configuration
✓ Deployment (node1)

▶️  Resuming from: Deployment (node2)
```

### What Gets Restored

**Automatically**:
- Node hostnames, ports, usernames
- SSH key paths
- Cluster configuration (RPC secret, admin token, etc.)
- Ports and directory paths
- Phase completion status
- Per-node deployment tracking

**Re-Prompted**:
- SSH passwords (never stored)
- Confirmation prompts
- Interactive choices during phases

---

## Recovery Scenarios

### Scenario 1: Network Failure During Deployment

**What Happened**:
- Node 1 deployed successfully
- Network dropped during Node 2 deployment
- Installer exited with error

**State Captured**:
```json
{
  "phases": {
    "deployment": "in-progress"
  },
  "nodeState": {
    "node1": {"containerDeployed": true, "nodeId": "abc123"},
    "node2": {"containerDeployed": false, "nodeId": null}
  }
}
```

**Recovery**:
1. Fix network issue
2. Restart installer
3. Select "Resume"
4. Re-enter password for node2
5. Installer skips node1, continues with node2

---

### Scenario 2: User Cancellation (Ctrl+C)

**What Happened**:
- User pressed Ctrl+C during preflight checks
- Installation interrupted

**State Captured**:
```json
{
  "phases": {
    "nodeConfig": "completed",
    "connectivity": "completed",
    "preflightChecks": "in-progress"
  }
}
```

**Recovery**:
1. Restart installer
2. Select "Resume"
3. Re-enter passwords
4. Preflight checks re-run
5. Continue to cluster config

---

### Scenario 3: Docker Permission Issue

**What Happened**:
- Preflight checks failed: user not in docker group
- User fixed manually by adding to group

**State Captured**:
```json
{
  "phases": {
    "preflightChecks": "failed"
  }
}
```

**Recovery**:
1. SSH to node: `sudo usermod -aG docker $USER`
2. Logout and login (or `newgrp docker`)
3. Restart installer
4. Select "Resume"
5. Preflight checks re-run (now pass)
6. Continue installation

---

### Scenario 4: Cluster Configuration Failed

**What Happened**:
- Both nodes deployed
- Layout application failed (version conflict)

**State Captured**:
```json
{
  "phases": {
    "deployment": "completed",
    "configuration": "failed"
  },
  "nodeState": {
    "node1": {"containerDeployed": true, "clusterConfigured": false},
    "node2": {"containerDeployed": true, "clusterConfigured": false}
  }
}
```

**Recovery**:
1. Restart installer
2. Select "Resume"
3. Configuration phase re-runs
4. Layout properly applied
5. Complete installation

---

## State Management

### Manual State Operations

**View State File**:
```bash
cat .garage-installer-state.json | jq .
```

**Check Last Phase**:
```bash
cat .garage-installer-state.json | jq '.phases'
```

**Extract Node Info**:
```bash
cat .garage-installer-state.json | jq '.nodes'
```

**Clear State Manually**:
```bash
rm .garage-installer-state.json
```

**Backup State**:
```bash
cp .garage-installer-state.json state-backup-$(date +%Y%m%d).json
```

### State File Corruption

**Symptoms**:
- Installer fails to start
- Error: "Failed to parse state file"

**Recovery**:
```bash
# Option 1: Delete and start fresh
rm .garage-installer-state.json

# Option 2: Try to repair with jq
cat .garage-installer-state.json | jq . > state-fixed.json
mv state-fixed.json .garage-installer-state.json

# Option 3: Restore from backup
cp state-backup-20251116.json .garage-installer-state.json
```

### StateManager API

For developers extending the installer:

```typescript
import { StateManager } from "./src/state.ts";

const stateManager = new StateManager();

// Initialize new state
await stateManager.initializeState();

// Check if state exists
const hasState = await stateManager.exists();

// Load existing state
await stateManager.load();

// Update nodes
stateManager.updateNodes(nodeConfigs);

// Update cluster config
stateManager.updateCluster(clusterConfig);

// Mark phase as started
stateManager.startPhase("deployment");

// Mark phase as completed
stateManager.completePhase("deployment");

// Mark phase as failed
stateManager.failPhase("deployment");

// Update per-node state
stateManager.updateNodeState("node1", {
  containerDeployed: true,
  configWritten: true
});

// Save to disk
await stateManager.save();

// Get status
const isComplete = stateManager.isComplete();
const isInProgress = stateManager.isInProgress();
const lastPhase = stateManager.getLastCompletedPhase();
const nextPhase = stateManager.getNextPendingPhase();

// Clear state
await stateManager.clear();
```

---

## Security Considerations

### What's Stored

**✅ Stored in State File**:
- Hostnames and IP addresses
- SSH usernames and ports
- SSH key file paths
- Cluster configuration (secrets, tokens)
- Directory paths
- Installation progress

**❌ NOT Stored**:
- SSH passwords
- Private key contents
- User interactive input

### Protecting State File

**File Permissions**:
```bash
# Restrict to owner only
chmod 600 .garage-installer-state.json

# Verify
ls -la .garage-installer-state.json
# Should show: -rw------- 1 user user
```

**Secrets in State**:
- RPC secret and admin token ARE stored
- These are needed to resume cluster configuration
- Treat state file as sensitive
- Don't commit to version control (automatically .gitignored)
- Don't share publicly

**Best Practices**:
1. Keep state file on secure workstation
2. Delete after successful installation
3. Encrypt backups if storing long-term
4. Rotate admin token after exposure

---

## Advanced Usage

### Inspecting State Programmatically

**Example: Extract Node IDs**:
```bash
jq -r '.nodeState | to_entries[] | "\(.key): \(.value.nodeId)"' .garage-installer-state.json
```

**Example: Check Progress**:
```bash
jq '.phases | to_entries[] | select(.value == "completed") | .key' .garage-installer-state.json
```

**Example: Get Cluster Endpoint**:
```bash
NODE1=$(jq -r '.nodes[0].host' .garage-installer-state.json)
PORT=$(jq -r '.cluster.ports.s3Api' .garage-installer-state.json)
echo "S3 Endpoint: http://$NODE1:$PORT"
```

### State Migration

If state format changes between versions:

```typescript
// Hypothetical migration function
function migrateState(oldState: any): State {
  if (oldState.version === "1.0.0") {
    // Add new fields with defaults
    oldState.version = "1.1.0";
    oldState.newField = "default";
  }
  return oldState as State;
}
```

### Multiple Installations

**Current Limitation**: One state file per directory

**Workaround**: Use different directories:
```bash
mkdir ~/cluster1
cd ~/cluster1
./garage-installer

mkdir ~/cluster2
cd ~/cluster2
./garage-installer
```

Each maintains independent state.

---

## Troubleshooting

### State File Missing After Failure

**Cause**: Installer crashed before save

**Solution**: No recovery - start fresh installation

---

### Resume Hangs at Old Phase

**Cause**: Phase status not properly updated

**Solution**:
1. Manually edit state file
2. Mark phase as "completed"
3. Resume installation

```bash
# Edit with jq
jq '.phases.deployment = "completed"' .garage-installer-state.json > tmp.json
mv tmp.json .garage-installer-state.json
```

---

### Want to Skip Failed Node

**Cause**: One node keeps failing, want to continue without it

**Solution**: Not supported - installer requires both nodes. Either:
1. Fix the failing node
2. Start fresh with different nodes

---

## Related Documentation

- **[Architecture Guide](architecture.md)** - StateManager implementation details
- **[Troubleshooting Guide](troubleshooting.md)** - Recovery from failures
- **[Cluster Management](cluster-management.md)** - Post-installation operations

---

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**

## Key Features

### 1. Automatic State Saving
- State is automatically saved after each major phase completes
- 7 tracked phases:
  1. `nodeConfig` - Node configuration collection
  2. `connectivity` - SSH connectivity testing
  3. `preflightChecks` - System requirements validation
  4. `clusterConfig` - Cluster configuration
  5. `deployment` - Container deployment
  6. `configuration` - Garage cluster setup
  7. `postInstall` - Validation testing

### 2. Resume from Checkpoint
- On startup, installer detects existing state file
- User prompted with options:
  - **Resume** - Continue from last checkpoint
  - **Start Fresh** - Clear state and start over
  - **Cancel** - Exit installer
- Completed phases are skipped
- Execution continues from next pending phase

### 3. State File Contents
Stored in `.garage-installer-state.json` (gitignored):
```json
{
  "version": "1.0.0",
  "nodes": [
    {
      "name": "node1",
      "host": "192.168.1.100",
      "port": 22,
      "username": "ubuntu",
      "authMethod": "key",
      "keyPath": "/path/to/key"
    }
  ],
  "cluster": {
    "garageVersion": "v2.1.0",
    "workdir": "/home/ubuntu/garage",
    "dataDir": "/home/ubuntu/garage/data",
    "metaDir": "/home/ubuntu/garage/meta",
    "replicationFactor": 2,
    "rpcSecret": "...",
    "capacity": "1T",
    "ports": { ... }
  },
  "phases": {
    "nodeConfig": "completed",
    "connectivity": "completed",
    "preflightChecks": "in-progress",
    ...
  },
  "nodeState": {
    "node1": {
      "containerDeployed": true,
      "configWritten": false,
      "clusterConfigured": false
    }
  },
  "lastUpdated": "2024-01-15T10:30:00.000Z"
}
```

**Security Note**: Passwords are NOT stored in the state file. On resume, user is prompted to re-enter passwords.

### 4. Uninstall Auto-Load
- Uninstall can automatically load node details from saved state
- No need to re-enter node information
- User confirms before proceeding
- Still prompts for passwords (not stored)

## Usage Examples

### Normal Installation
```bash
deno task start
# Select: Install
# Follow prompts...
# Installation completes successfully
# State file automatically deleted
```

### Resume After Failure
```bash
deno task start
# If state found:
# ✓ Found previous installation state:
#   Phase: deployment (failed)
#   Nodes: node1, node2
# 
# What would you like to do?
#   1. Resume installation
#   2. Start fresh
#   3. Cancel
# 
# Select: 1 (Resume)
# Prompts for passwords
# Continues from deployment phase
```

### Uninstall with State
```bash
deno task start
# Select: Uninstall
# ✓ Found saved installation state
#   • node1 (192.168.1.100)
#   • node2 (192.168.1.101)
# 
# Use these nodes for uninstall? Yes
# Enter passwords...
# Uninstallation proceeds
```

## Implementation Details

### StateManager Class (`src/state.ts`)
- Manages all state persistence operations
- Methods:
  - `initializeState()` - Create new state structure
  - `load()` - Load from disk
  - `save()` - Save to disk
  - `clear()` - Delete state file
  - `updatePhase()` - Mark phase status
  - `updateNodes()` - Save node configs
  - `updateCluster()` - Save cluster config
  - `updateNodeState()` - Track per-node deployment
  - `getLastCompletedPhase()` - Find checkpoint
  - `getNextPendingPhase()` - Determine resume point
  - `isComplete()` - Check if all phases done
  - `isInProgress()` - Check if installation active

### Wizard Integration (`src/wizard.ts`)
- Added `stateManager` property
- Modified `run()`:
  - Checks for existing state on startup
  - Prompts user for action
  - Calls `resumeInstallation()` or continues normally
  - Saves state after each phase
  - Clears state on success
  - Marks phases as failed on error
- New `resumeInstallation()` method:
  - Restores node configurations
  - Re-prompts for passwords
  - Restores cluster configuration
  - Determines next pending phase
  - Executes remaining phases
- Updated `runUninstall()`:
  - Checks for saved state
  - Offers to use saved node details
  - Re-prompts for passwords only

## Testing

Run the state manager test:
```bash
./test_state.ts
```

Expected output:
- ✓ State creation and initialization
- ✓ Node and cluster configuration updates
- ✓ Phase status tracking
- ✓ Save and load operations
- ✓ Checkpoint detection
- ✓ State cleanup

## Benefits

1. **Resilient** - Recover from network failures, crashes, or interruptions
2. **User-Friendly** - No need to re-enter all details after failure
3. **Production-Ready** - Safe for real-world deployments
4. **Secure** - Passwords never stored on disk
5. **Transparent** - Clear messaging about state and resume options
6. **Fast Uninstall** - Auto-loads node details for quick removal

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**