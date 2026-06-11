# Skills Catalog UI Research Findings

Captured: 2026-06-10

This pass compares public skills, GPT, MCP, agent-template, and integration catalogs for visual and information-architecture patterns that could inform the Poolside Skills site.

## Captured Sites

| Site | Folder | Best screenshots | Pattern type |
| --- | --- | --- | --- |
| Anthropic Agent Skills Docs | `anthropic-agent-skills-docs` | `screenshots/index-desktop-full.png`, `screenshots/skill-repo-detail-desktop-full.png` | Official docs + GitHub package detail |
| OpenAI Codex Agent Skills Docs | `openai-codex-skills-docs` | `screenshots/index-desktop-full.png` | Official docs |
| ChatGPT Explore GPTs | `chatgpt-gpt-store` | `screenshots/index-desktop-full.png` | Official product store, but capture is login/error-limited |
| SkillsMP | `skillsmp` | `screenshots/search-desktop-full.png`, `screenshots/detail-frontend-design-desktop-full.png` | Large-scale agent-skill marketplace |
| MCP Servers Agent Skills Library | `mcpservers-agent-skills` | `screenshots/index-desktop-full.png`, `screenshots/author-anthropic-desktop-full.png` | SEO-oriented skill directory |
| Official MCP Registry | `official-mcp-registry` | `screenshots/index-desktop-full.png`, `screenshots/search-desktop-full.png` | Minimal official registry |
| Smithery | `smithery` | `screenshots/index-desktop-full.png`, `screenshots/detail-exa-desktop-full.png` | MCP app-store style registry |
| Glama MCP Servers | `glama-mcp` | `screenshots/index-desktop-full.png`, `screenshots/detail-semgrep-desktop-full.png` | Dense metadata-heavy MCP registry |
| MCP.so | `mcp-so` | `screenshots/index-desktop-full.png`, `screenshots/detail-in-parallel-desktop-full.png` | Community MCP marketplace/feed |
| PulseMCP | `pulsemcp` | `screenshots/index-desktop-full.png`, `screenshots/detail-time-desktop-full.png` | Directory with freshness and popularity signals |
| MintMCP | `mintmcp` | `screenshots/index-desktop-full.png`, `screenshots/detail-github-desktop-full.png` | Enterprise-friendly MCP marketplace |
| Awesome Skill | `awesome-skill` | `screenshots/index-featured-desktop-full.png`, `screenshots/detail-browser-agent-desktop-full.png` | Agent-skill card grid with security detail |
| Official Skills | `officialskills` | `screenshots/index-desktop-full.png`, `screenshots/publisher-microsoft-desktop-full.png` | Publisher-first skills directory |
| PromptBase Agent Skills | `promptbase-agent-skills` | `screenshots/index-desktop-full.png`, `screenshots/detail-seogeo-desktop-full.png` | Commercial skill marketplace |
| Composio Toolkits | `composio-toolkits` | `screenshots/index-desktop-full.png`, `screenshots/detail-gmail-desktop-full.png` | Integration/toolkit catalog |
| Docker MCP Catalog Docs | `docker-mcp-catalog` | `screenshots/index-desktop-full.png` | Official documentation/catalog hybrid |

## Strong UI Paradigms

### 1. Catalog-first dense grid

Best references: `skillsmp`, `awesome-skill`, `glama-mcp`, `smithery`, `mintmcp`.

Useful traits:

- Search and filters appear before any marketing copy.
- Cards lead with package name, one practical description, and compact metadata.
- Tags and categories are visible without opening detail pages.
- Cards are dense enough to compare 8-12 items on a desktop viewport.

Poolside implication: keep the homepage as a usable catalog, not a landing page. The current prototype is directionally aligned, but the next version should make each card more data-driven: validation status, supported model, skill type, last verified date, estimated tokens, and source path.

### 2. Trust and quality signals

Best references: `glama-mcp`, `awesome-skill`, `pulsemcp`, `mintmcp`, `smithery`.

Useful traits:

