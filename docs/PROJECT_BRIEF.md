# MASTER PROMPT: PustakaTerbuka (Serverless Multi-Tenant MARC Catalog and OPAC)

You are the lead engineer for this project. Build it end to end, milestone by milestone, until every acceptance criterion in this brief is met. Read the whole brief before starting.

---

## 0. Operating rules

1. **Save this brief** as `docs/PROJECT_BRIEF.md` at the start and re-read it at the start of each milestone.
2. **Plan, then build.** Before each milestone, write a short implementation plan and task list. After each milestone, run the tests, list exactly what you verified, and append a dated entry to `docs/PROGRESS.md`. Record every significant design decision (what, why, alternatives rejected) in `docs/DECISIONS.md`.
3. **Verify, don't assume.** Run the code and the tests. Check the real UI in a browser (desktop viewport and a 375px mobile viewport, with network throttled to slow 3G/4G) and capture screenshots. Where this brief names an external tool or limit (Pagefind's API, GitHub size limits, KOHA behavior), consult the current official documentation and note what you found in `docs/DECISIONS.md` rather than relying on memory.
4. **Never contact external library systems.** Do not fetch from PNM, the Library of Congress, or any OPAC, and do not write scrapers or harvesters. The user is building harvesters in a separate prompt. You build everything around them: the standards, the input contract, the validator, and the rest of the pipeline. Test only with the synthetic fixtures described in Milestone 9.
5. **Stay in your lane on side effects.** Do not push to GitHub, create releases, publish to `gh-pages`, force-push, or delete branches during development. Implement those actions in the publish script and test them in dry-run mode only. The user performs the first real publish.
6. **Stop and ask** only at the points listed in Section 8. For anything in Section 2, use the stated default and keep going.
7. **Environment:** Windows 10/11, PowerShell 7+, Git, Node.js (LTS). Use cross-platform paths in code, avoid shell-specific tricks, write UTF-8 without BOM everywhere, and keep generated paths short (Windows long-path limits).

---

## 1. Project brief

A public librarian does copy cataloging against PNM (Perpustakaan Negara Malaysia), the Library of Congress (LC), and public library OPACs. The goal is a centralized, open-access repository of harvested MARCXML records, shared by schools and universities, with a fully static, searchable, multi-tenant OPAC hosted on GitHub Pages.

**Name and location:** The project's public name is **PustakaTerbuka**. The repository is `pustaka-terbuka`, inside the GitHub organization **`aplikasi-perpustakaan`**. Use these names in the site title, page `<title>` tags, Open Graph site name, README heading, `CITATION.cff`, `.zenodo.json`, config examples, release asset names, and both the English and Bahasa Malaysia UI strings.

**Architecture:** all processing happens locally before deployment; the browser does all searching. The pipeline is:

harvesters (built separately) → `harvest/inbox` → validate → merge/dedup → holdings join → build (index, pages, fetch files, dumps) → commit source to `main` → publish built site to `gh-pages`.

**Stack (use unless you document a better reason in DECISIONS.md):**
- Node.js for the core tools: MARCXML handling, merge, build, validation. Keep dependencies minimal and pin versions.
- **Pagefind** for search, fed through its Node API as custom records (no HTML page per record needed for indexing).
- Vanilla JavaScript, HTML, and CSS for the frontend. No framework and no bundler requirement.
- PowerShell 7 for orchestration (`Publish-Catalog.ps1`).
- Node's built-in test runner (or a similarly light tool) for tests.

**Non-goals:** harvesters or scrapers; a server or database; GitHub Actions for building or deploying (Actions are used only to validate pull requests); circulation or availability status; user accounts.

**Terminology:** LC = Library of Congress as a data source. LCC = Library of Congress Classification. DDC = Dewey Decimal Classification. The system supports both LCC and DDC call numbers.

## Section 2: Decisions to confirm
The table of defaults including: Public name PustakaTerbuka, GitHub org/repo, Git remote, Site base URL, Code license (ask at end), Data license placeholder, UI languages, Permanent record ID (10 chars crockford base32), Shard scheme (first 2 chars), Record-count drop gate (5%), Pages size warning (700MB warn, 950MB fail), Enrichment OFF.

## Section 3: Repository layout
The full directory tree as specified.

## Section 4: Specifications
4.1 Record identity/merge/dedup, 4.2 Call numbers LCC/DDC, 4.3 Holdings sidecars, 4.4 Harvester standards/inbox contract, 4.5 orgs.json/sources.json, 4.6 Predictable fetch URLs, 4.7 Exports.

## Section 5: Milestones M0-M10
All milestones with acceptance criteria.

## Section 6: Cross-cutting quality bars
## Section 7: Definition of done  
## Section 8: Stop and ask the user only when
