# Plan 003: Characterize the headless task runner's process spawn/abort lifecycle

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 5b22088b..HEAD -- electron/tasks/headless-task-runner.ts`
> If that file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `5b22088b`, 2026-06-10

## Why this matters

`HeadlessTaskRunner.run()` spawns an agent child process, wires the abort
signal to kill it, drives an ACP session over the child's stdio, and kills the
child in a `finally` block. Scheduled/background tasks depend on this lifecycle
being correct — a regression that fails to bind the spawn-error handler or
fails to kill the child on abort leaks OS processes silently. The path has only
*indirect* coverage today (`tests/electron/task-service-runner-locality.test.ts`
mocks the whole runner; `headless-task-connector-injection.test.ts` and
`headless-task-web-context-injection.test.ts` test config injection, not the
spawn/kill lifecycle). The two lifecycle-governing pieces — `waitForChildSpawn`
(the spawn success/failure gate) and the abort→`child.kill()` wiring — are small
and pure-ish, but `waitForChildSpawn` is module-private and the abort wiring is
inlined inside the 400-line `run()` method, so neither can be tested directly.

This plan adds direct characterization tests for both, via the minimum safe
change: export `waitForChildSpawn`, and extract the inline abort-wiring block
into a small behavior-preserving helper. **No runtime behavior changes** — this
is a test-safety-net plan. If a test reveals the current behavior is wrong, that
is a STOP condition (report it; do not "fix" behavior under a tests-only plan).

## Current state

`electron/tasks/headless-task-runner.ts` imports (lines 1–5):

```ts
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
```

### Piece 1 — `waitForChildSpawn` (module-private, lines 146–173)

```ts
function waitForChildSpawn(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (child.pid != null) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const finalize = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      child.off("spawn", handleSpawn);
      child.off("error", handleError);
      callback();
    };

    const handleSpawn = () => finalize(() => resolve());
    const handleError = (error: Error) => finalize(() => reject(error));

    child.once("spawn", handleSpawn);
    child.once("error", handleError);
  });
}
```

Behavior to lock in: resolves immediately if `child.pid != null`; otherwise
resolves on the first `"spawn"` event, rejects on the first `"error"` event,
ignores subsequent events (`settled` guard), and removes both listeners when it
settles.

### Piece 2 — the abort-wiring block, inlined in `run()` (lines 441–460)

```ts
const child = spawn(launchPlan.executable, launchPlan.args, {
  cwd: workspacePath,
  env: launchPlan.env,
  stdio: ["pipe", "pipe", "pipe"],
});

