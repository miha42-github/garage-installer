# Contributing to Garage Installer

Thank you for your interest in contributing to the Garage Installer project! This document provides guidelines and information for contributors.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Reporting Issues](#reporting-issues)

---

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for all contributors, regardless of experience level, gender, gender identity and expression, sexual orientation, disability, personal appearance, body size, race, ethnicity, age, religion, or nationality.

### Expected Behavior

- Use welcoming and inclusive language
- Be respectful of differing viewpoints and experiences
- Gracefully accept constructive criticism
- Focus on what is best for the community
- Show empathy towards other community members

### Unacceptable Behavior

- Trolling, insulting/derogatory comments, and personal or political attacks
- Public or private harassment
- Publishing others' private information without explicit permission
- Other conduct which could reasonably be considered inappropriate

---

## Getting Started

### Prerequisites

Before you begin, ensure you have:

- **Deno 1.40+** installed ([installation guide](https://deno.land/manual/getting_started/installation))
- **Git** for version control
- Basic understanding of TypeScript
- Familiarity with SSH and Docker concepts
- Access to test VMs or servers (for integration testing)

### First Contribution

Looking for a good first issue? Check our issue tracker for:
- Issues labeled `good-first-issue`
- Issues labeled `help-wanted`
- Documentation improvements
- Test coverage improvements

---

## Development Setup

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/garage-installer.git
cd garage-installer

# Add upstream remote
git remote add upstream https://github.com/miha42-github/garage-installer.git
```

### 2. Install Dependencies

Deno automatically manages dependencies, but verify installation:

```bash
# Check Deno version
deno --version

# Verify project loads
deno check mod.ts
```

### 3. Run from Source

```bash
# Run the installer in development mode
deno task dev

# Or run directly
deno run --allow-all mod.ts
```

### 4. Available Tasks

```bash
# Development mode (with permissions)
deno task dev

# Format code
deno task fmt

# Lint code
deno task lint

# Check types
deno task check

# Build all binaries
deno task build-all

# Build specific platform
deno task compile-linux
deno task compile-macos
deno task compile-windows
```

### 5. Set Up Test Environment

For integration testing, you'll need:

**Option A: Local VMs**
- 2 Ubuntu/Debian VMs
- SSH access configured
- Docker installed on both

**Option B: Cloud Instances**
- 2 small cloud instances (AWS, DigitalOcean, etc.)
- Public IPs or VPN connection
- SSH keys configured

**Test Configuration**:
```bash
# Create test inventory (don't commit credentials!)
cat > test-nodes.txt <<EOF
node1: user@192.168.1.100
node2: user@192.168.1.101
SSH Key: ~/.ssh/test_key
EOF
```

---

## Project Structure

```
garage-installer/
├── mod.ts                    # Entry point
├── deno.json                 # Deno configuration & tasks
├── README.md                 # Main documentation
├── CONTRIBUTING.md           # This file
├── CHANGELOG.md             # Version history
├── FUTURES.md               # Roadmap
├── DOC_UPDATES.md          # Documentation plan
│
├── src/
│   ├── wizard.ts            # Main orchestration (2200+ lines)
│   ├── constants.ts         # Configuration constants
│   ├── state.ts             # State persistence
│   ├── cleanup.ts           # Cleanup manager
│   ├── logger.ts            # Logging system
│   │
│   ├── ssh/
│   │   └── connection.ts    # SSH operations
│   │
│   ├── checks/
│   │   └── system.ts        # Preflight checks
│   │
│   ├── docker/
│   │   └── manager.ts       # Docker wrapper
│   │
│   ├── garage/
│   │   └── cluster.ts       # Garage operations
│   │
│   └── ui/
│       ├── display.ts       # Output formatting
│       └── spinner.ts       # Progress indicators
│
├── scripts/
│   └── build.sh             # Build script
│
└── docs/
    ├── README.md            # Documentation index
    ├── architecture.md      # Technical deep dive
    ├── troubleshooting.md   # Problem resolution
    ├── cluster-management.md # Day-2 operations
    ├── state-persistence.md  # State system
    ├── aws-cli-configuration.md
    └── nodejs-express-integration.md
```

### Module Responsibilities

- **wizard.ts**: Main orchestrator, user interaction, phase management
- **state.ts**: State persistence, resume capability
- **cleanup.ts**: Rollback and resource cleanup
- **logger.ts**: Logging infrastructure
- **ssh/connection.ts**: SSH communication layer
- **checks/system.ts**: Preflight validation
- **docker/manager.ts**: Docker operations wrapper
- **garage/cluster.ts**: Garage-specific operations
- **ui/**: User interface and progress indicators

See [docs/architecture.md](docs/architecture.md) for detailed documentation.

---

## Coding Standards

### TypeScript Style

**Use TypeScript strict mode features**:
```typescript
// Good: Type annotations
function connect(config: NodeConfig): Promise<void> {
  // ...
}

// Good: Interface definitions
interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  autoFix?: (ssh: SSHConnection) => Promise<void>;
}

// Avoid: Any types (unless absolutely necessary)
// Bad:
function process(data: any) { }
```

**Naming Conventions**:
- Classes: `PascalCase` (e.g., `SystemChecker`, `DockerManager`)
- Functions/Methods: `camelCase` (e.g., `runPreflightChecks`, `deployContainer`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `DEFAULT_PORTS`, `MINIMUM_VERSION`)
- Interfaces: `PascalCase` (e.g., `NodeConfig`, `ClusterConfig`)
- Private methods: Prefix with underscore if ambiguous (optional)

**Async/Await**:
```typescript
// Prefer async/await over .then()
async function deploy() {
  try {
    await ssh.connect();
    await docker.deploy();
  } catch (error) {
    await cleanup();
    throw error;
  }
}
```

**Error Handling**:
```typescript
// Provide context in errors
throw new Error(`Failed to connect to ${host}:${port}: ${originalError.message}`);

// Use try-catch for async operations
try {
  await operation();
} catch (error) {
  await logger.error("Operation failed", error);
  throw error;
}
```

### Code Formatting

**Run formatter before committing**:
```bash
deno fmt
```

**Standard formatting**:
- 2 spaces for indentation
- Double quotes for strings
- Trailing commas in multiline structures
- Max line length: 100 characters (soft limit)

### Documentation

**JSDoc for public APIs**:
```typescript
/**
 * Executes a command on the remote host via SSH.
 * 
 * @param command - The shell command to execute
 * @param options - Optional timeout and other settings
 * @returns Promise resolving to command output and exit code
 * @throws SSHError if connection fails or command times out
 * 
 * @example
 * ```typescript
 * const result = await ssh.exec("docker ps", { timeout: 10000 });
 * if (result.code === 0) {
 *   console.log(result.stdout);
 * }
 * ```
 */
async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
  // ...
}
```

**Inline comments for complex logic**:
```typescript
// Check if user is in docker group but hasn't activated it yet
// (requires newgrp or re-login to take effect)
const groupCheck = await ssh.exec(`groups ${username} | grep docker`);
```

### Imports

**Order imports logically**:
```typescript
// 1. Standard library
import { green, yellow, red } from "@std/fmt/colors";

// 2. Third-party dependencies
import { Input, Confirm } from "@cliffy/prompt";

// 3. Local modules (grouped by type)
import { SSHConnection } from "./ssh/connection.ts";
import { SystemChecker } from "./checks/system.ts";
import { DisplayManager } from "./ui/display.ts";
```

**Use absolute paths from project root** (configured in deno.json):
```typescript
// Good (if configured)
import { SSHConnection } from "~/ssh/connection.ts";

// Also acceptable
import { SSHConnection } from "./ssh/connection.ts";
```

---

## Testing

### Current State

⚠️ **Testing infrastructure is a work in progress.** See [FUTURES.md](FUTURES.md) for planned testing improvements.

### Manual Testing

Before submitting a PR, test manually:

**1. Installation Test**:
```bash
# Clean environment
rm -f .garage-installer-state.json

# Run installer
deno task dev

# Verify:
# - All phases complete successfully
# - Both nodes deploy correctly
# - Cluster is healthy
# - AWS CLI validation passes
```

**2. Resume Test**:
```bash
# Start installation
deno task dev

# Interrupt with Ctrl+C during deployment

# Resume
deno task dev
# Select "Resume"

# Verify: Resumes from correct phase
```

**3. Uninstall Test**:
```bash
# After successful installation
deno task dev
# Select "Uninstall"

# Verify: All resources removed
```

**4. Cross-Platform Test**:
- Build for your platform
- Test compiled binary (not just dev mode)
- Verify all features work

### Integration Testing Checklist

Test on clean VMs:
- [ ] Ubuntu 22.04
- [ ] Ubuntu 20.04
- [ ] Debian 11

Scenarios:
- [ ] Fresh installation
- [ ] Resume after network failure
- [ ] Resume after manual intervention
- [ ] Uninstall
- [ ] Custom ports configuration
- [ ] Different Garage versions
- [ ] SSH key authentication
- [ ] SSH password authentication
- [ ] Non-root user (docker group)
- [ ] Root user
- [ ] IPv4 nodes
- [ ] IPv6 nodes

### Future: Automated Tests

Planned test structure:
```typescript
// tests/unit/state.test.ts
Deno.test("StateManager saves and loads state", async () => {
  const sm = new StateManager();
  await sm.initializeState();
  sm.updateNodes([/* ... */]);
  await sm.save();
  
  const sm2 = new StateManager();
  await sm2.load();
  assertEquals(sm2.getState().nodes.length, 2);
});
```

---

## Submitting Changes

### Branching Strategy

**Main Branches**:
- `main` - Stable release branch
- `V0.1` - Current development branch

**Feature Branches**:
```bash
# Create feature branch from V0.1
git checkout V0.1
git pull upstream V0.1
git checkout -b feature/your-feature-name

# Make changes, commit
git add .
git commit -m "feat: add new feature"

# Push to your fork
git push origin feature/your-feature-name
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

**Format**:
```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples**:
```bash
feat(ssh): add support for Ed25519 keys

fix(wizard): prevent crash on invalid hostname

docs(readme): update installation instructions

refactor(state): simplify phase tracking logic

test(docker): add unit tests for manager class

chore(deps): update cliffy to v1.0.0
```

**Scope guidelines**:
- `ssh`: SSH connection module
- `docker`: Docker manager
- `garage`: Garage cluster operations
- `checks`: Preflight checks
- `state`: State management
- `cleanup`: Cleanup manager
- `wizard`: Main wizard/orchestration
- `ui`: User interface
- `docs`: Documentation
- `build`: Build system

### Pull Request Process

**1. Prepare Your PR**:
```bash
# Update from upstream
git fetch upstream
git rebase upstream/V0.1

# Ensure code quality
deno fmt
deno lint
deno check mod.ts

# Test manually
deno task dev
```

**2. Create Pull Request**:
- Open PR against `V0.1` branch (not `main`)
- Use descriptive title following commit convention
- Fill out PR template (if provided)
- Reference related issues: `Fixes #123` or `Relates to #456`

**3. PR Description Should Include**:
```markdown
## Description
Brief summary of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Tested on Ubuntu 22.04
- [ ] Tested resume capability
- [ ] Tested uninstall

## Checklist
- [ ] Code follows style guidelines
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No new warnings
```

**4. Review Process**:
- Address reviewer feedback
- Make requested changes in new commits (don't force-push)
- Re-test after changes
- Mark conversations as resolved when addressed

**5. After Approval**:
- Maintainer will merge using squash or rebase
- Your contribution will be in the next release!

### What Gets Reviewed

Reviewers will check:
- ✅ Code quality and style
- ✅ TypeScript best practices
- ✅ Error handling
- ✅ User experience (clear messages, proper prompts)
- ✅ Documentation updates
- ✅ No breaking changes (or properly documented)
- ✅ Performance implications
- ✅ Security considerations

---

## Reporting Issues

### Before Opening an Issue

1. **Search existing issues** - Your issue might already be reported
2. **Check documentation** - Solution might be in troubleshooting guide
3. **Try latest version** - Bug might already be fixed
4. **Test on clean environment** - Rule out local configuration issues

### Bug Reports

Use the bug report template:

```markdown
**Describe the Bug**
Clear description of what happened

**To Reproduce**
Steps to reproduce:
1. Run installer with '...'
2. Select '...'
3. See error

**Expected Behavior**
What you expected to happen

**Environment**
- OS: [e.g., Ubuntu 22.04]
- Deno version: [e.g., 1.40.0]
- Installer version: [e.g., v0.1.0]
- Target nodes: [e.g., 2x Ubuntu 20.04]

**Logs**
```
Paste relevant logs from garage-installer.log
```

**Additional Context**
- Network setup (LAN, VPN, cloud)
- Firewall configuration
- Previous installation attempts
```

### Feature Requests

Describe:
- **Problem**: What problem does this solve?
- **Proposed Solution**: How would it work?
- **Alternatives**: Other approaches considered?
- **Use Case**: Example scenario where needed

### Security Issues

⚠️ **Do NOT open public issues for security vulnerabilities**

Instead:
- Email maintainer directly (see README for contact)
- Provide detailed description privately
- Allow time for fix before public disclosure

---

## Development Tips

### Debugging

**Enable verbose logging**:
```typescript
// In logger.ts, set log level
const logger = new Logger("debug");
```

**Use Deno debugger**:
```bash
deno run --inspect-brk --allow-all mod.ts
# Open chrome://inspect in Chrome
```

**Check SSH commands**:
```bash
# View all executed commands
grep "Executing:" garage-installer.log
```

### Common Development Tasks

**Add a new check**:
1. Edit `src/checks/system.ts`
2. Add method following existing pattern
3. Add to `runAll()` array
4. Test on real nodes
5. Update documentation

**Add a new phase**:
1. Edit `src/wizard.ts`
2. Create `async runMyPhase()` method
3. Add state tracking
4. Call from `run()` method
5. Update state persistence docs

**Modify Garage configuration**:
1. Edit `src/garage/cluster.ts`
2. Update `generateGarageConfig()` method
3. Test with actual deployment
4. Verify Garage accepts configuration

### Testing with Docker-in-Docker

**Quick local test** (requires Docker):
```bash
# Run test containers
docker run -d --name test-node1 --privileged ubuntu:22.04
docker run -d --name test-node2 --privileged ubuntu:22.04

# Set up SSH in containers
docker exec test-node1 apt-get update && apt-get install -y openssh-server
docker exec test-node1 service ssh start

# Test installer against containers
```

---

## Resources

### Documentation
- [Architecture Guide](docs/architecture.md) - Technical deep dive
- [Troubleshooting Guide](docs/troubleshooting.md) - Common issues
- [Garage Documentation](https://garagehq.deuxfleurs.fr/documentation/) - Garage itself

### Deno Resources
- [Deno Manual](https://deno.land/manual)
- [Deno Standard Library](https://deno.land/std)
- [Third-party Modules](https://deno.land/x)

### Tools
- [Cliffy](https://cliffy.io/) - CLI framework we use
- [Deno SSH2](https://deno.land/x/ssh2) - SSH library

---

## Recognition

Contributors will be:
- Listed in release notes
- Credited in CHANGELOG.md
- Mentioned in README (for significant contributions)
- Appreciated in the community!

---

## Questions?

- Open a discussion on GitHub
- Join Matrix chat: #garage:deuxfleurs.fr
- Check existing documentation
- Ask in your PR/issue

---

**Thank you for contributing to Garage Installer!** 🚀

Every contribution, no matter how small, helps make this project better for everyone.
