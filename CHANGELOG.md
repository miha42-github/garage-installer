# Changelog

All notable changes to the Garage Installer project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- 3+ node cluster support
- Automated test suite
- Web UI for cluster management
- Monitoring integration (Prometheus/Grafana)
- TLS/SSL certificate management
- Cloud provider integration (AWS, GCP, Azure)

See [FUTURES.md](FUTURES.md) for complete roadmap.

---

## [0.1.0] - 2025-11-16

### Added - Core Features

**Installation & Deployment**
- Interactive CLI wizard for two-node Garage cluster installation
- Automated SSH connectivity testing with timeout handling
- Comprehensive preflight system checks (OS, Docker, permissions, disk space, ports)
- Docker-based Garage deployment using docker-compose
- Support for both SSH key and password authentication
- Automatic Docker Hub image pulling
- Bootstrap peer auto-configuration
- Dynamic layout version parsing and application
- IPv6 and dual-stack networking support

**State Management & Resilience**
- State persistence system with `.garage-installer-state.json`
- Checkpoint/resume capability for interrupted installations
- Seven-phase installation tracking
- Automatic recovery from failures
- State-based uninstall (auto-loads node configuration)
- Secure state file (passwords never stored)

**Cleanup & Rollback**
- Automatic cleanup on installation failure
- CleanupManager tracking all deployed resources
- Manual uninstall wizard
- Per-node cleanup capability
- Container, file, and directory cleanup

**Logging & Debugging**
- Comprehensive logging to `garage-installer.log`
- Timestamped log entries
- Error context and stack traces
- SSH command logging
- Audit trail for troubleshooting

**User Interface**
- Color-coded output with ANSI colors
- Progress spinners for long operations
- Table-formatted check results
- Clear success and error messages
- Interactive prompts with validation
- Deployment progress tracking

**Cross-Platform Support**
- Linux (x86_64, ARM64) binary builds
- macOS (x86_64, ARM64 / Apple Silicon) binary builds
- Windows (x86_64) binary builds
- Single compiled binary with no dependencies

**Configuration & Customization**
- Configurable Garage version selection
- Custom port configuration
- Custom capacity per node
- Custom data and metadata directories
- Replication factor configuration
- Version validation against known-good versions

**Post-Installation**
- Automatic cluster health verification
- Admin key creation
- AWS CLI validation test
- S3 API endpoint validation
- Credentials display
- Integration instructions

### Added - Documentation

**Main Documentation**
- Comprehensive README with quick start guide
- Installation prerequisites and system requirements
- Architecture overview and design decisions
- Security considerations
- Limitations and use case guidance
- Development instructions
- Build instructions for all platforms

**Detailed Guides**
- AWS CLI configuration guide
- Node.js + Express integration patterns
- State persistence and resume capability documentation
- Troubleshooting guide (600+ lines)
  - SSH connection issues
  - Docker problems
  - Port conflicts
  - Network connectivity
  - Container failures
  - Cluster configuration issues
  - Recovery procedures
- Architecture deep dive (800+ lines)
  - Module architecture
  - Core systems
  - Deployment flow
  - Configuration management
  - Security architecture
  - File structure
  - Extension points
- Cluster management guide (650+ lines)
  - Day-2 operations
  - Monitoring and metrics
  - Backup and restore
  - Container management
  - Configuration updates
  - Maintenance schedule
- Documentation index (docs/README.md)

**Project Documentation**
- CONTRIBUTING.md with development guidelines
- FUTURES.md with roadmap and planned features
- CHANGELOG.md (this file)
- DOC_UPDATES.md with documentation improvement plan

### Technical Implementation

**Core Modules**
- `src/wizard.ts` - Main orchestration (2200+ lines)
- `src/state.ts` - State persistence system
- `src/cleanup.ts` - Cleanup and rollback manager
- `src/logger.ts` - Logging infrastructure
- `src/constants.ts` - Configuration constants

**Specialized Modules**
- `src/ssh/connection.ts` - SSH communication layer with timeout handling
- `src/checks/system.ts` - Preflight validation checks
- `src/docker/manager.ts` - Docker operations wrapper with sudo detection
- `src/garage/cluster.ts` - Garage-specific operations
- `src/ui/display.ts` - Output formatting
- `src/ui/spinner.ts` - Progress indicators

**Build System**
- `scripts/build.sh` - Cross-platform build script
- `deno.json` - Deno configuration with tasks
- Support for 5 target platforms

### Fixed

