# Contract anti-patterns — what the validator rejects, and why

The founding design principle (Plan A): smaller contracts, schema
validation, fewer degrees of freedom, repair loops. These are the request
shapes that violate it. All four canonical bad asks **must fail validation**:

| Bad ask | Why it cannot be a valid contract |
|---|---|
| "Fix this whole repo." | No single concern, no bounded scope, no mechanical acceptance. |
| "Use any approach you want." | Unbounded method; the contract exists to remove degrees of freedom. |
| "Return prose explaining the patch." | Output must be a diff or schema-valid JSON, never prose-plus-maybe-code. |
| "Delegate recursively until solved." | Recursion is structurally impossible (task contracts cannot delegate) and "until solved" is not a stop condition. |

## The deny lists (mechanical, mirrored in `scripts/validate_contract.ts`)

**Unbounded language** — rejected anywhere in a worker `goal` (and every
delegated goal; the router's `user_goal` is exempt because it quotes the
user): "whole/entire repo|repository|codebase|project"; "all
files|tests|bugs|issues|TODOs|warnings|errors|deps|dependencies|modules|packages"
(same list with "every …"); "everything"; "any approach"; "as needed";
"wherever"; "recursively"; "until it works/passes/solved/fixed/done"; "and
more"; "etc".

**Multi-concern goals** — rejected markers: a second sentence, a line break,
"; ", ", and ", ", then", "and then", "and also", "as well as", "after
that". One sentence, one concern; two concerns means two contracts.

**Unbounded scope paths** — rejected: absolute paths, `..`, `.`, and any
glob whose first segment is not a literal name (`*`, `**`, `**/*`, top-level
`*.ts`). Bounded globs below a literal segment (`src/**/*.ts`) are fine.

**Non-runnable or unsafe acceptance commands** — rejected: placeholders
(`...`, `<file>`, TODO/TBD/FIXME); network operations (curl/wget/ssh/…, git
push/pull/fetch/clone, `gh`, every package-installer form — pip/npm/pnpm/
yarn/bun/cargo/go/uv install|add|sync, apt/brew/…, docker pull/push/run);
destructive operations (`rm`, `git reset --hard`/`clean`/`restore`/
`checkout --`, dd/mkfs/shred/truncate, sudo/doas, kill/pkill/shutdown,
`>`-redirects to absolute paths).

## Laundering: the subtler failure

The deny lists catch faithful transcriptions of unbounded asks. The subtler
anti-pattern is **laundering**: silently rewriting "fix this whole repo"
into "fix src/report_utils.py" so the contract validates. The contract then
lies about what was asked, the requester's expectation is silently dropped,
and the validator has been gamed rather than informed.

The honest procedure for an unboundable ask:

1. Write the **faithful** contract (it will be unbounded).
2. Run the validator; it will fail with named, mechanical reasons.
3. Report the rejection as the finding: this request is not one task.
4. Propose the decomposition — the 2–4 bounded contracts (or one router
   contract with bounded delegations) that would each validate — and let the
   requester choose.

The validator's `fail` is the correct output for an unboundable request;
that is why the `laguna-task-contract-fix-whole-repo` eval case expects
status `fail`. A failing validation that names its reasons is worth more
than a passing contract that hides the problem.

## Other recurring mistakes

- **Patch-shaped defaults**: writing `single_file_patch` + `unified_diff`
  for read-only work. Log reduction, stack-trace routing, and repo mapping
  modify zero files and output JSON to an `artifact_path`.
- **Context stuffing**: listing a dozen files "for context". The packet is
  what the worker must read, each with a `why`; everything else is noise.
- **Acceptance theater**: checks like "code looks clean" or commands that
  cannot run verbatim. If success is not mechanically checkable, the task is
  not ready to delegate.
- **Menu invention** (router): choosing a skill that was not in
  `candidate_skills`, or a first delegation whose `task_type` does not
  implement the chosen skill.
- **Missing exits** (router): stop conditions without `escalation_required`.
  Every routed plan needs an explicit "stop and hand back" path.
