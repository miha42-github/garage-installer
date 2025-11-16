# State Persistence Feature

## Overview
The Garage Installer now includes state persistence and checkpoint/resume capability. This makes the installer production-ready by allowing installations to recover from failures and resume from the last successful checkpoint.

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

## Future Enhancements

Potential improvements:
- Multi-cluster support (track multiple installations)
- State migration for version upgrades
- Export/import state for backup/restore
- State validation and repair
- Progress percentage display
- Retry failed operations with backoff
