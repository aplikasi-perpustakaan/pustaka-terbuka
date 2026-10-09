# Data Sources

Per-source notes including quirks, terms of use, and last verified dates.

---

## 1. Perpustakaan Negara Malaysia (PNM)

- **Source Code**: `pnm`
- **Prefix**: `PNM`
- **Priority**: 10
- **Base OPAC URL**: `https://opac.pnm.gov.my/`
- **Terms URL**: `https://www.pnm.gov.my/`
- **API Endpoint**: `https://ap.iiivega.com/api/search-result/search/format-groups` (Innovative Interfaces Vega Discover REST API)
- **Protocol**: HTTPS POST JSON with custom headers:
  - `iii-customer-domain: pnm.ap.iiivega.com`
  - `iii-host-domain: opac.pnm.gov.my`
  - `api-version: 2`
- **Authentication**: Public search endpoint, no API key required.
- **MARC Status**: Native MARCXML/Z39.50/OAI-PMH endpoints are not publicly exposed by PNM. Records are harvested from Vega Discover format-group JSON resources and mapped into valid MARCXML 21 slim collections.
- **Identifiers & Control Numbers**:
  - Control number `001`: Extracted from `identifiers.local` (e.g., `vtls000437338` from PNM's VTLS/Virtua legacy catalog system). If missing, falls back to Vega UUID.
  - ISBN: `identifiers.isbn` and `identifiedBy.isbn` -> MARC `020 $a`.
  - ISSN: `identifiers.issn` -> MARC `022 $a`.
- **Field Mappings**:
  - `001`: `identifiers.local`
  - `041`: `language` (ISO 639-2 e.g., `may`, `eng`)
  - `100`: `primaryAgent.label`
  - `245`: `title`
  - `264`: `publicationDate`
  - `490`: `seriesTitle`
  - `852`: `materialTabs[].editions[].callNumber`
- **Harvester Implementations**:
  - Node.js: `tools/harvesters/pnm/harvester.js` (`npm run harvest:pnm`)
  - C# Native: `tools/harvesters/pnm/Harvester.cs` (`tools\harvesters\pnm\PNM-Harvester.exe`)
- **Politeness**:
  - User-Agent: `PustakaTerbuka Harvester (+https://github.com/aplikasi-perpustakaan/pustaka-terbuka)`
  - 2,000 ms delay between page requests.
  - Exponential backoff on HTTP 429 and 5xx errors (5s up to 300s).
