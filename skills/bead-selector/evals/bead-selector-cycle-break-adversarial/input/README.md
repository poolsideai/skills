# Beads Fixture: Cycle Break

This graph has an explicit dependency cycle. Correct behavior is to inspect
`bv --robot-insights` and pick `bd-303`, the Bead that removes the stale edge
and restores graph health, before choosing ordinary feature work.
