Create a technical implementation plan for the requested Poolside Studio feature.

Use the local input files as the only source of truth. Write the grading artifact
to `.laguna/ce-plan.json` as JSON. The artifact must be a structured plan, not a
summary of the source plan.

Required top-level JSON fields:

- `schema_version`: `ce-plan.quality-plan.v1`
- `title`
- `problem_frame`
- `scope`: object with `in_scope` and `non_goals` arrays
- `requirements`: array of requirement strings traced to the brief
- `decisions`: array of decision strings with rationale
- `implementation_units`: array of objects with `name`, `files`, `test_files`, and `work`
- `test_scenarios`: array of concrete test scenario strings
- `risks`: array of risk strings
- `evidence_sources`: array of local input paths used

All file paths in the artifact must be repo-relative. Prefer current repo paths
from `input/repo-context.md` over stale or absolute paths in source prose.
