# Client Developer Integration Guide: PustakaTerbuka

This guide provides complete instructions and workflows for software developers building or integrating **Library Management System (LMS / ILS)** client applications with **PustakaTerbuka**.

Whether you are building a custom desktop application (such as a **.NET Framework 4.7 Windows Forms application for Windows 7 and later**), integrating with an existing web ILS (e.g., **SLiMS**, **Koha**, or **Inlislite**), or creating a mobile cataloging app, this document defines your integration contracts.

---

## 1. Architecture Overview for Clients

PustakaTerbuka is a **serverless, open-access union catalog**. It does not run a dynamic backend or SQL server on the internet; all data is statically distributed via **GitHub Pages** and **GitHub Releases**:

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      PustakaTerbuka (Hub)                              │
 │  Hosted on GitHub Pages & GitHub Releases                              │
 └─────────────▲───────────────────────────────────────┬──────────────────┘
               │                                       │
   [Two-Way Contribution]                     [Copy Cataloging & Sync]
   - Offline Contribution .zip                - Real-Time Point Fetch (/isbn/, /issn/)
   - Holdings CSV                             - Bulk Dumps (.xml / .mrc)
               │                                       │
 ┌─────────────┴───────────────────────────────────────▼──────────────────┐
 │                        LMS Client Terminal                             │
 │   (.NET 4.7 Windows Forms / SLiMS / Koha / Custom Client)              │
 │                                                                        │
 │   1. Local SQLite Cache (Sub-2ms instant offline lookups)             │
 │   2. Remote Fallback to PustakaTerbuka Static Endpoints                │
 │   3. Manual Entry + Staged Contribution Queue                          │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Real-Time Copy Cataloging API (Online Point Lookups)

When a librarian scans or enters an identifier, clients can perform fast, direct HTTP `GET` requests against predictable static endpoints on PustakaTerbuka.

### 2.1 Endpoint URL Matrix

| Identifier | Endpoint URL | Format |
| :--- | :--- | :--- |
| **ISBN-13 / ISBN-10** | `https://aplikasi-perpustakaan.github.io/pustaka-terbuka/isbn/{normalized_isbn}.xml` | MARCXML Collection |
| **ISSN** (Serials / Periodicals) | `https://aplikasi-perpustakaan.github.io/pustaka-terbuka/issn/{normalized_issn}.xml` | MARCXML Collection |
| **Permanent Record ID** | `https://aplikasi-perpustakaan.github.io/pustaka-terbuka/id/{record_id}.xml` | MARCXML Collection |
| **Clean Export** (Internal tags stripped) | `https://aplikasi-perpustakaan.github.io/pustaka-terbuka/export/{record_id}.xml` | MARCXML Collection |

> [!IMPORTANT]
> **Normalization Rule:** Clients **must strip all hyphens and spaces** before issuing requests:
> - `978-983-01-2345-6` &rarr; Request `/isbn/9789830123456.xml`
> - `0128-1232` &rarr; Request `/issn/01281232.xml`

---

### 2.2 Record Structure & Preserved Source Tags
Records returned by PustakaTerbuka retain **all original cataloging data** from the national and public sources (Perpustakaan Negara Malaysia, Library of Congress, etc.), including:
- `001`: Original source control number (e.g., PNM `vtls000898574`).
- `035`: System control numbers (e.g., `(PNM)vtls...`).
- `020` / `022`: Standard book/serial numbers.
- `040`: Original cataloging agency.
- `082` / `090` / `852`: Dewey Decimal and LCC call numbers.
- `100`, `245`, `260` / `264`, `300`, `520`, `650`: Title, author, publisher, subjects, and summaries.

---

### 2.3 Attribution & Provenance Tags (Crediting PustakaTerbuka)
Every record served from PustakaTerbuka includes standardized attribution tags crediting the project and linking to the source repository:

1. **MARC Tag `040 $d` (Standard Library Cataloging Agency):**
   ```xml
   <marc:datafield tag="040" ind1=" " ind2=" ">
     <marc:subfield code="a">MY-KLP</marc:subfield>
     <marc:subfield code="d">PustakaTerbuka</marc:subfield>
   </marc:datafield>
   ```
