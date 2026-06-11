#!/usr/bin/env python3
"""Install a skill into pool's discovery path so you can run it on real repos.

This is dev ergonomics, not part of the eval harness: it makes a skill from
this repo live in a *real* ``pool`` session (real prompts, real codebase),
which is the prerequisite for dogfooding a skill outside the fixture sandbox.

``pool`` discovers skills in two places:
  - ``~/.config/poolside/skills/<name>/``   global -- available in every repo
  - ``<repo>/.poolside/skills/<name>/``     project-local -- that repo only

Default is a **symlink** to ``skills/<name>/`` in this repo, so edits to the
skill source take effect immediately while you iterate. Use ``--copy`` for a
snapshot that excludes ``evals/`` (matching how the harness materializes a
skill, so gold artifacts never tag along).

Usage:
  uv run scripts/install_skill.py repo-map                 # symlink, global
  uv run scripts/install_skill.py repo-map --into ~/proj   # -> ~/proj/.poolside/skills/
  uv run scripts/install_skill.py --all                    # every skill, global
  uv run scripts/install_skill.py repo-map --copy          # snapshot copy (no evals/)
  uv run scripts/install_skill.py --list                   # show what's installed
  uv run scripts/install_skill.py repo-map --remove        # uninstall

Then dogfood it:
  cd ~/some/real/repo
  pool                          # ask a real question; the skill activates by description
  # grade the real output with the same validator the harness uses:
  bun <this-repo>/skills/<name>/scripts/validate_<artifact>.ts --workspace . --out /tmp/r.json
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = REPO_ROOT / "skills"
GLOBAL_SKILLS_DIR = Path.home() / ".config" / "poolside" / "skills"
COPY_EXCLUDES = ("evals",)  # gold artifacts live under evals/; never ship them to a real run


def available_skills() -> list[str]:
    """Every directory under skills/ that is actually a skill (has SKILL.md)."""
    return sorted(
        d.name for d in SKILLS_ROOT.iterdir() if d.is_dir() and (d / "SKILL.md").is_file()
    )


def target_dir(into: str | None) -> Path:
    """Where <name>/ lands: a project's .poolside/skills/ or the global dir."""
    if into is None:
        return GLOBAL_SKILLS_DIR
    return Path(into).expanduser().resolve() / ".poolside" / "skills"


def describe(dest: Path) -> str:
    """One-line status of an installed entry (link target or copy)."""
    if dest.is_symlink():
        tgt = Path(dest).readlink()
        here = " (this repo)" if str(tgt).startswith(str(SKILLS_ROOT)) else ""
        return f"symlink -> {tgt}{here}"
    if dest.is_dir():
        return "copy"
    return "missing"


def remove_existing(dest: Path) -> None:
    if dest.is_symlink() or dest.is_file():
        dest.unlink()
    elif dest.is_dir():
        shutil.rmtree(dest)


def install_one(name: str, dst_root: Path, *, copy: bool, force: bool, remove: bool) -> bool:
    src = SKILLS_ROOT / name
    if not (src / "SKILL.md").is_file():
        print(f"  ✗ {name}: not a skill (no SKILL.md at {src})", file=sys.stderr)
        return False
    dest = dst_root / name

    if remove:
        if dest.exists() or dest.is_symlink():
            remove_existing(dest)
            print(f"  ✓ removed {dest}")
        else:
            print(f"  · {name}: nothing installed at {dest}")
        return True

    if (dest.exists() or dest.is_symlink()):
        if not force:
            print(f"  ✗ {name}: already at {dest} ({describe(dest)}); pass --force to replace",
                  file=sys.stderr)
            return False
        remove_existing(dest)

    dst_root.mkdir(parents=True, exist_ok=True)
    if copy:
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns(*COPY_EXCLUDES))
        print(f"  ✓ {name}: copied -> {dest} (excl. {', '.join(COPY_EXCLUDES)}/)")
    else:
        dest.symlink_to(src, target_is_directory=True)
        print(f"  ✓ {name}: symlinked -> {dest} -> {src}")
    return True


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Install skills into pool's discovery path.")
    p.add_argument("skills", nargs="*", help="Skill name(s); omit with --all or --list.")
    p.add_argument("--all", action="store_true", help="Operate on every skill under skills/.")
    p.add_argument("--into", metavar="DIR",
                   help="Install project-local into DIR/.poolside/skills/ (default: global ~/.config/poolside/skills).")
    p.add_argument("--copy", action="store_true",
                   help="Snapshot-copy (excludes evals/) instead of the default live symlink.")
    p.add_argument("--force", action="store_true", help="Replace an existing install.")
    p.add_argument("--remove", action="store_true", help="Uninstall instead of install.")
    p.add_argument("--list", action="store_true", help="List installed skills at the target and exit.")
    args = p.parse_args(argv)

    dst_root = target_dir(args.into)
    scope = "global" if args.into is None else f"local:{args.into}"

    if args.list:
        print(f"installed skills @ {dst_root} ({scope}):")
        if not dst_root.is_dir():
            print("  (none — directory does not exist yet)")
            return 0
        entries = sorted(d for d in dst_root.iterdir() if d.is_symlink() or d.is_dir())
        if not entries:
            print("  (none)")
        for d in entries:
            print(f"  {d.name:30}  {describe(d)}")
        return 0

    names = available_skills() if args.all else args.skills
    if not names:
        p.error("name a skill, or pass --all (or --list). Available: " + ", ".join(available_skills()))

    unknown = [n for n in names if not (SKILLS_ROOT / n / "SKILL.md").is_file()]
    if unknown:
        p.error(f"unknown skill(s): {', '.join(unknown)}. Available: " + ", ".join(available_skills()))

    verb = "Removing" if args.remove else ("Copying" if args.copy else "Symlinking")
    print(f"{verb} {len(names)} skill(s) @ {dst_root} ({scope}):")
    ok = all(install_one(n, dst_root, copy=args.copy, force=args.force, remove=args.remove) for n in names)
    if not args.remove and ok:
        print(f"\nDone. Run `pool` in any{'' if args.into is None else ' '+args.into} repo and ask a question "
              f"that matches a skill's triggers.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
