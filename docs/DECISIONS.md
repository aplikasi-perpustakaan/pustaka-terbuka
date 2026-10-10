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

---

## D005: Harvester 10,000-Record Chunked Lifecycle and Continuous Deployment

**Decision:** Large catalog harvests process records in discrete 10,000-record lifecycle chunks (`harvest/inbox/<source>/<run-id>-chunk-<N>/`). Upon reaching 10,000 records, the harvester pauses fetching, executes the pipeline (`validate-inbox` -> `merge` -> `build`), commits data to `origin main`, force-pushes `dist/` to `origin gh-pages`, and resumes harvesting the next chunk until completion.

**Rationale:** Prevents giant uncommitted state over multi-day crawl jobs. Bypasses the $O(N^2)$ merge slowdown that occurs when scanning hundreds of thousands of cumulative XML batch files in a single folder. Decouples safe query partitioning (which prevents hitting OpenSearch's 10,000 max_result_window limit) from lifecycle checkpoints (~42 clean Git commits and deployments across the 422k catalog).

**Alternatives rejected:**
- Monolithic single-run harvest: too vulnerable to network loss, rate limiting, and huge uncommitted diffs.
- 1 chunk = 1 API partition: causes ~1,730 Git commits/pushes and spends 35+ hours repeatedly running Pagefind builds for tiny 200-record batches.
- Push main only (skipping gh-pages): leaves the public web portal out of sync with the catalog data until the entire crawl finishes days later.

---

## D006: Consolidated Shard Storage Architecture & Ephemeral Harvester Mode

**Decision:** Migrate catalog storage from 422,000+ individual XML files (`data/bib/<shard>/<id>.xml`) into 1,024 consolidated shard files (`data/bib/shard_<shard>.jsonl`) partitioned by 2-character Crockford base32 hash prefixes. Additionally, provide an Ephemeral Harvester execution mode (`--ephemeral`) where the harvester works statelessly in temporary scratch storage (pulling shallow state, processing 10k chunks locally, pushing to `origin main` and `origin gh-pages`, and immediately purging the scratch directory).

**Rationale:** Storing 422,000 separate files on NTFS consumes massive filesystem cluster slack (several gigabytes of slack space) and cripples Git operations (`git status` taking 30+ seconds). Consolidating into 1,024 sorted NDJSON files reduces total file count by 99.8%, keeps Git diffs small (1-line diff per record update), and shrinks repository size down to ~150–250 MB. The ephemeral mode allows any machine or developer laptop to execute the full harvesting, merging, and building lifecycle without permanently storing a giant repository on their local drive, and without requiring cloud CI runners (GitHub Actions).

**Alternatives rejected:**
- Keeping 422k loose files: unusable local Git performance and multi-gigabyte disk footprint.
- Large binary archives (.tar/.zip): binary files break Git diff-friendliness, causing repository history to explode on every 10k commit.
- GitHub Actions runner reliance: rejected per architectural constraints to maintain complete local self-containment.

---

## D007: Harvester Rebase Guard, Delta Mode, Token Auth, and Tombstone Enforcement

**Decision:** 
1. The harvester performs `git pull --rebase origin main` before every 10k push to eliminate non-fast-forward push conflicts.
2. An incremental sync mode (`--mode incremental`) is supported to sync only the active accession window in 2–5 minutes rather than re-crawling all 1,732 historical partitions.
3. Ephemeral mode supports unattended authentication via `GITHUB_TOKEN` loaded automatically from `.env.local` (or `.env` / environment variables).
4. Takedowns and tombstoned records defined in `data/tombstones.json` and `data/aliases.jsonl.gz` are strictly honored during ingestion, preventing automated crawls from resurrecting legally removed or retired catalog items.

**Rationale:** Long-running crawl processes must be resilient against concurrent branch updates and credential prompts. Daily catalog maintenance requires lightweight delta queries. Legal and privacy takedown compliance requires that harvested raw records do not override explicit tombstones.

**Alternatives rejected:**
- Blind push without rebase: causes fatal push aborts when remote main changes during a 30-minute chunk crawl.
- Mandatory full re-crawl for maintenance: wasteful and slow (30 hours vs 2 minutes).
- Ignoring tombstones during merge: violates `docs/TAKEDOWN.md` policy.

---

## D008: Preserved Source Tags, Injected Attribution (040 $d, 856, 900), and Direct ISSN Endpoints

**Decision:** 
1. Direct point endpoints (`/id/{id}.xml`, `/isbn/{isbn}.xml`, `/issn/{issn}.xml`) retain all original source tags (PNM control numbers `001`, `035`, classification `082`/`090`, holdings `852`) with 100% fidelity.
2. The build pipeline injects standardized attribution tags:
   - MARC `040 $d PustakaTerbuka` (standard cataloging agency).
   - MARC `856` (link to GitHub repository and project description).
   - MARC `900` (custom machine-readable provenance tag).
3. The build generator extracts ISSN from MARC field `022 $a` and publishes normalized `/issn/{issn}.xml` endpoints alongside ISBN endpoints.

**Rationale:** External LMS clients (such as custom .NET 4.7 WinForms apps, SLiMS, Koha) need complete original cataloging data for copy cataloging while clearly acknowledging PustakaTerbuka as the sharing provider. Normalizing identifiers (stripping hyphens and spaces) ensures O(1) static lookups on GitHub Pages.

**Alternatives rejected:**
- Stripping all local source tags: loses valuable national library classification and control numbers.
- Dynamic API for attribution: violates serverless/static GitHub Pages architecture.

---

## D009: Client-Side Caching (Option B) and Zero-GitHub Offline Contribution Bundles

**Decision:** 
1. PustakaTerbuka remains strictly text-based and database-free. No binary SQLite databases are committed to the repository or generated as mandatory build outputs.
2. Clients ingest the published bulk `.xml` or `.mrc` release dumps into their own local SQLite databases using streaming `XmlReader` for sub-2ms offline lookups on Windows 7+ PCs.
3. Rural school librarians contribute local holdings and newly cataloged books via an **Offline Contribution Bundle (`.zip`)** containing `manifest.json`, `provenance.jsonl`, `records/batch_0.xml`, and `holdings.csv`, eliminating the need for school teachers to manage GitHub accounts or Git tooling.
4. When a record is not found during copy cataloging, client UI standardizes on the exact prompt: `"Book not found in Pustaka Terbuka catalog. Enter details to create a new record."`

**Rationale:** Committing binary databases into Git breaks line-by-line diff tracking and inflates repository history. School teachers in rural areas often lack GitHub credentials or stable internet, making zip-based exports and streaming local ingestion the most robust, friction-free workflow.

**Alternatives rejected:**
- Requiring school librarians to use Git / GitHub Pull Requests: 95% friction barrier.
- Committing SQLite `.db` into Git: causes massive repository bloat.
