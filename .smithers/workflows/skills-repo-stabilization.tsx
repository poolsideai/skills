// smithers-source: seeded
// smithers-metadata-version: 1
// smithers-display-name: Skills Repo Stabilization
// smithers-description: Drive the U3-U5 stabilization tasks from the skills-repo plan to a verified-green state, then refresh the U6 status docs.
// smithers-tags: planning, repo-maintenance, evals
/** @jsxImportSource smithers-orchestrator */
import { $ } from "bun";
import { createSmithers, HumanTask } from "smithers-orchestrator";
import { z } from "zod/v4";
import { agents } from "../agents";
import DiscoveryPrompt from "../prompts/discovery.mdx";
import U3WorkbenchHardeningPrompt from "../prompts/u3-workbench-hardening.mdx";
import U4BeadsDocsPrompt from "../prompts/u4-beads-docs.mdx";
import U5EvalCasesPrompt from "../prompts/u5-eval-cases.mdx";
import VerificationTriagePrompt from "../prompts/verification-triage.mdx";
import U6StatusDocsPrompt from "../prompts/u6-status-docs.mdx";
import DryRunNoopPrompt from "../prompts/dry-run-noop.mdx";
import FinalReportPrompt from "../prompts/final-report.mdx";

const inputSchema = z.object({
  plan_path: z
    .string()
    .default("docs/plans/2026-06-15-001-chore-skills-repo-stabilization-plan.md")
    .describe("Path to the stabilization plan markdown."),
  dry_run: z
    .boolean()
    .default(false)
    .describe("When true, skip editing tasks and exercise discovery + verification only."),
  notes: z.string().default("").describe("Optional free-form operator notes routed to discovery."),
});

// 1. Discovery output: scoped plan of what each unit will touch + gate flags.
const discoverySchema = z.looseObject({
  summary: z.string(),
  scopeByUnit: z.looseObject({}).default({}),
  filesByUnit: z.looseObject({}).default({}),
  openQuestions: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
  touchesProtected: z.boolean().default(false),
  touchesBeads: z.boolean().default(false),
  touchesRootSmithers: z.boolean().default(false),
  touchesExperimentsSmithersPool: z.boolean().default(false),
});

// 2. Shared unit-edit output shape used by every editing task (u3, u4, u5 author,
//    triage, u6, dry-run noop). looseObject so per-task extra fields are kept.
const unitDiffSchema = z.looseObject({
  summary: z.string(),
  filesChanged: z.array(z.string()).default([]),
  diffNotes: z.string().default(""),
  noOp: z.boolean().default(false),
  evidence: z.array(z.string()).default([]),
  casesAdded: z.array(z.string()).default([]),
  iterations: z.number().int().default(0),
  nextAction: z.string().default(""),
  checkOutput: z.string().default(""),
});

// 3. Deterministic check_eval_cases.py result used as the U5 Ralph predicate.
const checkResultSchema = z.looseObject({
  passed: z.boolean(),
  stdout: z.string().default(""),
  stderr: z.string().default(""),
  exitCode: z.number().int().default(0),
});

// 4. Verification battery result. passed is the Ralph predicate.
const verificationSchema = z.looseObject({
  passed: z.boolean(),
  checks: z
    .array(
      z.looseObject({
        name: z.string(),
        passed: z.boolean(),
        detail: z.string().default(""),
      }),
    )
    .default([]),
  failingChecks: z.array(z.string()).default([]),
  stdout: z.string().default(""),
  stderr: z.string().default(""),
});

// 5. Durable approval decision (matches the Approval component's output shape).
const approvalSchema = z.object({
  approved: z.boolean(),
  note: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
});

// 6. Human escalation decision when the verification loop did not converge.
const escalationSchema = z.looseObject({
  decision: z.string().describe("deep-fix | cut-scope | abort"),
  notes: z.string().default(""),
});

// 7. Final per-stage report emitted at the end of the run.
const reportSchema = z.looseObject({
  summary: z.string(),
  perStage: z
    .array(z.looseObject({ stage: z.string(), summary: z.string() }))
    .default([]),
  deferred: z.array(z.string()).default([]),
  status: z.enum(["green", "yellow", "red"]).default("green"),
});

const { Workflow, Task, Sequence, Branch, Ralph, Approval, smithers, outputs } =
  createSmithers({
    input: inputSchema,
    discovery: discoverySchema,
    unitDiff: unitDiffSchema,
    checkResult: checkResultSchema,
    verification: verificationSchema,
    approval: approvalSchema,
    escalation: escalationSchema,
    report: reportSchema,
  });

