# Harvester Standards and Ingestion Contract

This normative specification defines the standards and data contracts that every harvester (and external data ingestion pipeline) must follow when contributing bibliographic records to **PustakaTerbuka**.

---

## 1. Core Principles

1. **Raw As Received:** Records must remain unmerged, undeduplicated, and unedited. Never strip, edit, or pre-enrich fields at the harvesting stage. All deduplication, normalization, and attribution happens downstream in `tools/merge.js` and `tools/lib/build.js`.
2. **Strict Tag Preservation:** Harvesters must preserve all original tags from the source catalog with 100% fidelity:
   - `001`: Original source system control number (e.g. PNM's `vtls...` or ILS ID).
   - `035`: System control numbers.
   - `020` / `022`: Raw ISBN and ISSN fields.
   - `040`: Original cataloging agency.
   - `082` / `090` / `852`: Dewey Decimal (DDC) and Library of Congress (LCC) classification and call numbers.
   - `9xx`: Any local provenance tags present in the source.
3. **Deterministic Output Contract:** Every harvester run produces a standardized batch folder in the harvest inbox.

---

## 2. Inbox Layout Contract

Every run must write to a discrete directory:

```
harvest/inbox/<source-code>/<run-id>/
├── manifest.json
├── provenance.jsonl
└── records/
    ├── batch_0.xml
    ├── batch_1.xml
    └── ...
```

- `<source-code>`: Matches the key declared in `data/sources.json` (e.g., `pnm`, `um`, `skbl`).
- `<run-id>`: Unique timestamped identifier for the run (suggested: `YYYYMMDD-HHmmss` or ISO datetime `YYYY-MM-DDTHH-mm-ssZ`).

---

## 3. manifest.json Specification

The `manifest.json` file records run metadata, totals, and validation status:

```json
{
  "schema_version": "1.0",
  "source_code": "pnm",
  "source_name": "Perpustakaan Negara Malaysia",
  "source_base_url": "https://opac.pnm.gov.my/",
  "terms_url": "https://opac.pnm.gov.my/terms",
  "terms_verified_on": "2026-10-01",
  "harvester_name": "PnmVegaHarvester",
  "harvester_version": "1.2.0",
  "run_id": "20261010-000000",
  "mode": "incremental",
  "started_at": "2026-10-10T00:00:00Z",
  "finished_at": "2026-10-10T01:30:00Z",
  "record_count": 10000,
  "error_count": 0,
  "status": "complete",
  "user_agent": "PustakaTerbuka-Harvester/1.0 (+https://github.com/aplikasi-perpustakaan/pustaka-terbuka)",
  "notes": "10k chunk batch"
}
```

### Fields:
- `schema_version`: String, currently `"1.0"`.
- `source_code`: String, matches directory name and `sources.json`.
- `source_name`: String, human-readable name of the library.
- `run_id`: Unique identifier for the batch.
- `mode`: `"full"` | `"incremental"`.
- `started_at` / `finished_at`: ISO 8601 timestamps.
- `record_count`: Integer, total `<marc:record>` elements across all XML files in `records/`.
- `error_count`: Integer, records discarded due to fatal parse errors.
- `status`: `"complete"` | `"partial"` | `"failed"`.

---

## 4. records/*.xml Specification

- **Root Element:** `<marc:collection xmlns:marc="http://www.loc.gov/MARC21/slim">`.
- **Encoding:** UTF-8 without Byte Order Mark (BOM).
- **Records per file:** Maximum 10,000 records per XML file (recommended: 1,000 to 5,000 to keep memory footprint low).
- **Minimum Required Fields:** Every record must contain at least `245 $a` (Title) and a control number in `001` or `035`. Records missing `245` will be rejected by `npm run validate-inbox`.

---

## 5. provenance.jsonl Specification

`provenance.jsonl` contains exactly one JSON line per record in the batch, strictly matching the order in `records/*.xml`:

```json
{"source_001":"vtls000898574","source_url":"https://opac.pnm.gov.my/search?id=vtls000898574","harvested_at":"2026-10-10T00:05:12Z","file":"batch_0.xml","index":0}
{"source_001":"vtls000898575","source_url":"https://opac.pnm.gov.my/search?id=vtls000898575","harvested_at":"2026-10-10T00:05:15Z","file":"batch_0.xml","index":1}
```

- `source_001`: Control number matching the `<marc:controlfield tag="001">` of the record.
- `harvested_at`: ISO 8601 timestamp when the record was received.
- `file`: Relative filename in `records/`.
- `index`: 0-based offset of the record within that file.

---

## 6. Politeness & Network Guidelines

1. **User-Agent:** Always provide a descriptive User-Agent with contact info:
   ```
   User-Agent: PustakaTerbuka-Harvester/1.0 (+https://github.com/aplikasi-perpustakaan/pustaka-terbuka; contact@example.edu.my)
   ```
2. **Rate Limiting:** Minimum 2.0 seconds delay between requests to external hosts.
3. **Exponential Backoff:** On HTTP 429 (Too Many Requests) or 5xx server errors, back off starting at 5s up to 5 minutes. Respect `Retry-After` headers.
4. **Cache & Checkpoint:** State must be checkpointed locally so interrupted runs can resume without re-harvesting existing records.

---

## 7. Client & School Library Contributions

When a school library using a custom LMS client (such as the .NET 4.7 Windows Forms client) contributes newly cataloged books, the contribution bundle adheres to this exact contract:
- The school's unique code is used as `source_code` (e.g. `SKBayanLepas`).
- The batch is placed in `harvest/inbox/<school-code>/<run-id>/`.
- Downstream tools (`validate-inbox` &rarr; `merge`) process school contributions identically to national library harvests.

See [docs/CLIENT_DEVELOPER_GUIDE.md](CLIENT_DEVELOPER_GUIDE.md) for details on the client-side contribution bundle export.

---

## 8. Large-Scale Chunked Harvesting

For large library collections (such as Perpustakaan Negara Malaysia's 420k+ records), harvesters must chunk runs into discrete 10,000-record batches. Refer to [docs/HARVESTER_CHUNK_LIFECYCLE.md](HARVESTER_CHUNK_LIFECYCLE.md) for the automated chunk validation, merge, build, and Git deployment lifecycle.
