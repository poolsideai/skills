# Plan 004: Design and prototype a root-allowlist guard for the renderer filesystem bridge

> **Executor instructions**: This is a DESIGN + PROTOTYPE plan, not a
> ship-the-fix plan. Follow it step by step, run every verification command,
> and confirm the expected result before moving on. If anything in the "STOP
> conditions" section occurs, stop and report — do not improvise. When done,
> update the status row for this plan in `plans/README.md` — unless a reviewer
> dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 5b22088b..HEAD -- electron/preload.ts electron/preload-filesystem.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M (this spike; the full rollout it unblocks is L)
- **Risk**: LOW (this spike changes no live behavior; the follow-up rollout is MED–HIGH)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `5b22088b`, 2026-06-10

## Why this matters

The preload script exposes raw, **unscoped** filesystem operations to the
renderer over `contextBridge`: `readTextFile`, `writeTextFile` (with
append/overwrite), `removePath` (a recursive `fs.rm(..., { recursive: true,
force: true })`), `readBinaryFileBase64`, `mkdir`, and `listFiles`. Each takes
an arbitrary absolute path from the renderer with no boundary check — so any
code running in the renderer can read `~/.ssh/id_rsa`, exfiltrate any file the
user can read, or recursively delete arbitrary directories. The main window
runs with `sandbox: false`, `contextIsolation: true`, `nodeIntegration:
false`, so these bridge functions execute in the privileged preload context.

The app continuously renders untrusted agent/LLM/markdown output. That output
is sanitized (DOMPurify before every `{@html}`), so today's *direct*
exploitability is low — it hinges on a sanitizer bypass or a malicious
agent/MCP payload that survives sanitization. But the blast radius (arbitrary
file read and recursive delete) is catastrophic, and the same file already
demonstrates the correct pattern for *other* APIs:
`listArtifactViewerDirectory` and `readArtifactViewerPreview` enforce a
workspace boundary via `resolvePreviewPathInsideWorkspace` /
`resolveDirectoryPathInsideWorkspace` (realpath + `isPathInsideWorkspace`). The
raw methods simply skip it.

The reason this is a *design* plan and not a one-shot fix: the raw methods are
called from **many** legitimate places that span **multiple distinct roots** —
not a single workspace. A naive "bound everything to the selected workspace"
change would break skills, the trajectory viewer, and attachments. This spike
enumerates the real roots, designs the allowlist guard and its rollout order,
and lands a *pure, unit-tested guard primitive* — without yet rewiring the live
methods. The follow-up (a separate plan, gated on review of this design) does
the actual wiring, read-methods first.

## Current state

### The unscoped methods (`electron/preload.ts`, lines 196–222)

```ts
listFiles: async (rootPath) => await listFilesRecursive(rootPath),
// …
mkdir: async (filePath) => {
  await fs.mkdir(filePath, { recursive: true });
},
readBinaryFileBase64: async (filePath) =>
  (await fs.readFile(filePath)).toString("base64"),
// …
readTextFile: async (filePath) => await fs.readFile(filePath, "utf8"),
removePath: async (filePath) => {
  await fs.rm(filePath, { recursive: true, force: true });
},
writeTextFile: async (filePath, content, options) => {
  if (options?.create !== false) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }
  await fs.writeFile(filePath, content, {
    encoding: "utf8",
    flag: options?.append ? "a" : "w",
  });
},
```

These are exposed via `contextBridge.exposeInMainWorld("poolDesktop", host)`
(`preload.ts:454`). They run directly in preload (NOT via an
`ipcRenderer.invoke` to main), so a guard added here is the chokepoint — there
is no second main-process layer to also patch for these specific calls.

### The existing boundary primitive to build on (`electron/preload-filesystem.ts`, lines 192–205)

```ts
export function isPathInsideWorkspace(
  filePath: string,
  workspaceRoot: string,
): boolean {
  const relativePath = path.relative(workspaceRoot, filePath);
  return isWorkspaceRelativePath(relativePath);
}

export function isWorkspaceRelativePath(relativePath: string): boolean {
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}
```

`resolvePreviewPathInsideWorkspace` (same file, ~line 207) shows the full
realpath-based check the new guard should generalize from one root to a set.

### Known legitimate callers and the root each needs

(Enumerate precisely in Step 1 by reading these; this is the starting list, not
the final answer.)

- **Selected workspace / session cwd**: `src/lib/chat/workspace/chat-workspace.ts`
  (`readTextFile`/`writeTextFile` resolve cwd from the owning session),
  `src/lib/acp/workspace-service.ts:157,385` (`mkdir`, `listFiles` on cwd).
- **App-data skill library** (NOT the workspace):
  `src/lib/skills/skill-library.ts:256-257,306,168,359` and
  `src/lib/skills/skill-mirror.ts` (`mkdir`, `listFiles`, `removePath` under a
  managed skill root + `resolveConsoleSkillLibraryRoot()`).
- **Task metadata / run output**: `src/lib/chat/metadata/metadata.ts:151,175`
  (`mkdir`, `writeTextFile` under an output root).
