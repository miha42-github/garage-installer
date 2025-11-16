# Documentation Updates Plan

## Executive Summary

After comprehensive analysis of the codebase, existing documentation, and planning documents, I've identified significant divergences between implementation and documentation. The actual codebase has evolved considerably beyond what's documented in `project-plan.md` and `REMEDIATION.md`, with many issues already fixed and features already implemented that aren't reflected in the docs.

**Updated Strategy:**
1. Create `FUTURES.md` for roadmap and improvement items (replaces enhancement sections)
2. Add bidirectional navigation between all docs/ files and README.md
3. Merge relevant `project-plan.md` content into README.md and docs/architecture.md, then delete it
4. Move remaining `REMEDIATION.md` issues to `FUTURES.md`, then delete REMEDIATION.md
5. Focus on production-ready documentation structure before comprehensive code review

## Key Findings

### What's Been Implemented (But Not Documented)

1. ✅ **State Management** - Full persistence with resume capability (`src/state.ts`)
2. ✅ **Cleanup Manager** - Rollback/cleanup on failure (`src/cleanup.ts`)
3. ✅ **File Logging** - Complete audit trail (`src/logger.ts`)
4. ✅ **Constants Module** - Configurable ports/paths (`src/constants.ts`)
5. ✅ **Progress Indicators** - Spinner UI for all operations (`src/ui/spinner.ts`)
6. ✅ **SSH Timeouts** - Configurable with proper error handling
7. ✅ **Bootstrap Peers** - Automatically configured after getting node IDs
8. ✅ **Dynamic Sudo Detection** - Docker permissions handled automatically
9. ✅ **Port Checking** - Works with/without sudo fallback
10. ✅ **Docker Compose** - Validation and auto-install
11. ✅ **Layout Version** - Dynamically parsed, not hardcoded
12. ✅ **Node ID Extraction** - Case-insensitive regex fixed
13. ✅ **SSH File Upload** - Fixed to use async Uint8Array properly
14. ✅ **Container Exact Match** - Fixed grep to use docker filters
15. ✅ **Input Validation** - Comprehensive bounds checking
16. ✅ **IPv6 Support** - Full support for IPv4/IPv6/dual-stack
17. ✅ **Hostname Resolution** - Smart validation with fallbacks
18. ✅ **AWS CLI Integration** - Path-style addressing with temp config
19. ✅ **Post-Install Validation** - Full S3 test suite

### What Still Needs Work

1. ⚠️ **Inter-node Connectivity** - Still uses `ping` instead of testing actual RPC port
2. ⚠️ **Windows Testing** - Build targets exist but not tested
3. ⚠️ **Version Validation** - Docker Hub check not implemented (warnings only)

### Documentation Issues