2. **MARC Tag `856` (Electronic Location and Access):**
   ```xml
   <marc:datafield tag="856" ind1="4" ind2="2">
     <marc:subfield code="u">https://github.com/aplikasi-perpustakaan/pustaka-terbuka</marc:subfield>
     <marc:subfield code="y">PustakaTerbuka</marc:subfield>
     <marc:subfield code="z">Shared open catalog record provided by PustakaTerbuka</marc:subfield>
   </marc:datafield>
   ```
3. **MARC Tag `900` (Dedicated Custom Attribution Tag):**
   ```xml
   <marc:datafield tag="900" ind1=" " ind2=" ">
     <marc:subfield code="a">PustakaTerbuka</marc:subfield>
     <marc:subfield code="u">https://github.com/aplikasi-perpustakaan/pustaka-terbuka</marc:subfield>
     <marc:subfield code="d">Open Shared MARC Catalog for Malaysian Libraries</marc:subfield>
     <marc:subfield code="r">07wbdk04t6</marc:subfield>
   </marc:datafield>
   ```

Clients displaying attribution or recording provenance should read `040 $d` or `900 $a`.

---

## 3. Offline & Local-Network Caching (Option B: Client-Side Ingestion)

For rural schools with intermittent or no internet connection, client applications should maintain a local **SQLite database** (`pustaka_local.db`).

### 3.1 Recommended Local SQLite Schema
```sql
CREATE TABLE IF NOT EXISTS catalog (
    id TEXT PRIMARY KEY,
    isbn13 TEXT,
    isbn10 TEXT,
    issn TEXT,
    title TEXT,
    author TEXT,
    publisher TEXT,
    year TEXT,
    call_number TEXT,
    ddc TEXT,
    lcc TEXT,
    raw_marcxml TEXT,
    is_local_contribution INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_catalog_isbn13 ON catalog(isbn13);
CREATE INDEX IF NOT EXISTS idx_catalog_isbn10 ON catalog(isbn10);
CREATE INDEX IF NOT EXISTS idx_catalog_issn ON catalog(issn);

CREATE TABLE IF NOT EXISTS local_holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id TEXT,
    barcode TEXT UNIQUE,
    accession_number TEXT,
    call_number TEXT,
    location TEXT,
    copy_number TEXT,
    status TEXT DEFAULT 'available',
    FOREIGN KEY(record_id) REFERENCES catalog(id)
);
```

---

### 3.2 High-Performance C# Ingestion Recipe (.NET 4.7 Windows Forms)
Downloading a full release dump (e.g., `pustakaterbuka-all-YYYYMMDD.xml`) can result in a 500MB–800MB XML file. 

Using `XDocument.Load()` or `XmlDocument` on older Windows 7 PCs will cause out-of-memory errors. The following recipe uses **`System.Xml.XmlReader`** to stream records node-by-node, using **less than 25MB of RAM**:

