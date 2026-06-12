import * as skillsView from "./views/skills.js";
import * as workflowsView from "./views/workflows.js";
import * as runsView from "./views/runs.js";
import * as reviewView from "./views/review.js";

const VIEWS = { skills: skillsView, workflows: workflowsView, runs: runsView, review: reviewView };
const PENDING_KEY = "wb-generate-pending";

const state = {
  project: null,
  cleanup: null,
  skills: [],
  paletteOpen: false,
  watcher: null,
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
  return `<span class="pill ${cls}">${esc(status)}</span>`;
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

export function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "") || "workflows";
  const [pathPart, queryPart] = hash.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  return {
    view: segments[0] || "workflows",
    id: segments.length > 1 ? decodeURIComponent(segments.slice(1).join("/")) : null,
    params: new URLSearchParams(queryPart || ""),
  };
}

export function navigate(path) {
  location.hash = path.startsWith("#") ? path : `#${path}`;
}

function setActiveNav(viewName) {
  document.querySelectorAll("#top-nav a").forEach((link) => {
    const active = link.dataset.view === viewName;
    link.classList.toggle("active", active);
    if (active) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

async function mountRoute() {
  const route = parseRoute();
  const view = VIEWS[route.view];
  if (!view) {
    navigate("/workflows");
    return;
  }

  if (typeof state.cleanup === "function") {
    state.cleanup();
  }
  state.cleanup = null;
  setActiveNav(route.view);

  const container = document.getElementById("view");
  state.cleanup = await view.mount(container, {
    project: state.project,
    id: route.id,
    params: route.params,
    navigate,
    helpers: { api, esc, fmtDuration, fmtAgo, statusPill, trajectoryLink },
  });
}

function workflowSlug(input) {
  return (
    String(input || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "generated-workflow"
  );
}

function skillSlug(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parsePalette(value) {
  const text = value.trim();
  if (text.startsWith("/workflow")) {
    const prompt = text.replace(/^\/workflow\s*/, "").trim();
    const slug = workflowSlug(prompt);
    return {
      kind: "workflow",
      prompt,
      label: slug,
      row: `<span class="cmdk-chip workflow">/workflow</span><span>${esc(prompt || "Describe the workflow to create")}</span><span class="cmdk-enter">↵ create</span>`,
      preview: `creates .smithers/workflows/${esc(slug)}.tsx`,
      valid: Boolean(prompt),
    };
  }
  if (text.startsWith("/skill")) {
    const rest = text.replace(/^\/skill\s*/, "").trim();
    const colon = rest.indexOf(":");
    const rawName = colon >= 0 ? rest.slice(0, colon).trim() : rest.split(/\s+/).slice(0, 4).join(" ");
    const prompt = colon >= 0 ? rest.slice(colon + 1).trim() : rest;
    const name = skillSlug(rawName);
    return {
      kind: "skill",
      name,
      prompt,
      label: name || "new skill",
      row: `<span class="cmdk-chip skill">/skill</span><span>${esc(rest || "name: describe the skill")}</span><span class="cmdk-enter">↵ create</span>`,
      preview: `creates skills/${esc(name || "skill-name")}`,
      valid: Boolean(name && prompt),
    };
  }
  return {
    kind: null,
    row: `Type <code>/workflow</code> or <code>/skill</code> followed by a description · <code>$skill-name</code> autocompletes`,
    preview: "",
    valid: false,
  };
}

function caretDollarToken(input) {
  const pos = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, pos);
  const match = before.match(/(^|\s)\$([a-z0-9-]*)$/i);
  if (!match) return null;
  return { start: pos - match[2].length - 1, end: pos, query: match[2].toLowerCase() };
}

function pendingList() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePending(items) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(items));
}

function addPending(item) {
  savePending([...pendingList().filter((p) => p.tag !== item.tag), item]);
}

function ensureToastHost() {
  let host = document.getElementById("generate-toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "generate-toasts";
    host.className = "generate-toasts";
    document.querySelector(".topbar")?.append(host);
  }
  return host;
}

function showFailureOverlay(item, result) {
  const overlay = document.createElement("div");
  overlay.className = "cmdk-overlay";
  overlay.innerHTML = `<div class="cmdk-error panel">
    <button class="btn" type="button">Close</button>
    <h2>${esc(item.label)} failed</h2>
    <pre>${esc(result?.error || "generation failed")}</pre>
    <pre>${esc(JSON.stringify(result?.attempts ?? [], null, 2))}</pre>
  </div>`;
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.tagName === "BUTTON") overlay.remove();
  });
  document.body.append(overlay);
}

function showGenerateToast(item, result) {
  const host = ensureToastHost();
  const toast = document.createElement(result?.ok ? "a" : "button");
  toast.className = `pill ${result?.ok ? "ok" : "bad"} generate-toast`;
  toast.textContent = result?.ok ? `${item.label} ready ✓` : `${item.label} failed — view log`;
  if (result?.ok) {
    toast.href = item.destination.route;
  } else {
    toast.type = "button";
    toast.onclick = () => showFailureOverlay(item, result);
  }
  host.append(toast);
  setTimeout(() => toast.remove(), 20_000);
}

