const TABS = [
  ["contract", "Contract"],
  ["cases", "Eval cases"],
  ["runs", "Runs"],
  ["usedin", "Used in"],
  ["versions", "Versions"],
];

export async function mount(container, ctx) {
  const { api, esc, fmtAgo, fmtDuration, statusPill, trajectoryLink } = ctx.helpers;
  const state = {
    disposed: false,
    timer: null,
    skills: [],
    detail: null,
    playground: { records: [], pending: [] },
    proposals: null,
    proposalsUnavailable: false,
    models: ["laguna-m.1"],
    evalRuns: [],
    notice: null,
    evidenceOpen: new Set(),
    showSource: false,
  };

  const selected = ctx.id;
  const activeTab = new Set(TABS.map(([id]) => id)).has(ctx.params.get("tab")) ? ctx.params.get("tab") : "contract";

  renderLoading();
  try {
    const skills = await api("/api/skills");
    if (state.disposed) return cleanup;
    state.skills = skills || [];
    if (!state.skills.length) {
      container.innerHTML = `<section class="skills-empty panel"><span class="mono-label">SKILLS</span><h1>No skills found</h1></section>`;
      return cleanup;
    }
    if (!selected) {
      ctx.navigate(`/skills/${encodeURIComponent(state.skills[0].name)}`);
      return cleanup;
    }
    await loadSelected(selected);
    render();
    schedulePoll();
  } catch (error) {
    renderError(error);
  }

  container.addEventListener("click", onClick);
  container.addEventListener("submit", onSubmit);
  window.addEventListener("keydown", onKeydown);
  return cleanup;

  async function loadSelected(skill) {
    const [detailRes, playgroundRes, modelsRes, proposalsRes, evalRunsRes, optimizeRes] = await Promise.allSettled([
      api(`/api/skill-detail?name=${encodeURIComponent(skill)}`),
      api(`/api/playground?skill=${encodeURIComponent(skill)}`),
      api("/api/models"),
      api(`/api/proposals?skill=${encodeURIComponent(skill)}`),
      api("/api/evals/runs"),
      api("/api/optimize/runs"),
    ]);
    if (detailRes.status === "rejected") throw detailRes.reason;
    state.detail = detailRes.value;
    state.playground = playgroundRes.status === "fulfilled" ? playgroundRes.value : { records: [], pending: [] };
    state.models = modelsRes.status === "fulfilled" && modelsRes.value?.length ? modelsRes.value : ["laguna-m.1"];
    if (proposalsRes.status === "fulfilled") {
      state.proposals = proposalsRes.value;
      state.proposalsUnavailable = false;
    } else {
      state.proposals = null;
      state.proposalsUnavailable = true;
    }
    state.evalRuns = evalRunsRes.status === "fulfilled" ? evalRunsRes.value?.runs || [] : [];
    state.harness = evalRunsRes.status === "fulfilled" ? evalRunsRes.value?.harness || [] : [];
    state.optimizeRuns = optimizeRes.status === "fulfilled" ? optimizeRes.value || [] : [];
  }

  async function refreshPlayground() {
    if (!state.detail) return;
    try {
      state.playground = await api(`/api/playground?skill=${encodeURIComponent(state.detail.skill.name)}`);
      render();
      schedulePoll();
    } catch (error) {
      state.notice = { kind: "bad", html: esc(error.message || String(error)) };
      render();
    }
  }

  async function refreshSkill() {
    if (!state.detail) return;
    const name = state.detail.skill.name;
    const [skillsRes, detailRes, proposalsRes] = await Promise.allSettled([
      api("/api/skills"),
      api(`/api/skill-detail?name=${encodeURIComponent(name)}`),
      api(`/api/proposals?skill=${encodeURIComponent(name)}`),
    ]);
    if (skillsRes.status === "fulfilled") state.skills = skillsRes.value || state.skills;
    if (detailRes.status === "fulfilled") state.detail = detailRes.value;
    if (proposalsRes.status === "fulfilled") state.proposals = proposalsRes.value;
  }

  function renderLoading() {
    container.innerHTML = `<section class="skills-page"><aside class="skills-rail"><span class="mono-label">SKILLS</span></aside><main class="skills-detail"><div class="panel skills-loading">Loading skills…</div></main></section>`;
  }

  function renderError(error) {
    container.innerHTML = `<section class="skills-empty panel"><span class="mono-label">SKILLS</span><h1>Could not load skill page</h1><pre>${esc(error.message || String(error))}</pre></section>`;
  }

  function render() {
    if (!state.detail) return;
    const skill = state.detail.skill;
    container.innerHTML = `<section class="skills-page">
      <aside class="skills-rail">
        <div class="skills-rail-head"><span class="mono-label">LIBRARY</span><span>${esc(String(state.skills.length))}</span></div>
        <div class="skills-list">${state.skills.map(renderRailItem).join("")}</div>
      </aside>
      <main class="skills-detail">
        ${renderNotice()}
        <header class="skill-header">
          <div>
            <div class="skill-title-row">
              <h1>${esc(skill.name)}</h1>
              <span class="pill">v${esc(skill.version || "—")}</span>
              <span class="pill ok">structure ✓</span>
              <button class="btn" type="button" data-action="view-source">View source</button>
            </div>
            <p>${esc(skill.description || "No description in frontmatter.")}</p>
          </div>
        </header>
        ${renderScorecard()}
        ${renderTabs()}
        <section class="panel skill-tab-panel">${renderTab(activeTab)}</section>
      </main>
      <aside class="skills-right-rail">
        ${renderTryNow()}
        ${renderQueue()}
      </aside>
      ${state.showSource ? renderSourceOverlay() : ""}
    </section>`;
  }

  function renderRailItem(skill) {
    const active = state.detail?.skill.name === skill.name;
    const lift = computeLift(skill.evalSummary);
    const liftClass = lift == null ? "muted" : lift < 0 ? "bad" : "ok";
    return `<a class="skill-rail-item ${active ? "selected" : ""}" href="#/skills/${encodeURIComponent(skill.name)}">
      <div><code>${esc(skill.name)}</code><span class="skill-lift ${liftClass}">${esc(formatLift(lift))}</span></div>
      <p>${esc(skill.description || "No description.")}</p>
    </a>`;
  }

  function renderScorecard() {
    const summary = state.detail.skill.evalSummary || emptySummary();
    const lift = computeLift(summary);
    const banner = liveRunBanner();
    return `${banner}<section class="skill-scorecard">
      ${scoreTile("WITH SKILL", `${summary.withSkill.pass}/${summary.withSkill.total}`, avgLine(summary.withSkill), "green")}
      ${scoreTile("WITHOUT", `${summary.withoutSkill.pass}/${summary.withoutSkill.total}`, avgLine(summary.withoutSkill), "red")}
      ${scoreTile("IN-WORKFLOW", `${state.detail.inWorkflow.pass}/${state.detail.inWorkflow.total}`, "node eval pass rate", "green")}
      ${scoreTile("LIFT", formatLift(lift), lift == null ? "needs both arms" : "with − without pass rate", "cyan accent")}
    </section>`;
  }

  function liveRunBanner() {
    const name = state.detail?.skill?.name;
    if (!name) return "";
    const optimizing = (state.optimizeRuns || []).filter((o) => o.skill === name && o.running);
    const optLines = optimizing.map((o) => {
      const pr = o.progress || {};
      const done = pr.rolloutsDone != null ? pr.rolloutsDone : "?";
      const total = pr.rolloutsTotal != null ? pr.rolloutsTotal : "?";
      const pace = pr.secPerRollout != null ? ` · ~${Math.round(pr.secPerRollout)}s/rollout` : "";
      const cand = pr.nCandidates != null ? ` · ${pr.nCandidates} candidate(s)` : "";
      const author = pr.reflectionLm ? ` · author ${pr.reflectionLm.split("/").pop()}` : "";
      return `<p class="skill-scorecard-note live">🧬 GEPA optimizing — rollout ${done}/${total}${pace}${cand}${author}</p>`;
    }).join("");
    const suite = `evals/suites/skill-${name}.json`;
    const live = (state.harness || []).some((h) => h.running && (h.suite === suite || h.suite === "evals/suites/smoke.json"));
    const graded = (state.evalRuns || []).filter((r) => r.skill === name).length;
    if (!live) {
      const settled = graded
        ? `<p class="skill-scorecard-note muted">settled · ${graded} graded arm(s) total · no eval run in progress</p>`
        : "";
      return optLines + settled;
    }
    return optLines + `<p class="skill-scorecard-note live">⏳ eval run in progress — ${graded} arm(s) graded so far; these tiles are PARTIAL and update as runs land</p>`;
  }

  function scoreTile(label, value, sub, tone) {
    return `<div class="skill-score-tile ${tone}"><span class="mono-label">${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`;
  }

  function renderTabs() {
    return `<nav class="skill-tabs">${TABS.map(([id, label]) => `<a class="${id === activeTab ? "active" : ""}" href="#/skills/${encodeURIComponent(state.detail.skill.name)}?tab=${id}">${esc(label)}</a>`).join("")}</nav>`;
  }

  function renderTab(tab) {
    if (tab === "cases") return renderCasesTab();
    if (tab === "runs") return renderRunsTab();
    if (tab === "usedin") return renderUsedInTab();
    if (tab === "versions") return renderVersionsTab();
    return renderContractTab();
  }

  function renderContractTab() {
    const snippet = state.detail.skillMd.split("\n").slice(0, 40).join("\n");
    const skill = state.detail.skill;
    return `<div class="contract-grid">
      <pre class="skill-md-snippet">${esc(snippet)}</pre>
      <div class="contract-files">
        <div class="contract-file"><span>SKILL.md</span><span class="pill ok">present</span></div>
        <div class="contract-file"><span>schemas</span><span class="pill ok">${esc(String(skill.schemas.length))}</span></div>
        <ul>${skill.schemas.map((s) => `<li><code>${esc(s)}</code></li>`).join("") || "<li class=\"muted\">none</li>"}</ul>
        <div class="contract-file"><span>validators</span><span class="pill ok">${esc(String(skill.validators.length))}</span></div>
        <ul>${skill.validators.map((v) => `<li><code>${esc(v)}</code></li>`).join("") || "<li class=\"muted\">none</li>"}</ul>
        <div class="contract-file"><span>eval cases</span><span class="pill ok">${esc(String(skill.evalCases))}</span></div>
      </div>
    </div>`;
  }

  function renderCasesTab() {
    const rows = state.detail.cases;
    if (!rows.length) return `<p class="muted">No eval cases for this skill yet.</p>`;
    return `<div class="skill-table cases-table"><div class="skill-table-head"><span>ID</span><span>BUCKET</span><span>DIFFICULTY</span><span>EXPECTED</span></div>${rows.map((c) => `<div class="skill-table-row"><code>${esc(c.id)}</code><span>${esc(c.bucket || "—")}</span><span>${esc(c.difficulty || "—")}</span><span>${esc(c.expectedStatus || "—")}</span></div>`).join("")}</div>`;
  }

  function renderRunsTab() {
    const runs = state.evalRuns.filter((r) => r.skill === state.detail.skill.name).slice(0, 10);
    return `<div class="runs-tab-head"><a class="btn" href="#/runs?skill=${encodeURIComponent(state.detail.skill.name)}">Open full Runs feed</a></div>
      ${runs.length ? `<div class="skill-run-list">${runs.map((r) => `<div class="skill-run-row">${statusPill(r.status)}<code>${esc(r.caseId)}</code><span>${esc(r.arm)}</span><span>${r.score == null ? "score —" : `score ${Number(r.score).toFixed(2)}`}</span><span>${esc(fmtRunAgo(r))}</span></div>`).join("")}</div>` : `<p class="muted">No eval arm-runs recorded for this skill.</p>`}`;
  }

  function renderUsedInTab() {
    const rows = state.detail.usedIn;
    if (!rows.length) return `<p class="muted">No workflow source files reference this skill.</p>`;
    return `<div class="usedin-list">${rows.map((w) => `<a class="usedin-row" href="#/workflows/${encodeURIComponent(w.path)}"><code>${esc(w.name)}</code><span>${esc(w.project)}</span><span>${esc(w.path)}</span></a>`).join("")}</div>`;
  }

  function renderVersionsTab() {
    const accepted = (state.proposals?.proposals || []).filter((p) => p.status === "accepted").sort((a, b) => (b.acceptedAtMs || 0) - (a.acceptedAtMs || 0));
    return `<div class="versions-list">
      <div class="version-row current"><span class="pill ok">current</span><strong>v${esc(state.detail.skill.version || "—")}</strong><span>${esc(state.detail.skill.path)}</span></div>
      ${accepted.map((p) => `<div class="version-row"><span class="pill">accepted</span><strong>v${esc(p.newVersion || "—")}</strong><span>${esc(fmtAgo(p.acceptedAtMs || p.createdAtMs))}</span><p>${esc(p.summary)}</p></div>`).join("") || `<p class="muted">No accepted proposals yet.</p>`}
    </div>`;
  }

  function renderTryNow() {
    const records = state.playground.records || [];
    const pending = (state.playground.pending || []).filter((p) => !records.some((r) => r.id === p.tag));
    return `<section class="panel try-now-panel">
      <div class="right-panel-head"><span class="mono-label">TRY IT NOW</span><span class="pill ok">validator graded</span></div>
      <form class="try-now-form" data-action="run-playground">
        <label>Prompt<textarea name="prompt" required placeholder="Map this workspace per the skill's output contract"></textarea></label>
        <label>Workspace<select name="fixtureCase"><option value="">empty</option>${state.detail.cases.map((c) => `<option value="${esc(c.id)}">${esc(c.id)}</option>`).join("")}</select></label>
        <label>Model<select name="model">${state.models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("")}</select></label>
        <button class="btn pass-tint" type="submit">Run</button>
      </form>
      <p class="rail-caption">graded by the validator · promotable to an eval case</p>
      <div class="playground-results">
        ${pending.map(renderPendingPlayground).join("")}
        ${records.map(renderPlaygroundRecord).join("") || (!pending.length ? `<p class="muted">No playground runs yet.</p>` : "")}
      </div>
    </section>`;
  }

  function renderPendingPlayground(p) {
    return `<div class="playground-record pending"><span class="pill ${p.running ? "live" : "bad"}">${p.running ? "running" : "ended"}</span><strong>${esc(p.tag)}</strong><span>${esc(fmtAgo(p.startedAtMs))}</span><small>${esc(p.fixtureCase || "empty workspace")}</small></div>`;
  }

  function renderPlaygroundRecord(record) {
    return `<div class="playground-record">
      <div class="playground-record-head">${statusPill(record.status)}<strong>${record.score == null ? "score —" : `score ${Number(record.score).toFixed(2)}`}</strong><span>${esc(fmtAgo(record.createdAtMs))}</span></div>
      <p>${esc(record.prompt)}</p>
      <div class="playground-actions">${trajectoryLink(record.trajectoryUrl)}<button class="btn" type="button" data-action="promote-playground" data-id="${esc(record.id)}">+ eval case</button></div>
      ${record.note ? `<pre class="record-note">${esc(record.note)}</pre>` : ""}
      ${renderChecks(record.checks)}
    </div>`;
  }

  function renderChecks(checks = []) {
    if (!checks.length) return `<ul class="check-list"><li class="muted">No validator checks returned.</li></ul>`;
    return `<ul class="check-list">${checks.map((c) => `<li class="${c.status === "pass" ? "ok" : "bad"}"><code>${esc(c.id)}</code><span>${esc(c.status)}</span>${c.detail ? `<small>${esc(c.detail)}</small>` : ""}</li>`).join("")}</ul>`;
  }

  function renderQueue() {
    if (state.proposalsUnavailable) {
      return `<section class="panel queue-panel"><div class="right-panel-head"><span class="mono-label">IMPROVEMENT QUEUE</span></div><p class="muted">Improvement queue lands with plan 004.</p></section>`;
    }
    const pending = state.proposals?.pending || [];
    const proposals = (state.proposals?.proposals || []).filter((p) => p.status === "open");
    return `<section class="panel queue-panel">
      <div class="right-panel-head"><span class="mono-label">IMPROVEMENT QUEUE</span><span>${esc(String(proposals.length))} open</span></div>
      ${pending.map((p) => `<div class="proposal-pending"><span class="pill live">suggesting</span><span>${esc(p.model)}</span><span>${esc(fmtAgo(p.startedAtMs))}</span></div>`).join("")}
      ${proposals.map(renderProposal).join("") || (!pending.length ? `<p class="muted">No open proposals.</p>` : "")}
      <p class="rail-caption">Accepting creates a draft version and re-runs the skill's eval suite.</p>
    </section>`;
  }

  function renderProposal(proposal) {
    const open = state.evidenceOpen.has(proposal.id);
    const next = nextPatch(proposal.baseVersion);
    return `<article class="proposal-card">
      <p>${esc(proposal.summary)}</p>
      ${renderLineDiff(state.detail.skillMd, proposal.proposedContent || "")}
      <div class="proposal-actions">
        <button class="btn suggest" type="button" data-action="accept-proposal" data-id="${esc(proposal.id)}">Accept as v${esc(next)}</button>
        <button class="btn" type="button" data-action="toggle-evidence" data-id="${esc(proposal.id)}">View evidence</button>
        <button class="btn" type="button" data-action="dismiss-proposal" data-id="${esc(proposal.id)}">✕</button>
      </div>
      ${open ? `<ul class="evidence-list">${(proposal.evidence || []).map((e) => `<li><code>${esc(e.kind)}:${esc(e.ref)}</code>${e.detail ? `<pre>${esc(e.detail)}</pre>` : ""}</li>`).join("") || "<li class=\"muted\">No evidence recorded.</li>"}</ul>` : ""}
    </article>`;
  }

  function renderLineDiff(before, after) {
    const a = String(before || "").split("\n");
    const b = String(after || "").split("\n");
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length - 1;
    let endB = b.length - 1;
    while (endA >= start && endB >= start && a[endA] === b[endB]) {
      endA--;
      endB--;
    }
    const removed = a.slice(start, endA + 1).slice(0, 80);
    const added = b.slice(start, endB + 1).slice(0, 80);
    const lines = [...removed.map((line) => `<span class="diff-del">− ${esc(line)}</span>`), ...added.map((line) => `<span class="diff-add">+ ${esc(line)}</span>`)];
    if (!lines.length) lines.push(`<span class="muted">No visible line changes.</span>`);
    if (removed.length + added.length >= 160) lines.push(`<span class="muted">Diff truncated.</span>`);
    return `<pre class="line-diff">${lines.join("\n")}</pre>`;
  }

  function renderNotice() {
    if (!state.notice) return "";
    return `<div class="skill-notice ${state.notice.kind || ""}"><button class="btn" type="button" data-action="dismiss-notice">Dismiss</button>${state.notice.html}</div>`;
  }

  function renderSourceOverlay() {
    return `<div class="skill-source-overlay"><div class="skill-source panel"><button class="btn" type="button" data-action="close-source">Close</button><span class="mono-label">${esc(state.detail.skill.path)}/SKILL.md</span><pre>${esc(state.detail.skillMd)}</pre></div></div>`;
  }

  async function onSubmit(event) {
    const form = event.target.closest("form[data-action='run-playground']");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const prompt = String(data.get("prompt") || "").trim();
    const fixtureCase = String(data.get("fixtureCase") || "");
    const model = String(data.get("model") || "") || undefined;
    try {
      const result = await postJson("/api/playground/run", { skill: state.detail.skill.name, prompt, model, fixtureCase: fixtureCase || undefined });
      state.notice = { kind: "ok", html: `playground run queued: <code>${esc(result.tag)}</code>` };
      state.playground.pending = [{ ...result.sidecar, running: true }, ...(state.playground.pending || [])];
      form.reset();
      render();
      schedulePoll();
    } catch (error) {
      state.notice = { kind: "bad", html: esc(error.message || String(error)) };
      render();
    }
  }

  async function onClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "view-source") state.showSource = true;
    if (action === "close-source") state.showSource = false;
    if (action === "dismiss-notice") state.notice = null;
    if (action === "toggle-evidence") toggleEvidence(button.dataset.id);
    if (action === "promote-playground") await promote(button.dataset.id);
    if (action === "accept-proposal") await accept(button.dataset.id);
    if (action === "dismiss-proposal") await dismiss(button.dataset.id);
    render();
  }

  function toggleEvidence(id) {
    if (!id) return;
    if (state.evidenceOpen.has(id)) state.evidenceOpen.delete(id);
    else state.evidenceOpen.add(id);
  }

  async function promote(id) {
    try {
      const result = await postJson("/api/playground/promote", { skill: state.detail.skill.name, id });
      state.notice = { kind: "ok", html: `review + promote is a human step — see CLAUDE.md<br><code>${esc(result.path)}</code><pre>${esc(result.command)}</pre>` };
    } catch (error) {
      state.notice = { kind: "bad", html: esc(error.message || String(error)) };
    }
  }

  async function accept(id) {
    try {
      const result = await postJson("/api/proposals/accept", { skill: state.detail.skill.name, id });
      if (result.ok === false) {
        state.notice = { kind: "bad", html: `<strong>Structure check failed</strong><pre>${esc(result.error || "accept failed")}</pre>` };
      } else {
        state.notice = { kind: "ok", html: `accepted as v${esc(result.newVersion)} — suite re-running` };
        await refreshSkill();
      }
    } catch (error) {
      state.notice = { kind: "bad", html: esc(error.message || String(error)) };
    }
  }

  async function dismiss(id) {
    try {
      await postJson("/api/proposals/dismiss", { skill: state.detail.skill.name, id });
      await refreshSkill();
    } catch (error) {
      state.notice = { kind: "bad", html: esc(error.message || String(error)) };
    }
  }

  async function postJson(url, body) {
    return api(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  function schedulePoll() {
    clearTimeout(state.timer);
    if (!state.playground.pending?.some((p) => p.running)) return;
    state.timer = setTimeout(() => {
      if (!state.disposed) refreshPlayground();
    }, 5000);
  }

  function cleanup() {
    state.disposed = true;
    clearTimeout(state.timer);
    container.removeEventListener("click", onClick);
    container.removeEventListener("submit", onSubmit);
    window.removeEventListener("keydown", onKeydown);
  }

  function onKeydown(event) {
    if (event.key === "Escape" && state.showSource) {
      state.showSource = false;
      render();
    }
  }

  function fmtRunAgo(run) {
    const ms = Date.parse(run.finishedAt || run.startedAt || "");
    return Number.isFinite(ms) ? fmtAgo(ms) : "—";
  }
}

function emptySummary() {
  return { withSkill: { pass: 0, total: 0, avgScore: null }, withoutSkill: { pass: 0, total: 0, avgScore: null } };
}

function computeLift(summary) {
  if (!summary || summary.withSkill.total === 0 || summary.withoutSkill.total === 0) return null;
  return Math.round((summary.withSkill.pass / summary.withSkill.total - summary.withoutSkill.pass / summary.withoutSkill.total) * 100);
}

function formatLift(lift) {
  if (lift == null) return "—";
  return `${lift > 0 ? "+" : ""}${lift}%`;
}

function avgLine(summary) {
  return summary.avgScore == null ? "avg score —" : `avg score ${Number(summary.avgScore).toFixed(2)}`;
}

function nextPatch(version) {
  const match = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return "next";
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}
