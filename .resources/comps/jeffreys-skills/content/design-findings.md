# Design Findings

## Page Structure

The index page is a catalog-first layout, not a marketing page. The first screen includes a compact top nav, `Browse Skills` heading, search input, category tabs, filter groups, a sort control, and dense skill cards.

The main navigation includes `Install CLI`, `Browse Skills`, `Pricing`, `Docs`, `Help`, and `Sign In`. The footer repeats product and developer links: skill catalog, pricing, featured drops, skill packs, CLI guide, docs, help, support, status, terms, privacy, and DMCA.

The catalog announces count and sort state in the UI: `Showing 123 skills` and `Sorted by Most installed`.

## Index Filters And Controls

Useful filter groups to mirror:

- Source or ownership: `All Skills`, `Jeffrey's`, `Community`, `My Skills`.
- Category tabs: all, tools and utilities, agent and orchestration, code quality, SaaS and web dev, DevOps and infra, research and exploration, Rust.
- Flywheel/tool tags: UBS, BV, CASS, NTM, DCG, SLB, CM, RU, CAAM, Agent Mail.
- Difficulty: beginner, intermediate, advanced, expert.
- Skill tags: Python 3.x, TypeScript, React/Next.js, API design/development, command-line tools, Docker/Containers, with a `Show all tags` expansion.
- Sort menu: visible as `Sort skills by`; default observed state is most installed.

The Rust filtered state updates the URL to `?category=rust-development`, shows a `Clear all filters` affordance, and replaces the card list with Rust-specific skills.

## Card Content Model

Skill cards carry enough data to build the mock-up from content alone:

- Category label, for example `RUST`, `AI/AGENT`, `CODE QUALITY`, or `SPECIALIZED`.
- Skill name.
- One paragraph description starting with the practical use case.
- Animated or illustrated visualization preview.
- Quality score.
- Usefulness score.
- Tags.
- Difficulty.
- Estimated token count.
- Sign-in/download gate.
- Install/download count.
- Save action, shown as `Sign in to save` when logged out or gated.

The visual density is high. Cards are information surfaces, not large hero cards. The previews add personality, but the scannable metadata is the core value.

## Detail Page Content Model

The `rch` detail page is a public preview. It includes:

- Back link to skills.
- `PUBLIC PREVIEW` label.
- Skill name and creator line.
- Description with concrete trigger conditions.
- Difficulty, category, install count, and author.
- `WORKS WITH` tags, including `Rust` and `Command-line tools`.
- Large interactive visualization with previous, pause, next, and stage selector controls.
- Token count, difficulty, quality score, and tags.
- Explanation that quality and utility come from canonical skill metadata.
- Subscription gate: `Subscribe to download`, `Sign In to Subscribe`, and premium benefits.
- Save-to-account block explaining that saved skills sync through `jsm sync`.

This is useful for Poolside because the public detail page can provide enough confidence before showing install or download commands.

## Visual Notes

The index uses a restrained dark, developer-tool aesthetic with dense cards, compact controls, and repeated metric chips. The strongest reusable pattern is the combination of practical description plus machine-readable skill metadata.

Annotated screenshots show that the actionable elements are simple: nav links, filter links/buttons, search, sort, card links, pagination, sign-in/save, and detail-page visualization controls.

The detail page gives the skill room to breathe, but still keeps the operational value above the subscription/download block: description, compatible tech, preview, tokens, difficulty, score, and tags.

## Poolside Adaptations

For a Poolside open-source skills directory, keep the catalog free and make the primary actions open-source friendly:

- Replace subscription CTAs with `View source`, `Copy install command`, `Open in pool`, or `Use with pool exec`.
- Keep `Save` optional, but do not make it the main path.
- Replace `Quality` and `Usefulness` with Poolside-owned signals such as validated scenarios, supported tools, eval status, last verified date, and compatible agents/models.
- Keep token count, difficulty, tags, and practical trigger language.
- Add filters specific to Poolside skills: agent workflows, eval/harness, repo archaeology, code review, frontend, infra, Rust, docs, planning, and model-specific skills.
- Detail pages should show the full public skill content or a direct source link, since the goal is a free open-source directory.