async function pollGenerate() {
  const items = pendingList();
  if (!items.length) return;
  const remaining = [];
  for (const item of items) {
    try {
      const status = await api(`/api/generate/status?tag=${encodeURIComponent(item.tag)}`);
      if (status.running) {
        remaining.push(item);
      } else {
        showGenerateToast(item, status.result || { ok: false, error: "generation ended without a result" });
      }
    } catch (error) {
      showGenerateToast(item, { ok: false, error: error.message });
    }
  }
  savePending(remaining);
}

function renderPalette(input, result, typeahead) {
  const parsed = parsePalette(input.value);
  result.innerHTML = `<div class="cmdk-row ${parsed.kind || "hint"}">${parsed.row}</div>${parsed.preview ? `<div class="cmdk-preview mono-label">${parsed.preview}</div>` : ""}`;

  const token = caretDollarToken(input);
  if (!token) {
    typeahead.hidden = true;
    typeahead.innerHTML = "";
    return parsed;
  }
  const matches = state.skills
    .filter((s) => s.name.toLowerCase().includes(token.query))
    .slice(0, 6);
  if (!matches.length) {
    typeahead.hidden = true;
    typeahead.innerHTML = "";
    return parsed;
  }
  typeahead.hidden = false;
  typeahead.innerHTML = matches
    .map((s, index) => `<button type="button" data-skill="${esc(s.name)}" class="cmdk-skill-option ${index === 0 ? "active" : ""}"><span class="cmdk-skill-name">$${esc(s.name)}</span><span>${esc(s.description || "No description")}</span><span class="mono-label">${s.evalSummary ? `${s.evalSummary.withSkill?.passed ?? 0}/${s.evalSummary.withSkill?.total ?? 0}` : "—"}</span></button>`)
    .join("");
  typeahead.querySelectorAll("button").forEach((button) => {
    button.onclick = () => {
      input.value = `${input.value.slice(0, token.start)}$${button.dataset.skill}${input.value.slice(token.end)}`;
      input.focus();
      renderPalette(input, result, typeahead);
    };
  });
  return parsed;
}

function closePalette() {
  document.getElementById("cmdk-overlay")?.remove();
  state.paletteOpen = false;
}

function openPalette() {
  if (state.paletteOpen) return;
  state.paletteOpen = true;
  const overlay = document.createElement("div");
  overlay.id = "cmdk-overlay";
  overlay.className = "cmdk-overlay";
  overlay.innerHTML = `<div class="cmdk-box">
    <input id="cmdk-input" autocomplete="off" spellcheck="false" placeholder="/workflow run repo-map then summarize" />
    <div id="cmdk-result" class="cmdk-result"></div>
    <div id="cmdk-typeahead" class="cmdk-typeahead" hidden></div>
  </div>`;
  document.body.append(overlay);
  const input = overlay.querySelector("#cmdk-input");
  const result = overlay.querySelector("#cmdk-result");
  const typeahead = overlay.querySelector("#cmdk-typeahead");
  const update = () => renderPalette(input, result, typeahead);
  input.addEventListener("input", update);
  input.addEventListener("keydown", async (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const parsed = update();
    if (!parsed.valid) return;
    const body = {
      kind: parsed.kind,
      prompt: parsed.prompt,
      project: state.project,
      agentName: "laguna-m.1",
    };
    if (parsed.kind === "skill") body.name = parsed.name;
    try {
      const started = await api("/api/generate/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      addPending({ tag: started.tag, kind: started.kind, destination: started.destination, label: parsed.label });
      navigate(`${started.destination.route}?generating=${encodeURIComponent(started.tag)}`);
      closePalette();
      void pollGenerate();
    } catch (error) {
      result.innerHTML = `<div class="cmdk-row hint"><span class="pill bad">error</span><span>${esc(error.message)}</span></div>`;
    }
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closePalette();
  });
  update();
  input.focus();
}

async function loadProjects() {
  const projects = await api("/api/projects");
  const select = document.getElementById("project-pick");
  select.innerHTML = projects
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.hasDb ? "" : " (no runs db)"}</option>`)
    .join("");

  const saved = localStorage.getItem("wb-project");
  const selected = projects.find((p) => p.id === saved) ?? projects[0] ?? null;
  state.project = selected?.id ?? null;
  if (state.project) select.value = state.project;

  select.onchange = () => {
    state.project = select.value;
    localStorage.setItem("wb-project", state.project);
    void mountRoute();
  };
}

async function loadSkillsForPalette() {
  try {
    state.skills = await api("/api/skills");
  } catch {
    state.skills = [];
  }
}

async function boot() {
  document.getElementById("new-button").onclick = openPalette;
  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
    const target = event.target;
    const inField = target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
    if (inField && target.id !== "cmdk-input") return;
    event.preventDefault();
    openPalette();
  });
  try {
    await loadProjects();
    void loadSkillsForPalette();
  } catch {
    document.getElementById("offline").hidden = false;
    return;
  }
  window.addEventListener("hashchange", () => void mountRoute());
  state.watcher = setInterval(() => void pollGenerate(), 5000);
  void pollGenerate();
  await mountRoute();
}

void boot();
