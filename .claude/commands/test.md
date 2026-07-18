# /test

Run the unit test suite.

```bash
deno task test
```

Tests live in:
- `src/wizard/services/sshDefaults.test.ts`
- `src/wizard/services/configLoader.test.ts`
- `src/wizard/services/endpointChecks.test.ts`
- `src/tui/adapters/wizardAdapter.test.ts`

Tests use real file I/O and env reads — no mocks. If a test needs SSH/Docker, it will be skipped or will fail fast without a live target.
