const FACETS = ["type", "skill", "workflow", "arm", "verdict"];

function facetState(params) {
  return Object.fromEntries(FACETS.map((key) => [key, params.get(key) || ""]));
}

function withFacet(ctx, key, value) {
  const params = new URLSearchParams(ctx.params.toString());
  if (!value || params.get(key) === value) params.delete(key);
  else params.set(key, value);
  const query = params.toString();
  ctx.navigate(`/runs${query ? `?${query}` : ""}`);
}

function setFacets(ctx, values) {
  const params = new URLSearchParams(ctx.params.toString());
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  ctx.navigate(`/runs${query ? `?${query}` : ""}`);
}

function fmtRatio(summary) {
  const avg = summary.avgScore == null ? "avg —" : `avg ${summary.avgScore.toFixed(2)}`;
  return `${summary.pass}/${summary.total} · ${avg}`;
}

function fmtLift(lift) {
  if (lift == null) return "—";
  const sign = lift > 0 ? "+" : "";
  return `${sign}${lift.toFixed(1)}pp`;
}

function verdictPill(verdict, esc) {
  const cls = { pass: "ok", fail: "bad", error: "bad", running: "live", ungraded: "warn" }[verdict] || "";
  const label = verdict === "running" ? "in progress…" : verdict;
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}

function labelPill(label, esc) {
  if (!label) return "—";
  const cls = label === "pass" ? "ok" : label === "fail" ? "bad" : "warn";
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}

function recordMatches(record, facets) {
  if (facets.type && record.type !== facets.type) return false;
  if (facets.skill && record.skill !== facets.skill) return false;
  if (facets.workflow && !(record.workflow || "").includes(facets.workflow)) return false;
  if (facets.arm && record.arm !== facets.arm) return false;
  if (facets.verdict && record.verdict !== facets.verdict) return false;
  return true;
}

function filteredRecords(records, facets) {
  return records.flatMap((record) => {
    const children = record.children || [];
    const matchingChildren = children.filter((child) => recordMatches(child, facets));
    const parentMatches = recordMatches(record, facets);
    if (!parentMatches && matchingChildren.length === 0) return [];
    if (children.length === 0) return [record];
    const childFacetActive = Boolean(facets.arm || facets.verdict || facets.skill || facets.workflow);
    return [{ ...record, children: childFacetActive ? matchingChildren : children }];
  });
}

function reviewHref(ctx, traceId) {
  const params = new URLSearchParams(ctx.params.toString());
  params.set("trace", traceId);
  return `#/review?${params.toString()}`;
}

function renderScorecard(rows, activeSkill, esc) {
  if (!rows.length) {
    return `<div class="scorecard-empty">No skill scorecard yet — run an eval suite or node eval to create evidence.</div>`;
  }
  return `<div class="scorecard-table">
    <div class="scorecard-head scorecard-row">
      <span>SKILL</span><span>LIFT</span><span>WITH SKILL</span><span>WITHOUT</span><span>IN-WORKFLOW</span><span>UNLABELED</span><span>▸</span>
    </div>
    ${rows.map((row, index) => `<button class="scorecard-row ${row.skill === activeSkill ? "selected" : ""}" data-facet="skill" data-value="${esc(row.skill)}">
      <span class="score-skill">${esc(row.skill)}</span>
      <span class="score-lift ${row.lift == null ? "muted" : row.lift < 0 ? "bad" : "ok"}">${esc(fmtLift(row.lift))}</span>
      <span>${esc(fmtRatio(row.withSkill))}</span>
      <span>${esc(fmtRatio(row.withoutSkill))}</span>
      <span>${esc(`${row.inWorkflow.pass}/${row.inWorkflow.total}`)}</span>
      <span>${row.unlabeledFails > 0 ? `<a href="#" data-fails-link="${esc(row.skill)}">${esc(`${row.unlabeledFails} fails →`)}</a>` : "—"}</span>
      <span>${index === 0 ? "weakest" : ""}</span>
    </button>`).join("")}
  </div>`;
}

function renderChips(facets, esc) {
  return `<div class="facet-chips">
    ${FACETS.map((key) => {
      const value = facets[key];
      return `<button class="pill ${value ? "live" : ""}" data-clear-facet="${esc(key)}">
        ${esc(key)}${value ? `: ${esc(value)} ✕` : ": all"}
      </button>`;
    }).join("")}
  </div>`;
}

function renderTiming(record, helpers) {
  const at = helpers.fmtAgo(record.atMs);
  const duration = helpers.fmtDuration(record.durationMs);
  return `${at}<br><span class="muted">${duration}</span>`;
}