const VERIFICATION_CHECKS: Array<{ name: string; cmd: string }> = [
  { name: "check_skill_structure", cmd: "uv run scripts/check_skill_structure.py" },
  { name: "check_schemas", cmd: "uv run scripts/check_schemas.py" },
  { name: "check_validator_robustness", cmd: "uv run scripts/check_validator_robustness.py" },
  { name: "check_eval_cases", cmd: "uv run scripts/check_eval_cases.py" },
  {
    name: "smoke_eval_dry_run_replay",
    cmd: "uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay",
  },
  {
    name: "smithers_graph",
    cmd: "bunx smithers-orchestrator graph .smithers/workflows/skills-repo-stabilization.tsx",
  },
];

export default smithers((ctx) => {
  const dryRun = ctx.input.dry_run;

  const discovery = ctx.outputMaybe("discovery", { nodeId: "discovery" });
  const protectedGate = ctx.outputMaybe("approval", { nodeId: "gate_protected_paths" });
  const u6Gate = ctx.outputMaybe("approval", { nodeId: "gate_u6_commit" });
  const u3 = ctx.outputMaybe("unitDiff", { nodeId: "u3_workbench_hardening" });
  const u4 = ctx.outputMaybe("unitDiff", { nodeId: "u4_beads_docs" });

  // Ralph bookkeeping: re-render `until` against the latest entry in the table.
  const verificationOutputs = ctx.outputs.verification ?? [];
  const lastVerification = verificationOutputs.at(-1);
  const verificationPassed = lastVerification?.passed === true;
  const verificationFailed = lastVerification !== undefined && lastVerification.passed === false;

  const checkOutputs = ctx.outputs.checkResult ?? [];
  const lastCheck = checkOutputs.at(-1);
  const u5Passed = lastCheck?.passed === true;

  const needsProtectedGate =
    discovery !== undefined &&
    !dryRun &&
    Boolean(
      discovery.touchesProtected ||
        discovery.touchesBeads ||
        discovery.touchesRootSmithers ||
        discovery.touchesExperimentsSmithersPool,
    );
  const protectedApproved = !needsProtectedGate || protectedGate?.approved === true;

  return (
    <Workflow name="skills-repo-stabilization">
      <Sequence>
        {/* 1 — Discover scope and the concrete files each unit will touch. */}
        <Task
          id="discovery"
          output={outputs.discovery}
          agent={agents.smartTool}
          heartbeatTimeoutMs={600_000}
        >
          <DiscoveryPrompt
            planPath={ctx.input.plan_path}
            notes={ctx.input.notes}
            dryRun={dryRun}
          />
        </Task>

        {/* 2 — Branch on dry_run. Real edits go through an optional protected-path
            approval, then U3, U4, and the U5 author/check Ralph loop. */}
        {discovery ? (
          <Branch
            if={!dryRun}
            then={
              <Sequence>
                {needsProtectedGate ? (
                  <Approval
                    id="gate_protected_paths"
                    output={outputs.approval}
                    request={{
                      title: "Approve write to protected path(s)",
                      summary:
                        "Discovery flagged a planned write under .beads/, root Smithers config, or experiments/smithers-pool. Default is to skip — approve only if the touch is intentional.",
                    }}
                    onDeny="continue"
                  />
                ) : null}

                {protectedApproved ? (
                  <Sequence>
                    <Task
                      id="u3_workbench_hardening"
                      output={outputs.unitDiff}
                      agent={agents.smartTool}
                      heartbeatTimeoutMs={900_000}
                    >
                      <U3WorkbenchHardeningPrompt discovery={discovery} dryRun={dryRun} />
                    </Task>
                    <Task
                      id="u4_beads_docs"
                      output={outputs.unitDiff}
                      agent={agents.smartTool}
                      heartbeatTimeoutMs={900_000}
                    >
                      <U4BeadsDocsPrompt discovery={discovery} dryRun={dryRun} />
                    </Task>
                    <Ralph
                      id="u5_loop"
                      until={u5Passed}
                      maxIterations={4}
                      onMaxReached="return-last"
                    >
                      <Sequence>
                        <Task
                          id="u5_eval_cases"
                          output={outputs.unitDiff}
                          agent={agents.smartTool}
                          heartbeatTimeoutMs={900_000}
                        >
                          <U5EvalCasesPrompt
                            discovery={discovery}
                            previousCheck={lastCheck ?? null}
                            iteration={checkOutputs.length}
                          />
                        </Task>
                        <Task id="u5_check_eval_cases" output={outputs.checkResult}>
                          {async () => {
                            const res = await $`uv run scripts/check_eval_cases.py`
                              .nothrow()
                              .quiet();
                            return {
                              passed: res.exitCode === 0,
                              stdout: (res.stdout?.toString() ?? "").slice(-8000),
                              stderr: (res.stderr?.toString() ?? "").slice(-4000),
                              exitCode: res.exitCode ?? -1,
                            };
                          }}
                        </Task>
                      </Sequence>
                    </Ralph>
                  </Sequence>
                ) : null}
              </Sequence>
            }
            else={
              <Task
                id="u3_u4_u5_dryrun_noop"
                output={outputs.unitDiff}
                agent={agents.cheapFast}
              >
                <DryRunNoopPrompt discovery={discovery} />
              </Task>
            }
          />
        ) : null}

        {/* 3 — Verification Ralph: run the full battery, triage failures, repeat. */}
        {discovery ? (
          <Ralph
            id="verification_gate"
            until={verificationPassed}
            maxIterations={3}
            onMaxReached="return-last"
          >
            <Sequence>
              <Task id="verification_run" output={outputs.verification}>
                {async () => {
                  const checks: Array<{ name: string; passed: boolean; detail: string }> = [];
                  const failing: string[] = [];
                  const stdoutChunks: string[] = [];
                  const stderrChunks: string[] = [];
                  for (const check of VERIFICATION_CHECKS) {
                    const res = await $`sh -c ${check.cmd}`.nothrow().quiet();
                    const passed = res.exitCode === 0;
                    const stdout = res.stdout?.toString() ?? "";
                    const stderr = res.stderr?.toString() ?? "";
                    stdoutChunks.push(`# ${check.name}\n${stdout}`.slice(-4000));
                    stderrChunks.push(`# ${check.name}\n${stderr}`.slice(-2000));
                    checks.push({
                      name: check.name,
                      passed,
                      detail: passed
                        ? "ok"
                        : (stderr || stdout).split("\n").slice(-8).join("\n").slice(-1200),
                    });
                    if (!passed) failing.push(check.name);
                  }
                  return {
                    passed: failing.length === 0,
                    checks,
                    failingChecks: failing,
                    stdout: stdoutChunks.join("\n\n").slice(-10_000),
                    stderr: stderrChunks.join("\n\n").slice(-5_000),
                  };
                }}
              </Task>
              <Branch
                if={verificationFailed && !dryRun}
                then={
                  <Task
                    id="verification_triage"
                    output={outputs.unitDiff}
                    agent={agents.smartTool}
                    heartbeatTimeoutMs={900_000}
                  >
                    <VerificationTriagePrompt
                      verification={lastVerification}
                      discovery={discovery}
                    />
                  </Task>
                }
                else={null}
              />
            </Sequence>
          </Ralph>
        ) : null}

        {/* 4 — HumanTask escalation if the verification Ralph exited without convergence. */}
        {lastVerification !== undefined && !verificationPassed ? (
          <HumanTask
            id="verification_escalation"
            output={outputs.escalation}
            prompt={`Verification did not converge after ${verificationOutputs.length} iteration(s). Failing checks: ${
              (lastVerification.failingChecks ?? []).join(", ") || "(none recorded)"
            }. Choose deeper fix, scope cut, or abort and explain why.`}
          />
        ) : null}

        {/* 5 — U6 status doc refresh, gated on green verification and human approval. */}
        {verificationPassed && !dryRun ? (
          <Sequence>
            <Approval
              id="gate_u6_commit"
              output={outputs.approval}
              request={{
                title: "Approve U6 status doc edits",
                summary:
                  "Verification is green. Approve committing the U6 status doc edits that summarise U3-U5 outcomes.",
              }}
            />
            {u6Gate?.approved === true ? (
              <Task
                id="u6_status_docs"
                output={outputs.unitDiff}
                agent={agents.smartTool}
                heartbeatTimeoutMs={900_000}
              >
                <U6StatusDocsPrompt
                  discovery={discovery}
                  verification={lastVerification}
                  u3={u3}
                  u4={u4}
                />
              </Task>
            ) : null}
          </Sequence>
        ) : null}

        {/* 6 — Final report, summarising every stage and the overall verdict. */}
        <Task id="final_report" output={outputs.report} agent={agents.cheapFast}>
          <FinalReportPrompt
            discovery={discovery}
            u3={u3}
            u4={u4}
            verification={lastVerification ?? null}
            verificationPassed={verificationPassed}
            dryRun={dryRun}
          />
        </Task>
      </Sequence>
    </Workflow>
  );
});
