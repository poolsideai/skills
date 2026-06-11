"""Disciplined subprocess runner for validators and CLI probes (plan item 11).

Rules enforced here (the harness side of the validator rules in
``schemas/common/README.md`` / ``evals/README.md``):

- **Timeouts always.** Every invocation has a wall-clock cap; on expiry the
  child's whole process group is SIGKILLed (children run in their own session
  via ``start_new_session=True``, so a validator that forks cannot leave
  orphans holding the pipes or mutating the workspace) and the result is
  marked ``timed_out`` with exit code -9.
- **No-network discipline.** Validators must not make network calls. A Python
  harness cannot truly sandbox a child process, so this runner (a) builds a
  minimal environment instead of inheriting the caller's, and (b) strips proxy
  variables so accidental egress through a configured proxy fails closed.
  Actual enforcement is by convention + review; this is the belt, not the law.
- **Explicit paths.** Callers pass absolute paths in argv; ``cwd`` defaults to
  the repo root only so repo-root-relative ``validator.command`` entries
  (see ``evals/README.md``) resolve.
- **Never raises on process failure** -- exit codes and timeouts are data, not
  exceptions; only argv/spawn-level errors (missing binary) surface as a
  CommandResult with exit_code 127.
"""

from __future__ import annotations

import os
import signal
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

#: Environment variables passed through from the parent by default. Everything
#: else (credentials, tokens, proxy config) is dropped unless explicitly added.
DEFAULT_INHERIT = ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM")

#: Proxy variables that are always stripped, even if a caller passes them in
#: ``extra_env`` by mistake -- part of the no-network discipline.
PROXY_VARS = (
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "FTP_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "ftp_proxy",
    "NO_PROXY", "no_proxy",
)

_TAIL_CHARS = 4000


@dataclass
class CommandResult:
    argv: list[str]
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool = False
    spawn_error: str | None = None

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and not self.timed_out and self.spawn_error is None

    def stderr_tail(self, chars: int = _TAIL_CHARS) -> str:
        return self.stderr[-chars:]


def base_env(
    extra_env: dict[str, str] | None = None,
    inherit: tuple[str, ...] = DEFAULT_INHERIT,
) -> dict[str, str]:
    """Minimal child environment: a short inherit allowlist + explicit extras,
    with proxy variables stripped unconditionally."""
    env: dict[str, str] = {}
    for key in inherit:
        value = os.environ.get(key)
        if value is not None:
            env[key] = value
    if extra_env:
        env.update(extra_env)
    for key in PROXY_VARS:
        env.pop(key, None)
    return env


def kill_process_group(proc: subprocess.Popen) -> None:
    """SIGKILL the child's whole process group.

    Callers must have spawned ``proc`` with ``start_new_session=True`` (so the
    child leads its own group and the harness itself is never in it). Falls
    back to killing just the direct child when the group is already gone.
    """
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except (ProcessLookupError, OSError):
            pass


def run_command(
    argv: list[str],
    *,
    cwd: Path | str | None = None,
    env: dict[str, str] | None = None,
    timeout_s: float = 120.0,
    stdout_path: Path | None = None,
    stderr_path: Path | None = None,
) -> CommandResult:
    """Run ``argv`` with the discipline above and return a CommandResult.

    If ``stdout_path``/``stderr_path`` are given the full streams are also
    written to those files (the in-memory fields keep the full text too --
    v0 outputs are small).
    """
    if env is None:
        env = base_env()
    if cwd is None:
        cwd = REPO_ROOT
    start = time.monotonic()
    timed_out = False
    spawn_error: str | None = None
    try:
        proc = subprocess.Popen(
            argv,
            cwd=str(cwd),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
            start_new_session=True,  # own process group, so timeout can killpg
        )
    except (OSError, ValueError) as exc:  # missing binary, bad argv
        spawn_error = str(exc)
        exit_code, stdout, stderr = 127, "", str(exc)
    else:
        try:
            stdout, stderr = proc.communicate(timeout=timeout_s)
            exit_code = proc.returncode
        except subprocess.TimeoutExpired:
            timed_out = True
            exit_code = -9
            kill_process_group(proc)  # the child AND anything it forked
            try:
                # group is SIGKILLed, so this drains promptly; bounded anyway.
                stdout, stderr = proc.communicate(timeout=10.0)
            except (subprocess.TimeoutExpired, ValueError, OSError):
                stdout, stderr = "", ""
    duration_ms = int((time.monotonic() - start) * 1000)

    if stdout_path is not None:
        Path(stdout_path).parent.mkdir(parents=True, exist_ok=True)
        Path(stdout_path).write_text(stdout, encoding="utf-8")
    if stderr_path is not None:
        Path(stderr_path).parent.mkdir(parents=True, exist_ok=True)
        Path(stderr_path).write_text(stderr, encoding="utf-8")

    return CommandResult(
        argv=list(argv),
        exit_code=exit_code,
        stdout=stdout,
        stderr=stderr,
        duration_ms=duration_ms,
        timed_out=timed_out,
        spawn_error=spawn_error,
    )
