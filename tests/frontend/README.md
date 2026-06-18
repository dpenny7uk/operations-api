# Frontend JS tests

Lightweight unit tests for the pure helpers in `frontend/js/`. No framework, no
build step - just Node's built-in test runner (`node --test`, Node 18+).

## Run

```bash
node --test tests/frontend/
```

## Scope

Currently covers `op-datekit.js` - the canonical date + reason-slug helpers
shared by `op-pages.js` and `op-boot.js`. These are the bits that previously
relied on the implementation-defined `new Date(string)` parser on the exclusion
write path; the tests pin the en-GB display-string round-trip (including the
CLDR-42 "Sept" form), the DST-safe day arithmetic, the hold-state boundaries,
and the selection-driven reason slug.

`op-datekit.js` is a classic browser script that also exports via
`module.exports` when run under Node, so the tests `require()` it directly with
no bundler.

> Not wired into the ADO pipeline: the self-hosted build agent isn't guaranteed
> to have Node installed. Run locally before changing any date/slug logic. If
> Node lands on the agent, add `node --test tests/frontend/` as a build step.
