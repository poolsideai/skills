"""Case x arm matrix for the v0 eval loop (plan items 9-10).

Arms (docs/eval-methodology.md section 2): two models x with/without the skill
under test. Agent names come from the model-access spike
(docs/model-access-spike.md): M.1 = the tenant-default agent ``laguna-m.1``;
the XS candidate is ``laguna-xs-polaris-base-bs256-s600-ctx256k`` (the only
XS-class agent; NOT confirmed as "XS.2" -- cite the checkpoint name in
readouts). Override per run with POOLSIDE_EVAL_AGENT_XS / POOLSIDE_EVAL_AGENT_M
when the model team promotes different agents.

Suite file format consumed by run_eval.py (``evals/suites/*.json``, plan item
12 -- the suites themselves are authored separately):

    {
      "name": "smoke",
      "cases": [
        "skills/ci-log-reducer/evals/ci-log-reducer-flaky-retry",
        ...
      ]
    }

``cases`` entries are case directories, repo-root-relative or absolute. A bare
JSON array of case paths is also accepted (name falls back to the file stem).

Execution order is deterministic: suite case order x ARM_ORDER, strictly
serial (docs/trajectory-recovery-spike.md: a v0 simplicity choice; per-run
state isolation is what makes recovery race-free).
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

if str(Path(__file__).resolve().parents[2]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.validators.json_schema import validate_instance

REPO_ROOT = Path(__file__).resolve().parents[2]

EVAL_CASE_SCHEMA = "eval-case.v1"

#: model class -> default --agent-name (docs/model-access-spike.md section 1).
DEFAULT_AGENTS = {
    "xs": "laguna-xs-polaris-base-bs256-s600-ctx256k",
    "m": "laguna-m.1",
}

_AGENT_ENV_OVERRIDES = {
    "xs": "POOLSIDE_EVAL_AGENT_XS",
    "m": "POOLSIDE_EVAL_AGENT_M",
}


@dataclass(frozen=True)
class Arm:
    name: str
    model_class: str  # "xs" | "m"
    with_skill: bool

    @property
    def agent_name(self) -> str:
        return os.environ.get(_AGENT_ENV_OVERRIDES[self.model_class]) or DEFAULT_AGENTS[self.model_class]


ARM_ORDER: tuple[Arm, ...] = (
    Arm("xs_without_skill", "xs", False),
    Arm("xs_with_skill", "xs", True),
    Arm("m_without_skill", "m", False),
    Arm("m_with_skill", "m", True),
)
ARMS: dict[str, Arm] = {arm.name: arm for arm in ARM_ORDER}


@dataclass
class Case:
    """An eval case folder (evals/README.md): prompt.md, input/, expected/,
    metadata.json. ``errors`` collects everything wrong with the case so
    dry-run can report all problems at once instead of dying on the first."""

    case_dir: Path
    metadata: dict
    errors: list[str]

    @property
    def id(self) -> str:
        return self.metadata.get("id", self.case_dir.name)

    @property
    def skill(self) -> str:
        return self.metadata.get("skill", "")

    @property
    def arm_names(self) -> list[str]:
        return list(self.metadata.get("arms", []))

    @property
    def validator_command(self) -> list[str]:
        return list(self.metadata.get("validator", {}).get("command", []))

    @property
    def expected_status(self) -> str:
        return self.metadata.get("validator", {}).get("expected_status", "pass")

    @property
    def prompt_path(self) -> Path:
        return self.case_dir / "prompt.md"

    @property
    def input_dir(self) -> Path:
        return self.case_dir / "input"

    @property
    def expected_dir(self) -> Path:
        return self.case_dir / "expected"


@dataclass(frozen=True)
class RunSpec:
    case: Case
    arm: Arm

    @property
    def label(self) -> str:
        return f"{self.case.id}/{self.arm.name}"


class SuiteError(Exception):
    """The suite file itself is unusable (missing, unparseable, wrong shape)."""


def load_suite(suite_path: Path | str, repo_root: Path = REPO_ROOT) -> tuple[str, list[Path]]:
    """Return (suite_name, ordered absolute case directories)."""
    suite_path = Path(suite_path)
    if not suite_path.is_file():
        raise SuiteError(f"suite file not found: {suite_path}")
    try:
        doc = json.loads(suite_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SuiteError(f"suite file unreadable/unparseable: {suite_path}: {exc}") from exc

    if isinstance(doc, list):
        name, entries = suite_path.stem, doc
    elif isinstance(doc, dict):
        name = doc.get("name") or suite_path.stem
        entries = doc.get("cases")
        if not isinstance(entries, list):
            raise SuiteError(f"suite {suite_path}: expected a \"cases\" array")
    else:
        raise SuiteError(f"suite {suite_path}: expected an object or array")

    case_dirs: list[Path] = []
    for entry in entries:
        if not isinstance(entry, str) or not entry:
            raise SuiteError(f"suite {suite_path}: case entries must be non-empty path strings, got {entry!r}")
        path = Path(entry)
        if not path.is_absolute():
            path = repo_root / path
        case_dirs.append(path.resolve())
    if not case_dirs:
        raise SuiteError(f"suite {suite_path}: no cases listed")
    return name, case_dirs


def load_case(case_dir: Path) -> Case:
    """Load + structurally validate one case. Never raises for case-content
    problems; they land in Case.errors."""
    errors: list[str] = []
    metadata: dict = {}
    if not case_dir.is_dir():
        return Case(case_dir, {}, [f"case directory missing: {case_dir}"])
    meta_path = case_dir / "metadata.json"
    if not meta_path.is_file():
        errors.append(f"metadata.json missing in {case_dir}")
    else:
        try:
            loaded = json.loads(meta_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                metadata = loaded
            else:
                errors.append(f"{meta_path}: metadata.json must be a JSON object")
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"{meta_path}: unreadable/unparseable: {exc}")
    if metadata:
        errors.extend(f"metadata.json ({EVAL_CASE_SCHEMA}): {e}" for e in validate_instance(metadata, EVAL_CASE_SCHEMA))
        if metadata.get("id") and metadata["id"] != case_dir.name:
            errors.append(f"metadata id {metadata['id']!r} != case folder name {case_dir.name!r}")
    return Case(case_dir, metadata, errors)


def build_matrix(
    cases: list[Case],
    case_filters: list[str] | None = None,
    arm_filters: list[str] | None = None,
) -> list[RunSpec]:
    """Expand cases into ordered RunSpecs.

    Each case runs only under the arms its metadata declares, intersected with
    ``arm_filters``; ``case_filters`` selects cases by metadata id. Unknown
    filter values raise SuiteError (a typo must not silently run nothing).
    """
    if arm_filters:
        unknown = sorted(set(arm_filters) - set(ARMS))
        if unknown:
            raise SuiteError(f"unknown arm(s) {unknown}; valid: {sorted(ARMS)}")
    if case_filters:
        known_ids = {c.id for c in cases}
        unknown = sorted(set(case_filters) - known_ids)
        if unknown:
            raise SuiteError(f"case id(s) {unknown} not in suite; suite has: {sorted(known_ids)}")

    specs: list[RunSpec] = []
    for case in cases:
        if case_filters and case.id not in case_filters:
            continue
        declared = set(case.arm_names)
        for arm in ARM_ORDER:
            if arm.name not in declared:
                continue
            if arm_filters and arm.name not in arm_filters:
                continue
            specs.append(RunSpec(case, arm))
    return specs
