# SQR-344 Test Performance Report

Captured on 2026-06-16 from
`bcm/sqr-344-deeply-audit-and-improve-test-suite-performance`.

## Summary

The main slowdown was DB cleanup. `resetTestDb()` used
`TRUNCATE ... RESTART IDENTITY CASCADE` before every DB test. The mutable schema
uses UUID primary keys, so identity resets bought nothing and made the serial DB
slice pay expensive lock/FK work hundreds of times.

The fix changes mutable DB cleanup to ordered `DELETE` statements and explicitly
clears `message_stream_events`. The read-only card and scenario-section fixture
tables still stay seeded once in global setup.

## Before And After

| Suite                                    |          Before wall |       After wall | Before tests >1s | After tests >1s |
| ---------------------------------------- | -------------------: | ---------------: | ---------------: | --------------: |
| `npm run test:unit -- --reporter=json`   |               26.40s |           16.23s |                1 |               0 |
| `npm run test:db -- --reporter=json`     |              128.60s |           46.45s |                2 |               0 |
| `npm test -- --reporter=json`            | about 2m45s baseline |           90.19s |     not captured |               1 |
| `npm run e2e:browser -- --reporter=json` |     36.63s, 4 failed | 14.44s, 0 failed |                6 |               3 |

The `npm test` after run passed 154 files and 1820 tests.

## Slowest After Files

### Unit

| File                                      | Duration | Tests |
| ----------------------------------------- | -------: | ----: |
| `test/web-ui-layout.test.ts`              |  621.0ms |   107 |
| `test/script-telemetry-real-otel.test.ts` |  556.9ms |     1 |
| `test/sentry-usage-guardrails.test.ts`    |  420.1ms |     4 |
| `test/service.test.ts`                    |  183.3ms |    22 |
| `test/mcp-transport.test.ts`              |  167.7ms |     7 |

### DB

| File                                            | Duration | Tests |
| ----------------------------------------------- | -------: | ----: |
| `test/conversation.test.ts`                     |    4.97s |    69 |
| `test/seed/seed-scenario-section-books.test.ts` |  927.8ms |     5 |
| `test/campaign-live-migration.test.ts`          |  602.4ms |     4 |
| `test/campaign-api.test.ts`                     |  513.4ms |    20 |
| `test/unlock-graph-seed.test.ts`                |  478.5ms |     4 |

No individual DB test is over 1s after the cleanup change. The remaining DB
wall time is serial file setup and one-time global data seeding, not one slow
assertion.

### Browser E2E

| File                                 | Duration | Tests |
| ------------------------------------ | -------: | ----: |
| `sqr-24-chat-game-selection.spec.ts` |    6.15s |     8 |
| `sqr-11-campaign-picker.spec.ts`     |    2.35s |     2 |

Browser e2e still has three tests over 1s. These are full browser flows with a
real server, DB reset, login, DOM interaction, and mobile/desktop projects. They
belong in the browser-e2e suite, not the normal Vitest gate.

## CI Coverage Finding

The browser-e2e job existed in `.github/workflows/ci.yml`, but it was limited to
scheduled and manual runs. PR CI ran Vitest coverage only, so it could not catch
the SQR-11-to-SQR-24 browser-state leak. The CI workflow now runs all current
CI/e2e jobs on PRs and main pushes, and the duplicate daily CI schedule has
been removed.

## Remaining Over-1s Test

The combined `npm test` JSON report had one individual Vitest test over 1s:

| File                                      | Duration | Reason                                                                                                                                                                                                                                                   |
| ----------------------------------------- | -------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/script-telemetry-real-otel.test.ts` |    1.13s | Direct-process OpenTelemetry setup test. It starts script telemetry in a child-like Node path and validates the real instrumentation path. In the isolated unit timing run it measured 556.9ms, so this appears to be combined-run process/setup jitter. |

## Browser E2E Isolation Finding

The first browser-e2e timing run exposed a real order-dependent failure:

1. `test/e2e/sqr-11-campaign-picker.spec.ts` created an active campaign for the
   shared dev user.
2. `test/e2e/sqr-24-chat-game-selection.spec.ts` then logged in as the same dev
   user and expected `.squire-game-picker`.
3. An active campaign intentionally hides the per-session game picker, so the
   SQR-24 tests failed in both desktop and mobile projects.

Evidence:

- SQR-24 alone on a clean test DB passed.
- SQR-11 followed by the SQR-24 first-turn test failed.
- After adding e2e DB reset hooks, that ordered repro passed.
- The full browser-e2e suite then passed 10/10 in 14.44s.

This fixes SQR-347 in the same branch as the performance work because the bug
was discovered by the SQR-344 timing audit and affected the same test gate.

## Regression Guard

Use:

```bash
npm run test:timing
```

That command runs unit and DB slices with JSON output under
`.gstack/test-timings/`, prints the slowest files/tests, and fails if any unit or
DB test exceeds 1000ms.

For browser-e2e timing:

```bash
PLAYWRIGHT_JSON_OUTPUT_NAME=.gstack/test-timings/e2e-browser.json npm run e2e:browser -- --reporter=json
node scripts/summarize-test-timings.ts e2e-browser=.gstack/test-timings/e2e-browser.json
```
