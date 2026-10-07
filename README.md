# PustakaTerbuka

> **PustakaTerbuka: an open, shared MARC catalog for Malaysian schools and libraries.**

PustakaTerbuka is a centralized, open-access repository of harvested MARCXML bibliographic records, shared by schools and universities in Malaysia. It provides a fully static, searchable, multi-tenant OPAC (Online Public Access Catalog) hosted on GitHub Pages.

## What It Is

- A **shared bibliographic catalog** of MARC records harvested from national and public library OPACs
- A **static OPAC** with full-text search, browsable by organization, classification, subject, and more
- A **standards-based pipeline** for validating, merging, and deduplicating MARCXML records
- **Multi-tenant**: each participating school or library sees their own holdings and call numbers

## Architecture

```
harvesters → harvest/inbox → validate → merge/dedup → holdings join → build → publish
```

All processing happens locally. The browser does all searching via [Pagefind](https://pagefind.app). The built site is deployed to GitHub Pages. No server or database required.

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

### Dry-Run Build

```powershell
.\scripts\Publish-Catalog.ps1 -WhatIf -SkipHarvest
```

## For Participating Schools

To add your school or library to PustakaTerbuka:

1. Register your organization in `data/orgs.json`
2. Create a holdings file at `data/holdings/<YOUR_ORG>.csv`
3. Submit a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

### Link to Your Organization's View

```
https://aplikasi-perpustakaan.github.io/pustaka-terbuka/?org=YourOrgCode
```

## Documentation

- [Project Brief](docs/PROJECT_BRIEF.md)
- [Harvester Standards](docs/HARVESTERS.md)
- [Runbook](docs/RUNBOOK.md)
- [Sources](docs/SOURCES.md)
- [Pilot Procedure](docs/PILOT.md)
- [Contributing](CONTRIBUTING.md)
- [Data License](docs/DATA_LICENSE.md)
- [Takedown Process](docs/TAKEDOWN.md)

## License

*(To be determined — see [LICENSE](LICENSE))*

## Citation

See [CITATION.cff](CITATION.cff) for citation information.