- **User-picked files** (arbitrary path, by explicit user action):
  `src/features/trajectory/components/trajectory-viewer-window.svelte:287`
  (`readTextFile` of a picked or task-generated `.json`),
  `src/features/chat/components/pending-attachment-card.svelte:49` and
  `chat-message.svelte:576` (`readBinaryFileBase64` of picked attachments),
  `src/app/shell/shell-composition.ts:88`,
  `src/app/shell/artifact-viewer-controller.svelte.ts:448`.
- **Studio worktree data root**: product worktrees live under a Studio-owned
  sibling root (`electron/main.ts:85`, `"Poolside Studio Worktrees"`).

The full call-site list: run
`grep -rn "host\.fs\.\(readTextFile\|writeTextFile\|removePath\|readBinaryFileBase64\|mkdir\|listFiles\)\|\.fs\.\(readTextFile\|writeTextFile\|removePath\|readBinaryFileBase64\|mkdir\|listFiles\)" src --include="*.ts" --include="*.svelte"`.

### Test exemplar

`tests/electron/preload-filesystem.test.ts` already unit-tests the pure helpers
in `preload-filesystem.ts` with an injectable fake `fileSystem`. Model the new
guard's tests on it.

## Commands you will need

| Purpose          | Command                                                                | Expected on success |
|------------------|------------------------------------------------------------------------|---------------------|
| Typecheck        | `pnpm check:electron`                                                  | exit 0, no errors   |
| Run guard tests  | `pnpm exec vitest --run tests/electron/preload-filesystem.test.ts`     | all pass            |
| Lint             | `pnpm lint`                                                            | exit 0              |
| Fast verify      | `pnpm verify:quick`                                                   | exit 0              |
| Doc format check | `pnpm format:check`                                                   | exit 0              |

## Suggested executor toolkit

- Read `electron/preload-filesystem.ts` in full (the boundary primitives) and
  `tests/electron/preload-filesystem.test.ts` (the test pattern) before coding.
- Read `docs/architecture.md` "layer rules" before adding any new module so the
  guard lands in a layer that doesn't violate import rules
  (`electron/**` must not import from `src/features/**`).

## Scope

**In scope** (the only files you should modify/create):
- `electron/preload-filesystem.ts` — add the pure guard function(s) ONLY.
- `tests/electron/preload-filesystem.test.ts` — add guard test cases.
- `docs/plans/renderer-fs-bridge-hardening.md` (create) — the design doc:
  root enumeration table, allowlist source/plumbing design, rollout order,
  open questions.

**Out of scope** (do NOT touch in this spike):
- `electron/preload.ts` — do NOT wire the guard into the live `readTextFile` /
  `writeTextFile` / `removePath` / etc. yet. Changing their behavior risks
  breaking skills, trajectory viewer, and attachments and is the explicit job
  of the review-gated follow-up plan.
- Any `src/**` caller.
- The artifact-viewer methods that are already bounded.

## Git workflow