```csharp
using System;
using System.Data.SQLite;
using System.IO;
using System.Xml;

public class PustakaBulkImporter
{
    private readonly string _connectionString;

    public PustakaBulkImporter(string sqliteDbPath)
    {
        _connectionString = $"Data Source={sqliteDbPath};Version=3;";
    }

    public void ImportMarcXmlDump(string xmlFilePath, IProgress<int> progress = null)
    {
        int count = 0;

        using (var conn = new SQLiteConnection(_connectionString))
        {
            conn.Open();
            using (var trans = conn.BeginTransaction())
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = @"
                    INSERT OR REPLACE INTO catalog 
                    (id, isbn13, issn, title, author, publisher, year, call_number, ddc, raw_marcxml)
                    VALUES (@id, @isbn13, @issn, @title, @author, @pub, @year, @call, @ddc, @xml);";

                var pId = cmd.Parameters.Add("@id", System.Data.DbType.String);
                var pIsbn = cmd.Parameters.Add("@isbn13", System.Data.DbType.String);
                var pIssn = cmd.Parameters.Add("@issn", System.Data.DbType.String);
                var pTitle = cmd.Parameters.Add("@title", System.Data.DbType.String);
                var pAuthor = cmd.Parameters.Add("@author", System.Data.DbType.String);
                var pPub = cmd.Parameters.Add("@pub", System.Data.DbType.String);
                var pYear = cmd.Parameters.Add("@year", System.Data.DbType.String);
                var pCall = cmd.Parameters.Add("@call", System.Data.DbType.String);
                var pDdc = cmd.Parameters.Add("@ddc", System.Data.DbType.String);
                var pXml = cmd.Parameters.Add("@xml", System.Data.DbType.String);

                using (var reader = XmlReader.Create(xmlFilePath, new XmlReaderSettings { IgnoreWhitespace = true }))
                {
                    while (reader.Read())
                    {
                        if (reader.NodeType == XmlNodeType.Element && 
                           (reader.LocalName == "record" || reader.Name == "marc:record"))
                        {
                            string recordOuterXml = reader.ReadOuterXml();
                            ParseAndBind(recordOuterXml, pId, pIsbn, pIssn, pTitle, pAuthor, pPub, pYear, pCall, pDdc, pXml);
                            cmd.ExecuteNonQuery();

                            count++;
                            if (count % 1000 == 0)
                            {
                                trans.Commit();
                                trans.Dispose();
                                conn.BeginTransaction();
                                progress?.Report(count);
                            }
                        }
                    }
                }
                trans.Commit();
            }
        }
    }

    private void ParseAndBind(string outerXml, 
        SQLiteParameter pId, SQLiteParameter pIsbn, SQLiteParameter pIssn, 
        SQLiteParameter pTitle, SQLiteParameter pAuthor, SQLiteParameter pPub, 
        SQLiteParameter pYear, SQLiteParameter pCall, SQLiteParameter pDdc, SQLiteParameter pXml)
    {
        pXml.Value = outerXml;
        
        // Lightweight extraction using XmlReader or minimal string matching
        using (var strReader = new StringReader(outerXml))
        using (var xr = XmlReader.Create(strReader))
        {
            string currentTag = "";
            string currentSub = "";

            pId.Value = DBNull.Value;
            pIsbn.Value = DBNull.Value;
            pIssn.Value = DBNull.Value;
            pTitle.Value = "Unknown Title";
            pAuthor.Value = "";
            pPub.Value = "";
            pYear.Value = "";
            pCall.Value = "";
            pDdc.Value = "";

            while (xr.Read())
            {
                if (xr.NodeType == XmlNodeType.Element)
                {
                    if (xr.Name.EndsWith("controlfield") && xr.GetAttribute("tag") == "001")
                    {
                        pId.Value = xr.ReadElementContentAsString();
                    }
                    else if (xr.Name.EndsWith("datafield"))
                    {
                        currentTag = xr.GetAttribute("tag") ?? "";
                    }
                    else if (xr.Name.EndsWith("subfield"))
                    {
                        currentSub = xr.GetAttribute("code") ?? "";
                        string text = xr.ReadElementContentAsString();

                        if (currentTag == "245" && currentSub == "a") pTitle.Value = text.TrimEnd('/', ' ');
                        else if (currentTag == "100" && currentSub == "a") pAuthor.Value = text;
                        else if (currentTag == "020" && currentSub == "a" && pIsbn.Value == DBNull.Value) pIsbn.Value = text.Split(' ')[0].Replace("-", "");
                        else if (currentTag == "022" && currentSub == "a" && pIssn.Value == DBNull.Value) pIssn.Value = text.Split(' ')[0].Replace("-", "");
                        else if (currentTag == "264" || currentTag == "260")
                        {
                            if (currentSub == "b") pPub.Value = text;
                            if (currentSub == "c") pYear.Value = System.Text.RegularExpressions.Regex.Replace(text, @"[^\d]", "");
                        }
                        else if (currentTag == "082" && currentSub == "a") pDdc.Value = text;
                        else if (currentTag == "852" && currentSub == "h") pCall.Value = text;
                    }
                }
            }
        }
    }
}
```

---

## 4. Complete Client Lookup Workflow (Step-by-Step)

When a librarian enters or scans an ISBN:

```
[ Librarian scans barcode ]
          │
          ▼
[ 1. Normalize ISBN (strip hyphens) ]
          │
          ▼
[ 2. Query Local SQLite ]
     SELECT * FROM catalog WHERE isbn13 = ?
          │
     ┌────┴───────────────────────────┐
  [Hit]                             [Miss]
     │                                │
     ▼                                ▼
[ Populate Form ]             [ Is Client Online? ]
(Instant < 2ms)                       │
                                 ┌────┴──────────────────────────┐
                              [Yes]                            [No]
                                 │                               │
                                 ▼                               ▼
                      [ 3. HTTP GET Point Fetch ]        [ 4. Show Prompt ]
                      GET /isbn/{isbn}.xml               "Book not found in Pustaka
                                 │                        Terbuka catalog. Enter details
                            ┌────┴───────────────┐        to create a new record."
                         [200 OK]              [404]             │
                            │                    │               ▼
                            ▼                    └───────► [ Manual Cataloging ]
                      [ Save to SQLite ]                   Mark is_local_contribution = 1
                      [ Populate Form ]
```

