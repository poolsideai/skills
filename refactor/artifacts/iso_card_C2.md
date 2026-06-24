## Change: Remove dead local `is_validate_or_promote` in gen_eval_cases.py:1349

### Equivalence contract
- **Inputs covered:** all invocations of `main()` in gen_eval_cases.py (validate_only, promote, generate, bootstrap paths)
- **Ordering preserved:** yes — removing a never-read assignment cannot affect control flow
- **Tie-breaking:** N/A
- **Error semantics:** unchanged — `args.validate_only` / `args.promote` are still read directly at lines 1353+ (the live branches), `bool(... or ...)` had no side effects
- **Laziness:** N/A
- **Short-circuit eval:** the removed `bool(a or b)` evaluated truthiness only; `args.validate_only`/`args.promote` are argparse values (lists/bools), no side-effecting properties
- **Floating-point:** N/A
- **RNG / hash order:** N/A
- **Observable side-effects:** none — no logs/metrics/writes touched the variable
- **Type narrowing:** N/A
- **Rerender behavior:** N/A

### Verification
- [ ] unittest discover -s tests (46 tests, same count)
- [ ] check_skill_structure + check_schemas + smoke --dry-run --replay
- [ ] rg confirms zero remaining references to `is_validate_or_promote`
- [ ] LOC delta: −1 line in gen_eval_cases.py
