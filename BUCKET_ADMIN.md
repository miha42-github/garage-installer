# Bucket & Key Admin Plan

**[← Back to Main README](README.md)**

This plan defines how to extend the installer with bucket administration and key/user management capabilities, including least-privilege users for object CRUD within a bucket.

## Goals

- Add an interactive admin workflow to manage buckets and access keys after installation.
- Support bucket CRUD operations from the installer.
- Support key/user CRUD operations from the installer.
- Support permission management so a key can perform object create/read/update/delete in a specific bucket.
- Keep secret key handling safe (display once, never persist).

## Non-Goals (MVP)

- No web UI.
- No policy language editor.
- No cross-cluster orchestration.
- No background daemon or scheduler.

## User Experience (MVP)

Add a new top-level action in the wizard:

- Bucket & Key Admin

Inside this action, provide a simple menu loop:

1. List buckets
2. Create bucket
3. Bucket info
4. Delete bucket
5. List keys
6. Create key
7. Key info
8. Delete key
9. Grant bucket permissions to key
10. Revoke bucket permissions from key
11. Create object-CRUD user for bucket (guided flow)
12. Exit

### Guided Flow: Create Object-CRUD User for Bucket

Flow steps:

1. Prompt for bucket name (existing or new).
2. Prompt for key name (user-friendly label).
3. Create key.
4. Grant `--read --write` on bucket using `bucket allow`.
5. Do **not** grant `--owner`.
6. Do **not** grant `key allow --create-bucket` unless explicitly requested.
7. Show access key + secret key once, then return to menu.

Result: Key can CRUD objects in that bucket, but cannot perform global bucket administration.

## Technical Design

### Integration Points

- [src/wizard.ts](src/wizard.ts):
  - Add new entry path for Bucket & Key Admin mode.
  - Reuse existing config loading logic from validation flow when available.
  - Reuse existing SSH connection handling for node access.

- [src/ssh/connection.ts](src/ssh/connection.ts):
  - No major changes required.
  - Continue using exec wrappers for remote Garage CLI commands.

- New module (recommended):
  - [src/garage/admin.ts](src/garage/admin.ts)
  - Encapsulate Garage admin operations as typed methods:
    - `listBuckets`, `createBucket`, `bucketInfo`, `deleteBucket`
    - `listKeys`, `createKey`, `keyInfo`, `deleteKey`
    - `allowBucket`, `denyBucket`, `allowCreateBucket`

### Command Mapping

Bucket operations:

- `docker exec garage /garage bucket list`
- `docker exec garage /garage bucket create <bucket>`
- `docker exec garage /garage bucket info <bucket>`
- `docker exec garage /garage bucket delete <bucket>`

Key operations:

- `docker exec garage /garage key list`
- `docker exec garage /garage key create <key-name>`
- `docker exec garage /garage key info <key-id-or-name>`
- `docker exec garage /garage key delete <key-id-or-name>`

Permissions:

- `docker exec garage /garage bucket allow <bucket> --read --write --key <key-id>`
- `docker exec garage /garage bucket allow <bucket> --read --write --owner --key <key-id>` (admin option only)
- `docker exec garage /garage bucket deny <bucket> --key <key-id>`
- `docker exec garage /garage key allow --create-bucket <key-id>` (optional, explicit)

## Security Requirements

- Never persist secret access keys in:
  - state file
  - cluster config file
  - logs
- Redact or avoid printing secrets after initial display.
- Require confirmation for destructive actions:
  - bucket delete
  - key delete
  - permission revoke
- Warn before granting high-privilege capabilities:
  - `--owner`
  - `--create-bucket`

## Error Handling

- Normalize common Garage CLI errors:
  - bucket exists / missing
  - key exists / missing
  - insufficient permissions
  - container unavailable
- Keep command stderr visible in friendly summaries.
- Continue menu loop after recoverable failures.

## Implementation Phases

## Phase 1: Admin Mode Skeleton

- Add top-level wizard option for Bucket & Key Admin.
- Load cluster connection context (from config file or prompts).
- Establish SSH to selected admin node.
- Add menu loop with placeholders.

## Phase 2: Bucket CRUD

- Implement list/create/info/delete bucket actions.
- Add confirmations for delete.
- Validate bucket name input before command execution.

## Phase 3: Key CRUD

- Implement list/create/info/delete key actions.
- Parse key create output to extract access key and secret key.
- Show secret once and warn user to store it safely.

## Phase 4: Permission Admin

- Implement grant and revoke actions.
- Add explicit prompt toggles for read/write/owner.
- Add optional `create-bucket` capability with warning prompt.

## Phase 5: Guided Object-CRUD User

- Build end-to-end helper for least-privilege object user creation.
- Reuse bucket/key methods to avoid duplicated command logic.
- Print concise “next commands” for AWS CLI testing.

## Phase 6: Documentation & Validation

- Update [README.md](README.md) with new admin mode entry point.
- Update [docs/quick-reference.md](docs/quick-reference.md) with new workflow commands.
- Add troubleshooting notes in [docs/troubleshooting.md](docs/troubleshooting.md).

## Testing Plan

Manual test matrix (minimum):

1. Bucket list/create/info/delete success path.
2. Key list/create/info/delete success path.
3. Grant read/write and verify S3 upload/download works.
4. Revoke permissions and verify access denied.
5. Attempt delete non-empty bucket and validate error reporting.
6. Restart installer and verify admin mode still works with existing config.

## Acceptance Criteria (MVP)

- Installer exposes Bucket & Key Admin mode from main flow.
- User can perform bucket CRUD from the installer.
- User can perform key CRUD from the installer.
- User can grant/revoke bucket permissions to keys.
- Guided flow can create a least-privilege object-CRUD key for one bucket.
- No secret keys are persisted to disk or logs.

## Future Enhancements

- Add JSON output mode for automation.
- Add pagination/filtering for large key or bucket lists.
- Add optional Admin API backend path in addition to Garage CLI.
- Add role presets (readonly, readwrite, owner) with templates.
