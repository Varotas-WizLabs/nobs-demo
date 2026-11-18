# Vendored browser libraries

## supabase.js

- Package: `@supabase/supabase-js`
- Version: **2.119.0** (exact; pinned in `web/package.json` as a dev dependency, `--save-exact`)
- Published to npm: 2026-11-04 (13:11 UTC)
- How it was chosen: the newest `2.x` release published at least 14 days before 2026-11-19 (the day it was
  vendored), read from `npm view @supabase/supabase-js time --json`. The next one, 2.119.1, was only a day old.
- Source: `node_modules/@supabase/supabase-js/dist/umd/supabase.js` (the package's own UMD build, copied unchanged)
- sha256: `a867edbcfb029370aeec7223dd6180b560b621fbe3bc64c6584fb0369d1b7bce`
- Licence: MIT, see `LICENSE-supabase-js` (copied from the package)
- Used by: `account.html` and `watch.html` as a classic script (`<script src="vendor/supabase.js">`), which
  defines `globalThis.supabase.createClient`.

The bundle contains the literal prefix of Supabase secret keys (`sb_` + `secret_`: supabase-js checks the prefix of the key it is given). The demo
build's secret scan (`scripts/build_demo.py`) exempts that one pattern for this file only when its sha256 equals
`VENDOR_SHA256` there; any other change to the file makes the scan refuse it.

### How to update

1. In `web/`: `npm view @supabase/supabase-js time --json` and pick the newest `2.x` that is at least 14 days old.
2. `npm install --save-dev --save-exact @supabase/supabase-js@<version>`
3. `cp node_modules/@supabase/supabase-js/dist/umd/supabase.js vendor/supabase.js` and
   `cp node_modules/@supabase/supabase-js/LICENSE vendor/LICENSE-supabase-js`
4. `shasum -a 256 vendor/supabase.js`: put the new hash in this file and in `VENDOR_SHA256` in
   `scripts/build_demo.py`, and the version and date above.
5. `npx vitest run tests/vendor.test.js` (checks the hash, the exact version and that `createClient` loads).