### 4.1 Step 7: Required Prompt Specification
When a book is not found in the local cache and returns `404` from PustakaTerbuka (or the machine is offline and misses the local database):

> **Exact Dialog Message:**  
> `"Book not found in Pustaka Terbuka catalog. Enter details to create a new record."`

**Client UI Behavior:**
1. Display the prompt with `OK` and `Cancel` options.
2. When the user confirms (`OK`):
   - Switch the UI into **Manual / Original Entry Mode**.
   - Lock the ISBN/ISSN field with the scanned value.
   - Set cursor focus directly to the **Title** input field.
   - When saved locally, set `is_local_contribution = 1` in SQLite so it is queued for contribution.

---

## 5. Client Contribution Workflows

Schools and libraries often acquire unique materials (school newsletters, local history publications, teacher modules) that do not yet exist in PustakaTerbuka.

### 5.1 Workflow A: Offline Contribution Bundle (`.zip`) — Zero GitHub Friction
Rural school librarians will generally not have GitHub accounts or Git installed. The client application should provide an **"Export Contribution Package"** button.

The app outputs a single `.zip` file: `PustakaContrib_{ORG}_{YYYYMMDD}.zip` containing:
```
PustakaContrib_SKBayanLepas_20261010.zip
├── manifest.json
├── provenance.jsonl
├── holdings.csv
└── records/
    └── batch_0.xml
```

#### File Specifications for the Bundle:

1. **`manifest.json`**:
   ```json
   {
     "schema_version": "1.0",
     "source_code": "SKBayanLepas",
     "source_name": "SK Bayan Lepas Library",
     "harvester_name": "PustakaWinFormsClient",
     "harvester_version": "1.0.0",
     "run_id": "20261010-120000",
     "mode": "incremental",
     "started_at": "2026-10-10T12:00:00Z",
     "finished_at": "2026-10-10T12:00:05Z",
     "record_count": 5,
     "error_count": 0,
     "status": "complete"
   }
   ```

2. **`records/batch_0.xml`**:
   Standard MARCXML collection containing the records cataloged locally.

3. **`provenance.jsonl`**:
   One line per record:
   ```json
   {"source_001":"SKBL-2026-001","harvested_at":"2026-10-10T12:00:00Z","file":"batch_0.xml","index":0}
   ```

4. **`holdings.csv`**:
   Local holding details:
   ```csv
   record,org,scheme,class_number,item_number,full_call_number,location
   9789830123456,SKBayanLepas,DDC,510,MAT,510 MAT,Main Library
   ```

The librarian can email this file, upload it via a Google Form / Web portal, or transfer it via USB stick to the District Education Office (PPD). Maintainers unpack the bundle into `harvest/inbox/{source}/` and run the pipeline.

---

### 5.2 Workflow B: Direct Pull Request (Online Clients)
For advanced clients or automated institutional systems:
1. Export holdings to `data/holdings/{ORG}.csv`.
2. Commit and open a Pull Request against the `main` branch of `https://github.com/aplikasi-perpustakaan/pustaka-terbuka`.
3. PustakaTerbuka's automated CI validates the submission via `npm run validate-holdings`.

---

## 6. Windows 7 and .NET Framework 4.7 Implementation Checklist

When deploying to Windows 7 SP1:

1. **Enforce TLS 1.2 at Startup:**
   GitHub strictly enforces TLS 1.2+. In .NET Framework 4.7 on Windows 7, TLS 1.0 is default. Place this in `Program.cs` before any network calls:
   ```csharp
   System.Net.ServicePointManager.SecurityProtocol = 
       System.Net.SecurityProtocolType.Tls12 | 
       System.Net.SecurityProtocolType.Tls11 | 
       System.Net.SecurityProtocolType.Tls;
   ```
2. **SQLite Deployment:**
   Use the NuGet package `System.Data.SQLite.Core`. It includes native x86 and x64 interop DLLs that work cleanly on Windows 7 without external runtimes.
3. **Local Path Limits:**
   Keep local storage paths short (e.g., `C:\PustakaLocal\data\`) to respect Windows 7 MAX_PATH limitations.
