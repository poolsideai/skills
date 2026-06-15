const BEADS_BV_SOURCE = "/home/ben/.codex/skills/beads-bv";
const BEADS_WORKFLOW_SOURCE = "/home/ben/.codex/skills/beads-workflow";
const BEAD_SELECTOR_SOURCE = "skills/bead-selector";
const DEFAULT_CASE_COUNT = 4;
const MODE_COPY = {
  triage: {
    label: "Check skill readiness",
    help: "Use this when you want a low-risk readout first. It does not call a model or write skill files; it scans the folder, writes a report under runs/onboard/, and flags missing contracts or unclear outputs.",
    cta: "Start readiness check",
    pending: "started readiness check",
  },
  prepare: {
    label: "Build review bundle",
    help: "Use this when the readiness check found useful follow-up or you want draft eval scaffolding. The selected model drafts contracts, validators, and optional eval cases; everything stays quarantined under runs/onboard/ for review.",
    cta: "Build review bundle",
    pending: "started review bundle",
  },
};

export async function mount(container, ctx) {
  const { api, esc, fmtAgo, statusPill } = ctx.helpers;
  const state = {
    disposed: false,
    timer: null,
    runs: [],
    examples: [],
    models: ["openai/gpt-5.5"],
    notice: null,
  };

  container.addEventListener("click", onClick);
  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("submit", onSubmit);
  container.addEventListener("change", onChange);
  container.addEventListener("input", onInput);
  container.addEventListener("focusin", onFocusIn);
  container.addEventListener("focusout", onFocusOut);
  container.addEventListener("keydown", onKeyDown);

  renderLoading();
  await load();
  schedulePoll();
  return cleanup;

  async function load() {
    try {
      const [runsRes, modelsRes, examplesRes] = await Promise.allSettled([
        api("/api/onboard/runs"),
        api("/api/models"),
        api("/api/onboard/examples"),
      ]);
      if (state.disposed) return;
      if (runsRes.status === "fulfilled") state.runs = runsRes.value || [];
      else state.notice = { kind: "bad", text: runsRes.reason?.message || String(runsRes.reason) };
      if (modelsRes.status === "fulfilled" && modelsRes.value?.length) state.models = modelsRes.value;
      if (examplesRes.status === "fulfilled") state.examples = examplesRes.value || [];
      render();
    } catch (error) {
      state.notice = { kind: "bad", text: error.message || String(error) };
      render();
    }
  }

  function renderLoading() {
    container.innerHTML = `<section class="onboard-page"><div class="panel onboard-loading">Loading bootstrap runs...</div></section>`;
  }

  function render() {
    const running = state.runs.filter((r) => r.running).length;
    const prepared = state.runs.filter((r) => r.mode === "prepare").length;
    const triaged = state.runs.filter((r) => r.mode === "triage").length;
    const journeys = onboardJourneys(state.runs);
    const milestoneCount = journeys.reduce((sum, journey) => sum + (journey.milestones || journey.runs).length, 0);
    container.innerHTML = `<section class="onboard-page">
      <header class="onboard-head">
        <div>
          <span class="mono-label">BOOTSTRAP</span>
          <h1>Skill onboarding</h1>
          <p>Use this page to decide whether a skill is ready for the eval flywheel. Start with a check, then build a quarantined review bundle only when you want draft files to inspect.</p>
        </div>
        <button class="btn" type="button" data-action="refresh">Refresh</button>
      </header>
      ${renderNotice()}
      <section class="onboard-grid">
        <aside class="onboard-left">
          <div class="onboard-metrics">
            ${metric("ACTIVE", running)}
            ${metric("CHECKS", triaged)}
            ${metric("BUNDLES", prepared)}
          </div>
      ${renderStarter()}
      ${renderExamples()}
      ${renderCustomForm()}
        </aside>
        <main class="onboard-main panel">
          <div class="right-panel-head">
            <span class="mono-label">SKILL JOURNEYS</span>
            <span>${esc(String(journeys.length))} skills · ${esc(String(milestoneCount))} milestones · ${esc(String(state.runs.length))} runs</span>
          </div>
          ${journeys.length ? `<div class="onboard-journey-list">${journeys.map(renderJourney).join("")}</div>` : `<p class="muted">No bootstrap runs yet.</p>`}
        </main>
      </section>
    </section>`;
    const form = container.querySelector("form[data-action='start-onboard']");
    if (form) updateFormMode(form);
  }

  function metric(label, value) {
    return `<div class="onboard-metric"><span class="mono-label">${esc(label)}</span><strong>${esc(String(value))}</strong></div>`;
  }

  function renderStarter() {
    return `<section class="panel onboard-card">
      <div class="right-panel-head"><span class="mono-label">QUICK STARTS</span><span class="pill ok">Beads project</span></div>
      <p>Use these when you want the fastest path through the common Beads onboarding jobs.</p>
      <div class="onboard-guidance">
        <div><strong>Checks</strong><span>Answer: is this skill folder structured well enough to review?</span></div>
        <div><strong>Eval cases</strong><span>Reusable test scenarios that let future runs prove whether a skill behavior still works.</span></div>
      </div>
      <div class="onboard-actions">
        <button class="btn primary" type="button" data-action="triage-beads-workflow">
          <span>Check Beads workflow skill</span>
          <small>Readiness report only</small>
        </button>
        <button class="btn primary" type="button" data-action="triage-beads">
          <span>Check Beads priority graph skill</span>
          <small>Readiness report only</small>
        </button>
        <button class="btn pass-tint" type="button" data-action="prepare-bead-selector">
          <span>Create bead-selector eval cases</span>
          <small>Drafts stay in runs/onboard/</small>
        </button>
      </div>
    </section>`;
  }

  function renderExamples() {
    const packs = state.examples || [];
    const total = packs.reduce((sum, pack) => sum + (Array.isArray(pack.examples) ? pack.examples.length : 0), 0);
    return `<section class="panel onboard-card">
      <div class="right-panel-head"><span class="mono-label">PAST SESSIONS TO REUSE</span><span>${esc(String(total))} found</span></div>
      <p>History examples found from previous CASS sessions. They are not eval cases yet; they are candidate stories, failures, or wins that can be turned into repeatable tests.</p>
      <div class="onboard-guidance compact">
        <div><strong>Useful when</strong><span>You need realistic prompts and expected behavior without inventing toy cases.</span></div>
        <div><strong>Not useful when</strong><span>The skill already has enough current eval coverage or the mined session is only background chatter.</span></div>
      </div>
      ${packs.length ? packs.map(renderExamplePack).join("") : `<p class="muted">No reusable session examples found.</p>`}
    </section>`;
  }

  function renderExamplePack(pack) {
    const examples = Array.isArray(pack.examples) ? pack.examples : [];
    return `<div class="onboard-example-pack">
      <strong>${esc(pack.source_skill || "example-pack")}</strong>
      <small>${esc(pack.purpose || "")}</small>
      <ul>${examples.map((ex) => `<li><code>${esc(ex.id)}</code><span>${esc(exampleKind(ex.kind))}</span><span class="pill ${ex.quality === "strong" ? "ok" : ""}">${esc(exampleQuality(ex.quality))}</span></li>`).join("")}</ul>
    </div>`;
  }

  function renderCustomForm() {
    const modeOptions = Object.entries(MODE_COPY)
      .map(([value, copy]) => `<option value="${esc(value)}">${esc(copy.label)}</option>`)
      .join("");
    return `<section class="panel onboard-card">
      <div class="right-panel-head">
        <span class="mono-label">RUN MANUALLY</span>
        <details class="onboard-help">
          <summary aria-label="Explain manual runs">?</summary>
          <p>Use this when the quick starts are not the skill you want. Runs write reports and drafts under <code>runs/onboard/</code>; a human still reviews anything generated.</p>
        </details>
      </div>
      <form class="onboard-form" data-action="start-onboard">
        ${field("Run type", `<select name="mode">${modeOptions}</select>`, "Check only inspects the folder. Build review bundle uses a model to draft reviewable files.")}
        ${field("Skill folder", `<input name="source" required value="${esc(BEADS_BV_SOURCE)}" autocomplete="off">`, "Path to one skill folder, or a folder that contains multiple skill folders.")}
        <div class="prepare-only">
          ${field("Skill name", `<input name="skill" placeholder="Required only if the folder has multiple skills" autocomplete="off">`, "Used to name the review bundle and select one skill from a multi-skill folder.")}
          ${modelField()}
          ${field("Number of eval cases", `<input name="nCases" type="number" min="1" max="20" value="${esc(String(DEFAULT_CASE_COUNT))}">`, "Recommended: 4 for a first pass, 6-8 for a skill with several distinct workflows. Each case is one reusable test scenario.")}
        </div>
        <div class="onboard-checks">
          <label class="prepare-only"><input type="checkbox" name="importSource"> <span>Import external source</span><small>Copy the source into this run as a baseline and generate a local candidate.</small></label>
          <label class="prepare-only"><input type="checkbox" name="smoke"> <span>Quick check only</span><small>No model call; copy an existing contract shape and run gates.</small></label>
          <label class="prepare-only"><input type="checkbox" name="skipCases"> <span>Do not generate eval cases</span><small>Build only the contract, schema, and validator draft.</small></label>
        </div>
        <div class="onboard-guidance mode-note" data-role="mode-guidance"></div>
        <p class="onboard-mode-explainer" data-role="mode-help">${esc(MODE_COPY.triage.help)}</p>
        <p class="onboard-run-preview" data-role="run-preview"></p>
        <button class="btn suggest" type="submit" data-role="submit-label">${esc(MODE_COPY.triage.cta)}</button>
      </form>
    </section>`;
  }

  function onboardJourneys(runs) {
    const groups = new Map();
    for (const run of runs || []) {
      const key = runSkillName(run);
      const current = groups.get(key) || { key, skill: key, runs: [], startedAtMs: 0 };
      current.runs.push(run);
      current.startedAtMs = Math.max(current.startedAtMs, Number(run.startedAtMs || 0));
      groups.set(key, current);
    }
    return [...groups.values()]
      .map((journey) => {
        journey.runs = journey.runs.sort((a, b) => Number(a.startedAtMs || 0) - Number(b.startedAtMs || 0));
        journey.milestones = compactJourneyRuns(journey.runs);
        journey.latest = journey.runs[journey.runs.length - 1] || null;
        journey.current = [...journey.runs].reverse().find((run) => nextStep(run, run.result && typeof run.result === "object" ? run.result : null)) || journey.latest;
        return journey;
      })
      .sort((a, b) => Number(b.startedAtMs || 0) - Number(a.startedAtMs || 0));
  }

  function compactJourneyRuns(runs) {
    const milestones = [];
    for (const run of runs) {
      const key = duplicateRunKey(run);
      const latest = milestones[milestones.length - 1];
      if (latest?.key === key) {
        latest.runs.push(run);
        latest.run = run;
        continue;
      }
      milestones.push({ key, run, runs: [run] });
    }
    return milestones;
  }

  function renderJourney(journey, index) {
    const latest = journey.latest;
    const current = journey.current || latest;
    const currentResult = current?.result && typeof current.result === "object" ? current.result : null;
    const step = current ? nextStep(current, currentResult) : null;
    const open = index === 0 || journey.runs.some((run) => run.running);
    const summary = journeySummary(journey, step);
    const milestones = journey.milestones || journey.runs.map((run) => ({ run, runs: [run] }));
    const condensed = journey.runs.length - milestones.length;
    return `<details class="onboard-journey" ${open ? "open" : ""}>
      <summary>
        <div class="onboard-journey-title">
          <span class="mono-label">SKILL</span>
          <strong>${esc(journey.skill)}</strong>
          <span>${esc(String(milestones.length))} ${milestones.length === 1 ? "milestone" : "milestones"} from ${esc(String(journey.runs.length))} ${journey.runs.length === 1 ? "run" : "runs"}</span>
          ${condensed ? `<span class="onboard-condensed-count">${esc(String(condensed))} similar hidden</span>` : ""}
        </div>
        <div class="onboard-journey-state">
          ${statusPill(journeyStatus(journey))}
          <span>${esc(fmtAgo(latest?.startedAtMs))}</span>
        </div>
      </summary>
      <div class="onboard-journey-body">
        <section class="onboard-golden-path ${esc(step?.tone || "")}">
          <span class="mono-label">CURRENT PATH</span>
          <strong>${esc(summary.title)}</strong>
          <span>${esc(summary.detail)}</span>
          ${renderStepPath(step)}
          ${renderStepAction(step, current)}
        </section>
        <div class="onboard-timeline">
          ${milestones.map((milestone, runIndex) => renderTimelineRun(milestone, runIndex, milestones.length)).join("")}
        </div>
      </div>
    </details>`;
  }

  function renderTimelineRun(milestone, index, total) {
    const run = milestone.run;
    const siblings = milestone.runs || [run];
    const result = run.result && typeof run.result === "object" ? run.result : null;
    const status = run.running ? "running" : result ? (result.ok === false ? "failed" : "finished") : "pending";
    const attempt = attemptLabel(run);
    const duplicateCount = siblings.length - 1;
    return `<div class="onboard-timeline-row">
      <div class="onboard-timeline-marker">
        <span>${esc(String(index + 1))}</span>
        ${index + 1 < total ? "<i></i>" : ""}
      </div>
      <div class="onboard-timeline-card">
        <div class="onboard-timeline-head">
          <div>${statusPill(status)}<strong>${esc(modeLabel(run.mode))}</strong><span>${esc(milestoneTimeLabel(siblings))}</span>${duplicateCount ? `<span class="onboard-condensed-count">${esc(String(duplicateCount))} similar</span>` : ""}</div>
          <code>${esc(attempt)}</code>
        </div>
        ${renderRunRelation(run)}
        <p class="onboard-run-summary">${esc(runSummary(run, result))}</p>
        ${duplicateCount ? renderDuplicateRuns(siblings) : ""}
        ${renderRunReviewArtifacts(run, result)}
        ${renderNextStep(run, result)}
        <details class="onboard-run-files">
          <summary>Run files</summary>
          <div class="onboard-run-meta">
            <span>Source: ${pathLink(run.source, run.source || "unknown")}</span>
            <span>Output: ${pathLink(run.outDir)}</span>
            ${run.parentOutDir ? `<span>Related: ${pathLink(run.parentOutDir)}</span>` : ""}
            ${run.logPath ? `<span>Log: ${pathLink(run.logPath)}</span>` : ""}
            ${runFileLinks(run, result)}
          </div>
        </details>
        ${renderRunErrorDetails(result)}
      </div>
    </div>`;
  }

  function renderDuplicateRuns(runs) {
    return `<details class="onboard-duplicates">
      <summary>${esc(String(runs.length))} attempts with the same outcome</summary>
      <div>
        ${runs.map((run) => {
          const result = run.result && typeof run.result === "object" ? run.result : null;
          const status = run.running ? "running" : result ? (result.ok === false ? "failed" : "finished") : "pending";
          return `<div class="onboard-duplicate-row">
            ${statusPill(status)}
            <span>${esc(modeLabel(run.mode))}</span>
            <span>${esc(fmtAgo(run.startedAtMs))}</span>
            ${pathLink(run.outDir, attemptLabel(run))}
          </div>`;
        }).join("")}
      </div>
    </details>`;
  }

  function runSkillName(run) {
    const result = run.result && typeof run.result === "object" ? run.result : null;
    const firstSkill = Array.isArray(result?.skills) ? result.skills[0] : null;
    return run.skill || firstSkill?.name || skillNameFromPath(run.source) || skillNameFromPath(run.outDir) || "unknown-skill";
  }

  function journeyStatus(journey) {
    if (journey.runs.some((run) => run.running)) return "running";
    const latest = journey.latest;
    const result = latest?.result && typeof latest.result === "object" ? latest.result : null;
    if (!result) return "pending";
    return result.ok === false ? "failed" : "finished";
  }

  function journeySummary(journey, step) {
    if (step) return { title: step.title, detail: step.detail };
    const latest = journey.latest;
    if (!latest) {
      return {
        title: "No runs yet",
        detail: "Start with a readiness check or build a review bundle.",
      };
    }
    return {
      title: "No automatic next step",
      detail: "The latest run has no recommended action. Open its report files below to decide whether to promote, rerun, or leave it archived.",
    };
  }

  function renderStepPath(step) {
    if (!step?.path) return "";
    return `<div class="onboard-step-files">${pathLink(step.path)}</div>`;
  }

  function renderStepAction(step, run) {
    if (!step?.action || !run) return "";
    return `<button class="btn" type="button" data-action="${esc(step.action)}" data-source="${esc(step.source || run.source || "")}" data-skill="${esc(step.skill || run.skill || skillNameFromPath(run.source) || "")}" data-run-dir="${esc(step.runDir || run.outDir || "")}" data-parent-run-dir="${esc(run.outDir || "")}">${esc(step.actionLabel || "Run next step")}</button>`;
  }

  function renderRunReviewArtifacts(run, result) {
    const queue = Array.isArray(result?.review_queue) ? result.review_queue : [];
    if (!queue.length) return "";
    return `<div class="onboard-review-artifacts">
      <span class="mono-label">REVIEW THESE</span>
      <div>${queue.map((path) => pathLink(path)).join("")}</div>
    </div>`;
  }

  function runFileLinks(run, result) {
    const links = [];
    if (run.outDir) {
      if (run.mode === "review" || result?.schema_version === "onboard-agent-review.v1") {
        links.push(pathLink(`${run.outDir}/agent-review.json`, "agent-review.json"));
      } else {
        links.push(pathLink(`${run.outDir}/report.json`, "report.json"));
      }
      if (run.mode === "prepare") {
        links.push(pathLink(`${run.outDir}/triage.json`, "triage.json"));
      }
      links.push(`${pathLink(run.outDir, "run directory")}`);
    }
    const queue = Array.isArray(result?.review_queue) ? result.review_queue : [];
    links.push(...queue.map((path, index) => pathLink(path, `review item ${index + 1}`)));
    return links.length ? `<span>Files: ${links.join(" ")}</span>` : "";
  }

  function attemptLabel(run) {
    const parts = String(run.outDir || "").split("/").filter(Boolean);
    return parts.slice(-1)[0] || run.tag || run.mode || "run";
  }

  function milestoneTimeLabel(runs) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (!first || first === last) return fmtAgo(last?.startedAtMs);
    const firstLabel = fmtAgo(first.startedAtMs);
    const lastLabel = fmtAgo(last.startedAtMs);
    if (firstLabel === lastLabel) return lastLabel;
    return `${firstLabel} - ${lastLabel}`;
  }

  function duplicateRunKey(run) {
    const result = run.result && typeof run.result === "object" ? run.result : null;
    const step = nextStep(run, result);
    const status = run.running ? "running" : result ? (result.ok === false ? "failed" : "finished") : "pending";
    const skillVerdicts = Array.isArray(result?.skills)
      ? result.skills.map((skill) => `${skill.name || ""}:${skill.verdict || ""}`).join("|")
      : "";
    const reviewQueueShape = Array.isArray(result?.review_queue)
      ? result.review_queue.map(reviewQueueKind).join("|")
      : "";
    return [
      run.mode || "",
      status,
      result?.schema_version || "",
      result?.verdict || "",
      run.relationKind || "",
      normalizeDuplicateText(runSummary(run, result)),
      step?.title || "",
      step?.action || "",
      step?.tone || "",
      skillVerdicts,
      reviewQueueShape,
      result?.gates?.ok === false ? "gates-failed" : "",
      Array.isArray(result?.payload_errors) && result.payload_errors.length ? "payload-errors" : "",
    ].join("::");
  }

  function reviewQueueKind(path) {
    const value = String(path || "");
    if (value.includes("/cases/candidates/")) return "candidate-case";
    if (value.includes("/skill/")) return "candidate-skill";
    return value.split("/").filter(Boolean).slice(-2, -1)[0] || "review-item";
  }

  function normalizeDuplicateText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function repoRelativePath(path) {
    const value = String(path || "");
    const prefix = "/data/projects/poolside/skills/";
    return value.startsWith(prefix) ? value.slice(prefix.length) : value;
  }

  function pathLink(path, label = path) {
    const rel = repoRelativePath(path);
    if (!rel || rel === "unknown") return `<code>${esc(label || "unknown")}</code>`;
    const allowed = rel.startsWith("runs/onboard/") || rel.startsWith("skills/");
    if (!allowed) return `<code>${esc(label || rel)}</code>`;
    return `<a class="onboard-file-link" href="/api/onboard/file?path=${encodeURIComponent(rel)}" target="_blank" rel="noopener">${esc(label || rel)}</a>`;
  }

  function renderRunRelation(run) {
    if (!run.relationLabel) return "";
    const label = run.relationKind === "repair-from" ? "REPAIR LOOP" : "RELATED RUN";
    return `<div class="onboard-run-relation">
      <span class="mono-label">${esc(label)}</span>
      <strong>${esc(run.relationLabel)}</strong>
      ${run.parentOutDir ? pathLink(run.parentOutDir) : ""}
    </div>`;
  }

  function renderNextStep(run, result) {
    const step = nextStep(run, result);
    if (!step) return "";
    const child = childRunForStep(run, step);
    if (child) return renderChildRunStatus(step, child);
    return `<div class="onboard-next-step ${esc(step.tone || "")}">
      <span class="mono-label">NEXT STEP</span>
      <strong>${esc(step.title)}</strong>
      <span>${esc(step.detail)}</span>
      ${renderStepPath(step)}
      ${renderStepAction(step, run)}
    </div>`;
  }

  function renderChildRunStatus(step, child) {
    const result = child.result && typeof child.result === "object" ? child.result : null;
    const running = Boolean(child.running);
    const failed = !running && result?.ok === false;
    const tone = running ? "" : failed ? "bad" : "ok";
    const label = running ? "RUNNING" : failed ? "FINISHED WITH ISSUE" : "FINISHED";
    return `<div class="onboard-next-step ${esc(tone)}">
      <span class="mono-label">${label}</span>
      <strong>${esc(childRunTitle(step, child, result))}</strong>
      <span>${esc(childRunDetail(child, result))}</span>
      <div class="onboard-step-files">
        ${pathLink(child.outDir, "output")}
        ${child.logPath ? pathLink(child.logPath, "log") : ""}
        ${child.mode === "review" ? pathLink(`${child.outDir}/agent-review.json`, "agent-review.json") : ""}
        ${child.mode !== "review" && !running ? pathLink(`${child.outDir}/report.json`, "report.json") : ""}
      </div>
    </div>`;
  }

  function childRunForStep(run, step) {
    if (!step?.action) return null;
    const parent = step.runDir || run.outDir;
    const candidates = (state.runs || []).filter((candidate) => isChildRunForStep(candidate, run, step, parent));
    return candidates.sort((a, b) => Number(b.startedAtMs || 0) - Number(a.startedAtMs || 0))[0] || null;
  }

  function isChildRunForStep(candidate, run, step, parent) {
    if (!candidate || candidate === run || Number(candidate.startedAtMs || 0) <= Number(run.startedAtMs || 0)) return false;
    if (candidate.parentOutDir && parent && candidate.parentOutDir === parent) return true;
    if (step.action === "agent-review-from-run") {
      return candidate.mode === "review" && candidate.outDir === parent;
    }
    if (step.action === "repair-from-review") {
      return candidate.mode === "prepare" && candidate.parentOutDir === parent;
    }
    if (step.action === "prepare-from-run" || step.action === "prepare-import-from-run") {
      const sameSkill = runSkillName(candidate) === (step.skill || runSkillName(run));
      const sameSource = repoRelativePath(candidate.source) === repoRelativePath(step.source || run.source);
      const unlinkedPrepare = candidate.mode === "prepare" && !candidate.parentOutDir;
      return unlinkedPrepare && sameSkill && sameSource;
    }
    return false;
  }

  function childRunTitle(step, child, result) {
    if (child.running) return `${modeLabel(child.mode)} running`;
    if (child.mode === "review" && result?.verdict) return `Agent review ${result.verdict}`;
    if (child.mode === "prepare") return "Review bundle finished";
    return `${step.actionLabel || modeLabel(child.mode)} finished`;
  }

  function childRunDetail(child, result) {
    if (child.running) return `Started ${fmtAgo(child.startedAtMs)}. This row will update when the run writes its report.`;
    return runSummary(child, result);
  }

  function nextStep(run, result) {
    if (run.running) {
      return {
        title: "Wait for the report",
        detail: "The run is still active. This card will switch to a review, fix, or contract step when the process writes its result.",
      };
    }
    if (!result) {
      return {
        tone: "warn",
        title: "Open the log",
        detail: "The process is no longer active and did not write a report. Use the log file below to decide whether to rerun or fix the source skill first.",
      };
    }
    const firstSkill = Array.isArray(result.skills) ? result.skills[0] : null;
    const sourcePath = run.source || firstSkill?.path || "";
    const skillMd = sourcePath ? `${sourcePath.replace(/\/+$/, "")}/SKILL.md` : "";
    const stderr = String(result.stderr_text || result.reminder || "");
    const isAdviceOnly = stderr.includes("advice-only skills need") || firstSkill?.verdict === "advice-only";
    if (isAdviceOnly) {
      return {
        tone: "warn",
        title: "Create a local candidate",
        detail: "Copy the upstream skill into this onboarding run as a read-only baseline, then ask the selected model to generate a project-owned executable candidate.",
        path: skillMd,
        action: "prepare-import-from-run",
        actionLabel: "Create local candidate",
        source: sourcePath,
        skill: firstSkill?.name || run.skill || skillNameFromPath(sourcePath),
      };
    }
    if (firstSkill?.verdict === "ready") {
      return {
        tone: "ok",
        title: "Build the review bundle",
        detail: "This skill is structured enough for model-authored draft files. Pick or accept the default model and generate the quarantined bundle.",
        action: "prepare-from-run",
        actionLabel: "Build review bundle",
        source: sourcePath,
        skill: firstSkill.name || run.skill || skillNameFromPath(sourcePath),
      };
    }
    if (firstSkill?.verdict === "needs-contract") {
      return {
        tone: "warn",
        title: "Fix the blocking contract gaps",
        detail: "Use the readiness recommendations above to make the skill gradeable, then rerun the readiness check before generating a bundle.",
        path: skillMd,
      };
    }
    if (Array.isArray(result.payload_errors) && result.payload_errors.length) {
      return {
        tone: "bad",
        title: "Repair the generated payload",
        detail: "The bundle was generated but failed validation. Open the report files, fix the named payload issue, then rerun Build review bundle.",
      };
    }
    if (result.gates?.ok === false) {
      return {
        tone: "bad",
        title: "Fix the gate blockers",
        detail: "The draft bundle exists, but validator gates failed. Open the report files, fix the blockers, then rerun the bundle check.",
      };
    }
    if (Array.isArray(result.review_queue) && result.review_queue.length) {
      return {
        tone: "ok",
        title: "Ask the agent to judge it",
        detail: "The bundle is ready for an agent review. The agent will inspect the generated candidate and report approve, changes requested, or blocked.",
        path: result.review_queue[0],
        action: "agent-review-from-run",
        actionLabel: "Run agent judge",
        runDir: run.outDir,
      };
    }
    if (result.schema_version === "onboard-agent-review.v1") {
      if (result.verdict === "changes_requested") {
        return {
          tone: "warn",
          title: "Ask the agent to repair it",
          detail: result.promotion_recommendation || "The judge found issues. Start a repair pass that feeds this review back into the drafting prompt and writes a fresh quarantined candidate.",
          path: `${run.outDir}/agent-review.json`,
          action: "repair-from-review",
          actionLabel: "Repair with agent",
          runDir: run.outDir,
          source: run.source,
          skill: run.skill,
        };
      }
      return {
        tone: result.verdict === "approve" ? "ok" : result.verdict === "blocked" ? "bad" : "warn",
        title: result.verdict === "approve" ? "Agent approved candidate" : "Resolve review blocker",
        detail: result.promotion_recommendation || "Use the agent review report to decide whether to promote, repair, or rerun the bundle.",
        path: `${run.outDir}/agent-review.json`,
      };
    }
    if (run.mode === "review" && result.ok === false) {
      return {
        tone: "bad",
        title: "Retry agent judge",
        detail: failureAdvice(result),
        action: "agent-review-from-run",
        actionLabel: "Retry agent judge",
        runDir: run.outDir,
      };
    }
    if (result.counts) {
      return {
        title: "Choose the next run",
        detail: "Ready skills can move to Build review bundle. Advisory external skills should be imported into a local candidate before model drafting.",
      };
    }
    if (result.ok === false) {
      return {
        tone: "bad",
        title: "Read the failure and create a local candidate",
        detail: "This run stopped before producing reviewable files. Use the message below, then import the source into a local candidate instead of editing upstream.",
      };
    }
    return null;
  }

  function renderNotice() {
    if (!state.notice) return "";
    return `<div class="skill-notice ${state.notice.kind || ""}"><button class="btn" type="button" data-action="dismiss-notice">Dismiss</button>${esc(state.notice.text)}</div>`;
  }

  async function onClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (startsOnboardProcess(action)) markButtonStarting(button);
    if (action === "refresh") await load();
    if (action === "dismiss-notice") {
      state.notice = null;
      render();
    }
    if (action === "pick-model") {
      selectModelButton(button);
    }
    if (action === "triage-beads-workflow") await start({ mode: "triage", source: BEADS_WORKFLOW_SOURCE });
    if (action === "triage-beads") await start({ mode: "triage", source: BEADS_BV_SOURCE });
    if (action === "prepare-bead-selector") await start({ mode: "prepare", source: BEAD_SELECTOR_SOURCE, skill: "bead-selector", model: defaultModel(), nCases: DEFAULT_CASE_COUNT });
    if (action === "prepare-from-run") {
      await start({
        mode: "prepare",
        source: button.dataset.source || "",
        skill: button.dataset.skill || undefined,
        model: defaultModel(),
        nCases: DEFAULT_CASE_COUNT,
        parentRunDir: button.dataset.parentRunDir || undefined,
      });
    }
    if (action === "prepare-import-from-run") {
      await start({
        mode: "prepare",
        source: button.dataset.source || "",
        skill: button.dataset.skill || undefined,
        model: defaultModel(),
        nCases: DEFAULT_CASE_COUNT,
        importSource: true,
        parentRunDir: button.dataset.parentRunDir || undefined,
      });
    }
    if (action === "agent-review-from-run") {
      await startReview({
        runDir: button.dataset.runDir || "",
        model: reviewDefaultModel(),
      });
    }
    if (action === "repair-from-review") {
      await start({
        mode: "prepare",
        source: button.dataset.source || "",
        skill: button.dataset.skill || undefined,
        model: defaultModel(),
        nCases: DEFAULT_CASE_COUNT,
        importSource: true,
        reviewDir: button.dataset.runDir || "",
      });
    }
  }

  function startsOnboardProcess(action) {
    return new Set([
      "triage-beads-workflow",
      "triage-beads",
      "prepare-bead-selector",
      "prepare-from-run",
      "prepare-import-from-run",
      "agent-review-from-run",
      "repair-from-review",
    ]).has(action);
  }

  function markButtonStarting(button) {
    button.disabled = true;
    button.dataset.originalLabel = button.textContent || "";
    button.textContent = "Starting...";
  }

  function onPointerDown(event) {
    const button = event.target.closest("button[data-action='pick-model']");
    if (!button) return;
    event.preventDefault();
    selectModelButton(button);
  }

  function selectModelButton(button) {
    const form = button.closest("form[data-action='start-onboard']");
    const input = form?.querySelector("input[name='model']");
    if (!form || !input) return;
    input.value = button.dataset.model || "";
    updateModelPicker(form, false);
    updateRunPreview(form);
    input.focus();
  }

  function onChange(event) {
    const form = event.target.closest("form[data-action='start-onboard']");
    if (!form) return;
    updateFormMode(form);
  }

  function onInput(event) {
    const form = event.target.closest("form[data-action='start-onboard']");
    if (!form) return;
    if (event.target.matches("input[name='model']")) updateModelPicker(form, true);
    updateRunPreview(form);
  }

  function onFocusIn(event) {
    const form = event.target.closest("form[data-action='start-onboard']");
    if (!form) return;
    if (event.target.matches("input[name='model']")) updateModelPicker(form, true);
  }

  function onFocusOut(event) {
    const picker = event.target.closest(".onboard-model-picker");
    if (!picker) return;
    setTimeout(() => {
      if (picker.contains(document.activeElement)) return;
      const form = picker.closest("form[data-action='start-onboard']");
      if (form) updateModelPicker(form, false);
    }, 120);
  }

  function onKeyDown(event) {
    const input = event.target.matches("input[name='model']") ? event.target : null;
    if (!input) return;
    const form = input.closest("form[data-action='start-onboard']");
    const list = form?.querySelector("[data-role='model-options']");
    if (!form || !list) return;
    const visible = visibleModelOptions(list);
    const active = list.querySelector(".active");
    const activeIndex = active ? visible.indexOf(active) : -1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveModelOption(list, visible[Math.min(activeIndex + 1, visible.length - 1)] || visible[0]);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveModelOption(list, visible[Math.max(activeIndex - 1, 0)] || visible[0]);
    } else if (event.key === "Enter" && active) {
      event.preventDefault();
      input.value = active.dataset.model || "";
      updateModelPicker(form, false);
      updateRunPreview(form);
    } else if (event.key === "Escape") {
      updateModelPicker(form, false);
    }
  }

  async function onSubmit(event) {
    const form = event.target.closest("form[data-action='start-onboard']");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    await start({
      mode: String(data.get("mode") || "triage"),
      source: String(data.get("source") || ""),
      skill: String(data.get("skill") || "") || undefined,
      model: String(data.get("model") || "").trim() || undefined,
      nCases: Number(data.get("nCases") || DEFAULT_CASE_COUNT),
      smoke: data.get("smoke") === "on",
      skipCases: data.get("skipCases") === "on",
      importSource: data.get("importSource") === "on",
    });
    form.reset();
    updateFormMode(form);
  }

  async function start(body) {
    try {
      const result = await api("/api/onboard/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const copy = MODE_COPY[body.mode] || MODE_COPY.triage;
      state.notice = { kind: "ok", text: `${copy.pending}: ${result.outDir}` };
      state.runs = [{ ...result, running: true }, ...state.runs];
      render();
      schedulePoll();
    } catch (error) {
      state.notice = { kind: "bad", text: error.message || String(error) };
      render();
    }
  }

  async function startReview(body) {
    try {
      const result = await api("/api/onboard/review/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      state.notice = { kind: "ok", text: `started agent review: ${result.outDir}` };
      state.runs = [{ ...result, running: true }, ...state.runs];
      render();
      schedulePoll();
    } catch (error) {
      state.notice = { kind: "bad", text: error.message || String(error) };
      render();
    }
  }

  function schedulePoll() {
    clearTimeout(state.timer);
    if (!state.runs.some((r) => r.running)) return;
    state.timer = setTimeout(async () => {
      if (state.disposed) return;
      await load();
      schedulePoll();
    }, 2500);
  }

  function cleanup() {
    state.disposed = true;
    clearTimeout(state.timer);
    container.removeEventListener("click", onClick);
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("submit", onSubmit);
    container.removeEventListener("change", onChange);
    container.removeEventListener("input", onInput);
    container.removeEventListener("focusin", onFocusIn);
    container.removeEventListener("focusout", onFocusOut);
    container.removeEventListener("keydown", onKeyDown);
  }

  function field(label, control, help) {
    return `<label><span>${esc(label)}</span>${control}<small>${esc(help)}</small></label>`;
  }

  function modelField() {
    return `<div class="onboard-field">
      <span>Agent model</span>
      ${renderModelPicker()}
      <small>Start typing to search the full registry. This model only drafts quarantined review files; it does not promote anything.</small>
    </div>`;
  }

  function renderModelPicker() {
    return `<div class="onboard-model-picker">
      <input name="model" value="${esc(defaultModel())}" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="onboard-model-options">
      <div class="onboard-model-options" id="onboard-model-options" data-role="model-options" role="listbox" hidden>
        ${renderModelOptions()}
      </div>
    </div>`;
  }

  function renderModelOptions() {
    const all = Array.from(new Set(state.models || []));
    const fallback = all.length ? all : ["openai/gpt-5.5"];
    return fallback.map((m) => `<button type="button" role="option" data-action="pick-model" data-model="${esc(m)}">${esc(m)}</button>`).join("");
  }

  function defaultModel() {
    const all = Array.from(new Set(state.models || []));
    const preferred = ["openai/gpt-5.5", "openai/gpt-5.4", "openai/gpt-5.3-codex", "openai/gpt-5.2-codex", "laguna-m.1-40k"];
    return preferred.find((model) => all.includes(model)) || all.find((model) => model.startsWith("openai/")) || all[0] || "openai/gpt-5.5";
  }

  function reviewDefaultModel() {
    return "openai/gpt-5.5";
  }

  function updateFormMode(form) {
    const mode = String(new FormData(form).get("mode") || "triage");
    const copy = MODE_COPY[mode] || MODE_COPY.triage;
    form.dataset.mode = mode;
    form.querySelector("[data-role='mode-help']").textContent = copy.help;
    form.querySelector("[data-role='submit-label']").textContent = copy.cta;
    form.querySelector("[data-role='mode-guidance']").innerHTML = modeGuidance(mode);
    form.querySelectorAll(".prepare-only input, .prepare-only select").forEach((input) => {
      input.disabled = mode !== "prepare";
    });
    updateModelPicker(form, false);
    updateRunPreview(form);
  }

  function updateModelPicker(form, open) {
    const input = form.querySelector("input[name='model']");
    const list = form.querySelector("[data-role='model-options']");
    if (!input || !list) return;
    const query = input.value.trim().toLowerCase();
    let shown = 0;
    list.querySelectorAll("button[data-model]").forEach((button) => {
      const match = !query || button.dataset.model.toLowerCase().includes(query);
      button.hidden = !match;
      if (match) shown += 1;
      button.classList.toggle("active", false);
      button.setAttribute("aria-selected", "false");
    });
    list.hidden = !open || shown === 0 || input.disabled;
    input.setAttribute("aria-expanded", list.hidden ? "false" : "true");
    if (!list.hidden) setActiveModelOption(list, visibleModelOptions(list)[0]);
  }

  function visibleModelOptions(list) {
    return Array.from(list.querySelectorAll("button[data-model]")).filter((button) => !button.hidden);
  }

  function setActiveModelOption(list, option) {
    list.querySelectorAll("button[data-model]").forEach((button) => {
      const active = button === option;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (option) option.scrollIntoView({ block: "nearest" });
  }

  function updateRunPreview(form) {
    const data = new FormData(form);
    const mode = String(data.get("mode") || "triage");
    const source = String(data.get("source") || "").trim() || "the selected skill folder";
    const preview = form.querySelector("[data-role='run-preview']");
    if (!preview) return;
    if (mode === "prepare") {
      const model = String(data.get("model") || "").trim() || "the selected model";
      const cases = Number(data.get("nCases") || DEFAULT_CASE_COUNT);
      const smoke = data.get("smoke") === "on" ? "on" : "off";
      const skipCases = data.get("skipCases") === "on" ? "on" : "off";
      const importSource = data.get("importSource") === "on" ? "on" : "off";
      const caseText = data.get("skipCases") === "on" ? "No eval cases will be drafted." : `${cases} eval ${cases === 1 ? "case" : "cases"} will be drafted; ${cases === DEFAULT_CASE_COUNT ? "4 is the recommended first-pass count" : "use 4 as the normal first-pass baseline"}.`;
      preview.textContent = `Will build a quarantined review bundle for ${source} with ${model}. ${caseText} Import external source: ${importSource}. Quick check only: ${smoke}. Skip case generation: ${skipCases}.`;
      return;
    }
    preview.textContent = `Will inspect ${source}, write a readiness report under runs/onboard/, and make no model call.`;
  }

  function modeGuidance(mode) {
    if (mode === "prepare") {
      return `<div><strong>This has value when</strong><span>You want draft contracts, validators, or eval cases that a human can review before promotion.</span></div><div><strong>Skip it when</strong><span>You only need to know whether the folder is structured correctly; use the readiness check first.</span></div>`;
    }
    return `<div><strong>This has value when</strong><span>You are unsure whether the skill is ready for review or eval generation.</span></div><div><strong>Skip it when</strong><span>You already know exactly which draft files you want generated; switch to Build review bundle.</span></div>`;
  }

  function modeLabel(mode) {
    if (mode === "review") return "Agent review";
    return MODE_COPY[mode]?.label || mode || "run";
  }

  function exampleKind(kind) {
    const labels = {
      bead_graph_polish: "Graph polish",
      plan_to_beads_seed: "Plan-to-cases seed",
      style_reference: "Style reference",
    };
    return labels[kind] || kind || "Session example";
  }

  function exampleQuality(quality) {
    if (quality === "strong") return "Good match";
    return quality || "Unknown";
  }

  function skillNameFromPath(path) {
    return String(path || "").split("/").filter(Boolean).pop() || "";
  }

  function runSummary(run, result) {
    if (run.running) return "Running now. Results will appear here when the report finishes.";
    if (!result) return "No report has been written yet.";
    if (result.schema_version === "onboard-terminal.v1" || result.stderr_text) {
      return failureSummary(result);
    }
    if (result.schema_version === "onboard-agent-review.v1") {
      const findings = Array.isArray(result.findings) ? result.findings.length : 0;
      return `Agent review: ${result.verdict || "unknown"}. ${result.summary || ""}${findings ? ` ${findings} finding${findings === 1 ? "" : "s"}.` : ""}`;
    }
    if (result.counts) {
      const ready = Number(result.counts.ready || 0);
      const needsContract = Number(result.counts.needs_contract || 0);
      const advice = Number(result.counts.advice_only || 0);
      return `Result: ${ready} ready ${ready === 1 ? "skill" : "skills"}, ${needsContract ? `${needsContract} need contract changes` : "no contract changes needed"}, ${advice ? `${advice} advisory ${advice === 1 ? "note" : "notes"}` : "no advisory notes"}.`;
    }
    if (result.gates) {
      if (result.gates.ok) {
        const caseText = result.case_generation?.skipped
          ? ` Case generation skipped: ${caseSkipReason(result.case_generation.reason)}.`
          : result.case_generation?.ok
            ? " Eval cases generated for review."
            : "";
        return `Gate result: Passed all gates.${caseText}`;
      }
      const violations = Array.isArray(result.gates.violations) ? result.gates.violations.length : 0;
      return `Failed: ${violations || "some"} blocking gate ${violations === 1 ? "issue" : "issues"}. Open the run files for the report and log.`;
    }
    if (Array.isArray(result.payload_errors) && result.payload_errors.length) {
      return `Failed: ${result.payload_errors.length} generated payload ${result.payload_errors.length === 1 ? "issue" : "issues"}. Open the run files for details.`;
    }
    if (result.reminder) return result.reminder;
    return result.ok === false ? "Failed. Open the run files for the report and log." : "Finished. Outputs are quarantined under runs/onboard/ for human review.";
  }

  function renderRunErrorDetails(result) {
    const text = String(result?.stderr_text || "").trim();
    if (!text) return "";
    return `<details class="onboard-error-details">
      <summary>Failure details</summary>
      <pre class="record-note">${esc(text)}</pre>
    </details>`;
  }

  function failureSummary(result) {
    const text = String(result?.stderr_text || "");
    if (modelNotFound(text)) return `Failed: selected model is not available to the review runner (${missingModelName(text) || "model not found"}).`;
    if (text.includes("payload")) return "Failed: generated payload could not be used. Open failure details or the log for the exact message.";
    const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean);
    return firstLine ? `Failed: ${truncateText(cleanTraceLine(firstLine), 180)}` : "Failed before writing a report. Open failure details or the log.";
  }

  function failureAdvice(result) {
    const text = String(result?.stderr_text || "");
    if (modelNotFound(text)) return "The review runner rejected the selected model. Retry agent judge; new retries use GPT-5.5 instead of the stale alias.";
    return "The review process failed before writing an agent verdict. Retry the judge after checking the failure details or log.";
  }

  function modelNotFound(text) {
    return /model_not_found|model ['"][^'"]+['"] not found|NotFoundError/i.test(String(text || ""));
  }

  function missingModelName(text) {
    const match = String(text || "").match(/model ['"]([^'"]+)['"] not found/i);
    return match?.[1] || null;
  }

  function cleanTraceLine(line) {
    return String(line || "").replace(/\^+/g, "").replace(/~+/g, "").replace(/\s+/g, " ").trim();
  }

  function truncateText(value, max) {
    const text = String(value || "");
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
  }

  function verdictLabel(verdict) {
    if (verdict === "ready") return "Ready for review";
    if (verdict === "advice-only") return "Advisory note";
    if (verdict === "needs-contract") return "Needs contract";
    return verdict || "Unknown";
  }

  function caseSkipReason(reason) {
    if (!reason || reason === "--skip-cases") return "not requested";
    return reason;
  }
}