1. **README.md** - Contains heavy content that should reference docs/
2. **REMEDIATION.md** - 90% of issues already fixed, document is outdated
3. **project-plan.md** - Doesn't reflect current architecture
4. **docs/** - Missing from README, no index/navigation

## Phased Implementation Plan

---

## Phase 1: Critical - Establish Documentation Structure (Priority: Immediate)

**Goal:** Make docs/ accessible, remove README redundancy, establish bidirectional navigation

### Tasks:

#### 1.1 Update README.md Structure
- **Add** "Documentation" section near top with organized links to all docs/ files
- **Merge** relevant high-level content from project-plan.md:
  * Architecture decisions (Why Deno? Why Docker?)
  * Deployment model diagram
  * Security considerations
- **Remove** detailed AWS CLI setup (keep 2-3 line example, link to docs/aws-cli-configuration.md)
- **Remove** detailed Node.js/Express guide content (link to docs/nodejs-express-integration.md)
- **Keep** Quick Start, Prerequisites, Architecture diagram (high-level only)
- **Add** link to docs/state-persistence.md for resume/rollback features
- **Add** link to FUTURES.md for roadmap and planned features
- **Simplify** Post-Installation section (basics only, link to AWS CLI doc for details)
- **Simplify** Troubleshooting (common issues only, create docs/troubleshooting.md for comprehensive guide)

#### 1.2 Create docs/README.md (Documentation Index)
```markdown
# Garage Installer Documentation

**[← Back to Main README](../README.md)**

## Getting Started
- [Quick Start Guide](../README.md#quick-start)
- [Installation Prerequisites](../README.md#prerequisites)
- [What Gets Installed](../README.md#what-gets-installed)

## Configuration Guides
- [AWS CLI Configuration](aws-cli-configuration.md) - Complete AWS CLI setup with Garage
- [Node.js + Express Integration](nodejs-express-integration.md) - Backend integration patterns
- [State Persistence & Resume](state-persistence.md) - Understanding checkpoint/resume functionality

## Advanced Topics
- [Troubleshooting Guide](troubleshooting.md) - Comprehensive problem resolution
- [Architecture Deep Dive](architecture.md) - Technical implementation details
- [Cluster Management](cluster-management.md) - Day-2 operations

## Project Information
- [Future Roadmap](../FUTURES.md) - Planned features and improvements
- [Contributing Guide](../CONTRIBUTING.md) - How to contribute
- [Changelog](../CHANGELOG.md) - Version history
- [Build & Development](../README.md#development) - Building from source

---
*This documentation is for Garage Installer v0.1+*
```

#### 1.3 Create docs/troubleshooting.md
Extract detailed troubleshooting from README.md and expand with:
- SSH connection failures (detailed cipher issues, key permissions)
- Docker permission problems (newgrp, re-login, sudo scenarios)
- Port conflicts (detailed resolution steps)
- Network connectivity (ping vs port testing, firewall rules)
- Container startup failures (logs interpretation)
- Layout application failures (version conflicts)
- AWS CLI issues (path-style, signature errors, region problems)
- Recovery from failed installations (using state files)

**Include navigation header:**
```markdown
# Troubleshooting Guide

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**

...content...
```

#### 1.4 Add Navigation Headers to Existing docs/
Update existing documentation files to include navigation:

**docs/aws-cli-configuration.md:**
```markdown
# AWS CLI Configuration

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**
```

**docs/nodejs-express-integration.md:**
```markdown
# Node.js + Express Integration with Garage

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**
```

**docs/state-persistence.md:**
```markdown
# State Persistence & Resume Capability

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**
```

**Files Modified:**
- README.md (major simplification, merge from project-plan.md)
- docs/README.md (new)
- docs/troubleshooting.md (new)
- docs/aws-cli-configuration.md (add navigation)
- docs/nodejs-express-integration.md (add navigation)
- docs/state-persistence.md (add navigation)

**Estimate:** 3-4 hours

---

## Phase 2: Consolidate Planning Documents (Priority: High)

**Goal:** Merge relevant content into proper locations, create FUTURES.md, remove obsolete files

### Tasks:

#### 2.1 Create FUTURES.md (Roadmap & Planned Improvements)
Consolidate all future enhancements from multiple sources:

**From REMEDIATION.md (3 outstanding issues):**
- Fix inter-node connectivity test (use port 3901 instead of ping)
- Complete Windows compatibility testing and documentation
- Implement Docker Hub version validation

**From project-plan.md (Future Enhancements):**
- Support for 3+ node clusters
- Add nodes to existing 2-node cluster
- Cluster upgrade wizard
- Backup/restore functionality
- Web UI option
- Monitoring setup (Prometheus/Grafana)
- TLS/SSL certificate management
- Cloud provider integration (AWS, GCP, etc.)

**Additional Code Review Items:**
- Comprehensive error handling review
- Performance optimization
- Security audit
- Automated testing suite
- CI/CD pipeline

**Structure:**
```markdown
# Garage Installer - Future Development

**[← Back to Main README](README.md)**

## Overview
This document tracks planned improvements and future development for the Garage Installer project.

## In Progress

### Code Quality & Testing
- [ ] Comprehensive code review and refactor
- [ ] Automated test suite (unit + integration)
- [ ] CI/CD pipeline setup

## Planned for Next Release

### Bug Fixes & Improvements
- [ ] Fix inter-node connectivity test to use port 3901 instead of ping
- [ ] Complete Windows compatibility testing
- [ ] Implement Docker Hub version validation before deployment

### Features
- [ ] Add nodes to existing 2-node cluster
- [ ] Cluster upgrade wizard
- [ ] Backup/restore functionality

## Future Roadmap

### Major Features
- [ ] Support for 3+ node clusters
- [ ] Web UI option
- [ ] Monitoring setup (Prometheus/Grafana)
- [ ] TLS/SSL certificate management
- [ ] Cloud provider integration (AWS, GCP, Azure)

### Enhancements
- [ ] Performance optimization
- [ ] Security audit and hardening
- [ ] Enhanced error recovery
- [ ] Multi-language support
- [ ] Video walkthrough and tutorials

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute to these initiatives.
```

#### 2.2 Merge project-plan.md Content and Delete File

**Extract to README.md:**
- Architecture Decisions section (Why Deno? Why Docker?)
- Deployment Model diagram
- Security Considerations summary

**Extract to docs/architecture.md:**
- Detailed technical components
- File structure explanation
- Module responsibilities
- Implementation details

**After extraction, DELETE project-plan.md** - Content is now in appropriate locations

#### 2.3 Delete REMEDIATION.md

**After moving issues to FUTURES.md, DELETE REMEDIATION.md**
- No need for archive - git history preserves it
- Issues are now tracked in FUTURES.md
- Cleaner repository structure

**Files Modified:**
- FUTURES.md (new)
- README.md (merge content from project-plan.md)
- docs/architecture.md (will be created in Phase 3, merge content from project-plan.md)

**Files Deleted:**
- project-plan.md (content merged)
- REMEDIATION.md (issues moved to FUTURES.md)

**Estimate:** 2-3 hours

---

## Phase 3: Create Missing Documentation (Priority: High)

**Goal:** Document features that exist but aren't documented

### Tasks:

#### 3.1 Create docs/architecture.md
Deep technical dive covering:

**Add navigation header:**
```markdown
# Architecture Deep Dive

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**
```

**Merge from project-plan.md:**
- Technical Components section
- Detailed file structure
- Module responsibilities
- Implementation approach

**Add new content:**
- **Module Architecture** - Detailed description of each src/ module
- **State Management** - How StateManager tracks progress and enables resume
- **Cleanup System** - How CleanupManager tracks deployments for rollback
- **Logging System** - Logger implementation and log file format
- **SSH Connection Management** - Timeout handling, error contexts, retry logic
- **Docker Integration** - Sudo detection, command execution, container lifecycle
- **Garage Configuration** - Config generation, bootstrap peers, layout management
- **UI System** - Display manager, spinner integration, progress tracking
- **Data Flow Diagrams** - Request flow through the system
- **Error Handling Strategy** - How errors propagate and get handled

#### 3.2 Create docs/cluster-management.md
Day-2 operations covering:

**Add navigation header:**
```markdown
# Cluster Management

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**
```

**Content:**
- **Checking Cluster Status** - `docker exec garage /garage status`
- **Adding/Removing Nodes** - (future feature, document limitation, link to FUTURES.md)
- **Capacity Management** - Adjusting node capacities
- **Layout Updates** - Modifying cluster topology
- **Backup Strategies** - Data and metadata backup approaches
- **Upgrade Procedures** - Updating Garage version
- **Monitoring** - Admin API, Prometheus metrics (port 3903)
- **Common Maintenance Tasks** - Restart, logs, debugging
- **Using State Files** - Leveraging saved state for uninstall/management
- **Disaster Recovery** - Handling node failures, data recovery

#### 3.3 Update docs/state-persistence.md (expand existing)
The current file exists but needs expansion:

**Add navigation header:**
```markdown
# State Persistence & Resume Capability

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**
```

**Expand content:**
- **How It Works** - Phase tracking, node state, persistence mechanism
- **Resume Capability** - What gets saved, when it's saved, what you can resume from
- **State File Location** - `.garage-installer-state.json` in current directory
- **Manual State Inspection** - JSON structure explanation
- **Recovery Scenarios** - Using state after failures
- **Uninstall Integration** - How state enables unattended uninstall
- **Security Considerations** - State contains node details but not passwords
- **State File Format** - Complete JSON schema with examples
- **Troubleshooting State Issues** - Corrupt state, manual edits

**Files Created:**
- docs/architecture.md (new, merged from project-plan.md)
- docs/cluster-management.md (new)

**Files Modified:**
- docs/state-persistence.md (expand existing)

**Estimate:** 4-5 hours

---

## Phase 4: Fix Outstanding Code Issues (Priority: Medium)

**Goal:** Fix the 3 remaining issues from analysis

### Tasks:

#### 4.1 Fix Inter-Node Connectivity Test
**File:** `src/wizard.ts` (~line 1253-1305)

**Current Problem:**
```typescript
// Uses ping which may be blocked by firewall
await this.node1!.connection!.exec(`ping -c 1 -W 5 ${this.node2!.host} 2>&1`);
```

**Solution:**
```typescript
// Test actual RPC port connectivity
private async testInterNodeConnectivity(): Promise<boolean> {
  console.log("\nTesting inter-node connectivity...");
  
  // Test node1 -> node2:3901 (RPC port)
  const result1to2 = await this.node1!.connection!.exec(
    `timeout 5 bash -c 'cat < /dev/null > /dev/tcp/${this.node2!.host}/${this.clusterConfig!.ports.rpc}' 2>&1 || echo "FAILED"`
  );
  
  if (result1to2.stdout.includes("FAILED") || result1to2.code !== 0) {
    console.log(red(`  ✖ Node1 cannot reach Node2 on port ${this.clusterConfig!.ports.rpc}`));
    return false;
  }
  
  // Test node2 -> node1:3901
  const result2to1 = await this.node2!.connection!.exec(
    `timeout 5 bash -c 'cat < /dev/null > /dev/tcp/${this.node1!.host}/${this.clusterConfig!.ports.rpc}' 2>&1 || echo "FAILED"`
  );
  
  if (result2to1.stdout.includes("FAILED") || result2to1.code !== 0) {
    console.log(red(`  ✖ Node2 cannot reach Node1 on port ${this.clusterConfig!.ports.rpc}`));
    return false;
  }
  
  console.log(green("  ✓ Both nodes can reach each other on RPC port"));
  return true;
}
```

**Alternative using nc if available:**
```typescript
// Fallback to nc if bash TCP test doesn't work
const ncTest = await this.node1!.connection!.exec(`which nc`);
if (ncTest.code === 0) {
  // Use netcat for connection test
  const result = await this.node1!.connection!.exec(
    `timeout 5 nc -zv ${this.node2!.host} ${this.clusterConfig!.ports.rpc} 2>&1`
  );
  // Parse nc output...
}
```

#### 4.2 Add Windows Testing Documentation
**File:** README.md, docs/troubleshooting.md

Add Windows-specific testing results after manual testing on Windows 10/11:
- SSH client compatibility (OpenSSH included since Windows 10 1809+)
- Path handling in Deno (should be automatic)
- Terminal ANSI color support (Windows Terminal recommended)
- Known issues and workarounds

**File:** scripts/test-windows.ps1 (new)
```powershell
# PowerShell script to test Windows build
Write-Host "Testing Garage Installer on Windows..." -ForegroundColor Cyan

# Check prerequisites
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: SSH client not found" -ForegroundColor Red
    exit 1
}

Write-Host "SSH client: OK" -ForegroundColor Green

# Test the binary
.\dist\garage-installer-windows-x64.exe --version

# More tests...
```

#### 4.3 Implement Docker Hub Version Check
**File:** src/wizard.ts (in configureCluster method)

Add early validation:
```typescript
private async validateGarageVersionExists(version: string): Promise<boolean> {
  console.log(dim(`  Checking if Garage ${version} exists on Docker Hub...`));
  
  try {
    // Query Docker Hub API
    const response = await fetch(
      `https://hub.docker.com/v2/repositories/dxflrs/garage/tags/${version.replace('v', '')}`
    );
    
    if (response.ok) {
      console.log(green(`  ✓ Version ${version} found on Docker Hub`));
      return true;
    } else if (response.status === 404) {
      console.log(red(`  ✖ Version ${version} not found on Docker Hub`));
      console.log(yellow(`    Available versions: ${KNOWN_GOOD_VERSIONS.join(', ')}`));
      return false;
    }
  } catch (error) {
    console.log(yellow(`  ⚠ Could not verify version (network issue), proceeding anyway...`));
  }
  
  return true; // Assume valid if we can't check
}
```

**Files Modified:**
- src/wizard.ts (connectivity test fix, version validation)
- README.md (Windows notes)
- docs/troubleshooting.md (Windows section)
- scripts/test-windows.ps1 (new)

**Estimate:** 3-4 hours

---

## Phase 5: Documentation Polish (Priority: Low)

**Goal:** Final touches and consistency

### Tasks:

#### 5.1 Add CONTRIBUTING.md
Standard contribution guide:
- How to set up development environment
- Code style guidelines (TypeScript, Deno)
- Testing requirements
- PR process
- Documentation requirements

#### 5.2 Add CHANGELOG.md
Track version history:
- v0.1.0 - Initial release
- Future versions

#### 5.3 Update All Code Comments
- Add JSDoc comments to public methods
- Document complex logic sections
- Add type annotations where missing
- Document why, not just what

#### 5.4 Create Quick Reference Card
**File:** docs/quick-reference.md

One-page cheat sheet:
- Common commands
- File locations
- Port numbers
- Troubleshooting steps
- Support resources

**Files Created:**
- CONTRIBUTING.md (new)
- CHANGELOG.md (new)
- docs/quick-reference.md (new)

**Files Modified:**
- All src/**/*.ts files (comment improvements)

