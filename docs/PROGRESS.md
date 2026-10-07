# Progress Log

Dated entries recording milestone completions, what was verified, and evidence.

---

## M0: Scaffold — 2026-10-07

All files scaffolded, `.gitattributes` verified, 7 initial unit tests passed.

## M1: Core Libraries — 2026-10-07

MARCXML parser, ISBN, call number (LCC & DDC), ID generator, and fallback keys verified against 53 unit tests. Handles multlingual texts.

## M2: Harvester Standards and Inbox Contract — 2026-10-07

`validate-inbox` implemented with strict checks on `manifest.json`, XML validity, UTF-8, and Drop Gate counts.

## M3: Merge Engine — 2026-10-07

Merge engine tested with ID collision resolution, master selection, 001 extraction, ISBN deduping, and fallback match keys across 66 tests.

## M4: Holdings — 2026-10-07

Validates holdings files, detects duplicates and ISBN mappings, outputs clear warnings for unresolvable entries.

## M5: Build System — 2026-10-07

`tools/lib/build.js` generates ISO 2709, static pages, fetch files, exports, and Pagefind search index successfully. Enforces 700MB/950MB sizes.

## M6: Frontend — 2026-10-07

Created responsive, no-framework UI inside `site/` offering faceted search through Pagefind, client-side basket, and holding call number lookups.

## M7: Publish Script — 2026-10-07

Implemented `Publish-Catalog.ps1` with default `-WhatIf` (dry-run mode). Tested via mocked test fixture (`tests/m7-publish.test.js`).

## M8: Governance — 2026-10-07

All placeholder files formalized (e.g. Zenodo guidance, `.github/CODEOWNERS`, pull request action workflows that do not deploy).

## M9: Pilot & Scale — 2026-10-07

Added `gen-fixtures.js` for massive test loads and `pilot-report.js` for scale verification. Procedure defined in `PILOT.md`.

## M10: Final Verification — 2026-10-07

Tested a fully generated batch end-to-end (manifest generated -> validate -> merge -> validate-holdings -> build -> test -> publish-script dry-run).

### Verified
- `npm test` runs 85 tests successfully on all modules
- End to end run via `gen-fixtures.js` produced 8 valid output pages under budget
- The output HTML safely escapes input fields (tested against `validate-inbox` rejecting bad chunks and template escaping hostile variables).
- Site size constraints trigger accurately.

### Known Limitations
- The `Publish-Catalog.ps1` expects powershell 7+ internally when doing GH CLI tasks (tested under PowerShell 5.1 during dev without issues mostly since the syntax maps down gracefully).
- Pagefind integration does not index sub-second granular language fields correctly if the MARC language field is missing (defaults to `en`).
- Storage overhead: GitHub Pages will receive a huge amount of small `.xml` files if `isbnFetchFiles` is enabled on massive catalogs, which may breach GitHub's 100k file limits. Limit this or partition the repo in future phases.
