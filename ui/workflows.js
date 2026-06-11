/* Workbench tab: workflow runs as eval-style trajectory records, NL
 * authoring of workflows AND skills (model selectable), and live eval
 * results from the harness output tree.
 * Vanilla JS against ui/server.ts; degrades to an offline banner. */

(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    project: null,
    workflows: [],
    selectedWorkflow: null,
    runs: [],
    selectedRun: null,
    pollTimer: null,
    evalTimer: null,
  };

  async function api(path, options) {
    const res = await fetch(path, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
    return body;
  }

  function fmtDuration(ms) {
    if (ms == null) return "–";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 120_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  function fmtAgo(ms) {
    if (!ms) return "–";
    const delta = Date.now() - ms;
    if (delta < 60_000) return `${Math.max(1, Math.round(delta / 1000))}s ago`;
    if (delta < 3_600_000) return `${Math.round(delta / 60000)}m ago`;
    if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
    return new Date(ms).toLocaleString();
  }

  function statusPill(status) {
    const cls =
      {
        finished: "ok",
        succeeded: "ok",
        pass: "ok",
        running: "live",
        pending: "live",
        failed: "bad",
        fail: "bad",
        cancelled: "bad",
        error: "bad",
        incomplete: "",
      }[status] || "";
    return `<span class="wf-pill ${cls}">${esc(status)}</span>`;
  }

  function esc(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  }

  /** Entity-escaping does not neutralize javascript:/data: schemes in hrefs;
   * only http(s) URLs from capture data may become links. */
  function trajectoryLink(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return `<a href="${esc(url)}" target="_blank" rel="noreferrer">trajectory ↗</a>`;
      }
    } catch {
      // not a URL
    }
    return "";
  }

  // ---- projects + models ---------------------------------------------------

  async function loadProjects() {
    const projects = await api("/api/projects");
    const select = $("wf-project");
    select.innerHTML = projects
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.hasDb ? "" : " (no runs db)"}</option>`)
      .join("");
    state.project = projects[0]?.id ?? null;
    select.onchange = () => {
      state.project = select.value;
      state.selectedRun = null;
      refreshAll();
    };
  }

  async function loadModels() {
    try {
      const models = await api("/api/models");
      const options = models
        .map((m) => `<option value="${esc(m)}"${m === "laguna-m.1" ? " selected" : ""}>${esc(m)}</option>`)
        .join("");
      $("wf-compose-model").innerHTML = options;
      $("wf-skill-model").innerHTML = options;
    } catch {
      const fallback = '<option value="laguna-m.1">laguna-m.1</option>';
      $("wf-compose-model").innerHTML = fallback;
      $("wf-skill-model").innerHTML = fallback;
    }
  }

  // ---- workflows + graph ---------------------------------------------------

  async function loadWorkflows() {
    state.workflows = await api(`/api/workflows?project=${encodeURIComponent(state.project)}`);
    const list = $("wf-list");
    list.innerHTML =
      state.workflows
        .map(
          (w) =>
            `<li><button type="button" class="wf-item ${
              w.path === state.selectedWorkflow ? "active" : ""
            }" data-path="${esc(w.path)}">${esc(w.name)}<span>${esc(w.path)}</span></button></li>`,
        )
        .join("") || '<li class="wf-hint">No workflow .tsx files found.</li>';
    for (const btn of list.querySelectorAll(".wf-item")) {
      btn.onclick = () => selectWorkflow(btn.dataset.path);
    }
  }

  async function selectWorkflow(path) {
    state.selectedWorkflow = path;
    await loadWorkflows();
    $("wf-graph-title").textContent = `Graph — ${path.split("/").pop()}`;
    $("wf-run-go").hidden = false;
    $("wf-graph").innerHTML = '<p class="wf-hint">Projecting graph…</p>';
    try {
      const graph = await api(
        `/api/workflows/graph?project=${encodeURIComponent(state.project)}&path=${encodeURIComponent(path)}`,
      );
      $("wf-graph").innerHTML = renderGraphSvg(graph);
    } catch (error) {
      $("wf-graph").innerHTML = `<p class="wf-hint">Graph failed: ${esc(error.message)}</p>`;
    }
  }

  function renderGraphSvg(graph, nodeStates = {}) {
    if (!graph.nodes.length) return '<p class="wf-hint">Empty graph.</p>';
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
      for (const next of outgoing.get(id) ?? []) visit(next, d + 1);
    };
    for (const n of graph.nodes) if (!(incoming.get(n.id) ?? []).length) visit(n.id, 0);
    for (const n of graph.nodes) if (!depth.has(n.id)) depth.set(n.id, 0);

    const lanes = new Map();
    const pos = new Map();
    const W = 168;
    const H = 52;
    const GX = 70;
    const GY = 26;
    for (const n of graph.nodes) {
      const d = depth.get(n.id);
      const lane = lanes.get(d) ?? 0;
      lanes.set(d, lane + 1);
      pos.set(n.id, { x: d * (W + GX) + 10, y: lane * (H + GY) + 12 });
    }
    const width = Math.max(...[...pos.values()].map((p) => p.x)) + W + 20;
    const height = Math.max(...[...pos.values()].map((p) => p.y)) + H + 20;

    const edges = graph.edges
      .map((e) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return "";
        const x1 = a.x + W;
        const y1 = a.y + H / 2;
        const x2 = b.x;
        const y2 = b.y + H / 2;
        const mx = (x1 + x2) / 2;
        return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" class="wf-edge"/>`;
      })
      .join("");

    const nodes = graph.nodes
      .map((n) => {
        const p = pos.get(n.id);
        const cls = n.kind === "control" ? "wf-node control" : "wf-node";
        const runState = nodeStates[n.id] ? ` data-state="${esc(nodeStates[n.id])}"` : "";
        const title = n.prompt ? `<title>${esc(n.prompt.slice(0, 600))}</title>` : "";
        return (
          `<g class="${cls}"${runState} transform="translate(${p.x},${p.y})">${title}` +
          `<rect width="${W}" height="${H}" rx="8"/>` +
          `<text x="${W / 2}" y="22" text-anchor="middle" class="wf-node-id">${esc(n.id)}</text>` +
          `<text x="${W / 2}" y="40" text-anchor="middle" class="wf-node-label">${esc(
            (n.label || "").slice(0, 26),
          )}</text></g>`
        );
      })
      .join("");

    return `<svg viewBox="0 0 ${width} ${height}" class="wf-graph-svg" role="img">${edges}${nodes}</svg>`;
  }

  // ---- workflow runs -------------------------------------------------------

  async function loadRuns() {
    state.runs = await api(`/api/runs?project=${encodeURIComponent(state.project)}`);
    $("wf-runs-meta").textContent = `${state.runs.length} trajectory record${
      state.runs.length === 1 ? "" : "s"
    }`;
    $("wf-runs").innerHTML =
      state.runs
        .map((r) => {
          const duration =
            r.startedAtMs && r.finishedAtMs ? fmtDuration(r.finishedAtMs - r.startedAtMs) : "–";
          return (
            `<button type="button" class="wf-run-row ${r.id === state.selectedRun ? "active" : ""}" data-id="${esc(r.id)}">` +
            `${statusPill(r.status)}<strong>${esc(r.title)}</strong>` +
            `<span>${r.nodesFinished}/${r.nodeCount} nodes</span>` +
            `<span>${duration}</span>` +
            `<span>${fmtAgo(r.createdAtMs)}</span>` +
            `<span class="wf-run-id">${esc(r.id.slice(0, 8))}</span></button>`
          );
        })
        .join("") || '<p class="wf-hint">No runs yet. Select a workflow and run it.</p>';
    for (const row of $("wf-runs").querySelectorAll(".wf-run-row")) {
      row.onclick = () => {
        state.selectedRun = row.dataset.id;
        loadRunDetail();
        loadRuns();
      };
    }
  }

  async function loadRunDetail() {
    if (!state.selectedRun) return;
    const detail = await api(
      `/api/runs/${encodeURIComponent(state.selectedRun)}?project=${encodeURIComponent(state.project)}`,
    );
    // Stale-response guard: the user may have selected another run while
    // this fetch was in flight.
    if (detail.run.id !== state.selectedRun) return;
    $("wf-run-detail").hidden = false;
    $("wf-detail-title").textContent = `${detail.run.title} · ${detail.run.id.slice(0, 8)}`;
    $("wf-detail-status").innerHTML = statusPill(detail.run.status);

    const capturesByNode = {};
    for (const c of detail.captures) {
      if (c.matchedNodeId) (capturesByNode[c.matchedNodeId] ??= []).push(c);
    }

    const nodeEvalsByNode = {};
    for (const r of state.nodeEvals ?? []) {
      if (r.mode === "in-workflow" && r.runId === detail.run.id)
        (nodeEvalsByNode[r.nodeId] ??= []).push(r);
    }

    const nodeCards = detail.nodes
      .map((n) => {
        const duration =
          n.startedAtMs && n.finishedAtMs ? fmtDuration(n.finishedAtMs - n.startedAtMs) : "–";
        const caps = capturesByNode[n.nodeId] ?? [];
        const capHtml = caps
          .map((c) => {
            const skill = c.skillInstalled
              ? `<span class="wf-pill ok">skill: ${esc(c.skillInstalled.split("/").pop())}${
                  c.skillToolCalls ? " ✓" : ""
                }</span>`
              : '<span class="wf-pill">no skill</span>';
            const traj = c.trajectoryUrl ? trajectoryLink(c.trajectoryUrl) : "";
            return `<div class="wf-capture">${skill}<span>${c.toolCallCount} tool calls</span><span>pool exit ${c.exitCode}</span>${traj}</div>`;
          })
          .join("");
        const output = n.output
          ? `<pre class="wf-output">${esc(JSON.stringify(stripKeys(n.output), null, 2))}</pre>`
          : '<p class="wf-hint">no output row</p>';
        const errors = n.attempts
          .filter((a) => a.error)
          .map((a) => `<p class="wf-error">attempt ${a.attempt}: ${esc(a.error)}</p>`)
          .join("");
        const grades = (nodeEvalsByNode[n.nodeId] ?? [])
          .slice(0, 1)
          .map(
            (r) =>
              `<div class="wf-capture">${statusPill(r.status)}<span>node eval: score ${
                r.score == null ? "–" : r.score
              } (${esc(r.grader)})</span></div>`,
          )
          .join("");
        return (
          `<article class="wf-node-card" data-state="${esc(n.state)}">` +
          `<header>${statusPill(n.state)}<h3>${esc(n.nodeId)}</h3><span>${duration}</span></header>` +
          `<p class="wf-hint">${esc(n.label)}</p>` +
          capHtml +
          grades +
          output +
          errors +
          `</article>`
        );
      })
      .join("");

    const orphanCaptures = detail.captures.filter((c) => !c.matchedNodeId);
    const orphanHtml = orphanCaptures.length
      ? `<details class="wf-orphans"><summary>${orphanCaptures.length} unmatched pool capture(s)</summary>` +
        orphanCaptures
          .map(
            (c) =>
              `<div class="wf-capture"><span>${esc(c.dir)}</span><span>${fmtDuration(c.durationMs)}</span>${
                c.trajectoryUrl ? trajectoryLink(c.trajectoryUrl) : ""
              }</div>`,
          )
          .join("") +
        `</details>`
      : "";

    $("wf-detail-body").innerHTML =
      `<p class="wf-hint">${detail.nodes.length} nodes · ${detail.agentEventCount} agent events` +
      (detail.run.error ? ` · <span class="wf-error">${esc(detail.run.error)}</span>` : "") +
      `</p><div class="wf-node-grid">${nodeCards}</div>${orphanHtml}`;

    if (["running", "pending"].includes(detail.run.status)) schedulePoll();
  }

  function stripKeys(row) {
    const { run_id, node_id, iteration, ...rest } = row;
    return rest;
  }

  function schedulePoll() {
    clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(async () => {
      // Self-rescheduling: a failed fetch (e.g. 404 while smithers is still
      // writing the run row right after start) must NOT kill the poll loop.
      let keepPolling = true;
      try {
        await loadRuns();
        await loadRunDetail();
        const current = state.runs.find((r) => r.id === state.selectedRun);
        keepPolling = !current || ["running", "pending"].includes(current.status);
        state.pollMisses = current ? 0 : (state.pollMisses ?? 0) + 1;
      } catch {
        state.pollMisses = (state.pollMisses ?? 0) + 1;
      }
      if (keepPolling && (state.pollMisses ?? 0) < 40) schedulePoll();
    }, 3000);
  }

  // ---- skills --------------------------------------------------------------

  async function loadSkills() {
    const skills = await api("/api/skills");
    $("wf-skills").innerHTML =
      skills
        .map((s) => {
          const lift = s.evalSummary
            ? `<span class="wf-skill-meta wf-lift">evals — with skill: ${s.evalSummary.withSkill.pass}/${s.evalSummary.withSkill.total}` +
              (s.evalSummary.withSkill.avgScore != null ? ` (avg ${s.evalSummary.withSkill.avgScore})` : "") +
              ` · without: ${s.evalSummary.withoutSkill.pass}/${s.evalSummary.withoutSkill.total}` +
              (s.evalSummary.withoutSkill.avgScore != null ? ` (avg ${s.evalSummary.withoutSkill.avgScore})` : "") +
              `</span>`
            : '<span class="wf-skill-meta">no eval runs yet</span>';
          return (
            `<li><div class="wf-item wf-skill-item"><strong>${esc(s.name)}</strong>` +
            `<span>${esc(s.description.slice(0, 140))}${s.description.length > 140 ? "…" : ""}</span>` +
            `<span class="wf-skill-meta">v${esc(s.version ?? "?")} · ${s.evalCases} eval cases · ${
              s.validators.length
            } validator${s.validators.length === 1 ? "" : "s"}</span>${lift}</div></li>`
          );
        })
        .join("") || '<li class="wf-hint">No skills found.</li>';
  }

  async function generateSkillHandler() {
    const name = $("wf-skill-name").value.trim();
    const prompt = $("wf-skill-prompt").value.trim();
    if (!name || !prompt) {
      $("wf-skill-status").innerHTML = '<span class="wf-error">Name and description required.</span>';
      return;
    }
    $("wf-skill-go").disabled = true;
    $("wf-skill-status").textContent =
      "pool is authoring the skill… (live run + structure check, can take a few minutes)";
    try {
      const result = await api("/api/skills/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, prompt, agentName: $("wf-skill-model").value }),
      });
      const attempts = (result.attempts ?? [])
        .map((a) => `<li>${a.kind}: ${a.ok ? "ok" : `failed — ${esc((a.detail ?? "").slice(0, 300))}`}</li>`)
        .join("");
      $("wf-skill-status").innerHTML = result.ok
        ? `<span class="wf-ok">Created ${esc(result.path)} (structure check passed)</span><ul>${attempts}</ul>`
        : `<span class="wf-error">${esc(result.error)}</span><ul>${attempts}</ul>`;
      if (result.ok) await loadSkills();
    } catch (error) {
      $("wf-skill-status").innerHTML = `<span class="wf-error">${esc(error.message)}</span>`;
    } finally {
      $("wf-skill-go").disabled = false;
    }
  }

  // ---- evals ---------------------------------------------------------------

  async function loadEvals() {
    const [suites, evalState] = await Promise.all([
      api("/api/evals/suites"),
      api("/api/evals/runs"),
    ]);

    $("wf-eval-suites").innerHTML = suites
      .map(
        (s) =>
          `<div class="wf-run-row wf-eval-suite-row"><strong>${esc(s.name)}</strong>` +
          `<span>${s.cases.length} cases</span>` +
          `<button type="button" class="button secondary wf-suite-run" data-suite="${esc(s.path)}">Run suite</button></div>`,
      )
      .join("");
    for (const btn of document.querySelectorAll(".wf-suite-run")) {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await api("/api/evals/run", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ suite: btn.dataset.suite }),
          });
          scheduleEvalPoll(true);
        } catch (error) {
          alert(`Eval run failed to start: ${error.message}`);
        } finally {
          btn.disabled = false;
        }
      };
    }

    const active = evalState.harness.filter((h) => h.running);
    $("wf-eval-harness").innerHTML = active.length
      ? `<span class="wf-pill live">harness running</span> ${active
          .map((h) => `${esc(h.suite)} (pid ${h.pid}, log ${esc(h.logPath)})`)
          .join(" · ")}`
      : "";

    const byCase = {};
    for (const r of evalState.runs) (byCase[`${r.suite}/${r.caseId}`] ??= []).push(r);
    $("wf-evals-meta").textContent = `${evalState.runs.length} arm-run${
      evalState.runs.length === 1 ? "" : "s"
    } on disk`;
    $("wf-eval-runs").innerHTML =
      Object.entries(byCase)
        .map(([key, arms]) => {
          const armHtml = arms
            .map((a) => {
              const failing = (a.checks ?? []).filter((c) => c.status !== "pass");
              const failDetail = failing.length
                ? `<div class="wf-capture wf-error">${failing
                    .map((c) => `${esc(c.id)}: ${esc((c.detail ?? "").slice(0, 160))}`)
                    .join(" · ")}</div>`
                : "";
              return (
                `<div class="wf-eval-arm">${statusPill(a.status)}<strong>${esc(a.arm)}</strong>` +
                `<span>score ${a.score == null ? "–" : a.score}</span>` +
                `<span>${fmtDuration(a.durationMs)}</span>` +
                `<span>${a.inputTokens == null ? "–" : `${Math.round(a.inputTokens / 1000)}k in / ${a.outputTokens} out`}</span>` +
                `<span>${esc(a.agentName ?? "")}</span></div>` +
                failDetail
              );
            })
            .join("");
          const skill = arms[0]?.skill;
          const skillChip = skill ? `<span class="wf-pill">skill: ${esc(skill)}</span>` : "";
          return `<div class="wf-eval-case"><h3>${esc(key)} ${skillChip}</h3>${armHtml}</div>`;
        })
        .join("") || '<p class="wf-hint">No eval runs on disk yet. Run a suite above.</p>';

    await loadNodeEvals().catch(() => {});
    if (active.length) scheduleEvalPoll();
  }

  async function loadReviewStatus() {
    try {
      const status = await api("/api/review/status");
      const link = $("wf-review-link");
      link.href = status.url;
      link.hidden = !status.running;
    } catch {
      $("wf-review-link").hidden = true;
    }
  }

  async function loadNodeEvals() {
    const records = await api(`/api/node-evals?project=${encodeURIComponent(state.project)}`);
    state.nodeEvals = records;
    $("wf-node-evals").innerHTML =
      records
        .slice(0, 30)
        .map(
          (r) =>
            `<div class="wf-eval-arm">${statusPill(r.status)}<strong>${esc(r.nodeId)}</strong>` +
            `<span>${esc(r.mode)}${r.trial ? ` #${r.trial}` : ""}</span>` +
            `<span>${r.skill ? `skill: ${esc(r.skill)}` : "no skill"}</span>` +
            `<span>score ${r.score == null ? "–" : r.score}</span>` +
            `<span>${esc(r.grader)}</span>` +
            `<span>${r.runId ? `run ${esc(r.runId.slice(0, 8))}` : esc(r.agentName ?? "")}</span>` +
            `<span>${fmtAgo(r.gradedAtMs)}</span></div>`,
        )
        .join("") || '<p class="wf-hint">No node evals yet. Open a run and hit "Grade nodes".</p>';
  }

  function scheduleEvalPoll(immediate = false) {
    clearTimeout(state.evalTimer);
    state.evalTimer = setTimeout(
      // loadEvals re-arms while a harness is alive; on a transient failure
      // re-arm here so one bad fetch doesn't end live updates.
      () => loadEvals().catch(() => scheduleEvalPoll()),
      immediate ? 500 : 5000,
    );
  }

  // ---- workflow composer + run ---------------------------------------------

  function composerStatus(html) {
    $("wf-compose-status").innerHTML = html;
  }

  async function generateWorkflowHandler() {
    const prompt = $("wf-compose-prompt").value.trim();
    if (!prompt) return composerStatus('<span class="wf-error">Describe the workflow first.</span>');
    $("wf-compose-go").disabled = true;
    composerStatus("authoring the workflow… (live pool run, ~30–90s)");
    try {
      const result = await api("/api/workflows/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project: state.project,
          prompt,
          id: $("wf-compose-id").value.trim() || undefined,
          agentName: $("wf-compose-model").value,
        }),
      });
      const attempts = result.attempts
        .map((a) => `<li>${a.kind}: ${a.ok ? "ok" : `failed — ${esc((a.detail ?? "").slice(0, 300))}`}</li>`)
        .join("");
      if (result.ok) {
        composerStatus(
          `<span class="wf-ok">Created ${esc(result.path)} (verified, authored by ${esc(result.agentName)})</span><ul>${attempts}</ul>`,
        );
        await loadWorkflows();
        await selectWorkflow(result.path);
      } else {
        composerStatus(`<span class="wf-error">${esc(result.error)}</span><ul>${attempts}</ul>`);
      }
    } catch (error) {
      composerStatus(`<span class="wf-error">${esc(error.message)}</span>`);
    } finally {
      $("wf-compose-go").disabled = false;
    }
  }

  async function runSelected() {
    if (!state.selectedWorkflow) return;
    $("wf-run-go").disabled = true;
    try {
      const result = await api("/api/workflows/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: state.project, path: state.selectedWorkflow }),
      });
      state.selectedRun = result.runId;
      schedulePoll();
    } catch (error) {
      alert(`Run failed to start: ${error.message}`);
    } finally {
      $("wf-run-go").disabled = false;
    }
  }

  // ---- boot ----------------------------------------------------------------

  async function refreshAll() {
    await loadWorkflows();
    await loadRuns();
    if (state.selectedRun) await loadRunDetail();
  }

  async function boot() {
    try {
      await loadProjects();
      await Promise.all([refreshAll(), loadModels(), loadSkills(), loadEvals()]);
      $("wf-compose-go").onclick = generateWorkflowHandler;
      $("wf-skill-go").onclick = generateSkillHandler;
      $("wf-run-go").onclick = runSelected;
      $("wf-review-sync").onclick = async () => {
        $("wf-review-sync").disabled = true;
        try {
          const result = await api("/api/review/sync", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ project: state.project }),
          });
          $("wf-evals-meta").textContent = `synced ${result.added} workbench trace(s) → review app (${result.total} total)`;
          await loadReviewStatus();
        } catch (error) {
          alert(`Sync failed: ${error.message}`);
        } finally {
          $("wf-review-sync").disabled = false;
        }
      };
      void loadReviewStatus();
      $("wf-grade-nodes").onclick = async () => {
        if (!state.selectedRun) return;
        $("wf-grade-nodes").disabled = true;
        try {
          await api("/api/node-evals/insitu", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ project: state.project, runId: state.selectedRun }),
          });
          await loadNodeEvals();
          await loadRunDetail();
        } catch (error) {
          alert(`Grading failed: ${error.message}`);
        } finally {
          $("wf-grade-nodes").disabled = false;
        }
      };
      if (state.workflows.length) await selectWorkflow(state.workflows[0].path);
    } catch {
      $("wf-offline").hidden = false;
    }
  }

  boot();
})();