// Wire abort signal to kill the child process.
if (signal) {
  const onAbort = () => {
    child.kill();
  };
  if (signal.aborted) {
    child.kill();
  } else {
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("exit", () => {
      signal.removeEventListener("abort", onAbort);
    });
  }
}
```

Here `signal` is an optional `AbortSignal`. Behavior to lock in: if the signal
is already aborted, kill immediately; otherwise kill on `"abort"`, and on the
child's `"exit"` remove the abort listener. The block uses ONLY the local
`child` and `signal` — nothing else from `run()`'s scope — so it extracts
cleanly.

### And the cleanup `finally` (lines 727–730), for context only (do NOT change)

```ts
} finally {
  await this.appBridgeService.releaseSession(bridgeSession.bridgeSessionId);
  child.kill();
}
```

### Test conventions

Electron tests live in `tests/electron/*.test.ts` and use Vitest
(`import { describe, expect, it, vi } from "vitest"`). For an event-emitter
fake, a `node:events` `EventEmitter` works as a stand-in for the child where
only `.once`/`.on`/`.off`/`.emit`/`.kill`/`.pid` are touched. See
`tests/electron/task-service-runner-locality.test.ts` for the file's general
shape (imports, `describe`/`it`, `vi`).

## Commands you will need

| Purpose         | Command                                                                     | Expected on success |
|-----------------|-----------------------------------------------------------------------------|---------------------|
| Typecheck       | `pnpm check:electron`                                                       | exit 0, no errors   |
| Run new test    | `pnpm exec vitest --run tests/electron/headless-task-runner-lifecycle.test.ts` | all pass            |
| Adjacent tests  | `pnpm exec vitest --run tests/electron/headless-task-connector-injection.test.ts tests/electron/task-service-runner-locality.test.ts` | still pass          |
| Lint            | `pnpm lint`                                                                | exit 0              |
| Fast verify     | `pnpm verify:quick`                                                        | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `electron/tasks/headless-task-runner.ts` — export `waitForChildSpawn`;
  extract the abort block into a new exported helper and call it from `run()`.
- `tests/electron/headless-task-runner-lifecycle.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- The body of `run()` other than replacing the ~14-line abort block with a call
  to the new helper. Do not refactor the ACP connection, DB writes, timeout, or
  the `finally` cleanup.
- The `finally { … child.kill() }` block — leave it exactly as-is.
- `electron/tasks/service.ts` and any other runner collaborators.
- Behavior: this plan must not change what the runner does at runtime.

## Git workflow

- Branch: `advisor/003-task-runner-lifecycle-tests`
- Commit per logical unit (extraction; tests). Conventional commits — e.g.
  `test(tasks): characterize headless runner spawn/abort lifecycle`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Export `waitForChildSpawn` (no behavior change)

Change `function waitForChildSpawn(` to `export function waitForChildSpawn(`
in `electron/tasks/headless-task-runner.ts`. Nothing else about it changes.

**Verify**: `grep -n "export function waitForChildSpawn" electron/tasks/headless-task-runner.ts`
→ 1 match; `pnpm check:electron` → exit 0.

### Step 2: Extract the abort-wiring block into an exported helper

Add a new exported function (place it next to `waitForChildSpawn`):

```ts
export function wireChildAbort(
  child: ChildProcessWithoutNullStreams,
  signal: AbortSignal | undefined,
): void {
  if (!signal) {
    return;
  }
  const onAbort = () => {
    child.kill();
  };
  if (signal.aborted) {
    child.kill();
  } else {
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("exit", () => {
      signal.removeEventListener("abort", onAbort);
    });
  }
}
```

Then replace the inline block in `run()` (lines 447–460, the
`// Wire abort signal…` comment through its closing brace) with a single call:

```ts
wireChildAbort(child, signal);
```

The extracted code must be byte-for-byte equivalent in behavior — same kill
timing, same listener add/remove. Confirm `signal`'s type at the call site
matches `AbortSignal | undefined` (it is the optional abort signal threaded
into `run()`); if it is typed differently, match that type in the helper
signature and report the difference.

**Verify**:
- `grep -n "wireChildAbort" electron/tasks/headless-task-runner.ts` → 2 matches
  (definition + call site).
- `grep -n "Wire abort signal to kill" electron/tasks/headless-task-runner.ts`
  → 0 matches (the inline block is gone).
- `pnpm check:electron` → exit 0.

### Step 3: Write the characterization tests

Create `tests/electron/headless-task-runner-lifecycle.test.ts` importing both
exported helpers. Use a `node:events` `EventEmitter`-based fake child that also
carries `pid` and a `kill` spy (`vi.fn()`), and a real `AbortController` for
signals.

Cover for `waitForChildSpawn`:
1. Resolves immediately when `child.pid` is set (no events emitted).
2. With `pid` unset: resolves after the fake emits `"spawn"`.
3. With `pid` unset: rejects with the emitted error after `"error"`.
4. After settling on `"spawn"`, a later `"error"` does NOT cause an unhandled
   rejection and the promise stays resolved (assert listeners were removed:
   `child.listenerCount("spawn") === 0 && child.listenerCount("error") === 0`).

Cover for `wireChildAbort`:
5. `signal === undefined` → no throw, `kill` never called.
6. Signal already aborted at call time → `kill` called once synchronously.
7. Signal aborts after wiring → `kill` called once on abort.
8. After the child emits `"exit"`, aborting the signal does NOT call `kill`
   (the abort listener was removed) — assert `kill` call count stays 0 when the
   only event is `exit` then abort.

**Verify**: `pnpm exec vitest --run tests/electron/headless-task-runner-lifecycle.test.ts`
→ all 8 cases pass.

### Step 4: Confirm no regressions + full gate

Run the adjacent runner tests and the fast verify.

**Verify**:
`pnpm exec vitest --run tests/electron/headless-task-connector-injection.test.ts tests/electron/task-service-runner-locality.test.ts`
→ pass; then `pnpm verify:quick` → exit 0.

## Test plan

- New file `tests/electron/headless-task-runner-lifecycle.test.ts`, 8 cases as
  in Step 3, structured like `tests/electron/task-service-runner-locality.test.ts`.
- Fakes: `EventEmitter` for the child (with `.pid` and a `kill` spy);
  `AbortController` for signals. No real process is spawned.
- Verification: `pnpm verify:quick` → all pass including the 8 new cases, and
  the two adjacent runner tests still pass (proves the extraction was
  behavior-preserving).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "export function waitForChildSpawn" electron/tasks/headless-task-runner.ts` → 1 match
- [ ] `grep -n "wireChildAbort" electron/tasks/headless-task-runner.ts` → 2 matches
- [ ] `grep -n "Wire abort signal to kill" electron/tasks/headless-task-runner.ts` → 0 matches
- [ ] `pnpm check:electron` exits 0
- [ ] `pnpm exec vitest --run tests/electron/headless-task-runner-lifecycle.test.ts` passes with ≥8 cases
- [ ] adjacent runner tests still pass
- [ ] `pnpm lint` exits 0
- [ ] `git status` shows only the 2 in-scope files modified/created
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts don't match the live code (drift).
- A characterization test reveals the *current* behavior differs from the
  "behavior to lock in" notes above (e.g. the abort listener is NOT removed on
  exit, or a double-settle is possible). Report the discrepancy — do NOT change
  runtime behavior to make a test pass; that is a separate bug-fix plan.
- The abort block references anything other than `child` and `signal`, so the
  extraction is not clean — report what else it captures.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- These tests pin the spawn-gate and abort-kill contract. If `run()` is later
  refactored to change *when* the child is killed (e.g. graceful shutdown before
  `SIGKILL`), update `wireChildAbort` and these tests together.
- A reviewer should confirm Step 2 is a pure extraction: the diff in `run()`
  should be the deleted inline block replaced by one `wireChildAbort(child, signal)`
  call, with no other lines changed.
- Deferred out of scope: end-to-end coverage of the full `run()` orchestration
  (spawn → ACP initialize → timeout → finally-kill). That needs a heavier
  harness or a runner refactor and is a separate plan.
