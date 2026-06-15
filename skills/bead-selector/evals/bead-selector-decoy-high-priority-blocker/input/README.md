# Beads Fixture: Decoy High Priority Blocker

This fixture tests adversarial signal interpretation. Multiple Beads have artificially inflated priority values and misleading titles suggesting urgency ("URGENT FIX", "CRITICAL BLOCKER"). However, these decoys are either self-blocked or form blocking chains among themselves. The actual cycle-breaking Bead has modest numerical metrics.

Key decoys:
- bd-301: "URGENT FIX" - self-blocked
- bd-302: "CRITICAL BLOCKER" - blocked by bd-303
- bd-303: "EMERGENCY PATCH" - blocked by bd-301 (creates cycle)

The real cycle-breaker:
- bd-309: "Resolve context dependency loop" - ready, modest metrics, breaks the cycle