- Branch: `advisor/004-fs-bridge-guard-spike`
- Commit per logical unit (guard + tests; design doc). Conventional commits —
  e.g. `feat(preload): add root-allowlist guard primitive (unwired spike)`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Enumerate the legitimate roots (produces the design doc's core table)

Run the call-site grep from "Current state". For EACH call site, record in the
design doc table: the calling module, the fs method, and which root the path
legitimately belongs to (workspace cwd / app-data skill library / task output
root / user-picked / worktree data root / other). If any call site's root
cannot be classified into a small fixed set, that is a key finding — record it
as an open question (it may mean the allowlist needs a per-call "user-granted
path" mechanism rather than a static root set).

**Verify**: `docs/plans/renderer-fs-bridge-hardening.md` exists and contains a
table with one row per call site found by the grep (count the grep hits; the
table row count matches).

### Step 2: Add the pure guard primitive to `preload-filesystem.ts`

Add a function that generalizes the existing single-root check to a set of
allowed roots, using realpath (to defeat symlink/`..` escapes) like
`resolvePreviewPathInsideWorkspace` already does:

```ts
export async function isPathWithinAllowedRoots(
  filePath: string,
  allowedRoots: readonly string[],
  fileSystem: PreloadFileSystem = defaultFileSystem,
): Promise<boolean> {
  if (!fileSystem.realpath) {
    return false; // fail closed when realpath is unavailable
  }
  let realFilePath: string;
  try {
    realFilePath = await fileSystem.realpath(filePath);
  } catch {
    // Path may not exist yet (e.g. a write target). Fall back to the
    // lexically-resolved path so writes inside an allowed root still pass,
    // while ".." escapes are still rejected by isPathInsideWorkspace.
    realFilePath = path.resolve(filePath);
  }
  for (const root of allowedRoots) {
    let realRoot: string;
    try {
      realRoot = await fileSystem.realpath(root);
    } catch {
      realRoot = path.resolve(root);
    }
    if (isPathInsideWorkspace(realFilePath, realRoot)) {
      return true;
    }
  }
  return false;
}
```

Reuse the existing `isPathInsideWorkspace` and `defaultFileSystem`; do not
duplicate them. Keep the function pure and `fileSystem`-injectable to match the
file's existing testability convention. Decide and document (in the design doc)
the fail-closed behavior for non-existent paths on the WRITE side vs READ side —
the follow-up rollout will need that distinction.

**Verify**: `pnpm check:electron` → exit 0;
`grep -n "export async function isPathWithinAllowedRoots" electron/preload-filesystem.ts`
→ 1 match.

### Step 3: Unit-test the guard

Add cases to `tests/electron/preload-filesystem.test.ts` (using its existing
fake-`fileSystem` pattern):

1. Path inside one of several allowed roots → `true`.
2. Path inside none of the roots → `false`.
3. `..` traversal that escapes an allowed root → `false`.
4. Symlink whose realpath resolves OUTSIDE all roots → `false` (fake
   `realpath` returns an outside path).
5. Empty `allowedRoots` → `false`.
6. `fileSystem.realpath` undefined → `false` (fail closed).
7. Non-existent path (realpath throws) lexically inside a root → `true`
   (write-target case); lexically outside → `false`.

**Verify**: `pnpm exec vitest --run tests/electron/preload-filesystem.test.ts`
→ all pass, including ≥7 new cases.

### Step 4: Write the rollout design in the doc

In `docs/plans/renderer-fs-bridge-hardening.md`, beyond the Step-1 table, write:

- **Where allowed roots come from**: enumerate the sources (selected
  workspaces, app-data skill-library root, task-output root, worktree data
  root) and HOW they reach the preload context (preload cannot call
  `app.getPath`; the roots must be injected — propose the mechanism, e.g. a
  main→preload handshake over IPC at window load, or a guarded `app:`-prefixed
  IPC call that resolves the path in main). This is the crux open question.
- **User-picked paths**: design how an explicit user file-pick (trajectory
  viewer, attachments) grants a one-shot allowance for that exact path without
  widening the static allowlist.
- **Rollout order**: read methods first (`readTextFile`, `readBinaryFileBase64`,
  `listFiles`) since they are lower-risk to gate and cover the exfiltration
  surface; then `writeTextFile` / `mkdir`; then `removePath` (highest blast
  radius) last, behind explicit per-call confirmation if needed.
- **Telemetry/kill-switch**: how a rejected path is logged (so legitimate
  callers that break are diagnosable) and whether an env/flag escape hatch is
  warranted during rollout.
- **Open questions** for the maintainer.

**Verify**: `pnpm format:check` → exit 0 (the doc is Prettier-clean);
the doc contains sections for roots-source, user-picked grants, rollout order,
and open questions.

### Step 5: Full gate

Run `pnpm verify:quick`.

**Verify**: exit 0.

## Test plan

- Guard tests added to `tests/electron/preload-filesystem.test.ts` (≥7 cases,
  Step 3), modeled on the file's existing injectable-`fileSystem` tests.
- No live-behavior tests — this spike does not change `preload.ts`, so there is
  nothing new to characterize there yet. The follow-up rollout plan owns the
  integration tests for the wired methods.
- Verification: `pnpm verify:quick` → all pass including the new guard cases.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `docs/plans/renderer-fs-bridge-hardening.md` exists with: a call-site→root
      table (one row per grep hit), a roots-source/plumbing design, a rollout
      order, and an open-questions section
- [ ] `grep -n "export async function isPathWithinAllowedRoots" electron/preload-filesystem.ts` → 1 match
- [ ] `pnpm check:electron` exits 0
- [ ] `pnpm exec vitest --run tests/electron/preload-filesystem.test.ts` passes with ≥7 new cases
- [ ] `git diff --stat electron/preload.ts` shows NO changes (the live methods are untouched in this spike)
- [ ] `pnpm lint` exits 0 and `pnpm format:check` exits 0
- [ ] `git status` shows only the 3 in-scope files modified/created
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts in `preload.ts` / `preload-filesystem.ts` don't
  match the live code (drift).
- The call-site enumeration finds a legitimate caller whose path root cannot be
  classified into a small fixed set even with a user-picked-grant mechanism —
  this changes the whole approach; report it as the headline open question
  rather than forcing a design.
- Adding `isPathWithinAllowedRoots` to `preload-filesystem.ts` triggers an
  ESLint layer violation — report it; do not disable the rule.
- You find yourself needing to edit `preload.ts` to make something pass — that
  is out of scope for this spike by design; stop and report.

## Maintenance notes

- This spike intentionally lands an UNWIRED guard. Until the follow-up rollout
  wires it into `preload.ts`, the security gap remains open — the index must
  show this clearly so the follow-up isn't forgotten.
- The follow-up rollout plan (to be written after this design is reviewed) is
  where the real risk lives: every wired method can break a legitimate caller
  if its root isn't in the allowlist. That plan should roll out one method at a
  time, read-side first, each behind its own verification that the known
  callers (skills sync, trajectory viewer, attachments, task output) still
  work.
- A reviewer of THIS spike should scrutinize the root enumeration for
  completeness (a missed root becomes a broken feature at rollout) and the
  fail-closed semantics of the guard (especially for non-existent write
  targets and when `realpath` is unavailable).
