# PustakaTerbuka

> **PustakaTerbuka: an open, shared MARC catalog for Malaysian schools and libraries.**

PustakaTerbuka is a centralized, open-access repository of harvested MARCXML bibliographic records, shared by schools, public libraries, and universities across Malaysia. It provides a fully static, searchable, multi-tenant OPAC (Online Public Access Catalog) hosted on GitHub Pages, as well as standards-compliant copy cataloging endpoints and bulk dumps for external Library Management Systems (LMS / ILS).

---

## What It Is

- A **shared bibliographic catalog** of MARC21 records harvested from national and public library OPACs (Perpustakaan Negara Malaysia, Library of Congress, etc.).
- A **static OPAC** with client-side full-text search via [Pagefind](https://pagefind.app), browsable by organization, Dewey (DDC), and LC (LCC) classifications.
- **Copy Cataloging API**: Real-time static endpoints for ISBN (`/isbn/{isbn}.xml`), ISSN (`/issn/{issn}.xml`), and permanent IDs (`/id/{id}.xml`) with preserved source tags and attribution.
- **Bulk Releases**: ISO-2709 (`.mrc`) and MARCXML (`.xml`) collections published to GitHub Releases for client-side local database caching.
- **Standards-based pipeline**: Validating, merging, and deduplicating MARCXML records.
- **Multi-tenant**: Participating schools maintain their own holdings in lightweight CSV sidecars.

---

## Architecture

```
harvesters → harvest/inbox → validate → merge/dedup → holdings join → build → publish
```

All data processing happens locally or via local pipelines. Searching runs entirely in the browser via Pagefind WASM chunks. Production distribution is hosted on GitHub Pages with release assets on GitHub Releases. **No dynamic database or web server is required.**

---

## Quick Start

### Prerequisites
- Node.js 20+ (LTS recommended)
- PowerShell 7+
- Git with `core.longpaths` enabled

### Installation
```powershell
git clone https://github.com/aplikasi-perpustakaan/pustaka-terbuka.git
cd pustaka-terbuka
npm install
cp config/config.example.json config/config.json
```

### Run Tests
```powershell
npm test
```

### Dry-Run Publish
```powershell
.\scripts\Publish-Catalog.ps1 -WhatIf -SkipHarvest
```

---

## Client & LMS Integration

If you are developing a **Library Management System client** (such as a custom .NET Framework Windows Forms application for Windows 7+, SLiMS, Koha, or mobile cataloging):
- **Real-Time Copy Cataloging**: Query `https://aplikasi-perpustakaan.github.io/pustaka-terbuka/isbn/{isbn}.xml`
- **Offline / Rural Caching**: Ingest release dumps into local SQLite via streaming `XmlReader` (< 25MB RAM on Windows 7).
- **Client Contributions**: Export local holdings and new records as offline `.zip` contribution packages.

See the complete [Client Developer Integration Guide](docs/CLIENT_DEVELOPER_GUIDE.md) for full C# code recipes and integration workflows.

---

## Quick Start for Librarians (Participating Schools)

To add your school or library to PustakaTerbuka or update your holdings:

1. Register or update your organization in `data/orgs.json`
2. Create or update your holdings file at `data/holdings/<YOUR_ORG>.csv`
3. Submit a pull request to the `main` branch (or export an offline contribution package).

See [CONTRIBUTING.md](CONTRIBUTING.md) for details on submitting and updating holdings.

### Link to Your Organization's View
```
https://aplikasi-perpustakaan.github.io/pustaka-terbuka/?org=YourOrgCode
```

---

## Comprehensive Documentation Suite

- **[AI Agent Master Architecture Guide](docs/AI_AGENT_GUIDE.md)** — Invariants, directory map, data schemas, and pipeline gates for autonomous AI agents.
- **[Client Developer Integration Guide](docs/CLIENT_DEVELOPER_GUIDE.md)** — Point lookups, attribution tags, offline SQLite caching, and UI workflows.
- **[Harvester Standards & Ingestion Contract](docs/HARVESTERS.md)** — Specifications for harvesters, inbox contracts, and strict tag preservation.
- **[Harvester Chunk Lifecycle](docs/HARVESTER_CHUNK_LIFECYCLE.md)** — Discrete 10k batch harvest and deployment architecture for PNM.
- **[Runbook](docs/RUNBOOK.md)** — Operational runbook for deploying and recovering releases.
- **[Sources](docs/SOURCES.md)** — Ingestion source notes and terms of use.
- **[Design Decisions](docs/DECISIONS.md)** — Architectural decision log (ADR).
- **[Contributing](CONTRIBUTING.md)** — Guidelines for library and code contributors.
- **[Data License](docs/DATA_LICENSE.md)** — Public domain / ODC-By data terms.
- **[Takedown Process](docs/TAKEDOWN.md)** — Rights clearance and takedown procedures.

---

## License

*(To be determined — see [LICENSE](LICENSE))*

## Citation

See [CITATION.cff](CITATION.cff) for citation information.
