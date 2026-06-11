# Jeffrey's Skills Directory Reference

Source: https://jeffreys-skills.md/skills
Captured: 2026-06-10
Browser tool: `agent-browser`
Chrome profile: `Profile 2` (`Ben`, `venker.ben@gmail.com`)
Viewport: `1440x1200`

## Capture Notes

Direct attach was attempted first:

```bash
agent-browser --profile "Profile 2" --auto-connect tab list
```

That failed with `Target.createTarget: Not supported`, so the capture used the approved fallback: an `agent-browser` session launched with Chrome `Profile 2`.

Core capture pattern:

```bash
agent-browser close --all
agent-browser --profile "Profile 2" open https://jeffreys-skills.md/skills
agent-browser set viewport 1440 1200
agent-browser wait --load networkidle
agent-browser screenshot --full ./.resources/comps/jeffreys-skills/screenshots/01-skills-index-full.png
agent-browser screenshot --annotate ./.resources/comps/jeffreys-skills/screenshots/02-skills-index-annotated.png
agent-browser get text body > ./.resources/comps/jeffreys-skills/content/skills-index-visible-text.md
```

The interaction-state screenshot uses the Rust category filter:

```bash
agent-browser click @e15
agent-browser wait --load networkidle
agent-browser screenshot --full ./.resources/comps/jeffreys-skills/screenshots/03-skills-index-filter-or-search-state.png
```

The representative detail page is `rch`:

```bash
agent-browser open https://jeffreys-skills.md/skills/rch
agent-browser wait --load networkidle
agent-browser screenshot --full ./.resources/comps/jeffreys-skills/screenshots/04-skill-detail-full.png
agent-browser screenshot --annotate ./.resources/comps/jeffreys-skills/screenshots/05-skill-detail-annotated.png
agent-browser get text body > ./.resources/comps/jeffreys-skills/content/skill-detail-visible-text.md
```

No cookies, localStorage dumps, browser state files, or auth-state files were saved into this directory.

## Files

- `screenshots/01-skills-index-full.png`: full-page skills index.
- `screenshots/02-skills-index-annotated.png`: annotated viewport of the skills index.
- `screenshots/03-skills-index-filter-or-search-state.png`: Rust-filtered index state.
- `screenshots/04-skill-detail-full.png`: full-page `rch` detail page.
- `screenshots/05-skill-detail-annotated.png`: annotated viewport of the `rch` detail page.
- `content/skills-index-visible-text.md`: visible text from the index page.
- `content/skill-detail-visible-text.md`: visible text from the `rch` detail page.
- `content/extracted-site-data.json`: structured extraction for mock-up work.
- `content/design-findings.md`: implementation guidance for a Poolside skills directory.
