# Bug Report: Empty Input Crash

**Reporter**: @maya (eng-platform)  
**Priority**: P1  
**Summary**: The util breaks on empty input

We're seeing crashes in production when empty strings get passed to one of the util functions. The partial stack trace is saved at `trace-fragment.txt`. It's not totally clear which util file is involved — could be the string one or the array one, both have similar signatures.

Need this fixed ASAP before the next deploy window (6 hours from now). The crash is 100% reproducible locally with empty input.

**Steps to reproduce**:
1. Call the util function with an empty string or empty array
2. Observe crash

**Expected**: should handle empty input gracefully (return empty or throw a clear validation error)

**Actual**: crashes with undefined reference
