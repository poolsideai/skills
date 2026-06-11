"""Validate JSON instances against the repo's .schema.json files (plan item 11).

The shared contract schemas live in ``schemas/common/`` and cross-reference each
other by relative ``$ref`` resolved against their stable ``$id``
(``https://poolside.ai/schemas/common/<file>``). Per ``schemas/common/README.md``
loaders must register every common schema; this module builds one
``referencing.Registry`` over all of them so e.g. ``run-manifest.v0``'s embedded
``validator_result`` ``$ref`` resolves.

Public surface:

- ``validate_instance(instance, schema)`` -> list of error strings (empty == valid).
  ``schema`` is a contract name (``"run-manifest.v0"``), a filename
  (``"eval-case.v1.schema.json"``), or a path to any ``.schema.json`` (e.g. a
  per-skill output schema); paths outside ``schemas/common/`` still resolve
  ``$ref``s into the common registry.
- ``validator_for(schema)`` -> a ``Draft202012Validator`` with a ``FormatChecker``
  (``jsonschema[format]`` makes ``format: date-time`` assertive).
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

REPO_ROOT = Path(__file__).resolve().parents[2]
COMMON_SCHEMA_DIR = REPO_ROOT / "schemas" / "common"


class SchemaLoadError(Exception):
    """A schema could not be located or parsed."""


@lru_cache(maxsize=1)
def _common() -> tuple[Registry, dict[str, dict]]:
    """Load every schemas/common/*.schema.json into a Registry, keyed by $id,
    filename, and contract name (filename minus .schema.json)."""
    by_key: dict[str, dict] = {}
    resources: list[tuple[str, Resource]] = []
    if not COMMON_SCHEMA_DIR.is_dir():
        raise SchemaLoadError(f"common schema dir missing: {COMMON_SCHEMA_DIR}")
    for path in sorted(COMMON_SCHEMA_DIR.glob("*.schema.json")):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SchemaLoadError(f"cannot load schema {path}: {exc}") from exc
        schema_id = doc.get("$id", str(path))
        resources.append((schema_id, Resource.from_contents(doc)))
        by_key[schema_id] = doc
        by_key[path.name] = doc
        by_key[path.name.removesuffix(".schema.json")] = doc
    return Registry().with_resources(resources), by_key


def _resolve_schema_doc(schema: str | Path | dict) -> dict:
    if isinstance(schema, dict):
        return schema
    registry_keys = _common()[1]
    key = str(schema)
    if key in registry_keys:
        return registry_keys[key]
    path = Path(schema)
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SchemaLoadError(f"cannot load schema {path}: {exc}") from exc
    raise SchemaLoadError(
        f"unknown schema {schema!r}: not a common contract name, filename, or readable path"
    )


def validator_for(schema: str | Path | dict) -> Draft202012Validator:
    registry, _ = _common()
    doc = _resolve_schema_doc(schema)
    return Draft202012Validator(doc, registry=registry, format_checker=FormatChecker())


def validate_instance(instance: object, schema: str | Path | dict) -> list[str]:
    """Return a sorted list of human-readable validation errors; [] == valid."""
    validator = validator_for(schema)
    errors = []
    for err in validator.iter_errors(instance):
        where = "/".join(str(p) for p in err.absolute_path) or "<root>"
        errors.append(f"{where}: {err.message}")
    return sorted(errors)
