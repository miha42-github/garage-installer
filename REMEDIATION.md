# Remediation Plan - Garage Cluster Installer

## Overview
This document outlines the issues found in the current codebase and the plan to fix them.

## Critical Issues

### 1. Docker Permissions Not Applied After Auto-Fix
**File:** `src/checks/system.ts` (lines 88-96)

**Problem:**
- When the auto-fix adds a user to the docker group, it requires a logout/login for the group changes to take effect
- The note says "We'll use sudo docker for now" but the code doesn't actually implement this fallback
- Subsequent docker commands will fail because permissions haven't taken effect

**Impact:** High - Installation will fail after auto-fix attempts

**Solution:**
- After adding user to docker group, use `sudo docker` for all subsequent commands in that session
- OR use `newgrp docker` to activate the group immediately
- OR detect if we need sudo and prepend it to all docker commands dynamically

---

### 2. Port Check Uses `sudo` Without Checking Availability
**File:** `src/checks/system.ts` (lines 130-132)

**Problem:**
- Uses `sudo ss -tlnp` without checking if sudo is available or requires password
- Could hang waiting for password or fail if sudo not configured

**Impact:** Medium - Could block installation flow

**Solution:**
- Try without sudo first: `ss -tlnp` or `netstat -tlnp`
- Fall back to sudo only if needed
- Check if sudo requires password and warn user

---

### 3. Missing Error Handling for SSH Operations
**File:** `src/ssh/connection.ts` (multiple locations)

**Problem:**
- `uploadFile()` uses synchronous `Deno.readFileSync()` which could block on large files
- No timeout handling for SSH operations
- Connection errors don't provide enough context

**Impact:** Medium - Poor user experience, hard to debug

**Solution:**
- Use async file reading: `Deno.readFile()`
- Add timeout parameter to exec() with default of 30s
- Improve error messages with connection context

---

### 4. Garage Layout Apply Command Has Hardcoded Version
**File:** `src/garage/cluster.ts` (line 227)

**Problem:**
```typescript
const applyCmd = "garage layout apply --version 1";
```
- Hardcodes layout version to 1
- Will fail if layout already exists or version incremented
- Garage requires incrementing version numbers for layout changes

**Impact:** High - Cluster configuration will fail

**Solution:**
- Get current layout version first
- Use `--version <current+1>` 
- OR use the newer command format that doesn't require version number

---

### 5. Node ID Extraction is Fragile
**File:** `src/garage/cluster.ts` (lines 163-173)

**Problem:**
```typescript
const match = result.stdout.match(/([a-f0-9]{64})/);
```
- Assumes specific format from `garage node id` output
- Output format may vary between Garage versions
- Only matches lowercase hex (a-f), not uppercase (A-F)

**Impact:** High - Node connection will fail

**Solution:**
- Use case-insensitive regex: `/([a-f0-9]{64})/i`
- Parse structured output if available
- Add fallback parsing strategies
- Validate the extracted ID before using

---

### 6. Docker Compose Deploy Doesn't Check for Errors in Config
**File:** `src/docker/manager.ts` (lines 57-68)

**Problem:**
- Writes compose file and immediately runs `docker compose up -d`
- Doesn't validate the compose file syntax first
- Could fail with cryptic errors

**Impact:** Medium - Poor error messages

**Solution:**
- Run `docker compose config` to validate before deploy
- Show validation errors clearly
- Catch common mistakes (invalid YAML, etc.)

---

### 7. Inter-Node Connectivity Test Uses Wrong Command
**File:** `src/wizard.ts` (lines 305-312)

**Problem:**
```typescript
await this.node1!.connection!.exec(`ping -c 1 -W 2 ${this.node2!.host}`);
```
- `ping` may be blocked by firewall
- Doesn't test the actual Garage RPC port (3901)
- Should test bidirectional connectivity

**Impact:** Medium - False positives/negatives

**Solution:**
- Test actual port connectivity: `nc -zv ${host} 3901` or `telnet`
- Test from both nodes to each other
- Test all required ports (3900-3903)

---

### 8. SSH File Upload Implementation is Broken
**File:** `src/ssh/connection.ts` (lines 95-113)

**Problem:**
```typescript
const readStream = Deno.readFileSync(localPath);
const writeStream = sftp.createWriteStream(remotePath);
writeStream.write(readStream);
```
- `readFileSync()` returns `Uint8Array`, not a stream
- Trying to use it like a stream with `.write()`
- This will not work correctly

**Impact:** High - File uploads will fail (used for config files)

**Solution:**
```typescript
const fileData = await Deno.readFile(localPath);
const writeStream = sftp.createWriteStream(remotePath);
writeStream.write(fileData);
writeStream.end();
```

---

### 9. Container Exists Check is Unreliable
**File:** `src/docker/manager.ts` (lines 42-47)

**Problem:**
```typescript
const result = await this.ssh.exec(
  `docker ps -a | grep ${name} || echo "not_found"`
);
return !result.stdout.includes("not_found");
```
- Using `grep` with unescaped name could match partial names
- e.g., searching for "garage" would match "garage-proxy", "garage-test", etc.

**Impact:** Medium - Could operate on wrong containers

**Solution:**
- Use `docker ps -a --filter "name=^${name}$"` for exact match
- OR parse docker ps output properly with format options

---

### 10. No Rollback/Cleanup on Failure
**File:** `src/wizard.ts` (entire file)

