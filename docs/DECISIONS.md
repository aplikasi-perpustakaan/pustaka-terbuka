# Design Decisions

Each entry records: what was decided, why, and what alternatives were considered.

---

## D001: aliases.jsonl format — sorted and rewritten

**Decision:** `aliases.jsonl` is sorted by key and fully rewritten on each merge run, not append-only.

**Rationale:** The brief asks for append-friendly, sorted, and diff-friendly. True append-only breaks sort order, making diffs noisy and lookups slower. Rewriting sorted on each merge keeps diffs minimal (only changed/added lines differ), enables binary search for lookups, and produces clean git diffs. The file is critical state but is always regenerated deterministically from the merge operation.

**Alternatives rejected:**
- Append-only with periodic compaction: adds complexity, breaks diff-friendliness between compactions.
- Database (SQLite): adds a binary dependency, not diff-friendly in git.

---

## D002: PowerShell version

**Decision:** The publish script targets PowerShell 7+ syntax but the development environment has PowerShell 5.1. PowerShell 7 is listed as a prerequisite in the README and RUNBOOK.

**Rationale:** The brief specifies PowerShell 7+. The current machine has 5.1. The script will be written for PS 7 and tested in dry-run mode. Installation of PS 7 is documented as a prerequisite.

---

## D003: Node.js test runner

**Decision:** Use Node's built-in test runner (`node:test`) with `node --test`.

**Rationale:** Minimizes dependencies as recommended by the brief. Node 22 has a mature built-in test runner with describe/it/assert support.

---

## D004: Book page resolver strategy

**Decision:** Static HTML book pages at `/book/<id>/index.html` for permanent IDs. A single resolver page at `/book/index.html` handles `?book=<isbn|retired-id>` by looking up a prebuilt JSON alias map and redirecting to the canonical book page. ISBN fetch files at `/isbn/<isbn>.xml` are real XML file copies (configurable, can be disabled to save space).

**Rationale:** Static book pages are needed for SEO, Open Graph tags, and direct linking. The resolver avoids creating thousands of redirect HTML files for every ISBN and retired ID. The alias map JSON is small (just ID mappings). ISBN XML fetch files are a configurable trade-off: convenient for programmatic access but can be disabled if file count becomes a concern.

**Alternatives rejected:**
- Single SPA with client-side routing: breaks SEO and Open Graph.
- One HTML redirect file per ISBN: file explosion.
- 404.html-based routing: fragile, GitHub Pages specific.