**SSH & Connectivity**
- SSH cipher compatibility issues (setAutoPadding errors)
- Connection timeout handling
- Proper error contexts for SSH failures
- Host key verification handling

**Docker Integration**
- Dynamic sudo detection for docker commands
- Docker permission handling (docker group check)
- Docker Compose v1 and v2 support
- Container name matching (exact match to avoid false positives)
- Docker Hub rate limiting guidance

**Garage Configuration**
- Bootstrap peer chicken-and-egg problem (two-phase deployment)
- Layout version conflicts (dynamic version parsing)
- RPC connectivity validation
- Node ID retrieval timing
- Cluster health verification

**State Management**
- State file corruption prevention (atomic writes)
- Password security (never stored on disk)
- Phase status tracking accuracy
- Resume from any checkpoint
- State cleanup on success

**User Experience**
- Clear error messages with actionable guidance
- Manual intervention prompts with step-by-step instructions
- Progress visibility during long operations
- Validation feedback
- Credential display format

### Security

**Implemented Security Measures**
- Cryptographically secure RPC secret generation (32-byte random hex)
- Cryptographically secure admin token generation
- SSH key preference over passwords
- Passwords never written to disk
- Passwords never logged
- Non-root container execution (user UID:GID)
- Read-only config file mounts
- Minimal permission requests
- State file security guidance
- Network security warnings for public IPs

**Documentation**
- Security considerations in README
- State file protection guidelines
- Credential handling best practices
- Firewall configuration guidance

### Performance

**Optimizations**
- Parallel preflight checks (both nodes simultaneously)
- Parallel deployment (both nodes simultaneously)
- Reused SSH connections throughout installation
- Efficient command execution with timeouts
- Minimal disk I/O (state file only)

**Resource Usage**
- ~50MB memory footprint for installer
- Single binary distribution
- No runtime dependencies
- Fast startup time

### Known Issues

**Limitations**
- Two-node clusters only (not production HA)
- Limited to Ubuntu/Debian (warnings on other OS)
- Docker and Docker Compose must be pre-installed
- Cannot auto-install Docker (requires interactive sudo)
- Windows builds not tested (see FUTURES.md #19)

**Compatibility**
- Tested on Ubuntu 20.04, 22.04, Debian 11
- Windows compatibility untested
- Requires Deno 1.40+ for development

**Planned Fixes** (see FUTURES.md)
- Inter-node connectivity test uses ping (#7) - should test TCP port 3901
- Docker Hub version validation missing (#18)
- Windows compatibility testing needed (#19)
- Comprehensive system checks needed (memory, CPU, network latency)

### Dependencies

**Runtime**
- None (compiled to single binary)

**Development**
- Deno 1.40+
- @cliffy/prompt ^1.0.0
- @std/fmt colors
- @std/path
- @std/fs
- denoland/deno_ssh2 (SSH operations)

**Target Systems**
- Docker 20.10+
- Docker Compose v2.0+ (or v1 legacy)
- SSH server
- Linux kernel with cgroups support

---

## Version History

### [0.1.0] - 2025-11-16
- Initial release
- Two-node cluster installer
- Complete documentation
- Cross-platform builds

---

## Upgrade Guide

### From Pre-Release to 0.1.0

No upgrade path - this is the initial release.

### Future Upgrades

Upgrade instructions will be provided in future releases.

---

## Contributors

### Core Development
- @miha42-github - Initial development and architecture

### Documentation
- @miha42-github - Complete documentation suite

### Testing & Feedback
- Community testers (thank you!)

---

## Notes

### Versioning Strategy

- **v0.x.x** - Pre-production releases (current)
- **v1.0.0** - Production-ready release (planned Q3 2026)

### Release Schedule

- **v0.1** - Initial release (November 2025)
- **v0.2** - Bug fixes and enhancements (Q1 2026)
- **v0.3** - Major features (3+ nodes, monitoring) (Q2 2026)
- **v1.0** - Production release (Q3 2026)

See [FUTURES.md](FUTURES.md) for detailed roadmap.

---

## Links

- [GitHub Repository](https://github.com/miha42-github/garage-installer)
- [Issue Tracker](https://github.com/miha42-github/garage-installer/issues)
- [Garage Project](https://garagehq.deuxfleurs.fr/)
- [Documentation](docs/README.md)

---

**Legend**:
- `Added` - New features
- `Changed` - Changes in existing functionality
- `Deprecated` - Soon-to-be removed features
- `Removed` - Removed features
- `Fixed` - Bug fixes
- `Security` - Security improvements
