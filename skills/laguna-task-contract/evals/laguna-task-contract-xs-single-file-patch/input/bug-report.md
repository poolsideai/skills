# Bug: slugify produces double hyphens

Running `bun test test/slugify.test.ts` fails:

```
✗ slugify > collapses consecutive separators
  Expected: "deep-dive-2024"
  Received: "deep--dive--2024"
```

`slugify("Deep  Dive  2024")` should collapse runs of whitespace and
punctuation into a single hyphen, but `src/slugify.ts` replaces each
separator character one-for-one, so consecutive separators become
consecutive hyphens.

Please do not touch the test file — its expectations match our published
URL format.
