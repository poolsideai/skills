# Source-doc claim reconciliation

Companion detail for §12 of [`../../laguna-skills-and-harness-substrate-2026-06-10.md`](../../laguna-skills-and-harness-substrate-2026-06-10.md).

Use this when you need to check which Plan A / Plan B claims were verified against the codebase, and which ones are still only attributed.


| # | Claim (source) | Verdict | Evidence |
|---|---|---|---|
| 1 | Poolside supports the Agent Skills format (SKILL.md + frontmatter, progressive disclosure). | ✅ | `types.go:68-79`; default skills w/ `references/`. |
| 2 | Poolside does not enforce `allowed-tools` / `compatibility`; restrictions belong in harness. | ✅ (+nuance) | `types.go:78` TODO; `compatibility` stored not enforced (`:74,92`). |
| 3 | Skill discovery checks `.poolside/skills`, `.agents/skills`, user-global. | ✅ | `local_registry.go:33`; `types.go:102`. |
| 4 | Default embedded skills auto-install unless skipped (contaminates evals). | ✅ | `local_registry.go:41`; `default_skills.go:22,80`. |
| 5 | `pool exec` has no skill disable/allow/force flags. | ✅ | `exec_cmd.go` flag set. |
| 6 | `pool exec` omits `RemoteSkillRepositories`; ACP passes them. | ✅ | `main.go:336-347` vs `runner.go:1323`. |
| 7 | JSON formatter is sparse (reasoning/thought/toolCall/toolResult, mostly stringified). | ✅ | `json_formatter.go` (full). |
| 8 | Artifact export relies on `history` "latest"/ATIF scraping. | ✅ | `history_cmd.go:66-99`; `main.go:521`. |
| 9 | `--agent-config-file` exists (hidden) and is the model-matrix lever. | ✅ | `exec_cmd.go`. |
| 10 | Exit codes 0 / 4 / other. | ✅ | `exec_cmd.go` Long help + `runPoolCLI`. |
| 11 | `AgentConfig` can express reproducible model eval configs: top-level `max_steps`; OpenAI provider `model_id`, sampling, guided-generation, streaming, and reasoning controls. | ✅ (+nuance) | `config.go:64,159-190,206-215,260-285,543-546`; `defaults.go:15,47`. Model ID is `model.provider.openai.model_id`, not top-level. Actual Laguna IDs/access remain open. |
| 12 | Laguna XS.2 = 33B/3B MoE, 256K context (model facts). | ❓ | External (HF/Poolside blog); not verified in this pass. Verify via web if it gates messaging. |

## Delta vs the source docs

Six things this investigation established that are in neither Plan A nor Plan B. Each is documented in full at its home section; this is only the index:

- (a) Skills are **on by default** in `pool exec`; see §6.2.
- (b) `SkipDefaultSkillInstall` **already exists** but is only a default-install/upgrade control, not full isolation; see §6.2.
- (c) `--disable-skills` is achievable by dropping the skill tool from `EnabledTools`; see the PR3 row in §9 and flag semantics in §9.1.
- (d) Default install **self-upgrades by semver on every run** (nondeterminism, not just contamination); see §6.2.
- (e) `pool` ships `skill-creator` / `configure-sandbox` / `pool-product-reference` as authoring precedents; see §6.1.
- (f) An optional **public-catalog / GTM dimension** exists in the comp, but is non-authoritative and not gating unless Ben scopes it in; see Workstream F (§10).