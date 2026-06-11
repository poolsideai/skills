"""Run-artifact recovery + manifest assembly (plan item 10).

Implements the RECOMMENDED RECOVERY PROCEDURE from
docs/trajectory-recovery-spike.md verbatim:

  Primary path: read ``<state>/poolside/sessions/session-<run_id>.json``
  (the run-id-keyed bridge), construct
  ``<state>/poolside/trajectories/trajectory-<agent_id>_<session_id>.ndjson``,
  copy it into the run dir as ``trajectory.ndjson`` (the canonical v0
  artifact -- installed pool 0.2.172 has no --atif; spike F6), scrape model
  facts from the raw NDJSON (F7), and collect ``pool-<run_id>.log``.

  Fallback chain: F-a single-trajectory-in-isolated-state-dir; F-b
  ``pool history trajectories --latest`` scoped to the run's state dir;
  F-c record the failure and proceed only because v0 validators grade
  workspace state, never the trajectory.

Every fragile dependency is appended to the manifest's ``harness_debt[]``
using the spike's HD-1..HD-7 register ids (plus runner-level kinds for CLI
divergences and the methodology's accepted isolation residue).
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

import yaml

if str(Path(__file__).resolve().parents[2]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.validators.command_result import run_command
from harness.validators.json_schema import validate_instance

MANIFEST_SCHEMA = "run-manifest.v0"
_SEMVER_RE = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(-((0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(\+([0-9a-zA-Z-]+(\.[0-9a-zA-Z-]+)*))?$"
)

#: Canonical harness-debt register (trajectory-recovery-spike + eval-methodology).
DEBT_REGISTER: dict[str, tuple[str, str]] = {
    "hd-2": ("hd-2-best-effort-session-record",
             "session-record write is best-effort (warn-and-continue); run_id-keyed lookup failed and a fallback was used."),
    "hd-3": ("hd-3-undocumented-state-layout",
             "recovery reads pool's undocumented on-disk layout (session-<run_id>.json, trajectory-<aid>_<sid>.ndjson under XDG state); re-verify on every pool upgrade."),
    "hd-4": ("hd-4-no-atif-export",
             "installed pool advertises no --atif; canonical trajectory artifact is raw NDJSON (internal schema, no stability promise)."),
    "hd-5": ("hd-5-latest-trajectory-recovery",
             "recovered via `pool history trajectories --latest` scoped to the run's state dir; correctness then requires strictly serial execution."),
    "hd-6": ("hd-6-model-scrape-per-request",
             "resolved model/sampling scraped from the first non-continued inference request in raw NDJSON; payload shape is internal."),
    "hd-7": ("hd-7-local-sink-assumed",
             "local trajectory sink assumed enabled (defaults [api, local], user-overridable); runner asserts file existence rather than trusting it."),
    "isolation-residue": ("isolation-embedded-default-skills",
                          "pool auto-installs embedded default skills (configure-sandbox, pool-product-reference, skill-creator) into the fresh isolated HOME; identical across arms but baseline is not literally zero-skill (eval-methodology section 3); PR3 is the cleanup."),
    "nljson-activation": ("nljson-activation-parse",
                          "activation metric parses stringified `-o json` NLJSON for toolCall name==\"skill\"; brittle until PR5 telemetry."),
}


def debt(register_id: str, detail: str | None = None) -> dict:
    kind, default_detail = DEBT_REGISTER[register_id]
    return {"kind": kind, "detail": detail or default_detail}


@dataclass
class RecoveryOutcome:
    trajectory_path: Path | None = None  # run_dir/trajectory.ndjson when recovered
    atif_path: Path | None = None
    pool_log_path: Path | None = None
    session: dict | None = None
    debt: list[dict] = field(default_factory=list)
    error: str | None = None  # F-c: recovery failed entirely


def recover_trajectory(
    *,
    state_dir: Path,
    run_id: str,
    run_dir: Path,
    run_id_flag_used: bool,
    pool_bin: str,
    history_has_atif: bool,
    env: dict[str, str],
) -> RecoveryOutcome:
    """Spike steps 3-7 + fallback chain, immediately after one run exits."""
    outcome = RecoveryOutcome()
    outcome.debt.append(debt("hd-3"))
    outcome.debt.append(debt("hd-7"))

    sessions_dir = state_dir / "poolside" / "sessions"
    traj_dir = state_dir / "poolside" / "trajectories"
    logs_dir = state_dir / "poolside" / "logs"

    # Step 3: session record, keyed by run id when --run-id was honored.
    session_path = sessions_dir / f"session-{run_id}.json"
    if run_id_flag_used and session_path.is_file():
        outcome.session = _read_json(session_path)
    else:
        candidates = sorted(sessions_dir.glob("session-*.json")) if sessions_dir.is_dir() else []
        if len(candidates) == 1:
            outcome.session = _read_json(candidates[0])
            outcome.debt.append(debt(
                "hd-2",
                "session record not reachable by harness run_id "
                f"({'--run-id unsupported' if not run_id_flag_used else 'session-<run_id>.json missing'}); "
                "recovered via the single session file in the isolated state dir.",
            ))
        elif candidates:
            outcome.debt.append(debt("hd-2", f"{len(candidates)} session records in isolated state dir; cannot pick by run_id."))

    # Step 4: construct the trajectory path from the session record.
    source: Path | None = None
    if outcome.session and outcome.session.get("agent_id") and outcome.session.get("session_id"):
        candidate = traj_dir / f"trajectory-{outcome.session['agent_id']}_{outcome.session['session_id']}.ndjson"
        if candidate.is_file() and candidate.stat().st_size > 0:
            source = candidate

    # F-a: exactly one trajectory in the isolated state dir.
    if source is None:
        ndjson_files = sorted(traj_dir.glob("*.ndjson")) if traj_dir.is_dir() else []
        if len(ndjson_files) == 1 and ndjson_files[0].stat().st_size > 0:
            source = ndjson_files[0]
            outcome.debt.append(debt("hd-2", "primary session-record path failed; took the single trajectory file in the isolated state dir (fallback F-a)."))

    if source is not None:
        outcome.trajectory_path = run_dir / "trajectory.ndjson"
        shutil.copyfile(source, outcome.trajectory_path)
    else:
        # F-b: history --latest scoped to this run's private state dir.
        latest = run_command(
            [pool_bin, "history", "trajectories", "--latest"],
            env=env, timeout_s=60,
        )
        if latest.ok and latest.stdout.strip():
            outcome.trajectory_path = run_dir / "trajectory.ndjson"
            outcome.trajectory_path.write_text(latest.stdout, encoding="utf-8")
            outcome.debt.append(debt("hd-2"))
            outcome.debt.append(debt("hd-5"))
        else:
            # F-c: no trajectory. v0 validators grade workspace state, so the
            # run is still graded; the gap is recorded loudly.
            outcome.error = f"trajectory unrecoverable (F-c); history --latest stderr tail: {latest.stderr_tail(500)}"
            outcome.debt.append({
                "kind": "trajectory-missing",
                "detail": "no trajectory recovered (primary, F-a, F-b all failed); graded on workspace state only -- trajectory-derived metrics are absent for this run.",
            })

    # Step 6 (optional): ATIF export only when the installed pool advertises it.
    if outcome.trajectory_path is not None:
        if history_has_atif and outcome.session and outcome.session.get("session_id"):
            atif = run_command(
                [pool_bin, "history", "trajectories", str(outcome.session["session_id"]), "--atif"],
                env=env, timeout_s=60,
            )
            if atif.ok and atif.stdout.strip():
                outcome.atif_path = run_dir / "trajectory.atif.json"
                outcome.atif_path.write_text(atif.stdout, encoding="utf-8")
        if outcome.atif_path is None:
            outcome.debt.append(debt("hd-4"))

    # Step 7: run-id-keyed pool log.
    if logs_dir.is_dir():
        log_candidates = [logs_dir / f"pool-{run_id}.log"] if run_id_flag_used else []
        log_candidates += sorted(logs_dir.glob("pool-*.log"))
        for candidate in log_candidates:
            if candidate.is_file():
                outcome.pool_log_path = run_dir / "pool.log"
                shutil.copyfile(candidate, outcome.pool_log_path)
                break

    return outcome


def scrape_run_facts(trajectory_path: Path) -> tuple[dict, list[dict]]:
    """Spike step 5 / F7: resolved model + sampling from the first
    non-continued chat_completion_request; token/latency totals from
    inference-end events. Tolerant of unknown line shapes by design -- the
    NDJSON schema is internal (HD-6)."""
    facts: dict = {"model": None, "sampling": {}, "totals": {"input_tokens": 0, "output_tokens": 0, "inference_steps": 0, "inference_latency_ns": 0}}
    sampling_keys = ("temperature", "top_p", "top_k", "min_p", "seed", "max_completion_tokens", "stop")
    model_found = False
    multi_model = False
    seen_models: set[str] = set()
    try:
        with open(trajectory_path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                for request in _find_key(event, "chat_completion_request"):
                    if not isinstance(request, dict):
                        continue
                    model = request.get("model")
                    if isinstance(model, str) and model:
                        seen_models.add(model)
                    if not model_found and not request.get("continued"):
                        facts["model"] = model
                        facts["sampling"] = {k: request.get(k) for k in sampling_keys if k in request}
                        model_found = True
                for holder in _dicts_with_keys(event, ("input_tokens", "output_tokens")):
                    facts["totals"]["input_tokens"] += _as_int(holder.get("input_tokens"))
                    facts["totals"]["output_tokens"] += _as_int(holder.get("output_tokens"))
                    facts["totals"]["inference_latency_ns"] += _as_int(holder.get("inference_latency"))
                    facts["totals"]["inference_steps"] += 1
    except OSError:
        return facts, [{"kind": "trajectory-missing", "detail": f"could not read trajectory for fact scrape: {trajectory_path}"}]
    multi_model = len(seen_models) > 1
    facts["models_seen"] = sorted(seen_models)
    debts = [debt("hd-6")]
    if multi_model:
        debts.append(debt("hd-6", f"multi-model trajectory (anomaly per spike F7): {sorted(seen_models)}"))
    return facts, debts


def read_skill_version(skills_root: Path, skill_name: str) -> tuple[str, str | None]:
    """Skill semver from SKILL.md frontmatter metadata.version. Returns
    (version, problem); on any problem version falls back to "0.0.0" so the
    manifest still validates, and the problem string is surfaced as debt."""
    skill_md = skills_root / skill_name / "SKILL.md"
    if not skill_md.is_file():
        return "0.0.0", f"SKILL.md missing for {skill_name} at {skill_md}"
    try:
        text = skill_md.read_text(encoding="utf-8")
    except OSError as exc:
        return "0.0.0", f"SKILL.md unreadable: {exc}"
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, flags=re.DOTALL)
    if not match:
        return "0.0.0", f"no YAML frontmatter in {skill_md}"
    try:
        front = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError as exc:
        return "0.0.0", f"frontmatter unparseable in {skill_md}: {exc}"
    version = str(((front.get("metadata") or {}).get("version")) or "")
    if not _SEMVER_RE.match(version):
        return "0.0.0", f"metadata.version missing/not semver in {skill_md}: {version!r}"
    return version, None


def build_manifest(
    *,
    run_id: str,
    skill_name: str,
    skill_version: str,
    agent_name: str,
    pool_version: str,
    command: list[str],
    exit_code: int,
    artifacts: dict[str, str],
    started_at: str,
    finished_at: str,
    duration_ms: int,
    validator_result: dict,
    harness_debt: list[dict],
) -> dict:
    """Assemble a run-manifest.v0 instance (validate with write_manifest)."""
    return {
        "schema_version": MANIFEST_SCHEMA,
        "run_id": run_id,
        "skill": {"name": skill_name, "version": skill_version},
        "agent_name": agent_name,
        "pool_version": pool_version,
        "command": list(command),
        "exit_code": exit_code,
        "artifacts": dict(artifacts),
        "timing": {"started_at": started_at, "finished_at": finished_at, "duration_ms": duration_ms},
        "validator_result": validator_result,
        "harness_debt": _dedupe_debt(harness_debt),
    }


def write_manifest(run_dir: Path, manifest: dict) -> list[str]:
    """Validate against run-manifest.v0 and write manifest.json. Returns
    validation errors; on errors the manifest is still written (as
    manifest.invalid.json) so the evidence isn't lost, but callers must
    treat the run as a harness failure."""
    errors = validate_instance(manifest, MANIFEST_SCHEMA)
    target = run_dir / ("manifest.json" if not errors else "manifest.invalid.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return errors


def _dedupe_debt(entries: list[dict]) -> list[dict]:
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    for entry in entries:
        key = (entry.get("kind", ""), entry.get("detail", ""))
        if key in seen:
            continue
        seen.add(key)
        out.append(entry)
    return out


def _read_json(path: Path) -> dict | None:
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _find_key(obj: object, key: str, max_depth: int = 8):
    """Yield every value stored under ``key`` anywhere in a nested structure."""
    if max_depth < 0:
        return
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                yield v
            else:
                yield from _find_key(v, key, max_depth - 1)
    elif isinstance(obj, list):
        for item in obj:
            yield from _find_key(item, key, max_depth - 1)


def _dicts_with_keys(obj: object, keys: tuple[str, ...], max_depth: int = 8):
    """Yield every dict that contains all of ``keys``."""
    if max_depth < 0:
        return
    if isinstance(obj, dict):
        if all(k in obj for k in keys):
            yield obj
        for v in obj.values():
            yield from _dicts_with_keys(v, keys, max_depth - 1)
    elif isinstance(obj, list):
        for item in obj:
            yield from _dicts_with_keys(item, keys, max_depth - 1)


def _as_int(value: object) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
