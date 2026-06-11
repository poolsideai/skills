# Sample Plans — handoff plans built for a smaller executor model

This folder is a **reference set of example implementation plans**. They were
produced by the `/improve` skill running a `--quick` audit against the
`poolside-studio` repo (an Electron desktop ACP client), at commit `5b22088b`.

They are kept here as concrete examples of the *output shape* the planning
workflow should produce — not because the poolside-studio findings themselves
matter outside that repo.

## What these plans are for — the goal

The whole point of this format is **separation of labor between models**: an
expensive, high-context model does the part where intelligence compounds
(understanding the codebase, judging what's real, specifying the fix exactly),
and a **cheaper, smaller model with zero prior context executes** it. The plan
is the product — its quality determines whether the weaker executor succeeds.

So every plan here is written for the *weakest plausible executor*: a model
that has not seen the audit, the conversation, the other plans, or the
codebase survey. That forces a specific discipline:

- **Self-contained context** — exact file paths, current-state code excerpts
  inlined, the repo conventions to match (with a pointer to an exemplar file),
  and the exact build/test/lint commands. Never "as discussed above."
- **Verification gates on every step** — each step ends with a command and its
  expected result, so the executor never has to *judge* whether it succeeded.
- **Hard boundaries** — an explicit in-scope file list and an out-of-scope list
  ("do NOT touch X even though it looks related, because Y").
- **Escape hatches** — specific STOP conditions ("if the code doesn't match
  this excerpt, stop and report — do not improvise") instead of letting a weak
  model paper over a mismatch.
- **Machine-checkable done criteria** — `grep`/test/typecheck commands with
  expected output, not prose like "works correctly."
- **A drift check** — every plan stamps the commit it was written against so the
  executor can detect if the codebase moved underneath it.

A reader studying these files should look at *how much is inlined* and *how
every instruction reduces to a checkable command* — that's what makes them
runnable by a model that knows nothing going in.

## Files in this folder

- `001-bump-hono-override.md` — smallest, simplest example (a dependency bump);
  good starting point for the format.
- `002-encrypt-pool-credentials-at-rest.md` — the richest example: a security
  fix that inlines a real in-repo exemplar to copy, funnels all call sites
  through two chokepoints, and specifies a 5-case test suite.
- `003-characterize-task-runner-process-lifecycle.md` — a tests-only plan that
  also does a small behavior-preserving extraction; shows how to scope "add a
  safety net without changing behavior."
- `004-scope-renderer-filesystem-bridge.md` — a *design/spike* plan (not a
  ship-the-fix plan): used when the real fix is too large/architectural for one
  pass, so the deliverable is an enumeration, a tested primitive, and a design
  doc, with the risky rollout explicitly deferred.
- `PLANS-INDEX.md` — the index that ships alongside a plan set: execution order,
  dependency notes, a status table the executors update, and — importantly — a
  "considered and rejected" section recording findings that were vetted and
  thrown out, so they aren't re-audited next run.

---

## Origin context — the advisor's summary of this plan set

The text below is the advisor model's own closing summary from the session that
produced these plans. It explains what was audited, what survived vetting, and
why plan 004 was scoped as a spike rather than a one-shot fix.

> I ran a `--quick` audit (hotspots only, correctness/security/tests), vetted
> every candidate against the actual code, rejected four over-reported
> findings, and wrote four self-contained executor plans against commit
> `5b22088b`.
>
> **Plans written:**
>
> | Plan | What it does | Why | Effort |
> |------|--------------|-----|--------|
> | **001** | Bump the `hono` pnpm override `4.12.14 → 4.12.18` | Clears all 11 `pnpm audit` advisories (all transitive via `@modelcontextprotocol/sdk`); hygiene, low real-world reach for a desktop client | S |
> | **002** | Encrypt Pool/provider API tokens at rest with `safeStorage` | Today they're plaintext in SQLite under `agent.config.plainSecrets`; the repo's own browser-playwright token store already shows the exact `safeStorage` pattern to copy | M |
> | **003** | Characterization tests for the task-runner spawn/abort lifecycle | The spawn-gate and abort→kill wiring have only indirect coverage; plan exports `waitForChildSpawn` and extracts the abort block (behavior-preserving) so both can be tested | M |
> | **004** | Design + prototype a root-allowlist guard for the renderer FS bridge | `preload.ts` exposes unscoped `readTextFile`/`writeTextFile`/`removePath`(recursive)/etc. to the renderer — arbitrary file read/delete if the markdown sanitizer is ever bypassed | M spike (unblocks an L rollout) |
>
> **The headline issue is #4**, but I deliberately scoped it as a design spike
> rather than a one-shot fix: the unscoped methods are called from many
> legitimate callers spanning *different* roots (selected workspaces, the
> app-data skill library, task output, the Studio worktree root, user-picked
> files), so a naive "bound to the workspace" change would break skills, the
> trajectory viewer, and attachments. The spike enumerates the roots, lands a
> pure unit-tested guard primitive, and leaves wiring to a review-gated
> follow-up. Its index row notes the security gap stays open until that
> follow-up ships.
>
> **Rejected after reading the code** (recorded in the index so they aren't
> re-audited): the "missing spawn-error handler" (it's handled + a `finally`
> kills the child), "unawaited Promise.all swallows errors/races" (each branch
> self-handles errors; refreshes are versioned), "navigation-policy untested"
> (it's directly tested in `main-dev-navigation.test.ts`), and "unsafe
> `{@html}`/DOMPurify" (every sink is sanitized, escaped, or sandboxed).
>
> **Two lower-priority items** noted but not planned: unredacted opt-in
> feedback trajectory JSON, and DB column migrations without a
> transaction/version gate.
>
> Not audited this pass (`--quick`): performance, the full `src/features/**`
> UI, build/CI tooling, docs, and direction/roadmap.