function renderRow(record, ctx, expanded, child = false) {
  const { esc } = ctx.helpers;
  const canExpand = record.children?.length;
  const open = expanded.has(record.id);
  const action = canExpand
    ? `<button class="row-action" data-expand="${esc(record.id)}">${open ? "▾" : "▸"}</button>`
    : record.verdict === "fail" && record.traceId
      ? `<a class="row-action" href="${esc(reviewHref(ctx, record.traceId))}" title="Open in Review">▸</a>`
      : "";
  const score = record.score == null ? "" : ` · score ${Number(record.score).toFixed(2)}`;
  const row = `<div class="feed-row ${child ? "child" : ""} ${record.type === "playground" ? "playground-row" : ""}">
    <button class="type-tag ${esc(record.type)}" data-facet="type" data-value="${esc(record.type)}">${esc(record.type)}</button>
    <div class="record-cell">
      <div class="record-title">${esc(record.title)}</div>
      <div class="record-meta">
        <code>${esc(record.id)}</code>${record.skill ? ` · <button class="linkish" data-facet="skill" data-value="${esc(record.skill)}">${esc(record.skill)}</button>` : ""}${record.workflow ? ` · <button class="linkish" data-facet="workflow" data-value="${esc(record.workflow)}">${esc(record.workflow)}</button>` : ""}${score}
      </div>
    </div>
    <div>${record.arm ? `<button class="linkish" data-facet="arm" data-value="${esc(record.arm)}">${esc(record.arm)}</button>` : "—"}<br><span class="muted">${esc(record.model || "")}</span></div>
    <div>${renderTiming(record, ctx.helpers)}</div>
    <button class="verdict-button" data-facet="verdict" data-value="${esc(record.verdict)}">${verdictPill(record.verdict, esc)}</button>
    <div>${record.type === "playground" ? `<button class="btn pass-tint small">+ eval case</button>` : labelPill(record.label, esc)}</div>
    <div>${action}</div>
  </div>`;
  if (!canExpand || !open) return row;
  return row + record.children.map((childRecord) => renderRow(childRecord, ctx, expanded, true)).join("");
}

function renderFeed(records, ctx, expanded) {
  if (!records.length) {
    return `<div class="empty-feed">No trajectory records yet — run a workflow, an eval suite, or a playground prompt.</div>`;
  }
  return `<div class="feed-grid">
    <div class="feed-head">TYPE</div><div class="feed-head">RECORD</div><div class="feed-head">ARM/MODEL</div><div class="feed-head">TIMING</div><div class="feed-head">VERDICT</div><div class="feed-head">LABEL</div><div class="feed-head">▸</div>
    ${records.map((record) => renderRow(record, ctx, expanded)).join("")}
  </div>`;
}

export async function mount(container, ctx) {
  const { esc } = ctx.helpers;
  const expanded = new Set();
  let timeout = null;
  let disposed = false;

  async function loadAndRender() {
    const projectQuery = ctx.project ? `?project=${encodeURIComponent(ctx.project)}` : "";
    const data = await ctx.helpers.api(`/api/feed${projectQuery}`);
    if (disposed) return;
    for (const record of data.records || []) {
      if (record.type === "eval" && record.children?.length) expanded.add(record.id);
    }
    const facets = facetState(ctx.params);
    const visible = filteredRecords(data.records || [], facets);
    container.innerHTML = `<section class="runs-page">
      <div class="runs-header">
        <span class="mono-label">RUNS</span>
        <h1>Runs feed</h1>
        <p>One feed for workflow runs, eval arms, node evals, and playground records. Skill is a facet, not a separate table.</p>
      </div>
      <section class="panel runs-panel">
        <div class="section-title"><span class="mono-label">SKILL SCORECARD</span><span>${esc(String((data.scorecard || []).length))} skills</span></div>
        ${renderScorecard(data.scorecard || [], facets.skill, esc)}
      </section>
      <section class="panel runs-panel">
        <div class="section-title"><span class="mono-label">FACETS</span><span>${esc(String(visible.length))} records</span></div>
        ${renderChips(facets, esc)}
        ${renderFeed(visible, ctx, expanded)}
      </section>
    </section>`;

    container.querySelectorAll("[data-facet]").forEach((el) => {
      el.addEventListener("click", (event) => {
        event.preventDefault();
        withFacet(ctx, el.dataset.facet, el.dataset.value || "");
      });
    });
    container.querySelectorAll("[data-clear-facet]").forEach((el) => {
      el.addEventListener("click", () => {
        if (ctx.params.get(el.dataset.clearFacet)) withFacet(ctx, el.dataset.clearFacet, "");
      });
    });
    container.querySelectorAll("[data-fails-link]").forEach((el) => {
      el.addEventListener("click", (event) => {
        event.preventDefault();
        setFacets(ctx, { skill: el.dataset.failsLink, verdict: "fail" });
      });
    });
    container.querySelectorAll("[data-expand]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.expand;
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        const facets = facetState(ctx.params);
        const visible = filteredRecords(data.records || [], facets);
        const feed = container.querySelector(".feed-grid")?.parentElement;
        if (feed) {
          feed.querySelector(".feed-grid, .empty-feed")?.remove();
          feed.insertAdjacentHTML("beforeend", renderFeed(visible, ctx, expanded));
          loadAndRender();
        }
      });
    });

    const running = (data.records || []).some((record) => record.verdict === "running" || record.children?.some((child) => child.verdict === "running"));
    if (running && !disposed) timeout = setTimeout(() => void loadAndRender().catch(() => {}), 5000);
  }

  container.innerHTML = `<section class="panel" style="margin:24px;padding:32px"><span class="mono-label">RUNS</span><p>Loading feed…</p></section>`;
  await loadAndRender();
  return () => {
    disposed = true;
    if (timeout) clearTimeout(timeout);
  };
}
