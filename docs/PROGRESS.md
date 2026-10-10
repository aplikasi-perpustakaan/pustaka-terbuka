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

---

## Client Integration & Documentation Suite Overhaul — 2026-10-10

Complete refactoring to support custom LMS client integration (.NET Framework 4.7 Windows Forms for Windows 7+, SLiMS, Koha) and comprehensive developer documentation.

### Completed Work
- **Direct Endpoints with Attribution:** Enhanced `tools/lib/build.js` to generate normalized `/isbn/{isbn}.xml` and `/issn/{issn}.xml` endpoints while preserving 100% of original source tags (PNM control numbers, classification, call numbers). Injected MARC attribution tags: `040 $d PustakaTerbuka`, `856` (repository link), and `900` (custom provenance).
- **File Count Budgeting:** Added file count warning thresholds in `tools/lib/build.js` and `scripts/Publish-Catalog.ps1` to prevent GitHub Pages 100k file limits from being breached.
- **AI Agent Master Guide (`docs/AI_AGENT_GUIDE.md`):** Complete system manual defining invariants, directory maps, data contracts, and pipeline gates for future AI agents.
- **Client Developer Integration Guide (`docs/CLIENT_DEVELOPER_GUIDE.md`):** Authoritative guide covering real-time point lookups, streaming `XmlReader` recipe for Option B offline local SQLite caching on Windows 7, offline contribution packages, and UI dialog standards.
- **Harvester Standards Update (`docs/HARVESTERS.md`):** Revised harvester contract enforcing strict tag preservation and aligning school library contributions with the inbox contract.
- **Test Coverage:** Added `tests/client-endpoints.test.js` and updated `tests/m5-build.test.js`. Verified clean test passes (89 tests passing).
