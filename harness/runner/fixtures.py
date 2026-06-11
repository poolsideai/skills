"""Fixture-workspace materialization for eval runs (plan item 9).

The invariant (docs/eval-methodology.md section 3): the only difference
between a with-skill arm and its baseline is the skill materialized into the
workspace. ``pool`` is never pointed at the skill source tree or the case
directory itself.

Per run this module builds one scratch directory containing:

    <scratch>/
    |-- workspace/   case input/ copied in; with-skill arms also get
    |                .poolside/skills/<skill>/ (the discovery path pool exec
    |                actually scans -- skipping this makes with-skill arms
    |                silently identical to baseline). The skill's evals/
    |                subtree is EXCLUDED so gold expected/ artifacts never
    |                leak into the model's workspace.
    |-- home/        isolated HOME: empty ~/.config/poolside/skills/ so real
    |                user-global skills can't contaminate either arm; for
    |                live runs, credentials.json is copied in iff
    |                POOLSIDE_TOKEN is unset (settings.yaml is never copied
    |                -- the runner passes --api-url explicitly).
    `-- state/       private XDG_STATE_HOME so trajectory recovery is
                     race-free (docs/trajectory-recovery-spike.md F1).

``harness/fixtures/README.md`` documents this layout; keep the two in sync.
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

if str(Path(__file__).resolve().parents[2]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.runner.matrix import Arm, Case

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SKILLS_ROOT = REPO_ROOT / "skills"

#: Skill subtrees never copied into the workspace. evals/ holds the cases
#: themselves -- including expected/ gold artifacts for the case under test.
SKILL_MATERIALIZATION_EXCLUDES = ("evals",)


@dataclass
class MaterializedRun:
    scratch: Path
    workspace: Path
    home: Path
    state: Path
    skill_materialized: bool  # True iff a with-skill arm got its skill copied
    credentials_copied: bool

    def cleanup(self) -> None:
        shutil.rmtree(self.scratch, ignore_errors=True)


def materialize(
    case: Case,
    arm: Arm,
    skills_root: Path = DEFAULT_SKILLS_ROOT,
    *,
    scratch_parent: Path | None = None,
    include_credentials: bool = False,
    poolside_token_present: bool = False,
) -> MaterializedRun:
    """Build the scratch layout above for one case x arm run.

    Raises FileNotFoundError when a with-skill arm's skill directory is
    missing -- materializing baseline-identical "with-skill" runs is the
    silent failure mode this whole module exists to prevent.
    """
    scratch = Path(tempfile.mkdtemp(prefix=f"laguna-eval-{case.id}-{arm.name}-", dir=scratch_parent))
    workspace = scratch / "workspace"
    home = scratch / "home"
    state = scratch / "state"

    # 1. Fresh workspace <- case input/ (input/ may legitimately be empty).
    if case.input_dir.is_dir():
        shutil.copytree(case.input_dir, workspace)
    else:
        workspace.mkdir(parents=True)

    # 2. With-skill arms only: skills_root/<skill> -> workspace/.poolside/skills/<skill>
    skill_materialized = False
    if arm.with_skill:
        skill_src = skills_root / case.skill
        if not skill_src.is_dir():
            shutil.rmtree(scratch, ignore_errors=True)
            raise FileNotFoundError(
                f"with-skill arm {arm.name} for case {case.id}: skill directory missing: {skill_src}"
            )
        dest = workspace / ".poolside" / "skills" / case.skill
        shutil.copytree(
            skill_src,
            dest,
            ignore=shutil.ignore_patterns(*SKILL_MATERIALIZATION_EXCLUDES),
        )
        skill_materialized = True

    # 3. Workspace sandbox config. `pool exec --sandbox required` aborts with
    #    "no sandbox is configured for <dir>" unless the workspace declares
    #    one (verified live 2026-06-11, pool 1.0.5 + Docker running). Written
    #    to BOTH arms so it can never be the with/without difference.
    #    read-write = shell sandboxing: tools run in the container, writes
    #    land directly in the workspace where the validator grades them.
    settings_path = workspace / ".poolside" / "settings.yaml"
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(
        "sandbox:\n"
        "    filesystem:\n"
        "        workspaces:\n"
        "            access: read-write\n",
        encoding="utf-8",
    )

    # 4. Isolated HOME with an empty user-global skills dir.
    (home / ".config" / "poolside" / "skills").mkdir(parents=True)

    # 5. Credentials for live runs: copy ~/.config/poolside/credentials.json
    #    iff the caller asked AND POOLSIDE_TOKEN is not already set (the token
    #    env var wins in pool's resolution order; docs/model-access-spike.md
    #    section 5). settings.yaml is deliberately NOT copied.
    credentials_copied = False
    if include_credentials and not poolside_token_present:
        real_creds = Path.home() / ".config" / "poolside" / "credentials.json"
        if real_creds.is_file():
            shutil.copy2(real_creds, home / ".config" / "poolside" / "credentials.json")
            credentials_copied = True

    # 6. Private XDG state dir for run/session/trajectory recovery.
    state.mkdir(parents=True)

    return MaterializedRun(
        scratch=scratch,
        workspace=workspace,
        home=home,
        state=state,
        skill_materialized=skill_materialized,
        credentials_copied=credentials_copied,
    )


def materialize_replay_workspace(case: Case, *, scratch_parent: Path | None = None) -> Path:
    """Gold-replay workspace (evals/README.md "Gold replay"): input/ copied
    in, then expected/ copied OVER it -- expected/ mirrors workspace-relative
    output paths, so this places gold artifacts exactly where a real run
    would have written them. Caller owns cleanup of the returned directory."""
    workspace = Path(tempfile.mkdtemp(prefix=f"laguna-replay-{case.id}-", dir=scratch_parent))
    if case.input_dir.is_dir():
        shutil.copytree(case.input_dir, workspace, dirs_exist_ok=True)
    if case.expected_dir.is_dir():
        shutil.copytree(case.expected_dir, workspace, dirs_exist_ok=True)
    return workspace


def validate_fixture(
    case: Case,
    arms: list[Arm],
    skills_root: Path = DEFAULT_SKILLS_ROOT,
    repo_root: Path = REPO_ROOT,
) -> list[str]:
    """Static fixture checks for --dry-run; returns problems (empty == ok).

    Case.errors (metadata schema validity etc.) are included so callers get
    one consolidated list per case.
    """
    problems = list(case.errors)

    if not case.prompt_path.is_file():
        problems.append(f"prompt.md missing: {case.prompt_path}")
    elif not case.prompt_path.read_text(encoding="utf-8").strip():
        problems.append(f"prompt.md is empty: {case.prompt_path}")

    if not case.input_dir.is_dir():
        problems.append(f"input/ missing (must exist, may be empty): {case.input_dir}")
    if not case.expected_dir.is_dir():
        problems.append(f"expected/ missing (gold artifacts required for replay): {case.expected_dir}")

    if any(arm.with_skill for arm in arms):
        skill_dir = skills_root / case.skill
        if not skill_dir.is_dir():
            problems.append(f"with-skill arm declared but skill directory missing: {skill_dir}")
        elif not (skill_dir / "SKILL.md").is_file():
            problems.append(f"skill directory has no SKILL.md: {skill_dir}")

    # validator.command path tokens must resolve (repo-root-relative or absolute).
    for token in case.validator_command:
        if "/" not in token:
            continue  # bare binaries (bun, python3) resolve via PATH at run time
        path = Path(token)
        if not path.is_absolute():
            path = repo_root / token
        if not path.exists():
            problems.append(f"validator.command path does not exist: {token} (resolved {path})")

    return problems
