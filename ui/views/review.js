const STORAGE_PREFIX = "laguna-review-pending:";
const REVIEW_LABELS_URL = "/api/review/labels";

export async function mount(container, ctx) {
  const esc = ctx.helpers?.esc ?? escapeHtml;
  const state = {
    traces: [],
    labels: {},
    view: [],
    cursor: 0,
    undo: [],
    notesTimer: null,
    showGold: true,
    version: { traces: null, labels: null },
    filters: filtersFromParams(ctx.params),
    traceParam: ctx.params.get("trace") || "",
    notice: "",
    hotReloadTimer: null,
    disposed: false,
  };

  container.innerHTML = renderShell();
  const root = container.querySelector(".review-view");
  const q = (selector) => root.querySelector(selector);

  function setStatus(text, isError = false) {
    const el = q("[data-save-status]");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("err", isError);
  }

  function flashStatus(text) {
    setStatus(text);
    setTimeout(() => {
      if (!state.disposed && q("[data-save-status]")?.textContent === text) setStatus("");
    }, 2500);
  }

  function current() {
    return state.view.length ? state.traces[state.view[state.cursor]] : null;
  }

  function currentEntry() {
    const t = current();
    return t ? state.labels[t.trace_id] || {} : {};
  }

  function filterTrace(t) {
    const entry = state.labels[t.trace_id] || {};
    const wantedVerdict = normalizeVerdict(state.filters.verdict);
    if (state.filters.skill && t.skill !== state.filters.skill) return false;
    if (state.filters.arm && t.arm !== state.filters.arm) return false;
    if (wantedVerdict && verdict(t) !== wantedVerdict) return false;
    if (state.filters.label === "unlabeled" && entry.label) return false;
    if (["pass", "fail", "defer"].includes(state.filters.label) && entry.label !== state.filters.label) return false;
    return true;
  }

  function rebuildView({ preferredTraceId = "", fallbackCursor = state.cursor, allowMissingNotice = false } = {}) {
    state.view = state.traces.map((_, i) => i).filter((i) => filterTrace(state.traces[i]));
    const wanted = preferredTraceId || state.traceParam;
    let idx = wanted ? state.view.findIndex((i) => state.traces[i].trace_id === wanted) : -1;
    if (idx >= 0) {
      state.cursor = idx;
      if (allowMissingNotice) state.notice = "";
    } else {
      state.cursor = Math.max(0, Math.min(fallbackCursor, Math.max(0, state.view.length - 1)));
      if (allowMissingNotice && wanted) {
        state.notice = `Trace ${wanted} is not in this facet; showing the first matching trace.`;
      }
    }
  }

  function render() {
    if (state.disposed) return;
    const modeBar = q("[data-mode-bar]");
    const center = q("[data-center]");
    const rail = q("[data-rail]");
    const labelBar = q("[data-label-bar]");

    if (!state.traces.length) {
      modeBar.innerHTML = `<span class="mono-label">REVIEW</span><span class="review-mode-title">No traces loaded</span>`;
      center.innerHTML = `<section class="panel review-empty">No review traces are available yet.</section>`;
      rail.innerHTML = "";
      labelBar.hidden = true;
      return;
    }

    if (!state.view.length) {
      modeBar.innerHTML = renderModeBar(null);
      center.innerHTML = `<section class="panel review-empty">No traces match this facet.</section>`;
      rail.innerHTML = "";
      labelBar.hidden = true;
      return;
    }

    state.cursor = Math.max(0, Math.min(state.cursor, state.view.length - 1));
    const t = current();
    const entry = currentEntry();
    modeBar.innerHTML = renderModeBar(t);
    center.innerHTML = [
      state.notice ? `<div class="review-notice">${esc(state.notice)}</div>` : "",
      verdictBanner(t),
      renderPrompt(t),
      renderOutput(t),
      renderValidator(t),
      renderJudge(t),
      renderFinalMessage(t),
      renderCollapsed(t),
    ].join("");
    rail.innerHTML = renderTrajectory(t);
    labelBar.hidden = false;

    for (const [selector, value] of [
      ["[data-label-pass]", "pass"],
      ["[data-label-fail]", "fail"],
      ["[data-label-defer]", "defer"],
    ]) {
      q(selector).classList.toggle("selected", entry.label === value);
    }
    const notes = q("[data-notes]");
    if (document.activeElement !== notes) notes.value = entry.notes || "";
    q("[data-toggle-gold]").textContent = state.showGold ? "Gold: on" : "Gold: off";
    q("[data-prev]").disabled = state.cursor <= 0;
    q("[data-next]").disabled = state.cursor >= state.view.length - 1;
  }

  function renderModeBar(t) {
    const params = new URLSearchParams();
    for (const [k, v] of ctx.params.entries()) {
      if (k !== "trace") params.append(k, v);
    }
    const runHref = `#/runs${params.toString() ? `?${params}` : ""}`;
    const position = t
      ? `<span class="review-position"><b>${state.cursor + 1}</b> of ${state.view.length} ${esc(facetDescription())}</span>`
      : `<span class="review-position">0 ${esc(facetDescription())}</span>`;
    const pills = t
      ? [
          `<span class="pill">${esc(armShort(t.arm))}</span>`,
          `<span class="pill ${verdictClass(verdict(t))}">graded ${esc(verdict(t))}</span>`,
          `<span class="pill">${esc(t.skill || "unknown skill")}</span>`,
          t.demo ? `<span class="pill warn">DEMO</span>` : "",
        ].join("")
      : "";
    return `<a class="btn review-back" href="${esc(runHref)}">← back to runs</a>
      <span class="review-case mono">${esc(t?.case_id || "review")}</span>
      <span class="review-mode-pills">${pills}</span>
      ${position}
      <button class="btn" type="button" data-toggle-gold title="Toggle the gold reference column (R)">${state.showGold ? "Gold: on" : "Gold: off"}</button>`;
  }

  function facetDescription() {
    const parts = [];
    if (state.filters.label === "unlabeled") parts.push("unlabeled");
    else if (state.filters.label) parts.push(`labeled ${state.filters.label}`);
    const v = normalizeVerdict(state.filters.verdict);
    if (v) parts.push(`in ${v.toLowerCase()}s`);
    if (state.filters.arm) parts.push(`arm ${state.filters.arm}`);
    if (state.filters.skill) parts.push(state.filters.skill);
    return parts.length ? parts.join(" · ") : "all traces";
  }

  function updateTraceParam() {
    const t = current();
    if (!t) return;
    const params = new URLSearchParams(ctx.params);
    params.set("trace", t.trace_id);
    state.traceParam = t.trace_id;
    const nextHash = `#/review?${params}`;
    if (location.hash !== nextHash) history.replaceState(null, "", nextHash);
  }

  function toggleGold() {
    state.showGold = !state.showGold;
    q("[data-toggle-gold]").textContent = state.showGold ? "Gold: on" : "Gold: off";
    for (const cmp of root.querySelectorAll(".review-cmp")) cmp.classList.toggle("hide-gold", !state.showGold);
  }

  async function postEvidenceIfSupported(trace, patch) {
    if (patch.label !== "fail" || !trace?.skill) return;
    try {
      await fetch("/api/proposals/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill: trace.skill, source: "review", traceId: trace.trace_id, note: patch.notes || "" }),
      });
    } catch {
      // Plan 004 may not be applied; evidence routing is best-effort only.
    }
  }

  async function persist(traceId, patch) {
    setStatus("saving…");
    const trace = state.traces.find((t) => t.trace_id === traceId);
    try {
      const res = await fetch(REVIEW_LABELS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trace_id: traceId, ...patch }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `${res.status}`);
      localStorage.removeItem(STORAGE_PREFIX + traceId);
      setStatus("saved ✓");
      void postEvidenceIfSupported(trace, patch);
    } catch (error) {
      setStatus("save failed — kept locally", true);
      localStorage.setItem(STORAGE_PREFIX + traceId, JSON.stringify({ ...patch, at: Date.now() }));
    }
  }

  function setLabel(label) {
    const t = current();
    if (!t) return;
    const prevCursor = state.cursor;
    const prev = { ...(state.labels[t.trace_id] || {}) };
    state.undo.push({ trace_id: t.trace_id, prev });
    const entry = (state.labels[t.trace_id] = { ...(state.labels[t.trace_id] || {}) });
    entry.label = entry.label === label ? null : label;
    void persist(t.trace_id, { label: entry.label, notes: entry.notes || "" });
    rebuildView({ preferredTraceId: t.trace_id, fallbackCursor: prevCursor });
    render();
    updateTraceParam();
  }

  async function saveNotes(immediate = false) {
    const t = current();
    if (!t) return;
    const entry = (state.labels[t.trace_id] = { ...(state.labels[t.trace_id] || {}) });
    entry.notes = q("[data-notes]").value;
    clearTimeout(state.notesTimer);
    const doSave = () => persist(t.trace_id, { label: entry.label || null, notes: entry.notes });
    if (immediate) return doSave();
    state.notesTimer = setTimeout(doSave, 600);
  }

  function undo() {
    const op = state.undo.pop();
    if (!op) return;
    const prevCursor = state.cursor;
    state.labels[op.trace_id] = op.prev;
    void persist(op.trace_id, { label: op.prev.label || null, notes: op.prev.notes || "" });
    rebuildView({ preferredTraceId: op.trace_id, fallbackCursor: prevCursor });
    render();
    updateTraceParam();
  }

  function nav(delta, { skipSave = false } = {}) {
    if (!state.view.length) return;
    if (!skipSave) void saveNotes(true);
    state.cursor = Math.min(Math.max(state.cursor + delta, 0), state.view.length - 1);
    state.notice = "";
    render();
    updateTraceParam();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function refreshTraces() {
    const res = await fetch("/api/review/traces");
    if (!res.ok) return;
    const doc = await res.json();
    const keepId = current()?.trace_id || state.traceParam;
    state.traces = doc.traces || [];
    rebuildView({ preferredTraceId: keepId });
    render();
    updateTraceParam();
    flashStatus("traces refreshed ↻");
  }

  async function refreshLabels() {
    const res = await fetch("/api/review/labels");
    if (!res.ok) return;
    const fresh = (await res.json()) || {};
    const cur = current();
    const notes = q("[data-notes]");
    const editing = document.activeElement === notes && cur;
    const keep = editing ? state.labels[cur.trace_id] : null;
    state.labels = fresh;
    if (editing && keep) state.labels[cur.trace_id] = keep;
    rebuildView({ preferredTraceId: cur?.trace_id || state.traceParam });
    render();
    updateTraceParam();
  }

  function startHotReload() {
    state.hotReloadTimer = setInterval(async () => {
      try {
        const res = await fetch("/api/review/version");
        if (!res.ok) return;
        const version = await res.json();
        const prev = state.version;
        state.version = version;
        if (prev.traces === null) return;
        if (version.traces !== prev.traces) await refreshTraces();
        else if (version.labels !== prev.labels) await refreshLabels();
      } catch {
        // Companion server may be restarting; keep the UI usable and poll again.
      }
    }, 2000);
  }

  function wireEvents() {
    q("[data-label-pass]").onclick = () => setLabel("pass");
    q("[data-label-fail]").onclick = () => setLabel("fail");
    q("[data-label-defer]").onclick = () => setLabel("defer");
    q("[data-undo]").onclick = undo;
    q("[data-prev]").onclick = () => nav(-1);
    q("[data-next]").onclick = () => nav(1);
    root.addEventListener("click", (event) => {
      if (event.target.closest("[data-toggle-gold]")) toggleGold();
    });
    q("[data-notes]").addEventListener("input", () => void saveNotes(false));
    q("[data-notes]").addEventListener("blur", () => void saveNotes(true));
  }

  const onKeydown = (event) => {
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveNotes(true);
      return;
    }
    if (meta && event.key === "Enter") {
      event.preventDefault();
      void (async () => {
        await saveNotes(true);
        nav(1, { skipSave: true });
      })();
      return;
    }
    if (paletteOpen()) return;
    const notes = q("[data-notes]");
    const typing = document.activeElement === notes || isEditableElement(document.activeElement);
    if (typing) {
      if (event.key === "Escape") document.activeElement.blur();
      return;
    }
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        nav(-1);
        break;
      case "ArrowRight":
        event.preventDefault();
        nav(1);
        break;
      case "1":
        setLabel("pass");
        break;
      case "2":
        setLabel("fail");
        break;
      case "d":
      case "D":
        setLabel("defer");
        break;
      case "u":
      case "U":
        undo();
        break;
      case "r":
      case "R":
        toggleGold();
        break;
    }
  };

  function renderLoadError(error) {
    q("[data-mode-bar]").innerHTML = `<span class="mono-label">REVIEW</span><span class="review-mode-title">Trace load failed</span>`;
    q("[data-center]").innerHTML = `<section class="panel review-empty review-error">
      <h1>Failed to load review traces</h1>
      <p>${esc(error?.message || error)}</p>
      <p>Run <code>uv run harness/review/extract_traces.py --demo</code> then reload.</p>
      <p>Or use <b>Sync workbench → review</b> from a run page to fold workbench traces into the same store.</p>
    </section>`;
    q("[data-rail]").innerHTML = "";
    q("[data-label-bar]").hidden = true;
  }

  function renderBadges(t) {
    const v = verdict(t);
    const tokens = t.model_facts && t.model_facts.tokens
      ? `${t.model_facts.tokens.input ?? "?"}→${t.model_facts.tokens.output ?? "?"} tok`
      : null;
    return [
      `<span class="review-badge big mono">${esc(t.case_id || "?")}</span>`,
      t.demo ? `<span class="review-badge demo">DEMO</span>` : "",
      `<span class="review-badge arm">${esc(t.arm || "?")}</span>`,
      `<span class="review-badge ${verdictClass(v)}" title="${esc(INFO.graded)}">graded ${esc(v)}</span>`,
      t.validator
        ? `<span class="review-badge" title="${esc(INFO.validator)}">validator: ${esc(t.validator.status)} (expected ${esc(t.expected_status ?? "?")})</span>`
        : `<span class="review-badge error">no validator result</span>`,
      `<span class="review-badge">skill: ${esc(t.skill ?? "?")}</span>`,
      t.bucket ? `<span class="review-badge">${esc(t.bucket)} · ${esc(t.difficulty ?? "?")}</span>` : "",
      `<span class="review-badge" title="${esc(INFO.activation)}">activation: ${esc(t.activation ?? "?")}</span>`,
      `<span class="review-badge">exit ${t.exit_code ?? "—"}${t.timed_out ? " · TIMEOUT" : ""}</span>`,
      `<span class="review-badge">${fmtMs(t.duration_ms)}</span>`,
      tokens ? `<span class="review-badge">${esc(tokens)}</span>` : "",
      `<span class="review-badge mono">${esc(t.agent_name ?? "?")}</span>`,
      t.pool_version ? `<span class="review-badge">pool ${esc(t.pool_version)}</span>` : "",
      (t.harness_debt || []).length ? `<span class="review-badge">debt ×${t.harness_debt.length}</span>` : "",
    ].filter(Boolean).join("");
  }

  function info(key) {
    return `<span class="review-info" title="${esc(INFO[key])}">i</span>`;
  }

  function highlightJSON(text) {
    return text.replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(-?\d+\.?\d*(?:[eE][+-]?\d+)?)\b|\b(true|false|null)\b/g,
      (m, str, colon, num, lit) => {
        if (str) return `<span class="${colon ? "json-key" : "json-str"}">${str}</span>${colon || ""}`;
        if (num) return `<span class="json-num">${num}</span>`;
        return `<span class="json-lit">${lit}</span>`;
      });
  }

  function prettyBlock(content) {
    try {
      const pretty = JSON.stringify(JSON.parse(content), null, 2);
      return `<pre>${highlightJSON(esc(pretty))}</pre>`;
    } catch {
      return `<pre>${esc(content)}</pre>`;
    }
  }

  function mdLite(src) {
    const out = [];
    const lines = String(src || "").split("\n");
    let inCode = false;
    let code = [];
    let inList = false;
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|\s)\*([^*\s][^*]*)\*/g, "$1<i>$2</i>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    const closeList = () => {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
    };
    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        if (inCode) {
          out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
          code = [];
        }
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        code.push(line);
        continue;
      }
      const h = line.match(/^(#{1,3})\s+(.*)/);
      if (h) {
        closeList();
        out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`);
        continue;
      }
      const li = line.match(/^\s*[-*]\s+(.*)/);
      if (li) {
        if (!inList) {
          out.push("<ul>");
          inList = true;
        }
        out.push(`<li>${inline(li[1])}</li>`);
        continue;
      }
      closeList();
      if (line.trim() === "") continue;
      out.push(`<p>${inline(line)}</p>`);
    }
    if (inCode && code.length) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
    closeList();
    return `<div class="review-md">${out.join("")}</div>`;
  }

  function renderValue(val, opts = {}) {
    if (val === null || val === undefined) return "<i>null</i>";
    if (Array.isArray(val)) {
      if (!val.length) return "<i>empty list</i>";
      if (val.every((x) => typeof x !== "object" || x === null)) {
        return `<div class="review-chips">${val.map((x) => `<span class="review-chip">${esc(String(x))}</span>`).join("")}</div>`;
      }
      if (val.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
        const cols = [...new Set(val.flatMap((o) => Object.keys(o)))].slice(0, 6);
        return `<table class="review-kv-table"><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>` +
          val.map((o) => {
            const bad = opts.badLines && o.line !== undefined && opts.badLines.has(String(o.line));
            return `<tr${bad ? ' class="bad" title="named in a failed validator check"' : ""}>${cols.map((c) =>
              `<td>${esc(typeof o[c] === "object" && o[c] !== null ? JSON.stringify(o[c]) : String(o[c] ?? ""))}</td>`).join("")}</tr>`;
          }).join("") +
          `</table>`;
      }
      return `<pre>${esc(JSON.stringify(val, null, 2))}</pre>`;
    }
    if (typeof val === "object") {
      return Object.entries(val).map(([k, v]) =>
        `<div class="review-kv-row"><span class="review-kv-key">${esc(k)}</span><span class="review-kv-val">${renderValue(v)}</span></div>`).join("");
    }
    return esc(String(val));
  }

  function humanArtifact(content, goldContent) {
    let obj;
    try {
      obj = JSON.parse(content);
    } catch {
      return `<pre>${esc(content)}</pre>`;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return prettyBlock(content);
    let gold = null;
    try {
      gold = goldContent ? JSON.parse(goldContent) : null;
    } catch {
      // no diff marks
    }
    const rows = Object.entries(obj).map(([k, v]) => {
      const differs = gold && typeof gold === "object" && !Array.isArray(gold) && JSON.stringify(gold[k]) !== JSON.stringify(v);
      return `<div class="review-kv-row${differs ? " diff" : ""}"><span class="review-kv-key">${esc(k)}${differs
        ? `<span class="review-diff-mark" title="Differs from the gold expected/ artifact — not necessarily wrong; gold is one acceptable answer.">≠ gold</span>`
        : ""}</span><span class="review-kv-val">${renderValue(v)}</span></div>`;
    }).join("");
    return `${rows}<details class="review-raw-json"><summary>raw JSON</summary>${prettyBlock(content)}</details>`;
  }

  function tryParse(text) {
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function checksForField(key, failedChecks) {
    const kt = key.toLowerCase().split(/[_\-\s]+/).filter(Boolean);
    const need = Math.min(2, kt.length);
    return failedChecks.filter((c) => {
      const ct = String(c.id || "").toLowerCase().split(/[_\-\s]+/).filter(Boolean);
      return kt.filter((token) => ct.includes(token)).length >= need;
    });
  }

  function renderComparison(modelText, goldText, modelMissing, failedChecks) {
    const model = modelMissing ? null : tryParse(modelText);
    const gold = tryParse(goldText);
    if (!gold || (!model && !modelMissing)) {
      return modelMissing
        ? `<div class="review-cmp-missing">MISSING — model never wrote the contract path</div>`
        : humanArtifact(modelText, goldText);
    }
    const keys = [...new Set([...Object.keys(model || {}), ...Object.keys(gold)])];
    const goldCls = state.showGold ? "" : " hide-gold";
    const head = `<div class="review-cmp-head">field</div><div class="review-cmp-head">model output</div><div class="review-cmp-head g">gold reference${info("reference")}</div>`;
    const rows = keys.map((k) => {
      const inModel = model && k in model;
      const inGold = k in gold;
      const differs = !inModel || !inGold || JSON.stringify(model[k]) !== JSON.stringify(gold[k]);
      const fails = checksForField(k, failedChecks);
      const badLines = new Set();
      for (const check of fails) {
        for (const match of String(check.detail || "").matchAll(/line\s+(\d+)/gi)) badLines.add(match[1]);
      }
      const keyCls = fails.length ? " verr" : differs ? " diff" : "";
      const cellCls = fails.length ? " verr" : differs ? " diff" : "";
      const errNotes = fails.map((c) => `<div class="review-field-err">✗ ${esc(c.id)} — ${esc(c.detail ?? "")}</div>`).join("");
      return `<div class="review-cmp-key${keyCls}">${esc(k)}</div>` +
        `<div class="review-cmp-cell m${cellCls}">${model === null ? `<span class="review-cmp-missing">artifact missing</span>` : inModel ? renderValue(model[k], { badLines }) : `<span class="review-cmp-missing">model omitted this field</span>`}${errNotes}</div>` +
        `<div class="review-cmp-cell g${differs ? "" : " same"}">${inGold ? renderValue(gold[k]) : `<i>not in gold</i>`}</div>`;
    }).join("");
    const raw = modelMissing ? "" : `<details class="review-raw-json"><summary>raw JSON</summary>${prettyBlock(modelText)}</details>`;
    return `<div class="review-cmp${goldCls}">${head}${rows}</div>${raw}`;
  }

  function renderOutput(t) {
    const head = `<h2>Output artifact — model vs gold${info("output")}</h2>`;
    const note = t.case_notes ? `<p class="review-card-note">Case: ${esc(t.case_notes)} · expected validator status: <b>${esc(t.expected_status ?? "?")}</b></p>` : "";
    const failedChecks = ((t.validator || {}).checks || []).filter((c) => c.status !== "pass");
    const goldByPath = Object.fromEntries((t.gold_files || []).map((g) => [g.path, g.content]));
    const modelPaths = new Set((t.output_files || []).map((f) => f.path));
    const files = (t.output_files || []).map((f) =>
      `<div class="review-file-head">${esc(f.path)}</div>${renderComparison(f.content, goldByPath[f.path], f.missing, failedChecks)}`);
    for (const g of t.gold_files || []) {
      if (!modelPaths.has(g.path)) {
        files.push(`<div class="review-file-head">${esc(g.path)}</div>${renderComparison("", g.content, true, failedChecks)}`);
      }
    }
    if (!files.length) {
      return `<section class="panel review-card">${head}${note}<span class="review-missing-note">No output artifacts recorded for this run.</span></section>`;
    }
    return `<section class="panel review-card">${head}${note}${files.join("")}</section>`;
  }

  function verdictBanner(t) {
    const v = t.validator;
    if (!v) return `<div class="review-verdict-banner error">No validator result was produced for this run.</div>`;
    const checks = v.checks || [];
    const failed = checks.filter((c) => c.status !== "pass");
    const expectNote = t.expected_status === "fail" ? " (good-failure case: the validator is EXPECTED to reject this)" : "";
    if (verdict(t) === "PASS") {
      return `<div class="review-verdict-banner pass">PASS — validator returned <code>${esc(v.status)}</code> as expected${expectNote}${failed.length ? `; ${failed.length} check(s) failed as designed` : `; all ${checks.length} checks passed`}.</div>`;
    }
    if (v.status === "error") {
      return `<div class="review-verdict-banner error">ERROR — the validator crashed or its result was invalid; this run is ungraded. ${esc((v.repair_feedback || [])[0] || "")}</div>`;
    }
    const first = failed[0];
    return `<div class="review-verdict-banner fail">FAILED ${failed.length} of ${checks.length} checks${expectNote} — <code>${esc(first ? first.id : "?")}</code>: ${esc(first ? first.detail || "" : "")}${failed.length > 1 ? ` (+${failed.length - 1} more below)` : ""}</div>`;
  }

  function renderValidator(t) {
    const v = t.validator;
    if (!v) return `<section class="panel review-card"><h2>Validator${info("validator")}</h2><span class="review-missing-note">validator.json missing</span></section>`;
    const ordered = [...(v.checks || [])].sort((a, b) => (a.status === "pass") - (b.status === "pass"));
    const checks = ordered.map((c) =>
      `<div class="review-check ${c.status === "pass" ? "pass" : "fail"}"><span class="review-check-id">${esc(c.id)}</span><span>${esc(c.detail ?? "")}</span></div>`).join("");
    const repair = (v.repair_feedback || []).length
      ? `<div class="review-repair"><b>Repair feedback</b> <span class="review-info" title="Derived only from failed checks and schema errors — what the model would be told in a repair loop.">i</span><ul>${v.repair_feedback.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>`
      : "";
    return `<section class="panel review-card"><h2>Validator — ${esc(v.status)} · score ${v.score ?? "?"} · ${fmtMs(v.duration_ms)}${info("validator")}</h2>${checks || "<i>no checks</i>"}${repair}</section>`;
  }

  function renderJudge(t) {
    const j = t.judge;
    if (!j) return "";
    const cls = j.verdict === "pass" ? "pass" : j.verdict === "fail" ? "fail" : "error";
    const reasons = (j.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("");
    const matter = (j.diffs_that_matter || []).map((r) => `<li>${esc(r)}</li>`).join("");
    const dont = (j.diffs_that_dont_matter || []).map((r) => `<li>${esc(r)}</li>`).join("");
    return `<section class="panel review-card"><h2>LLM judge — <span class="review-badge ${cls}">${esc(j.verdict)}</span> · confidence ${esc(j.confidence ?? "?")}${info("judge")}</h2>
      ${reasons ? `<ul>${reasons}</ul>` : ""}
      ${j.what_should_have_happened ? `<div class="review-judge-box"><b>What should have happened:</b> ${esc(j.what_should_have_happened)}</div>` : ""}
      ${matter ? `<b class="review-danger-text">Differences that matter</b><ul>${matter}</ul>` : ""}
      ${dont ? `<b class="review-muted-text">Differences that don't</b><ul class="review-muted-text">${dont}</ul>` : ""}
      <div class="review-judge-meta">judge model: ${esc(j.judge_model ?? "?")} · unvalidated grader — your label below is the ground truth</div>
    </section>`;
  }

  function renderFinalMessage(t) {
    return `<section class="panel review-card"><h2>Final message${info("final")}</h2>${t.final_message ? mdLite(t.final_message) : "<i>none captured</i>"}</section>`;
  }

  function renderPrompt(t) {
    return `<section class="review-prompt"><h2>Prompt${info("prompt")}</h2>${t.prompt ? mdLite(t.prompt) : "<i>missing</i>"}</section>`;
  }

  function renderTrajectory(t) {
    const steps = (t.trajectory || []).map((s) =>
      `<details class="review-step ${esc(s.kind)}"><summary>${esc(s.title)}</summary><pre>${esc(s.detail)}</pre></details>`).join("");
    const n = (t.trajectory || []).length;
    return `<section class="panel review-card review-trajectory-card"><h2>Trajectory — ${n} step${n === 1 ? "" : "s"}${info("trajectory")}</h2>${steps || `<div class="review-traj-empty"><i>no trajectory recovered</i></div>`}</section>`;
  }

  function renderCollapsed(t) {
    const debt = (t.harness_debt || []).map((d) => `<li><b>${esc(d.kind)}</b> — ${esc(d.detail)}</li>`).join("");
    const blocks = [
      [`stderr${info("stderr")}`, t.stderr_tail ? `<pre>${esc(t.stderr_tail)}</pre>` : "<i>empty</i>"],
      [`Harness debt (${(t.harness_debt || []).length})${info("debt")}`, debt ? `<ul>${debt}</ul>` : "<i>none</i>"],
      [`Command${info("command")}`, t.command ? `<pre>${esc(t.command.join(" "))}</pre>` : "<i>unknown</i>"],
    ];
    return blocks.map(([title, body]) =>
      `<section class="panel review-card"><details class="review-section"><summary>${title}</summary>${body}</details></section>`).join("");
  }

  try {
    const [tracesRes, labelsRes] = await Promise.all([
      fetch("/api/review/traces"),
      fetch("/api/review/labels"),
    ]);
    const traceDoc = await tracesRes.json().catch(() => ({}));
    if (!tracesRes.ok) throw new Error(traceDoc.error || `${tracesRes.status}`);
    const labelDoc = await labelsRes.json().catch(() => ({}));
    if (!labelsRes.ok) throw new Error(labelDoc.error || `${labelsRes.status}`);
    state.traces = traceDoc.traces || [];
    state.labels = labelDoc || {};
  } catch (error) {
    renderLoadError(error);
    return () => {
      state.disposed = true;
    };
  }

  for (const key of Object.keys(localStorage).filter((k) => k.startsWith(STORAGE_PREFIX))) {
    const traceId = key.slice(STORAGE_PREFIX.length);
    try {
      void persist(traceId, JSON.parse(localStorage.getItem(key)));
    } catch {
      // Leave malformed entries alone; a future cleanup can handle them.
    }
  }

  rebuildView({ allowMissingNotice: true });
  wireEvents();
  document.addEventListener("keydown", onKeydown);
  render();
  updateTraceParam();
  startHotReload();

  return () => {
    state.disposed = true;
    document.removeEventListener("keydown", onKeydown);
    clearInterval(state.hotReloadTimer);
    clearTimeout(state.notesTimer);
  };
}

function renderShell() {
  return `<div class="review-view">
    <div class="review-mode-bar" data-mode-bar></div>
    <div class="review-body">
      <article class="review-center" data-center><section class="panel review-empty">Loading traces…</section></article>
      <aside class="review-rail" data-rail aria-label="Trajectory"></aside>
    </div>
    <footer class="review-label-bar" data-label-bar hidden>
      <div class="review-label-actions">
        <button class="btn" type="button" data-prev title="Previous (←)">←</button>
        <button class="btn" type="button" data-next title="Next (→)">→</button>
        <button class="btn pass-tint" type="button" data-label-pass title="Pass (1)">Pass</button>
        <button class="btn danger" type="button" data-label-fail title="Fail (2)">Fail</button>
        <button class="btn" type="button" data-label-defer title="Defer (D)">Defer</button>
        <button class="btn" type="button" data-undo title="Undo last action (U)">Undo</button>
      </div>
      <textarea data-notes placeholder="Notes — routes to the skill's improvement queue."></textarea>
      <span class="review-save-status" data-save-status></span>
      <span class="review-kbd-hint">←→ nav · 1 pass · 2 fail · D defer · U undo · R gold · ⌘S save · ⌘↵ save+next</span>
    </footer>
  </div>`;
}

function filtersFromParams(params) {
  return {
    skill: params.get("skill") || "",
    arm: params.get("arm") || "",
    verdict: params.get("verdict") || "",
    label: (params.get("label") || "").toLowerCase(),
  };
}

function normalizeVerdict(value) {
  const upper = String(value || "").toUpperCase();
  return ["PASS", "FAIL", "ERROR"].includes(upper) ? upper : "";
}

function verdict(t) {
  const status = t.validator && t.validator.status;
  if (status === "error") return "ERROR";
  if (t.graded_pass === true || (status && t.expected_status && status === t.expected_status)) return "PASS";
  if (status) return "FAIL";
  return "—";
}

function verdictClass(v) {
  return v === "PASS" ? "ok" : v === "FAIL" ? "bad" : v === "ERROR" ? "warn" : "";
}

function fmtMs(ms) {
  return ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function armShort(arm) {
  return String(arm || "?").replace("_without_skill", " −skill").replace("_with_skill", " +skill");
}

function isEditableElement(el) {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

function paletteOpen() {
  return Boolean(document.querySelector("[data-cmdk-open='true'], .cmdk[open], .cmdk.open, .command-palette, [role='dialog'].cmdk"));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "\u0026amp;",
    "<": "\u0026lt;",
    ">": "\u0026gt;",
    '"': "\u0026quot;",
    "'": "\u0026#39;",
  })[c]);
}

const INFO = {
  output: "The file(s) the model was asked to write to a fixed workspace path — the skill's output contract. This is the main thing you are judging. Rendered field-by-field; ≠ gold marks fields that differ from the gold example (different is not necessarily wrong — gold is one acceptable answer, not the only one). Raw JSON is behind the toggle.",
  validator: "Deterministic TypeScript checks run by the harness with bun — NO model or LLM judge is involved. Each check is a mechanical rule (file exists, schema valid, cited lines verbatim…). The run is graded by comparing the validator's status to the case's expected status.",
  final: "The model's last message in the run, parsed from pool's NLJSON output stream.",
  prompt: "The exact prompt sent to pool exec via --prompt-file. Identical across arms of the same case.",
  trajectory: "Every event pool recorded: reasoning, tool calls and their results. Context for understanding HOW the model worked — never used for grading.",
  stderr: "pool's stderr for this run (harness/CLI noise, not model output).",
  debt: "The harness's own confession list: every fragile mechanism this run depended on (hidden flags, undocumented file layouts, disabled sandbox…). It says nothing about model quality — it tells you how reproducible/trustworthy the MEASUREMENT is, and which hardening PR the evidence justifies next.",
  command: "The exact pool exec command line this run executed.",
  reference: "The case's gold expected/ artifacts: one known-good example answer, used for validator replay. A reference for comparison — not the only acceptable answer.",
  graded: "graded = does the validator's status match the case's expected status? Good-failure cases EXPECT the validator to fail, so validator:fail can be graded PASS.",
  judge: "Second opinion from an external LLM judge called via OpenRouter — deliberately NOT a Laguna or Poolside model, and independent of the deterministic validator. It reads the task, the model's artifact, the gold reference, and the validator findings, then articulates what should have happened. UNVALIDATED grader: calibrate it against your human Pass/Fail labels before trusting its verdicts (eval methodology, error-analysis-first).",
  activation: "Did the model formally invoke the `skill` tool? Parsed from the NLJSON stream. A model can also read skill files directly without formal activation — check the trajectory.",
};
