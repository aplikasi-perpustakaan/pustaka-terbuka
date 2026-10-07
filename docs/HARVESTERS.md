# Harvester Standards and Inbox Contract

This document is the normative specification that every future harvester for PustakaTerbuka must follow.

## 1. Output Contract
- **Inbox layout:** `harvest/inbox/<source-code>/<run-id>/`
- **Files:** `manifest.json`, `records/*.xml`, `provenance.jsonl`
- One harvester per source.
- Scraping is the primary method; APIs used additionally where available.
- Records must be raw as received — no merge, dedup, enrich, or call number editing.
- UTF-8 encoding throughout.

## 2. manifest.json Specification
Full field-by-field specification:
- `schema_version` (string, currently "1.0")
- `source_code` (string, must match directory name and sources.json key)
- `source_name` (string, human-readable)
- `source_base_url` (string, URL)
- `terms_url` (string, URL to source's terms of use)
- `terms_verified_on` (string, ISO date)
- `harvester_name` (string)
- `harvester_version` (string, semver)
- `run_id` (string, unique per run, suggested format: YYYYMMDD-HHmmss)
- `mode` (enum: "full" | "incremental")
- `started_at` (string, ISO 8601 datetime)
- `finished_at` (string, ISO 8601 datetime)
- `record_count` (integer, total records in this batch)
- `error_count` (integer, records that failed validation)
- `status` (enum: "complete" | "partial" | "failed")
- `user_agent` (string, the UA used for requests)
- `notes` (string, optional)

## 3. records/*.xml Specification
- Each file is a MARCXML `<collection>` with one or more `<record>` elements.
- **Namespace:** `http://www.loc.gov/MARC21/slim`
- UTF-8, no BOM.
- Raw as received from source.

## 4. provenance.jsonl Specification
- One JSON line per record.
- **Fields:** `source_001` (required, unique within source), `source_url`, `harvested_at` (ISO 8601), `file` (filename in records/), `index` (0-based position in file).
- If source lacks 001, harvester assigns stable synthetic control number and flags in manifest notes.

## 5. Politeness Rules
- Descriptive User-Agent with contact details.
- Honor `robots.txt` and terms of use.
- Rate limiting (minimum 2 seconds between requests to same host).
- Exponential backoff on errors (starting at 5s, max 5min).
- Respect `Retry-After` headers.

## 6. Cache and Resume
- Store raw HTTP responses locally.
- Skip unchanged records (use ETag/Last-Modified or content hash).
- Runs must be safe to resume and repeat (idempotent).

## 7. Fail Loudly
- Log counts per run.
- Compare with previous batch.
- Exit non-zero on failure.
- Write status: `partial` | `failed` for incomplete runs.
- Required fields (245 at minimum) must be present or record goes to `error_count`.
- Never produce silently incomplete output.

## 8. Secrets and Config
- Only `*.example.*` templates committed.
- Credentials in environment variables or git-ignored files.

## 9. Per-Source Notes
- Documented in `docs/SOURCES.md` and `data/sources.json`.