**Estimate:** 3-4 hours

---

## Phase 6: Create Example Configurations (Priority: Low)

**Goal:** Provide real-world usage examples

### Tasks:

#### 6.1 Create examples/ Directory
```
examples/
├── README.md
├── aws-cli/
│   ├── basic-usage.sh
│   ├── sync-directory.sh
│   └── lifecycle-policy.sh
├── nodejs/
│   ├── simple-upload.js
│   ├── express-middleware.js
│   └── presigned-urls.js
├── python/
│   ├── boto3-example.py
│   └── django-storage.py
└── terraform/
    ├── garage-buckets.tf
    └── garage-keys.tf
```

Each example should be:
- Self-contained and runnable
- Well-commented
- Include error handling
- Show best practices

**Files Created:**
- examples/** (entire directory structure)

**Estimate:** 4-5 hours

---

## Summary by Priority

### Immediate (Do First) - ~6 hours
- Phase 1: Establish documentation structure with bidirectional navigation
- Phase 2: Create FUTURES.md, merge and delete planning documents

### High (Do Soon) - ~5 hours  
- Phase 3: Create missing documentation (architecture, cluster management)

### Medium (Important) - ~4 hours
- Phase 4: Fix outstanding code issues (moved to FUTURES.md, deferred to code review)

### Low (Nice to Have) - ~8 hours
- Phase 5: Documentation polish
- Phase 6: Example configurations

**Total Estimated Time (Pre-Code-Review):** ~19 hours
**Deferred to Code Review Phase:** ~4 hours (Phase 4 code fixes)
**Grand Total:** ~23 hours

---

## Implementation Order

**Documentation Phase (Before Code Review):**
1. **Phase 1** - Establish documentation structure with navigation (~4 hours)
2. **Phase 2** - Create FUTURES.md, merge/delete planning docs (~3 hours)
3. **Phase 3** - Create missing documentation (~5 hours)
4. **Phase 5** - Documentation polish (~3 hours)
5. **Phase 6** - Example configurations (~4 hours)

**Code Review Phase (Separate Initiative):**
6. **Phase 4** - Fix outstanding code issues as part of comprehensive review (~4 hours)
7. **Additional** - Full codebase review, refactor, testing per FUTURES.md

**Total Documentation Work:** ~19 hours
**Code Review Preparation:** FUTURES.md created with all items tracked

---

## Validation Criteria

After documentation phases complete:

✅ **User Experience:**
- [ ] New users can find all documentation easily from README
- [ ] Bidirectional navigation works in all docs/ files
- [ ] AWS CLI setup is clear and works first try
- [ ] Troubleshooting guide covers all common issues
- [ ] Examples are runnable and helpful

✅ **Developer Experience:**
- [ ] Architecture is clearly documented
- [ ] Code comments explain complex logic
- [ ] Contributing guide makes it easy to submit PRs
- [ ] Build process is documented
- [ ] FUTURES.md clearly tracks all planned work

✅ **Accuracy:**
- [ ] No documentation contradicts the code
- [ ] All features are documented
- [ ] All known issues are tracked in FUTURES.md
- [ ] All examples work as written

✅ **Maintenance:**
- [ ] CHANGELOG tracks versions
- [ ] FUTURES.md lists all outstanding work
- [ ] No obsolete planning documents (project-plan.md, REMEDIATION.md deleted)
- [ ] Documentation is easy to update
- [ ] Navigation is consistent across all docs

✅ **Repository Cleanliness:**
- [ ] Only current, relevant documentation exists
- [ ] No duplicate information across files
- [ ] Clear separation: README = overview, docs/ = deep dives
- [ ] Git history preserves deleted planning docs if needed

---

## Notes

### What NOT to Do

❌ Don't keep obsolete planning documents (DELETE project-plan.md and REMEDIATION.md after migration)
❌ Don't over-document implementation details in README (keep high-level)
❌ Don't make docs/aws-cli-configuration.md redundant with README
❌ Don't create docs that duplicate each other
❌ Don't forget navigation headers in docs/ files

### What to Maintain

✅ Keep README concise and welcoming
✅ Keep docs/ deep and comprehensive
✅ Keep examples practical and runnable
✅ Keep troubleshooting actionable

### Future Considerations (Track in FUTURES.md)

- Add video walkthrough links when available
- Create diagrams for architecture.md (mermaid.js)
- Add FAQ section in troubleshooting.md
- Consider versioning documentation (docs/v0.1/, docs/v0.2/)
- Add telemetry/analytics opt-in for usage insights
- Interactive web-based documentation (e.g., MkDocs, Docusaurus)

---

## Appendix: Current File Status

### README.md - Needs Major Revision
- Currently: ~380 lines, very detailed
- Target: ~250 lines, high-level with links to docs/
- Remove: Detailed AWS CLI setup, detailed troubleshooting, Windows specifics
- Keep: Quick Start, prerequisites, architecture diagram, basic examples
- Add: Links to all docs/ files in organized "Documentation" section
- Merge: Architecture decisions from project-plan.md (Why Deno? Why Docker?)

### docs/aws-cli-configuration.md - ✅ Good
- Comprehensive and well-structured
- Add: Navigation header linking back to docs/README.md and main README.md

### docs/nodejs-express-integration.md - ✅ Good
- Comprehensive integration guide
- Add: Navigation header linking back to docs/README.md and main README.md

### docs/state-persistence.md - Needs Expansion
- Currently: Basic overview
- Add: Navigation header
- Expand: Detailed explanation of resume capability, state file format, recovery scenarios

### project-plan.md - TO BE DELETED
- Merge: Architecture decisions → README.md
- Merge: Technical components → docs/architecture.md
- Merge: Future enhancements → FUTURES.md
- Delete: After content extracted

### REMEDIATION.md - TO BE DELETED
- Move: 3 outstanding issues → FUTURES.md
- Delete: File after migration (git history preserves it)
- No archive needed: Git history serves that purpose

---

## Next Steps

**Recommended approach:**

1. ✅ Plan reviewed and updated per stakeholder feedback
2. Implement documentation phases (1-3, 5-6) before code review
3. Create FUTURES.md to track all improvement work
4. Delete obsolete planning documents after content migration
5. Code review and fixes (Phase 4) as separate initiative per FUTURES.md

**Decisions Made:**

1. ✅ Delete REMEDIATION.md after migrating issues to FUTURES.md (no archive, git history sufficient)
2. ✅ Delete project-plan.md after merging content into README.md and docs/architecture.md
3. ✅ Add bidirectional navigation to all docs/ files
4. ⏳ Versioned documentation (docs/v0.1/) - track in FUTURES.md for future consideration
5. ⏳ Examples/ location - track in FUTURES.md, likely keep in same repo
6. ⏳ GLOSSARY.md - track in FUTURES.md if needed
7. ⏳ Telemetry/analytics - track in FUTURES.md for future consideration

**Key Changes from Original Plan:**

- **FUTURES.md replaces enhancement sections** - Single source of truth for roadmap
- **Delete planning docs after migration** - Cleaner repository, git history preserves them
- **Defer code fixes to review phase** - Focus on documentation completeness first
- **Add bidirectional navigation** - Improved user experience navigating docs
- **Merge project-plan.md content** - Eliminate duplication, consolidate information

