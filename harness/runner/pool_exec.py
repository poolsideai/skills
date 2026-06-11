"""pool CLI invocation for the eval runner (plan item 10).

The canonical command (the plan's item 10, with the auth additions the
model-access spike showed isolated-HOME runs need):

    pool exec --prompt-file <run_dir>/prompt.md --directory <workspace>
        -o json --unsafe-auto-allow --sandbox required --run-id <uuid7>
        --agent-name <agent> --api-url <api_url>

The *installed* pool 0.2.172 diverges from that surface (verified live,
docs/model-access-spike.md section 2): no ``exec`` subcommand, and
``--run-id`` / ``--sandbox`` are rejected as unknown flags. So before live
runs this module probes the installed binary's flag surface and adapts the
canonical command, logging every dropped/translated flag as harness debt.
The probe trick: ``pool [exec] <flag> <value> --help`` -- help-only
inspection, no model call, no run. CAUTION (verified live, 2026-06-10):
pool 0.2.172 exits 0 even when it rejects an unknown flag or command -- it
prints ``Error: unknown flag: --sandbox`` to stderr, executes nothing, and
still returns exit code 0 (with *or without* ``--help``). Flag support is
therefore decided by exit code AND the absence of an unknown-flag/command
error on stderr, and ``run_pool`` re-checks live stderr for the same
rejection pattern so a silently-rejected command is never recorded as a
successful run.

Dry-run never probes and never invokes pool: it renders the canonical
command (docs/trajectory-recovery-spike.md HD-5 -- live behavior asserted on
the first smoke run).

NEVER import forge. pool is always a subprocess.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

if str(Path(__file__).resolve().parents[2]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.runner.fixtures import MaterializedRun
from harness.validators.command_result import PROXY_VARS, kill_process_group, run_command

DEFAULT_API_URL = os.environ.get("POOLSIDE_API_URL", "https://api.poolsi.de")
DEFAULT_POOL_BIN = os.environ.get("POOL_BIN", "pool")

#: flag -> dummy value used only for help-probing (never executed).
_PROBE_FLAGS: dict[str, list[str]] = {
    "--prompt-file": ["/dev/null"],
    "--directory": ["/tmp"],
    "--sandbox": ["required"],
    "--run-id": ["00000000-0000-7000-8000-000000000000"],
    "--agent-name": ["probe"],
    "--api-url": ["https://example.invalid"],
    "--unsafe-auto-allow": [],
    "-o": ["json"],
}

#: Flags the runner cannot function without; a probe failure on these aborts.
_LOAD_BEARING = ("--agent-name", "-o", "--unsafe-auto-allow")

#: pool 0.2.172 prints these to stderr and exits 0 when it rejects argv --
#: exit codes alone cannot distinguish "ran" from "rejected and did nothing".
_CLI_REJECTION_RE = re.compile(r"^.*\bunknown (?:shorthand )?(?:flag|command)\b.*$", re.IGNORECASE | re.MULTILINE)


def cli_rejection(stderr: str) -> str | None:
    """The unknown-flag/command error line pool printed, or None."""
    match = _CLI_REJECTION_RE.search(stderr)
    return match.group(0).strip() if match else None


@dataclass
class PoolSurface:
    """What the pool binary in front of us actually supports."""

    pool_version: str = "unprobed"
    has_exec_subcommand: bool = True
    flags: dict[str, bool] = field(default_factory=lambda: {f: True for f in _PROBE_FLAGS})
    history_has_atif: bool = False
    probed: bool = False

    def supports(self, flag: str) -> bool:
        return self.flags.get(flag, False)


@dataclass
class PoolRunResult:
    argv: list[str]
    exit_code: int
    started_at: str
    finished_at: str
    duration_ms: int
    timed_out: bool
    stderr_tail: str
    #: pool's unknown-flag/command error line when it rejected the argv (it
    #: exits 0 and executes nothing in that case); None for a real run.
    cli_rejection: str | None = None


def canonical_surface() -> PoolSurface:
    """The plan-canonical surface, used by --dry-run (everything supported,
    nothing probed)."""
    return PoolSurface()


def probe_surface(pool_bin: str = DEFAULT_POOL_BIN) -> PoolSurface:
    """Probe the installed pool binary with help-only invocations."""
    surface = PoolSurface(probed=True)

    version = run_command([pool_bin, "--version"], timeout_s=20)
    raw = version.stdout.strip().splitlines()[0].strip() if version.ok and version.stdout.strip() else ""
    match = re.search(r"\d+\.\d+\.\S+", raw)
    surface.pool_version = match.group(0) if match else (raw or "unknown")

    exec_help = run_command([pool_bin, "exec", "--help"], timeout_s=20)
    surface.has_exec_subcommand = exec_help.ok and cli_rejection(exec_help.stderr) is None

    base = [pool_bin, "exec"] if surface.has_exec_subcommand else [pool_bin]
    for flag, dummy in _PROBE_FLAGS.items():
        probe = run_command([*base, flag, *dummy, "--help"], timeout_s=20)
        # exit code alone is meaningless: pool 0.2.172 exits 0 on unknown
        # flags too, printing the rejection to stderr (module docstring).
        surface.flags[flag] = probe.ok and cli_rejection(probe.stderr) is None

    history_help = run_command([pool_bin, "history", "trajectories", "--help"], timeout_s=20)
    surface.history_has_atif = history_help.ok and "--atif" in history_help.stdout

    missing = [f for f in _LOAD_BEARING if not surface.supports(f)]
    if missing:
        raise RuntimeError(
            f"pool binary {pool_bin!r} (version {surface.pool_version}) is missing "
            f"load-bearing flag(s) {missing}; cannot run evals against it"
        )
    return surface


def build_pool_command(
    surface: PoolSurface,
    *,
    pool_bin: str,
    prompt_file: Path,
    prompt_text: str,
    workspace: Path,
    agent_name: str,
    run_id: str,
    api_url: str = DEFAULT_API_URL,
    sandbox_mode: str = "required",
) -> tuple[list[str], list[dict], bool]:
    """Build the argv for one run from the canonical command, adapted to the
    probed surface.

    Returns (argv, debt_entries, run_id_flag_used). Every adaptation away
    from the canonical command is a harness_debt entry (run-manifest.v0).
    """
    debt: list[dict] = []
    argv: list[str] = [pool_bin]

    if surface.has_exec_subcommand:
        argv.append("exec")
    else:
        debt.append({
            "kind": "cli-no-exec-subcommand",
            "detail": f"pool {surface.pool_version} has no `exec` subcommand; the root command is exec (model-access spike section 2).",
        })

    if surface.supports("--prompt-file"):
        argv += ["--prompt-file", str(prompt_file)]
    else:
        argv += ["-p", prompt_text]
        debt.append({
            "kind": "cli-missing-flag-prompt-file",
            "detail": "--prompt-file rejected by installed pool; prompt passed inline via -p (verbatim prompt.md content).",
        })

    argv += ["--directory", str(workspace)] if surface.supports("--directory") else ["-d", str(workspace)]
    if not surface.supports("--directory"):
        debt.append({
            "kind": "cli-missing-flag-directory",
            "detail": "--directory long flag rejected; fell back to -d.",
        })

    argv += ["-o", "json", "--unsafe-auto-allow"]

    if surface.supports("--sandbox"):
        argv += ["--sandbox", sandbox_mode]
        if sandbox_mode != "required":
            debt.append({
                "kind": "sandbox-disabled",
                "detail": "run executed with --sandbox disabled (no container runtime reachable, or forced via --sandbox); "
                          "tools ran unsandboxed on the host with --unsafe-auto-allow. The canonical command requires "
                          "sandboxing; sandboxed runs additionally need a workspace .poolside/settings.yaml sandbox "
                          "block and bun in the image for the repair loop (later hardening).",
            })
    else:
        debt.append({
            "kind": "cli-missing-flag-sandbox",
            "detail": "--sandbox rejected by installed pool 0.2.172; run executes with --unsafe-auto-allow and NO sandbox requirement (canonical command pairs them).",
        })

    run_id_flag_used = False
    if surface.supports("--run-id"):
        argv += ["--run-id", run_id]
        run_id_flag_used = True
        debt.append({
            "kind": "hd-1-hidden-flag-run-id",
            "detail": "--run-id is a hidden flag with no compat promise (trajectory-recovery-spike HD-1); used to key session-record recovery.",
        })
    else:
        debt.append({
            "kind": "cli-missing-flag-run-id",
            "detail": f"--run-id rejected by installed pool {surface.pool_version}; harness run_id {run_id} names the manifest only -- recovery relies on the isolated per-run state dir (fallback F-a/F-b).",
        })

    argv += ["--agent-name", agent_name, "--api-url", api_url]
    return argv, debt, run_id_flag_used


def sandbox_available() -> bool:
    """Pool's sandbox is container-based; --sandbox required aborts with
    'no sandbox is configured' when no runtime is reachable (verified live
    2026-06-11 on pool 1.0.5)."""
    docker = shutil.which("docker")
    if not docker:
        return False
    return run_command([docker, "info"], timeout_s=10).exit_code == 0


def build_run_env(mat: MaterializedRun) -> dict[str, str]:
    """Environment for the pool subprocess: isolated HOME + private
    XDG_STATE_HOME, minimal passthrough, POOLSIDE_TOKEN forwarded if set
    (token env var beats credentials.json in pool's resolution order),
    proxy vars stripped."""
    env = {
        "HOME": str(mat.home),
        "XDG_STATE_HOME": str(mat.state),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
        "LANG": os.environ.get("LANG", "en_US.UTF-8"),
        "TERM": "dumb",
    }
    token = os.environ.get("POOLSIDE_TOKEN")
    if token:
        env["POOLSIDE_TOKEN"] = token
    for key in PROXY_VARS:
        env.pop(key, None)
    return env


def run_pool(
    argv: list[str],
    *,
    env: dict[str, str],
    stdout_path: Path,
    stderr_path: Path,
    timeout_s: float,
) -> PoolRunResult:
    """Run pool, streaming stdout (NLJSON) / stderr to files. Returns timing
    in the run-manifest.v0 shape; on timeout the whole process group is
    killed (pool spawns agent tool subprocesses; killing only the leader
    would leave children mutating the workspace while it is graded and
    cleaned up) and exit_code is -9."""
    started_dt = datetime.now(timezone.utc)
    start = time.monotonic()
    timed_out = False
    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    with open(stdout_path, "wb") as out_f, open(stderr_path, "wb") as err_f:
        try:
            proc = subprocess.Popen(
                argv, stdout=out_f, stderr=err_f, stdin=subprocess.DEVNULL, env=env,
                start_new_session=True,  # own process group, so timeout can killpg
            )
        except OSError as exc:
            err_f.write(f"harness: failed to spawn pool: {exc}\n".encode())
            finished_dt = datetime.now(timezone.utc)
            return PoolRunResult(
                argv=list(argv), exit_code=127,
                started_at=rfc3339(started_dt), finished_at=rfc3339(finished_dt),
                duration_ms=int((time.monotonic() - start) * 1000),
                timed_out=False, stderr_tail=str(exc),
            )
        try:
            exit_code = proc.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            timed_out = True
            kill_process_group(proc)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass  # leader unreapable; the group got SIGKILL, do not hang the runner
            exit_code = -9
    finished_dt = datetime.now(timezone.utc)
    stderr_text = stderr_path.read_text(encoding="utf-8", errors="replace")
    return PoolRunResult(
        argv=list(argv),
        exit_code=exit_code,
        started_at=rfc3339(started_dt),
        finished_at=rfc3339(finished_dt),
        duration_ms=int((time.monotonic() - start) * 1000),
        timed_out=timed_out,
        stderr_tail=stderr_text[-4000:],
        # pool 0.2.172 exits 0 on unknown flags/commands without executing;
        # surface that here so the runner never records a no-op as a run.
        cli_rejection=cli_rejection(stderr_text),
    )


def rfc3339(dt: datetime) -> str:
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")
