const W = 178;
const H = 64;
const GX = 70;
const GY = 28;
const DEFAULT_AGENT = "laguna-m.1";

export async function mount(container, ctx) {
  const { api, esc, fmtAgo, fmtDuration, statusPill } = ctx.helpers;
  const state = {
    path: ctx.id,
    graph: null,
    facts: [],
    skills: [],
    models: [DEFAULT_AGENT],
    graphError: null,
    zoom: 1,
    busy: false,
    evalStatus: "",
    runStatus: "",
    chatStatus: "",
    editResult: null,
    sourceText: null,
    sourceError: null,
    proposalsAvailable: null,
    runs: [],
    nodeEvals: [],
    labels: {},
    runDetails: new Map(),
    nodeArtifacts: new Map(),
    runLoopError: null,
    runLoopStatus: "",
    pollTimer: null,
    pollMisses: 0,
    timers: [],
  };

  const projectQuery = () => (ctx.project ? `project=${encodeURIComponent(ctx.project)}` : "");
  const withProject = (url) => {
    const qs = projectQuery();
    return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
  };
  const postJson = (url, body) =>
    api(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: ctx.project, ...body }),
    });
  const selectedNodeId = () => ctx.params.get("node");
  const selectedRunId = () => ctx.params.get("run") || state.runs[0]?.id || null;
  const selectedGradedId = () => ctx.params.get("graded");
  window.addEventListener("keydown", keyHandler);

  if (!state.path) {
    await renderList();
    return () => clearTimers();
  }

  await loadCanvas();
  return () => clearTimers();

  async function renderList() {
    container.innerHTML = `<section class="workflow-list-page">
      <div class="workflow-list-head">
        <div>
          <span class="mono-label">WORKFLOWS</span>
          <h1>Workflow canvas</h1>
          <p>Open a Smithers workflow to inspect node prompts, skills, models, and recent grades.</p>
        </div>
      </div>
      <div class="panel workflow-list-panel"><p class="workflow-muted">Loading workflows…</p></div>
    </section>`;
    try {
      const workflows = await api(withProject("/api/workflows"));
      const panel = container.querySelector(".workflow-list-panel");
      panel.innerHTML = workflows.length
        ? workflows
            .map(
              (w) => `<a class="workflow-list-row" href="#/workflows/${encodeURIComponent(w.path)}">
                <strong>${esc(w.name)}</strong>
                <span class="workflow-path">${esc(w.path)}</span>
              </a>`,
            )
            .join("")
        : `<p class="workflow-muted">No workflow .tsx files found.</p>`;
    } catch (error) {
      container.querySelector(".workflow-list-panel").innerHTML =
        `<p class="workflow-error">${esc(error.message)}</p>`;
    }
  }

  async function loadCanvas() {
    renderShell();
    const graphUrl = withProject(`/api/workflows/graph?path=${encodeURIComponent(state.path)}`);
    const factsUrl = withProject(`/api/workflows/nodes?path=${encodeURIComponent(state.path)}`);
    const [graphRes, factsRes, skillsRes, modelsRes] = await Promise.allSettled([
      api(graphUrl),
      api(factsUrl),
      api("/api/skills"),
      api("/api/models"),
    ]);
    if (graphRes.status === "fulfilled") {
      state.graph = graphRes.value;
      state.graphError = null;
    } else {
      state.graphError = graphRes.reason?.message || String(graphRes.reason);
    }
    if (factsRes.status === "fulfilled") state.facts = factsRes.value;
    if (skillsRes.status === "fulfilled") state.skills = skillsRes.value;
    state.models = modelsRes.status === "fulfilled" && modelsRes.value.length ? modelsRes.value : [DEFAULT_AGENT];
    await checkProposalsForSelected();
    await loadRunLoopData();
    renderShell();
  }

  function renderShell() {
    const name = state.path.split("/").pop() || state.path;
    const graphPill = state.graphError
      ? `<span class="pill bad" title="${esc(state.graphError)}">graph failed</span>`
      : `<span class="pill ok">graph verified</span>`;
    container.innerHTML = `<section class="workflow-page">
      <header class="workflow-subheader">
        <div class="workflow-title-block">
          <div class="workflow-breadcrumb">Workflows / <strong>${esc(name)}</strong></div>
          <div class="workflow-path">${esc(state.path)}</div>
        </div>
        <div class="workflow-actions">
          ${graphPill}
          ${state.runStatus || ""}
          <button class="btn" type="button" data-action="source">View TSX</button>
          <button class="btn primary" type="button" data-action="run">▶ Run workflow</button>
        </div>
      </header>
      <div class="workflow-grid">
        ${renderCanvas()}
        ${renderInspector()}
      </div>
      ${renderRunLoop()}
      ${state.sourceText !== null || state.sourceError ? renderSourceOverlay() : ""}
    </section>`;
    attachHandlers();
  }

  function renderCanvas() {
    if (state.graphError) {
      return `<section class="workflow-canvas-shell">
        <div class="workflow-canvas-toolbar"><span class="mono-label">CANVAS</span></div>
        <div class="workflow-canvas-error">Graph failed: ${esc(state.graphError)}</div>
        ${renderChatDock()}
      </section>`;
    }
    if (!state.graph) {
      return `<section class="workflow-canvas-shell"><p class="workflow-muted">Projecting graph…</p>${renderChatDock()}</section>`;
    }
    if (!state.graph.nodes.length) {
      return `<section class="workflow-canvas-shell"><p class="workflow-muted">Empty graph.</p>${renderChatDock()}</section>`;
    }

    const layout = computeLayout(state.graph);
    const selected = selectedNodeId();
    const edges = state.graph.edges
      .map((e) => {
        const a = layout.pos.get(e.from);
        const b = layout.pos.get(e.to);
        if (!a || !b) return "";
        const x1 = a.x + W;
        const y1 = a.y + H / 2;
        const x2 = b.x;
        const y2 = b.y + H / 2;
        const mx = (x1 + x2) / 2;
        const hot = selected && (e.from === selected || e.to === selected);
        return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" class="workflow-edge${e.state === "latent" ? " latent" : ""}${hot ? " selected" : ""}"/>`;
      })
      .join("");
    const nodes = state.graph.nodes
      .map((node) => {
        const p = layout.pos.get(node.id);
        const fact = factFor(node.id);
        const latest = fact?.lastEvals?.[0] ?? null;
        const status = latest?.status === "pass" ? "pass" : latest ? "fail" : "ungraded";
        const skill = fact?.skill || "no skill";
        const model = fact?.agentName || node.agentName || DEFAULT_AGENT;
        const isLatent = node.state === "latent";
        const desc = isLatent ? "latent source task" : (node.prompt || node.label || "").split("\n").find(Boolean) || "No prompt text";
        return `<button class="node-card ${node.kind === "control" ? "control" : ""} ${isLatent ? "latent" : ""} ${node.id === selected ? "selected" : ""}" type="button" data-node="${esc(node.id)}" style="left:${p.x}px;top:${p.y}px;width:${W}px;height:${H}px">
          <span class="node-status ${status}"></span>
          <strong>${esc(node.id)}</strong>
          <span class="node-desc">${esc(desc)}</span>
          <span class="node-footer">${isLatent ? "renders after state" : `${esc(model)} · ${esc(skill)}`}</span>
        </button>`;
      })
      .join("");

    return `<section class="workflow-canvas-shell">
      <div class="workflow-canvas-toolbar">
        <span class="mono-label">CANVAS</span>
        <div class="zoom-controls" aria-label="Zoom controls">
          <button class="btn" type="button" data-zoom="out">−</button>
          <button class="btn" type="button" data-zoom="reset">${Math.round(state.zoom * 100)}%</button>
          <button class="btn" type="button" data-zoom="in">+</button>
        </div>
      </div>
      <div class="workflow-canvas-viewport">
        <div class="workflow-canvas-inner" style="width:${layout.width}px;height:${layout.height}px;transform:scale(${state.zoom});">
          <svg class="workflow-edge-layer" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true">${edges}</svg>
          <div class="workflow-node-layer">${nodes}</div>
        </div>
      </div>
      ${renderChatDock()}
    </section>`;
  }

  function renderInspector() {
    const node = taskNode(selectedNodeId());
    if (!node) {
      return `<aside class="node-inspector"><div class="inspector-empty">
        <span class="mono-label">INSPECTOR</span>
        <h2>Select a node</h2>
        <p>Choose a task card on the canvas to inspect its prompt, installed skill, model, and recent node grades.</p>
      </div></aside>`;
    }
    const fact = factFor(node.id) || { nodeId: node.id, skill: null, agentName: null, lastEvals: [] };
    const skill = fact.skill;
    const model = fact.agentName || node.agentName || DEFAULT_AGENT;
    return `<aside class="node-inspector">
      <header class="inspector-head">
        <div><h2>${esc(node.label || node.id)}</h2><span class="pill">agent node</span></div>
        <button class="btn" type="button" data-action="close-node" title="Clear selected node">✕</button>
      </header>
      <section class="inspector-group">
        <div class="mono-label">MODEL</div>
        <select class="model-select" disabled title="model changes land via the chat dock">
          ${state.models.map((m) => `<option ${m === model ? "selected" : ""}>${esc(m)}</option>`).join("")}
        </select>
      </section>
      <section class="inspector-group">
        <div class="mono-label">PROMPT</div>
        <pre class="prompt-box">${highlightPrompt(node.prompt || "No prompt text recovered from graph projection.")}</pre>
      </section>
      <section class="inspector-group">
        <div class="mono-label">SKILLS</div>
        <div class="skill-chips">
          ${skill ? `<span class="skill-chip">$${esc(skill)} <button type="button" data-action="remove-skill" data-skill="${esc(skill)}">✕</button></span>` : `<span class="workflow-muted">No skill recovered from latest capture.</span>`}
        </div>
        <label class="skill-typeahead"><span>$</span><input type="search" placeholder="type a skill name" autocomplete="off" data-skill-search></label>
        <div class="skill-matches" data-skill-matches></div>
      </section>
      <section class="inspector-group">
        <div class="mono-label">NODE PERFORMANCE</div>
        <div class="node-performance">
          ${renderGrades(fact.lastEvals)}
        </div>
        <div class="inspector-buttons">
          <button class="btn" type="button" data-action="rerun-node">Re-run node · 3 trials</button>
          <button class="btn suggest" type="button" data-action="suggest" ${!skill || state.proposalsAvailable === false ? "disabled" : ""} title="${!skill ? "requires an installed skill" : state.proposalsAvailable === false ? "lands with plan 004" : "Suggest skill improvements"}">✦ Suggest improvements</button>
        </div>
        <div class="inspector-status">${state.evalStatus}</div>
        <p class="inspector-footnote">Improvements are proposed by laguna-m.1 and land on the skill page — never inline.</p>
      </section>
    </aside>`;
  }

  function renderChatDock() {
    return `<form class="chat-dock" data-chat>
      <textarea rows="2" placeholder="Ask Laguna to edit this workflow TSX…"></textarea>
      <button class="btn primary" type="submit" ${state.busy ? "disabled" : ""}>Send</button>
      <div class="chat-status">${state.chatStatus}${state.editResult ? renderEditResult() : ""}</div>
    </form>`;
  }

  function renderEditResult() {
    const result = state.editResult;
    if (!result) return "";
    if (!result.ok) return `<div class="attempts"><strong>Edit failed</strong>${renderAttempts(result.attempts)}</div>`;
    return `<div class="edit-diff">
      <div class="edit-diff-head"><span class="pill ok">verified</span><span>${esc(result.path)}</span></div>
      ${renderLineDiff(result.before, result.after)}
      <div class="edit-diff-actions">
        <button class="btn primary" type="button" data-action="accept-edit">Accept</button>
        <button class="btn danger" type="button" data-action="revert-edit" data-backup="${esc(result.backup)}">Revert</button>
      </div>
    </div>`;
  }

  function renderGrades(records) {
    if (!records?.length) return `<p class="workflow-muted">No node grades yet.</p>`;
    return records
      .map((r) => {
        const mode = r.mode === "in-workflow" ? "in-workflow run" : `standalone #${r.trial ?? "?"}`;
        return `<div class="grade-row">${statusPill(r.status)}<span>${esc(mode)}</span><span>${fmtAgo(r.gradedAtMs)}</span></div>`;
      })
      .join("");
  }

  function renderRunLoop() {
    if (!state.path) return "";
    const expandedRunId = selectedRunId();
    const expandedRun = state.runs.find((r) => r.id === expandedRunId) || state.runs[0] || null;
    const earlier = expandedRun ? state.runs.filter((r) => r.id !== expandedRun.id) : state.runs;
    return `<section class="run-loop-section" aria-label="Workflow run loop">
      <div class="run-loop-title">
        <div><span class="mono-label">RUN LOOP</span><h2>Workflow runs</h2></div>
        <div class="run-loop-status">${state.runLoopStatus || ""}</div>
      </div>
      <div class="run-grid run-grid-head"><span>STATUS</span><span>RUN/NODE</span><span>TIMING</span><span>VERDICT</span><span>LABEL</span><span>▸</span></div>
      ${state.runLoopError ? `<p class="workflow-error run-loop-error">${esc(state.runLoopError)}</p>` : ""}
      ${!state.runs.length && !state.runLoopError ? `<div class="run-empty panel">No runs yet — start one from the canvas to create node evidence.</div>` : ""}
      ${expandedRun ? renderRunCard(expandedRun, true) : ""}
      ${earlier.length ? `<div class="earlier-runs mono-label">EARLIER RUNS</div>${earlier.map((run) => renderRunCard(run, false)).join("")}` : ""}
    </section>`;
  }

  function renderRunCard(run, expanded) {
    const detail = state.runDetails.get(run.id) || null;
    const row = renderRunRow(run, detail, expanded);
    if (!expanded) return `<article class="run-card collapsed">${row}</article>`;
    const gradedNode = selectedGradedId();
    const nodes = detail
      ? detail.nodes
          .map((node) => renderNodeRow(run, node, latestEvalForNode(run.id, node.nodeId), gradedNode === node.nodeId))
          .join("")
      : `<div class="run-loading">Loading nodes…</div>`;
    return `<article class="run-card expanded">
      ${row}
      <div class="run-nodes">${nodes}</div>
    </article>`;
  }

  function renderRunRow(run, detail, expanded) {
    const summary = runEvalSummary(run, detail);
    const live = isLiveRun(run);
    const status = runDisplayStatus(run, summary);
    const duration = run.startedAtMs ? fmtDuration((run.finishedAtMs ?? Date.now()) - run.startedAtMs) : "–";
    const labelCount = labelCountForRun(run.id);
    return `<div class="run-grid run-row run-card-head ${expanded ? "expanded" : ""}">
      <div>${runStatusPill(status)}</div>
      <div class="run-main-cell">
        <strong>${esc(run.title || "workflow run")}</strong>
        <span class="run-meta"><code>${esc(run.id.slice(0, 8))}</code>${run.workflowPath ? ` · ${esc(run.workflowPath)}` : ""}</span>
        ${expanded ? `<button class="btn small" type="button" data-grade-nodes="${esc(run.id)}">Grade nodes</button>` : ""}
      </div>
      <div>${esc(duration)}<br><span class="muted">${esc(fmtAgo(run.createdAtMs))}</span></div>
      <div>${live ? "in progress…" : `${summary.passed}/${summary.graded} nodes`}</div>
      <div>${labelCount ? `<span class="pill">${esc(labelCount)} labeled</span>` : "—"}</div>
      <div><button class="row-action" type="button" data-run-toggle="${esc(run.id)}" title="${expanded ? "Expanded run" : "Expand run"}">${expanded ? "▾" : "▸"}</button></div>
    </div>`;
  }

  function renderNodeRow(run, node, record, expanded) {
    const status = record?.status || "ungraded";
    const traceId = traceIdForNode(run.id, node.nodeId);
    const label = traceId ? labelForTrace(traceId) : null;
    const timing = node.startedAtMs ? fmtDuration((node.finishedAtMs ?? Date.now()) - node.startedAtMs) : "–";
    return `<div class="run-node-wrap ${expanded ? "open" : ""}">
      <div class="run-grid run-row node-row node-${esc(status)}">
        <div>${nodeStatusPill(status)}</div>
        <div class="run-main-cell"><strong>${esc(node.label || node.nodeId)}</strong><span class="run-meta"><code>${esc(node.nodeId)}</code> · ${esc(node.state)}</span></div>
        <div>${esc(timing)}<br><span class="muted">${esc(node.finishedAtMs ? fmtAgo(node.finishedAtMs) : "")}</span></div>
        <div>${esc(status)}</div>
        <div>${renderLabelPill(label)}</div>
        <div><button class="row-action" type="button" data-run-id="${esc(run.id)}" data-node-id="${esc(node.nodeId)}" data-node-toggle title="Open node detail">${expanded ? "▾" : "▸"}</button></div>
      </div>
      ${expanded ? renderNodeDetail(run.id, node.nodeId) : ""}
    </div>`;
  }

  function renderNodeDetail(runId, nodeId) {
    const key = artifactKey(runId, nodeId);
    const artifacts = state.nodeArtifacts.get(key) || null;
    if (!artifacts) return `<div class="run-node-detail"><div class="run-detail-strip"><span class="mono-label">NODE DETAIL</span></div><p class="workflow-muted">Loading artifacts…</p></div>`;
    const label = artifacts.traceId ? labelForTrace(artifacts.traceId) : null;
    const notes = artifacts.traceId ? (state.labels[artifacts.traceId]?.notes || "") : "";
    const disabled = artifacts.traceId ? "" : "disabled title=\"no pool capture matched this node — nothing to label\"";
    return `<div class="run-node-detail">
      <div class="run-detail-strip"><span class="mono-label">NODE DETAIL</span><span>${statusPill(artifacts.status)}</span>${artifacts.skill ? `<span class="pill">$${esc(artifacts.skill)}</span>` : ""}</div>
      <section class="run-detail-section">
        <div class="mono-label">PROMPT</div>
        <div class="run-prompt-text">${esc(artifacts.prompt || "No prompt.md recovered for this node capture.")}</div>
      </section>
      <section class="run-detail-section">
        <div class="mono-label">MODEL OUTPUT vs GOLD REFERENCE</div>
        ${renderArtifactComparison(artifacts)}
      </section>
      <section class="run-detail-section">
        <div class="mono-label">VALIDATOR</div>
        ${renderChecks(artifacts.checks)}
      </section>
      <div class="run-action-bar">
        <div class="run-action-left">
          <button class="btn" type="button" data-run-id="${esc(runId)}" data-node-id="${esc(nodeId)}" data-runloop-rerun>↺ Re-run</button>
          <button class="btn suggest" type="button" data-run-id="${esc(runId)}" data-node-id="${esc(nodeId)}" data-runloop-suggest ${artifacts.skill ? "" : "disabled title=\"requires an installed skill\""}>✦ Suggest fix</button>
        </div>
        <div class="run-label-controls">
          <textarea data-label-notes placeholder="What went wrong? Detail routes to the skill's improvement queue.">${esc(notes)}</textarea>
          <button class="btn pass-tint ${label === "pass" ? "selected" : ""}" type="button" data-trace-id="${esc(artifacts.traceId || "")}" data-label-action="pass" ${disabled}>Pass</button>
          <button class="btn danger ${label === "fail" ? "selected" : ""}" type="button" data-trace-id="${esc(artifacts.traceId || "")}" data-label-action="fail" ${disabled}>Fail</button>
          <button class="btn ${label === "defer" ? "selected" : ""}" type="button" data-trace-id="${esc(artifacts.traceId || "")}" data-label-action="defer" ${disabled}>Defer</button>
        </div>
      </div>
    </div>`;
  }

  function renderArtifactComparison(artifacts) {
    if (!artifacts.files?.length) return `<p class="workflow-muted">No .laguna artifacts found for this node workspace.</p>`;
    return artifacts.files.map((file) => renderArtifactFile(file, artifacts.checks)).join("");
  }

  function renderArtifactFile(file, checks) {
    const model = file.model.missing ? "artifact missing" : prettyArtifact(file.model.content);
    if (!file.gold) {
      return `<div class="artifact-block no-gold">
        <div class="artifact-title"><strong>${esc(file.path)}</strong><span>no gold reference — ad-hoc workspace; reference example unavailable</span></div>
        <pre class="artifact-code model full">${renderArtifactLines(model, [], "")}</pre>
      </div>`;
    }
    const gold = prettyArtifact(file.gold.content);
    const marks = conflictMarks(model, gold, checks, file.model.missing);
    return `<div class="artifact-block">
      <div class="artifact-title"><strong>${esc(file.path)}</strong><span>gold reference example from eval case ${esc(file.gold.case)}</span></div>
      <div class="artifact-columns">
        <div><div class="artifact-col-head model">MODEL OUTPUT</div><pre class="artifact-code model">${renderArtifactLines(model, marks.model, marks.detail || "← doesn't exist", "bad")}</pre></div>
        <div><div class="artifact-col-head gold">GOLD REFERENCE</div><pre class="artifact-code gold">${renderArtifactLines(gold, marks.gold, "← correct", "good")}</pre></div>
      </div>
    </div>`;
  }

  function renderArtifactLines(text, markedLines, annotation, kind = "") {
    const marked = new Set(markedLines);
    return text.split("\n").map((line, index) => {
      const hot = marked.has(index);
      if (!hot) return `<span>${esc(line)}</span>`;
      const valueClass = kind === "good" ? "run-good-value" : "run-bad-value";
      return `<span class="artifact-line conflict ${esc(kind)}"><span class="${valueClass}">${esc(line || " ")}</span> <em>${esc(annotation)}</em></span>`;
    }).join("\n");
  }

  function prettyArtifact(content) {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return String(content || "");
    }
  }

  function conflictMarks(modelText, goldText, checks, missing) {
    const details = (checks || [])
      .filter((c) => c.status !== "pass")
      .map((c) => c.detail || c.id || "")
      .filter(Boolean);
    const detail = details[0] ? `← ${details[0]}` : "← doesn't exist";
    const goldLines = goldText.split("\n");
    const goldTrimmed = new Set(goldLines.map((l) => l.trim()).filter(Boolean));
    const modelLines = modelText.split("\n");
    let modelIndex = modelLines.findIndex((line) => {
      const trimmed = line.trim();
      return trimmed && !goldTrimmed.has(trimmed) && (missing || lineMatchesDetails(trimmed, details));
    });
    if (modelIndex < 0 && details.length) modelIndex = modelLines.findIndex((line) => line.trim() && !goldTrimmed.has(line.trim()));
    if (modelIndex < 0 && missing) modelIndex = 0;
    let goldIndex = -1;
    if (modelIndex >= 0) {
      const key = modelLines[modelIndex].match(/^\s*"([^"]+)"\s*:/)?.[1];
      goldIndex = key ? goldLines.findIndex((line) => line.includes(`"${key}"`)) : -1;
      if (goldIndex < 0) {
        const modelTrimmed = new Set(modelLines.map((l) => l.trim()).filter(Boolean));
        goldIndex = goldLines.findIndex((line) => line.trim() && !modelTrimmed.has(line.trim()));
      }
    }
    return { model: modelIndex >= 0 ? [modelIndex] : [], gold: goldIndex >= 0 ? [goldIndex] : [], detail };
  }

  function lineMatchesDetails(line, details) {
    if (!details.length) return true;
    const lower = line.toLowerCase();
    const tokens = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase()).filter((t) => t.length > 2);
    return details.some((detail) => {
      const d = detail.toLowerCase();
      return d.includes(lower) || tokens.some((token) => d.includes(token) || lower.includes(token));
    });
  }

  function renderChecks(checks) {
    if (!checks?.length) return `<p class="workflow-muted">No validator checks recorded yet. Use Grade nodes to create in-workflow checks.</p>`;
    return `<ul class="run-check-list">${checks.map((check) => {
      const ok = check.status === "pass";
      return `<li class="${ok ? "pass" : "fail"}"><span>${ok ? "✓" : "✗"}</span><strong>${esc(check.id)}</strong>${check.detail ? `<em>${esc(check.detail)}</em>` : ""}</li>`;
    }).join("")}</ul>`;
  }

  async function loadRunLoopData(options = {}) {
    const schedule = options.schedule !== false;
    try {
      const [runsRes, evalsRes, labelsRes] = await Promise.allSettled([
        api(withProject("/api/runs")),
        api(withProject("/api/node-evals")),
        api("/api/review/labels"),
      ]);
      if (runsRes.status === "rejected") throw runsRes.reason;
      state.runs = (runsRes.value || []).filter((run) => run.workflowPath?.endsWith(state.path.replace(/^\.\//, "")));
      if (evalsRes.status === "fulfilled") state.nodeEvals = evalsRes.value || [];
      if (labelsRes.status === "fulfilled") state.labels = labelsRes.value || {};
      const runId = selectedRunId();
      const run = state.runs.find((r) => r.id === runId) || null;
      if (runId && (!state.runDetails.has(runId) || isLiveRun(run))) await ensureRunDetail(runId);
      const graded = selectedGradedId();
      if (runId && graded) await ensureNodeArtifacts(runId, graded);
      state.runLoopError = null;
      state.pollMisses = 0;
      if (schedule) {
        if (state.runs[0] && isLiveRun(state.runs[0])) scheduleRunPoll();
        else if (state.pollTimer) clearTimeout(state.pollTimer);
      }
    } catch (error) {
      state.runLoopError = error?.message || String(error);
    }
  }

  async function ensureRunDetail(runId) {
    if (!runId) return null;
    const detail = await api(withProject(`/api/runs/${runId}`));
    state.runDetails.set(runId, detail);
    return detail;
  }

  async function ensureNodeArtifacts(runId, nodeId) {
    const key = artifactKey(runId, nodeId);
    if (!state.nodeArtifacts.has(key)) {
      const url = withProject(`/api/node-artifacts?runId=${encodeURIComponent(runId)}&nodeId=${encodeURIComponent(nodeId)}`);
      state.nodeArtifacts.set(key, await api(url));
    }
    return state.nodeArtifacts.get(key);
  }

  function scheduleRunPoll() {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(async () => {
      let keepPolling = false;
      try {
        await loadRunLoopData({ schedule: false });
        keepPolling = Boolean(state.runs[0] && isLiveRun(state.runs[0]));
        renderShell();
      } catch {
        state.pollMisses = (state.pollMisses ?? 0) + 1;
        keepPolling = true;
      }
      if (keepPolling && (state.pollMisses ?? 0) < 40) scheduleRunPoll();
    }, 3000);
  }

  function navigateRun(runId) {
    if (!runId) return;
    const params = new URLSearchParams(ctx.params);
    params.set("run", runId);
    params.delete("graded");
    ctx.navigate(`/workflows/${encodeURIComponent(state.path)}?${params.toString()}`);
  }

  function navigateNodeDetail(runId, nodeId) {
    if (!runId || !nodeId) return;
    const params = new URLSearchParams(ctx.params);
    params.set("run", runId);
    if (params.get("graded") === nodeId) params.delete("graded");
    else {
      params.set("graded", nodeId);
      params.set("node", nodeId);
    }
    ctx.navigate(`/workflows/${encodeURIComponent(state.path)}?${params.toString()}`);
  }

  async function gradeRunNodes(runId) {
    if (!runId) return;
    state.runLoopStatus = `<span class="pill live">grading nodes…</span>`;
    renderShell();
    try {
      await postJson("/api/node-evals/insitu", { runId });
      state.nodeArtifacts.clear();
      state.runLoopStatus = `<span class="pill ok">nodes graded</span>`;
      await refreshFactsOnly();
      await loadRunLoopData();
    } catch (error) {
      state.runLoopStatus = `<span class="workflow-error">${esc(error.message)}</span>`;
    }
    renderShell();
  }

  async function rerunNodeFromLoop(runId, nodeId) {
    if (!nodeId) return;
    state.runLoopStatus = `<span class="pill live">running node trial…</span>`;
    renderShell();
    try {
      const res = await fetch("/api/node-evals/standalone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: ctx.project, path: state.path, nodeId, trials: 1 }),
        signal: AbortSignal.timeout(230_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
      state.runLoopStatus = `<span class="pill ok">standalone trial graded</span>`;
    } catch (error) {
      state.runLoopStatus =
        error?.name === "TimeoutError"
          ? `<span class="pill live">still running server-side — refresh shortly.</span>`
          : `<span class="workflow-error">${esc(error.message)}</span>`;
    }
    if (runId) state.nodeArtifacts.delete(artifactKey(runId, nodeId));
    await refreshFactsOnly();
    await loadRunLoopData();
    renderShell();
  }

  async function suggestFixFromLoop(runId, nodeId) {
    const artifacts = state.nodeArtifacts.get(artifactKey(runId, nodeId)) || null;
    const skill = artifacts?.skill || latestEvalForNode(runId, nodeId)?.skill || factFor(nodeId)?.skill;
    if (!skill) {
      state.runLoopStatus = `<span class="workflow-error">requires an installed skill</span>`;
      renderShell();
      return;
    }
    try {
      const probe = await fetch(`/api/proposals?skill=${encodeURIComponent(skill)}`);
      if (probe.status === 404) throw new Error("improvement queue is unavailable");
    } catch (error) {
      state.runLoopStatus = `<span class="workflow-error">${esc(error.message)}</span>`;
      renderShell();
      return;
    }
    state.runLoopStatus = `<span class="pill live">requesting fix suggestion…</span>`;
    renderShell();
    try {
      const result = await postJson("/api/proposals/suggest", {
        skill,
        source: "run-loop",
        refs: { workflowPath: state.path, runId, nodeId, traceId: artifacts?.traceId || null },
      });
      state.runLoopStatus = `<span class="pill live">proposal job started ${esc(result.tag || "")} — lands on the skill page</span>`;
    } catch (error) {
      state.runLoopStatus = `<span class="workflow-error">${esc(error.message)}</span>`;
    }
    renderShell();
  }

  async function saveRunLoopLabel(traceId, label, button) {
    if (!traceId || !label) return;
    const detail = button.closest(".run-node-detail");
    const notes = detail?.querySelector("[data-label-notes]")?.value || "";
    state.runLoopStatus = `<span class="pill live">saving label…</span>`;
    renderShell();
    try {
      await postJson("/api/review/labels", { trace_id: traceId, label, notes });
      state.labels[traceId] = { ...(state.labels[traceId] || {}), label, notes };
      state.runLoopStatus = `<span class="pill ok">label saved</span>`;
    } catch (error) {
      state.runLoopStatus = `<span class="workflow-error">${esc(error.message)}</span>`;
    }
    renderShell();
  }

  function latestEvalForNode(runId, nodeId) {
    return state.nodeEvals.find((r) => r.mode === "in-workflow" && r.runId === runId && r.nodeId === nodeId) || null;
  }

  function runEvalSummary(run, detail) {
    const nodeIds = detail?.nodes?.map((n) => n.nodeId) || [];
    const latest = new Map();
    for (const record of state.nodeEvals) {
      if (record.mode !== "in-workflow" || record.runId !== run.id) continue;
      if (nodeIds.length && !nodeIds.includes(record.nodeId)) continue;
      if (!latest.has(record.nodeId)) latest.set(record.nodeId, record);
    }
    const records = [...latest.values()];
    return {
      graded: records.length,
      passed: records.filter((r) => r.status === "pass").length,
      failed: records.filter((r) => r.status === "fail" || r.status === "error").length,
      total: detail?.nodes?.length ?? run.nodeCount ?? records.length,
    };
  }

  function runDisplayStatus(run, summary) {
    if (isLiveRun(run)) return "running";
    if (run.status === "failed" || run.status === "error" || run.error) return "fail";
    if (summary.failed > 0) return "fail";
    if (summary.total > 0 && summary.graded >= summary.total && summary.passed === summary.total) return "pass";
    return run.status || "ungraded";
  }

  function isLiveRun(run) {
    return run && ["running", "pending"].includes(run.status);
  }

  function runStatusPill(status) {
    const cls = status === "pass" || status === "finished" ? "ok" : status === "fail" || status === "failed" || status === "error" ? "bad" : status === "running" || status === "pending" ? "live" : "warn";
    const label = status === "running" ? "running" : status;
    return `<span class="pill ${cls}">${esc(label)}</span>`;
  }

  function nodeStatusPill(status) {
    const cls = status === "pass" ? "ok" : status === "fail" || status === "error" ? "bad" : "warn";
    return `<span class="pill ${cls}">${esc(status)}</span>`;
  }

  function renderLabelPill(label) {
    if (!label) return "—";
    const cls = label === "pass" ? "ok" : label === "fail" ? "bad" : "warn";
    return `<span class="pill ${cls}">${esc(label)}</span>`;
  }

  function labelForTrace(traceId) {
    return state.labels?.[traceId]?.label || null;
  }

  function labelCountForRun(runId) {
    const prefix = `workbench/${runId.slice(0, 8)}/`;
    return Object.entries(state.labels || {}).filter(([traceId, entry]) => traceId.startsWith(prefix) && entry?.label).length;
  }

  function traceIdForNode(runId, nodeId) {
    const detail = state.runDetails.get(runId);
    const capture = detail?.captures
      ?.filter((c) => c.matchedNodeId === nodeId)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    return capture ? `workbench/${runId.slice(0, 8)}/${nodeId}/${capture.dir.split("/").pop()}` : null;
  }

  function artifactKey(runId, nodeId) {
    return `${runId}:${nodeId}`;
  }

  function renderSourceOverlay() {
    return `<div class="source-overlay" role="dialog" aria-modal="true">
      <div class="source-modal">
        <header><strong>${esc(state.path)}</strong><button class="btn" type="button" data-action="close-source">Esc ✕</button></header>
        ${state.sourceError ? `<p class="workflow-error">${esc(state.sourceError)}</p>` : `<pre>${esc(state.sourceText)}</pre>`}
      </div>
    </div>`;
  }

  function attachHandlers() {
    container.querySelectorAll("[data-node]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const params = new URLSearchParams(ctx.params);
        params.set("node", btn.dataset.node);
        ctx.navigate(`/workflows/${encodeURIComponent(state.path)}?${params.toString()}`);
      });
    });
    container.querySelectorAll("[data-zoom]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.zoom === "in") state.zoom = Math.min(1.8, state.zoom + 0.1);
        if (btn.dataset.zoom === "out") state.zoom = Math.max(0.5, state.zoom - 0.1);
        if (btn.dataset.zoom === "reset") state.zoom = 1;
        renderShell();
      });
    });
    const chat = container.querySelector("[data-chat]");
    if (chat) chat.addEventListener("submit", (event) => void submitChat(event));

    const sourceBtn = container.querySelector('[data-action="source"]');
    if (sourceBtn) sourceBtn.addEventListener("click", () => void openSource());
    const runBtn = container.querySelector('[data-action="run"]');
    if (runBtn) runBtn.addEventListener("click", () => void runWorkflow());
    const closeNode = container.querySelector('[data-action="close-node"]');
    if (closeNode) closeNode.addEventListener("click", clearSelectedNode);
    const closeSource = container.querySelector('[data-action="close-source"]');
    if (closeSource) closeSource.addEventListener("click", closeSourceOverlay);
    const accept = container.querySelector('[data-action="accept-edit"]');
    if (accept) accept.addEventListener("click", () => void acceptEdit());
    const revert = container.querySelector('[data-action="revert-edit"]');
    if (revert) revert.addEventListener("click", () => void revertEdit(revert.dataset.backup));
    const remove = container.querySelector('[data-action="remove-skill"]');
    if (remove) remove.addEventListener("click", () => void removeSkill(remove.dataset.skill));
    const rerun = container.querySelector('[data-action="rerun-node"]');
    if (rerun) rerun.addEventListener("click", () => void rerunNode());
    const suggest = container.querySelector('[data-action="suggest"]');
    if (suggest) suggest.addEventListener("click", () => void suggestImprovements());

    container.querySelectorAll("[data-run-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => navigateRun(btn.dataset.runToggle));
    });
    container.querySelectorAll("[data-node-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => navigateNodeDetail(btn.dataset.runId, btn.dataset.nodeId));
    });
    container.querySelectorAll("[data-grade-nodes]").forEach((btn) => {
      btn.addEventListener("click", () => void gradeRunNodes(btn.dataset.gradeNodes));
    });
    container.querySelectorAll("[data-runloop-rerun]").forEach((btn) => {
      btn.addEventListener("click", () => void rerunNodeFromLoop(btn.dataset.runId, btn.dataset.nodeId));
    });
    container.querySelectorAll("[data-runloop-suggest]").forEach((btn) => {
      btn.addEventListener("click", () => void suggestFixFromLoop(btn.dataset.runId, btn.dataset.nodeId));
    });
    container.querySelectorAll("[data-label-action]").forEach((btn) => {
      btn.addEventListener("click", () => void saveRunLoopLabel(btn.dataset.traceId, btn.dataset.labelAction, btn));
    });

    const skillInput = container.querySelector("[data-skill-search]");
    if (skillInput) {
      renderSkillMatches(skillInput.value || "");
      skillInput.addEventListener("input", () => renderSkillMatches(skillInput.value));
    }
  }

  function renderSkillMatches(query) {
    const box = container.querySelector("[data-skill-matches]");
    if (!box) return;
    const q = query.trim().replace(/^\$/, "").toLowerCase();
    const matches = state.skills
      .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q))
      .slice(0, 6);
    box.innerHTML = matches.length
      ? matches
          .map((s) => {
            const summary = s.evalSummary
              ? `${s.evalSummary.withSkill.pass}/${s.evalSummary.withSkill.total} ↩`
              : "no evals";
            return `<button class="skill-match" type="button" data-install-skill="${esc(s.name)}">
              <strong>$${esc(s.name)}</strong><span>${esc((s.description || "").slice(0, 90))}</span><em>${esc(summary)}</em>
            </button>`;
          })
          .join("")
      : `<p class="workflow-muted">No matching skills.</p>`;
    box.querySelectorAll("[data-install-skill]").forEach((btn) => {
      btn.addEventListener("click", () => void installSkill(btn.dataset.installSkill));
    });
  }

  async function submitChat(event) {
    event.preventDefault();
    const textarea = event.currentTarget.querySelector("textarea");
    const instruction = textarea.value.trim();
    if (!instruction) return;
    state.busy = true;
    state.editResult = null;
    state.chatStatus = `<span class="pill live">editing workflow…</span>`;
    renderShell();
    try {
      const result = await postJson("/api/workflows/edit", { path: state.path, instruction });
      state.editResult = result;
      state.chatStatus = result.ok ? "" : `<span class="pill bad">edit failed</span>`;
    } catch (error) {
      state.chatStatus = `<span class="workflow-error">${esc(error.message)}</span>`;
    } finally {
      state.busy = false;
      renderShell();
    }
  }

  async function acceptEdit() {
    state.editResult = null;
    state.chatStatus = `<span class="pill ok">change accepted</span>`;
    await refreshGraphAndFacts();
  }

  async function revertEdit(backup) {
    if (!backup) return;
    state.chatStatus = `<span class="pill live">reverting…</span>`;
    renderShell();
    try {
      await postJson("/api/workflows/revert", { path: state.path, backup });
      state.editResult = null;
      state.chatStatus = `<span class="pill ok">reverted</span>`;
      await refreshGraphAndFacts();
    } catch (error) {
      state.chatStatus = `<span class="workflow-error">${esc(error.message)}</span>`;
      renderShell();
    }
  }

  async function installSkill(skill) {
    const nodeId = selectedNodeId();
    if (!nodeId || !skill) return;
    const instruction = `Install the skill "${skill}" into node "${nodeId}" via the PoolAgent skill option ({ name: "${skill}", from: join(ROOT, "..", "..", "skills", "${skill}") }). Change nothing else.`;
    await editByInstruction(instruction, `installing $${skill}…`);
  }

  async function removeSkill(skill) {
    const nodeId = selectedNodeId();
    if (!nodeId || !skill) return;
    if (!confirm(`Remove $${skill} from node ${nodeId}?`)) return;
    const instruction = `Remove the skill "${skill}" from node "${nodeId}" (drop its PoolAgent skill option). Change nothing else.`;
    await editByInstruction(instruction, `removing $${skill}…`);
  }

  async function editByInstruction(instruction, label) {
    state.busy = true;
    state.editResult = null;
    state.chatStatus = `<span class="pill live">${esc(label)}</span>`;
    renderShell();
    try {
      state.editResult = await postJson("/api/workflows/edit", { path: state.path, instruction });
      state.chatStatus = state.editResult.ok ? "" : `<span class="pill bad">edit failed</span>`;
    } catch (error) {
      state.chatStatus = `<span class="workflow-error">${esc(error.message)}</span>`;
    } finally {
      state.busy = false;
      renderShell();
    }
  }

  async function rerunNode() {
    const nodeId = selectedNodeId();
    if (!nodeId) return;
    state.evalStatus = `<span class="pill live">running trials…</span>`;
    renderShell();
    try {
      const res = await fetch("/api/node-evals/standalone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: ctx.project, path: state.path, nodeId, trials: 3 }),
        signal: AbortSignal.timeout(230_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
      state.evalStatus = `<span class="pill ok">trials graded</span>`;
    } catch (error) {
      state.evalStatus =
        error?.name === "TimeoutError"
          ? `<span class="pill live">still running server-side — grades will appear here when done.</span>`
          : `<span class="workflow-error">${esc(error.message)}</span>`;
    }
    await refreshFactsOnly();
  }

  async function suggestImprovements() {
    const nodeId = selectedNodeId();
    const skill = factFor(nodeId)?.skill;
    if (!nodeId || !skill || state.proposalsAvailable === false) return;
    state.evalStatus = `<span class="pill live">requesting suggestion…</span>`;
    renderShell();
    try {
      const result = await postJson("/api/proposals/suggest", {
        skill,
        source: "inspector",
        refs: { workflowPath: state.path, nodeId },
      });
      state.evalStatus = `<span class="pill live">proposal job started ${esc(result.tag || "")} — lands on the skill page</span>`;
    } catch (error) {
      state.evalStatus = `<span class="workflow-error">${esc(error.message)}</span>`;
    }
    renderShell();
  }

  async function runWorkflow() {
    state.runStatus = `<span class="pill live">starting…</span>`;
    renderShell();
    try {
      const result = await postJson("/api/workflows/run", { path: state.path });
      state.runStatus = `<span class="pill live">run started ${esc((result.runId || "").slice(0, 8))}</span>`;
      await loadRunLoopData();
      if (result.runId) {
        const params = new URLSearchParams(ctx.params);
        params.set("run", result.runId);
        params.delete("graded");
        ctx.navigate(`/workflows/${encodeURIComponent(state.path)}?${params.toString()}`);
        return;
      }
    } catch (error) {
      state.runStatus = `<span class="pill bad">${esc(error.message)}</span>`;
    }
    renderShell();
  }

  async function openSource() {
    state.sourceText = "";
    state.sourceError = null;
    renderShell();
    try {
      const res = await fetch(withProject(`/api/workflows/source?path=${encodeURIComponent(state.path)}`));
      const text = await res.text();
      if (!res.ok) {
        try {
          state.sourceError = JSON.parse(text).error || text;
        } catch {
          state.sourceError = text;
        }
      } else {
        state.sourceText = text;
      }
    } catch (error) {
      state.sourceError = error.message;
    }
    renderShell();
  }

  function closeSourceOverlay() {
    state.sourceText = null;
    state.sourceError = null;
    renderShell();
  }

  function clearSelectedNode() {
    const params = new URLSearchParams(ctx.params);
    params.delete("node");
    const qs = params.toString();
    ctx.navigate(`/workflows/${encodeURIComponent(state.path)}${qs ? `?${qs}` : ""}`);
  }

  async function refreshGraphAndFacts() {
    const graph = await api(withProject(`/api/workflows/graph?path=${encodeURIComponent(state.path)}`));
    const facts = await api(withProject(`/api/workflows/nodes?path=${encodeURIComponent(state.path)}`));
    state.graph = graph;
    state.facts = facts;
    state.graphError = null;
    await checkProposalsForSelected();
    renderShell();
  }

  async function refreshFactsOnly() {
    try {
      state.facts = await api(withProject(`/api/workflows/nodes?path=${encodeURIComponent(state.path)}`));
    } catch {
      // Graph/source may be missing; keep the old facts visible.
    }
    await checkProposalsForSelected();
    renderShell();
  }

  async function checkProposalsForSelected() {
    const skill = factFor(selectedNodeId())?.skill;
    state.proposalsAvailable = null;
    if (!skill) return;
    try {
      const res = await fetch(`/api/proposals?skill=${encodeURIComponent(skill)}`);
      state.proposalsAvailable = res.status !== 404;
    } catch {
      state.proposalsAvailable = false;
    }
  }

  function factFor(nodeId) {
    return state.facts.find((f) => f.nodeId === nodeId) || null;
  }

  function taskNode(nodeId) {
    if (!nodeId || !state.graph) return null;
    return state.graph.nodes.find((n) => n.id === nodeId && n.kind === "task") || null;
  }

  function computeLayout(graph) {
    const incoming = new Map(graph.nodes.map((n) => [n.id, []]));
    const outgoing = new Map(graph.nodes.map((n) => [n.id, []]));
    for (const e of graph.edges) {
      if (incoming.has(e.to)) incoming.get(e.to).push(e.from);
      if (outgoing.has(e.from)) outgoing.get(e.from).push(e.to);
    }
    const depth = new Map();
    const visit = (id, d) => {
      if ((depth.get(id) ?? -1) >= d) return;
      depth.set(id, d);
      for (const next of outgoing.get(id) || []) visit(next, d + 1);
    };
    for (const n of graph.nodes) if (!(incoming.get(n.id) || []).length) visit(n.id, 0);
    for (const n of graph.nodes) if (!depth.has(n.id)) depth.set(n.id, 0);
    const lanes = new Map();
    const pos = new Map();
    for (const n of graph.nodes) {
      const d = depth.get(n.id);
      const lane = lanes.get(d) || 0;
      lanes.set(d, lane + 1);
      pos.set(n.id, { x: d * (W + GX) + 12, y: lane * (H + GY) + 12 });
    }
    const width = Math.max(...[...pos.values()].map((p) => p.x)) + W + 24;
    const height = Math.max(...[...pos.values()].map((p) => p.y)) + H + 24;
    return { pos, width, height };
  }

  function highlightPrompt(text) {
    return esc(text).replace(/(\{ctx\.[^}]*\})/g, '<mark class="ctx-ref">$1</mark>');
  }

  function renderAttempts(attempts = []) {
    return `<ul>${attempts
      .map((a) => `<li>${esc(a.kind)}: ${a.ok ? "ok" : `failed — ${esc((a.detail || "").slice(0, 300))}`}</li>`)
      .join("")}</ul>`;
  }

  function renderLineDiff(before, after) {
    const a = before.split("\n");
    const b = after.split("\n");
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
    const lines = [
      ...removed.map((line) => `<span class="diff-del">− ${esc(line)}</span>`),
      ...added.map((line) => `<span class="diff-add">+ ${esc(line)}</span>`),
    ];
    if (!lines.length) lines.push(`<span class="workflow-muted">No visible line changes.</span>`);
    if (removed.length + added.length >= 160) lines.push(`<span class="workflow-muted">Diff truncated.</span>`);
    return `<pre class="line-diff">${lines.join("\n")}</pre>`;
  }

  function clearTimers() {
    for (const t of state.timers) clearTimeout(t);
    if (state.pollTimer) clearTimeout(state.pollTimer);
    window.removeEventListener("keydown", keyHandler);
  }

  function keyHandler(event) {
    if (event.key === "Escape" && (state.sourceText !== null || state.sourceError)) closeSourceOverlay();
  }

}
