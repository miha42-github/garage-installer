# Garage Installer - Future Development

**[← Back to Main README](README.md)**

This document tracks planned improvements, bug fixes, and future development for the Garage Installer project.

## Status Legend
- 🎯 **In Progress** - Currently being worked on
- 📋 **Planned** - Scheduled for next release
- 💡 **Proposed** - Under consideration
- ✅ **Completed** - Implemented (for reference)

---

## 🎯 In Progress

### Code Quality & Testing
- [ ] **Comprehensive code review and refactor**
  - Review all modules for consistency
  - Improve error handling patterns
  - Add inline documentation (JSDoc)
  - Optimize performance bottlenecks

- [ ] **Automated test suite**
  - Unit tests for core modules
  - Integration tests for SSH/Docker operations
  - End-to-end tests with test VMs
  - CI/CD pipeline setup

---

## 📋 Planned for Next Release (v0.2)

### Bug Fixes & Improvements

#### High Priority

- [ ] **Fix inter-node connectivity test (#7 from REMEDIATION)**
  - **Issue**: Currently uses `ping` which may be blocked by firewalls
  - **Impact**: False positives/negatives in connectivity checks
  - **Solution**: Test actual RPC port (3901) connectivity
  ```typescript
  // Test with bash TCP or netcat
  timeout 5 bash -c 'cat < /dev/null > /dev/tcp/HOST/3901'
  // Or: nc -zv HOST 3901
  ```
  - **Files**: `src/wizard.ts` (lines ~1253-1305)

- [ ] **Windows compatibility testing (#19 from REMEDIATION)**
  - **Issue**: Windows builds exist but haven't been tested
  - **Tasks**:
    - Test on Windows 10/11
    - Verify SSH client compatibility (OpenSSH)
    - Test path handling
    - Verify terminal ANSI color support
    - Document Windows-specific issues
  - **Files**: Add `scripts/test-windows.ps1`, update `docs/troubleshooting.md`

- [ ] **Implement Docker Hub version validation (#18 from REMEDIATION)**
  - **Issue**: Version validation only shows warnings
  - **Impact**: Could attempt to pull non-existent Garage versions
  - **Solution**: Query Docker Hub API before deployment
  ```typescript
  // Check: https://hub.docker.com/v2/repositories/dxflrs/garage/tags/VERSION
  ```
  - **Files**: `src/wizard.ts` (add validateGarageVersionExists method)

#### Medium Priority

- [ ] **Validate Docker Compose config before deployment (#6 from REMEDIATION)**
  - **Status**: ALREADY FIXED - Compose validation exists
  - **Verify**: Double-check implementation in `src/docker/manager.ts`

- [ ] **Enhance input validation**
  - Add bounds checking for capacity values
  - Validate capacity against available disk space
  - Prevent nonsensical values (0G, 999999T, etc.)
  - **Files**: `src/wizard.ts`

- [ ] **Add comprehensive system prerequisite checks**
  - **Issue**: Current checks are limited to disk space, ports, Docker, and OS
  - **Missing checks**:
    - Minimum memory/RAM (recommend 2GB+)
    - CPU cores (recommend 2+ cores)
    - Internet connectivity test (before pulling images)
    - Firewall rules (port 3901 for RPC between nodes)
    - Network latency between nodes (warn if >100ms)
  - **Implementation**:
    ```typescript
    // Memory check
    free -g | awk '/^Mem:/{print $2}'
    
    // CPU cores
    nproc
    
    // Internet connectivity
    curl -I --connect-timeout 5 https://hub.docker.com
    
    // Network latency
    ping -c 3 node2 | tail -1 | awk -F'/' '{print $5}'
    ```
  - **Files**: `src/checks/system.ts` (add new check methods)
  - **Related**: Update docs to specify what IS checked vs. what ISN'T

### Features

- [ ] **State persistence for all phases**
  - Save state after each major phase
  - Enable granular resume from any checkpoint
  - Track partial deployments better
  - **Files**: `src/state.ts`, `src/wizard.ts`

- [ ] **Uninstall auto-loads state**
  - Read node details from state file
  - Skip prompts if state exists
  - Offer state-based or manual uninstall
  - **Files**: `src/wizard.ts` (runUninstall method)

- [ ] **Add nodes to existing 2-node cluster**
  - Expand cluster from 2 to 3+ nodes
  - Rebalance layout automatically
  - Maintain cluster availability during expansion
  - Requires significant design work

- [ ] **Cluster upgrade wizard**
  - Upgrade Garage version on running cluster
  - Rolling upgrade with zero downtime
  - Backup before upgrade
  - Rollback capability

- [ ] **Backup/restore functionality**
  - Backup cluster metadata
  - Backup data with progress tracking
  - Restore to new cluster
  - Scheduled backup support

---

## 💡 Future Roadmap (v0.3+)

### Major Features

- [ ] **Support for 3+ node clusters**
  - **Priority**: High
  - **Complexity**: High
  - **Details**:
    - Wizard for 3, 5, 7+ nodes
    - Automatic zone assignment
    - Improved replication factor handling
    - Proper quorum calculations
  - **Status**: Requires architectural changes

- [ ] **Web UI option**
  - **Priority**: Medium
  - **Complexity**: High
  - **Details**:
    - Browser-based installer interface
    - Real-time progress updates via WebSocket
    - Cluster management dashboard
    - Log viewing and troubleshooting
  - **Tech**: Consider Deno Fresh or similar framework

- [ ] **Monitoring setup (Prometheus/Grafana)**
  - **Priority**: Medium
  - **Complexity**: Medium
  - **Details**:
    - Auto-deploy Prometheus for metrics collection
    - Grafana with pre-configured Garage dashboards
    - Alert rules for common issues
    - Integration with existing monitoring stacks
  - **Port**: Use 9090 for Prometheus, 3000 for Grafana

- [ ] **TLS/SSL certificate management**
  - **Priority**: Medium
  - **Complexity**: Medium
  - **Details**:
    - Let's Encrypt integration
    - Self-signed certificate generation
    - Certificate rotation
    - mTLS between nodes
  - **Scope**: S3 API and Admin API

- [ ] **Cloud provider integration**
  - **Priority**: Low
  - **Complexity**: High
  - **Details**:
    - AWS: EC2 auto-provisioning, Security Groups
    - GCP: Compute Engine deployment
    - Azure: VM deployment
    - Terraform module generation
    - Cloud-init script generation
  - **Scope**: Each cloud provider is significant work

### Enhancements

- [ ] **Performance optimization**
  - Profile installer for bottlenecks
  - Parallel deployment to nodes
  - Optimize SSH connection reuse
  - Stream large file operations

- [ ] **Security audit and hardening**
  - Third-party security review
  - Implement security best practices
  - Add optional security enhancements
  - Vulnerability scanning

- [ ] **Enhanced error recovery**
  - More granular rollback points
  - Automatic retry with exponential backoff
  - Better error classification
  - Suggested remediation actions

- [ ] **Multi-language support**
  - i18n infrastructure
  - Translations for common languages
  - Locale-aware formatting
  - RTL support

- [ ] **Video walkthrough and tutorials**
  - Installation video
  - Common scenarios
  - Troubleshooting videos
  - Integration examples

- [ ] **Interactive documentation**
  - MkDocs or Docusaurus setup
  - Searchable documentation
  - Code examples with syntax highlighting
  - Versioned docs

### Developer Experience

- [ ] **Plugin/Extension system**
  - Hook points for custom logic
  - Pre/post deployment hooks
  - Custom validation plugins
  - Integration with other tools

- [ ] **Configuration file support**
  - YAML/JSON config files for batch deployments
  - Template system for common setups
  - Config validation
  - Migration between config versions

- [ ] **Telemetry/Analytics (opt-in)**
  - Anonymous usage statistics
  - Error reporting
  - Feature usage tracking
  - Help improve the installer

---

## ✅ Completed (For Reference)

These items were initially flagged as issues but have been **implemented**:

### From REMEDIATION.md (Now Fixed)

1. ✅ **Docker permissions handling** (#1)
   - Dynamic sudo detection implemented
   - `DockerManager.detectSudoRequirement()` automatically handles this
   - **File**: `src/docker/manager.ts`

2. ✅ **Port checking with sudo fallback** (#2)
   - Tries without sudo first, falls back to sudo if available
   - Handles missing sudo gracefully
   - **File**: `src/checks/system.ts`

3. ✅ **SSH timeout handling** (#3)
   - `exec()` method has configurable timeout (default 30s)
   - Async file operations throughout
   - Improved error contexts
   - **File**: `src/ssh/connection.ts`

4. ✅ **Layout version parsing** (#4)
   - Dynamically parses current version from `garage layout show`
   - Increments version automatically
   - **File**: `src/garage/cluster.ts` (line ~368)

5. ✅ **Node ID extraction with case-insensitive regex** (#5)
   - Uses `/([a-f0-9]{64})/i` pattern
   - Handles both uppercase and lowercase
   - **File**: `src/garage/cluster.ts` (line ~243)

6. ✅ **SSH file upload fixed** (#8)
   - Uses `await Deno.readFile()` properly
   - Correct Uint8Array handling
   - **File**: `src/ssh/connection.ts` (line ~150)

7. ✅ **Container name exact matching** (#9)
   - Uses `docker ps --filter "name=^${name}$"`
   - No more partial name matches
   - **File**: `src/docker/manager.ts` (line ~90)

8. ✅ **Rollback/cleanup on failure** (#10)
   - `CleanupManager` tracks all deployments
   - Automatic cleanup offer on failure
   - Manual cleanup support
   - **File**: `src/cleanup.ts`

9. ✅ **State management and resume** (#13)
   - Full state persistence in `.garage-installer-state.json`
   - Resume from last checkpoint
   - Phase tracking
   - **File**: `src/state.ts`

10. ✅ **Bootstrap peers configuration** (#13)
    - Automatically configured after getting node IDs
    - Two-pass config deployment
    - **File**: `src/garage/cluster.ts` (updateBootstrapPeers)

11. ✅ **Configurable ports and paths** (#14)
    - All ports and paths configurable
    - Constants file for defaults
    - **File**: `src/constants.ts`

12. ✅ **Progress indicators** (#16)
    - Spinner UI for all long operations
    - **File**: `src/ui/spinner.ts`

13. ✅ **File logging** (#17)
    - Complete audit trail in `garage-installer.log`
    - Structured logging with timestamps
    - **File**: `src/logger.ts`

14. ✅ **IPv6 support** (#19)
    - Full IPv4/IPv6/dual-stack support
    - Smart hostname resolution
    - **File**: `src/wizard.ts`

### Original Project Goals (Completed)

From `project-plan.md`:

- ✅ Interactive CLI wizard
- ✅ SSH key management and connectivity
- ✅ Pre-flight system checks with auto-fix
- ✅ Docker-based deployment (non-root)
- ✅ Automated cluster configuration
- ✅ Single compiled binary
- ✅ Cross-platform (Linux, macOS, Windows builds)
- ✅ Progress indicators and status displays
- ✅ Rollback capability
- ✅ Comprehensive error handling

---

## Contributing

Want to work on any of these items? Here's how:

1. **Check status** - Make sure the item isn't already in progress
2. **Discuss first** - Open an issue to discuss your approach
3. **Follow conventions** - Match existing code style
4. **Add tests** - Include tests for new functionality
5. **Update docs** - Keep documentation in sync
6. **Small PRs** - Break large changes into reviewable chunks

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines *(coming soon)*.

---

## Prioritization Criteria

Features are prioritized based on:

1. **User Impact** - How many users benefit?
2. **Stability** - Does it fix bugs or improve reliability?
3. **Complexity** - Effort required vs value delivered
4. **Dependencies** - What must be done first?
5. **Community Demand** - What are users asking for?

---

## Version Planning

### v0.1 (Current)
- Initial release
- Two-node cluster deployment
- Basic management capabilities
- State persistence and resume

### v0.2 (Next - Q1 2026)
- Windows testing complete
- Bug fixes (#7, #18, #19)
- Enhanced state persistence
- Uninstall improvements

### v0.3 (Q2 2026)
- 3+ node cluster support
- Cluster expansion capability
- Backup/restore
- Monitoring setup

### v1.0 (Q3 2026)
- Production-ready
- Comprehensive testing
- Security audit
- Full documentation

---

**Last Updated**: November 16, 2025

**[← Back to Main README](README.md)** | **[Documentation](docs/README.md)**