**Problem:**
- If installation fails midway, containers/files remain on remote hosts
- No cleanup mechanism
- Wizard.cleanup() only closes SSH connections

**Impact:** Medium - Leaves system in inconsistent state

**Solution:**
- Track deployment state (which nodes were modified)
- Offer cleanup on failure
- Add `--cleanup` or `--uninstall` command-line option
- Remove containers, volumes, config files on rollback

---

## Medium Issues

### 11. Missing Input Validation for Capacity
**File:** `src/wizard.ts` (lines 320-328)

**Problem:**
- Validates format (`^\d+[KMGT]$`) but doesn't validate reasonable values
- User could enter "0G" or "999999999T"

**Solution:**
- Add min/max bounds checking
- Warn if capacity is very small or exceeds available disk space

---

### 12. No SSH Connection Timeout
**File:** `src/ssh/connection.ts` (line 48)

**Problem:**
- No `readyTimeout` set for SSH connection
- Could hang indefinitely if network is slow/problematic

**Solution:**
- Add `readyTimeout: 30000` to connection config
- Make timeout configurable

---

### 13. Bootstrap Peers Not Configured
**File:** `src/garage/cluster.ts` (line 94)

**Problem:**
```typescript
bootstrap_peers = []
```
- Sets bootstrap_peers to empty array
- Nodes won't automatically discover each other on restart
- Relies on manual `garage node connect` every time

**Solution:**
- Pre-populate bootstrap_peers with both node addresses
- Format: `["<node1_id>@<node1_host>:3901", "<node2_id>@<node2_host>:3901"]`
- Requires deploying configs in two passes (first to get IDs, second to update configs)

---

### 14. Hardcoded Paths and Ports
**Files:** Multiple

**Problem:**
- Ports (3900-3903) hardcoded throughout
- Paths like `/opt/garage`, `/var/lib/garage` not configurable
- Project plan mentions asking about custom ports but it's not implemented

**Solution:**
- Add optional advanced settings prompts
- Store all config in ClusterConfig interface
- Use constants file for defaults

---

### 15. Docker User Mapping Assumes Single User
**File:** `src/garage/cluster.ts` (lines 49-54)

**Problem:**
- Uses current SSH user's UID/GID for container
- If user is not owner of data directories, permission issues
- Doesn't verify user can write to target directories

**Solution:**
- Check write permissions before deployment
- Offer to create directories with correct ownership
- Warn if using root (UID 0)

---

## Low Priority / Enhancement Issues

### 16. No Progress Indicators for Long Operations
**Files:** Multiple

**Problem:**
- Long operations (docker pull, waiting for health) show static messages
- No spinner or progress bar

**Solution:**
- Use cliffy spinner for operations
- Show approximate time remaining
- Stream docker pull progress

---

### 17. No Logging to File
**Problem:**
- All output to console only
- Debugging failures requires copy-pasting terminal output
- No structured logs

**Solution:**
- Add optional `--log-file` parameter
- Write timestamped logs
- Include all SSH commands and responses

---

### 18. Missing Validation for Garage Version
**File:** `src/wizard.ts` (lines 337-340)

**Problem:**
- User can enter any version string
- No check if version exists on Docker Hub
- Could cause docker pull to fail late in process

**Solution:**
- Validate against known versions list
- OR attempt docker pull early as preflight check
- Provide default/recommended version

---

### 19. No IPv6 Support Consideration
**Files:** Multiple

**Problem:**
- Hostname validation rejects IPv6 addresses
- Config uses `[::]` which is good, but no IPv6 testing

**Solution:**
- Update hostname validation to accept IPv6
- Test IPv6 connectivity if address is IPv6

---

### 20. Windows Compatibility Not Tested
**Problem:**
- Project plan mentions Windows support
- Build script only tests Linux/macOS
- SSH client availability on Windows unclear

**Solution:**
- Test on Windows
- Document Windows requirements
- May need different SSH approach for Windows

---

## Implementation Priority

### Phase 1 (Critical - Do First)
1. Fix docker permissions fallback (#1)
2. Fix garage layout apply version (#4)
3. Fix node ID extraction regex (#5)
4. Fix SSH file upload (#8)
5. Fix container exists check (#9)

### Phase 2 (High - Do Soon)
6. Add proper error handling for SSH operations (#3)
7. Implement rollback/cleanup (#10)
8. Fix inter-node connectivity test (#7)
9. Configure bootstrap peers (#13)

### Phase 3 (Medium - Can Wait)
10. Improve port checking (#2)
11. Validate docker compose config (#6)
12. Add input validation improvements (#11)
13. Add SSH timeouts (#12)
14. Make ports/paths configurable (#14)

### Phase 4 (Nice to Have)
15. Add progress indicators (#16)
16. Add file logging (#17)
17. Version validation (#18)
18. IPv6 support (#19)
19. Windows testing (#20)

---

## Testing Strategy

After fixes, test:
1. Fresh install on clean Ubuntu 22.04 nodes
2. Install where Docker already exists
3. Install where Docker needs to be installed
4. Install with user not in docker group
5. Install with ports already in use
6. Install with insufficient disk space
7. Network connectivity failures
8. SSH authentication failures (wrong key, wrong password)
9. Ctrl+C during different phases
10. Re-run installer on already-configured nodes

---

## Next Steps

1. Review this plan and prioritize
2. Create branch for remediation work
3. Fix issues in priority order
4. Add unit tests for critical functions
5. Integration test with real VMs
6. Update documentation