- Glama grades license, quality, and maintenance.
- Awesome Skill shows a security score and detected risk categories on detail pages.
- PulseMCP emphasizes updates, popularity, and server metadata.
- MintMCP shows official/featured/auth/tool-count-style signals.
- Smithery highlights verified and managed servers.

Poolside implication: replace vague "quality" with Poolside-owned evidence. Good candidate signals:

- Schema valid
- Validator pass rate
- Eval lift over no-skill baseline
- Last verified date
- Compatible agents/models
- Required tools
- Scope boundary, such as single-file patch or read-only review

### 3. Detail page as confidence builder

Best references: `awesome-skill`, `glama-mcp`, `smithery`, `mintmcp`, `skillsmp`.

Useful traits:

- Detail pages expose source, install/action path, risk/security, included files, and related packages.
- Glama and MintMCP are strongest for technical tabs and package metadata.
- Awesome Skill is strongest for showing `SKILL.md` content plus security assessment.
- Smithery is strongest for install/use flow.

Poolside implication: a skill detail page should not only repeat the card. It should answer:

- When should this skill trigger?
- What does it produce?
- Which files/scripts/schemas are included?
- What validation proves success?
- What models/tools does it work with?
- What are the known risks or boundaries?

### 4. Publisher-first browsing

Best references: `officialskills`, `mcpservers-agent-skills`, GitHub skill repositories.

Useful traits:

- Publisher pages make official/vendor source legible.
- Author pages work well when the catalog is large and heterogeneous.
- GitHub-backed pages make package ownership and source-of-truth clear.

Poolside implication: add publisher/source filters early, even if every initial skill is Poolside-authored. A future catalog may need `Poolside`, `Anthropic`, `OpenAI`, `GitHub`, `Community`, and `Internal` source slices.

### 5. Docs/catalog hybrid

Best references: `anthropic-agent-skills-docs`, `openai-codex-skills-docs`, `docker-mcp-catalog`.

Useful traits:

- Docs sites are weaker as visual catalogs but strong for authoring, installation, and conceptual guidance.
- Left navigation and page-local anchors make long-form usage guidance easy to scan.
- Official docs establish terms of art and constraints.

Poolside implication: keep long authoring/eval methodology out of the main card grid. Link catalog entries to docs-style pages for authoring guide, eval methodology, and skill acceptance gates.

### 6. Commercial marketplace patterns

Best references: `promptbase-agent-skills`, `chatgpt-gpt-store`.

Useful traits:

- Editorial categories and featured/trending rails work well for consumers.
- Ratings, price/free state, creator identity, and "add to library" actions are familiar.

Poolside implication: use sparingly. Poolside probably benefits more from engineering confidence signals than consumer marketplace affordances. Trending or featured rails could be useful later, but should not displace search/filter/eval metadata.

## Reusable Layout Ideas

- Header: brand, catalog, docs, GitHub/source, maybe install.
- Top band: short H1 plus search, not a large marketing hero.
- Filter rail: model fit, workflow, language/tooling, source, difficulty, validation state.
- Catalog toolbar: count, sort, active filters, clear filters.
- Cards: category, name, trigger summary, validation/eval chips, tags, difficulty/tokens, source, last verified.
- Detail layout: main column for purpose, use-when, output contract, validation, examples; side column for install/source/eval status/files.
- Detail tabs: Overview, SKILL.md, Schema, Evals, Risks, Related.
- Trust strip: schema valid, validator pass, last verified, compatible model, required tools.

## Capture Caveats

- ChatGPT Explore GPTs rendered a public product shell, but repeated screenshot attempts returned `Error loading GPTs` or inaccessible GPT detail states in the automated browser. Treat it as a weak visual reference and rely on official OpenAI descriptions for the category/trending-store paradigm.
- Some sites are client-rendered; screenshots are the ground truth for layout, while extracted text may miss late-loaded or canvas-rendered UI.
- Inventory counts, popularity, and last-updated values are live and should be treated as date-stamped observations.
