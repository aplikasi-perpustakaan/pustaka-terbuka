using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace PNMHarvester
{
    class Program
    {
        const string SOURCE_CODE = "pnm";
        const string SOURCE_NAME = "Perpustakaan Negara Malaysia";
        const string SOURCE_BASE_URL = "https://opac.pnm.gov.my/";
        const string TERMS_URL = "https://www.pnm.gov.my/";
        const string BASE_API_URL = "https://ap.iiivega.com/api/search-result/search/format-groups";
        const string HARVESTER_NAME = "pnm-vega-scraper-csharp";
        const string HARVESTER_VERSION = "1.3.0";
        const string USER_AGENT = "PustakaTerbuka Harvester (+https://github.com/aplikasi-perpustakaan/pustaka-terbuka)";

        static int Main(string[] args)
        {
            // TLS 1.2 support for Windows 7+ .NET 4.0/4.5
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;

            // CLI Options
            int maxPages = 0; // Default 0: harvest all available records
            int pageSize = 100;
            string query = "*";
            int delayMs = 2000;
            string mode = "full";
            string customOutDir = null;
            bool skipPipeline = false;
            bool freshRun = false;
            string resumeTarget = null;
            int? dateFrom = null;
            int? dateTo = null;
            bool partitioned = false;

            for (int i = 0; i < args.Length; i++)
            {
                string arg = args[i];
                if (arg == "--help" || arg == "-h")
                {
                    PrintHelp();
                    return 0;
                }
                else if (arg == "--max-pages" && i + 1 < args.Length)
                {
                    int.TryParse(args[++i], out maxPages);
                }
                else if (arg == "--page-size" && i + 1 < args.Length)
                {
                    int.TryParse(args[++i], out pageSize);
                }
                else if (arg == "--query" && i + 1 < args.Length)
                {
                    query = args[++i];
                }
                else if (arg == "--delay" && i + 1 < args.Length)
                {
                    int.TryParse(args[++i], out delayMs);
                }
                else if (arg == "--mode" && i + 1 < args.Length)
                {
                    mode = args[++i];
                }
                else if (arg == "--out-dir" && i + 1 < args.Length)
                {
                    customOutDir = args[++i];
                }
                else if (arg == "--date-from" && i + 1 < args.Length)
                {
                    int df;
                    if (int.TryParse(args[++i], out df)) dateFrom = df;
                }
                else if (arg == "--date-to" && i + 1 < args.Length)
                {
                    int dt;
                    if (int.TryParse(args[++i], out dt)) dateTo = dt;
                }
                else if (arg == "--partitioned")
                {
                    partitioned = true;
                }
                else if (arg == "--skip-pipeline" || arg == "--no-pipeline")
                {
                    skipPipeline = true;
                }
                else if (arg == "--fresh" || arg == "--no-resume" || arg == "--new")
                {
                    freshRun = true;
                }
                else if (arg == "--resume")
                {
                    if (i + 1 < args.Length && !args[i + 1].StartsWith("--"))
                    {
                        resumeTarget = args[++i];
                    }
                    else
                    {
                        resumeTarget = "auto";
                    }
                }
            }

            var js = new JavaScriptSerializer();
            js.MaxJsonLength = int.MaxValue;

            DateTime startUtc = DateTime.UtcNow;
            string termsVerifiedOn = startUtc.ToString("yyyy-MM-dd");

            string repoRoot = FindRepoRoot(Directory.GetCurrentDirectory());
            string pnmInboxBase = Path.Combine(repoRoot, "harvest", "inbox", SOURCE_CODE);
            string inboxDir = null;
            string runId = null;
            bool isResuming = false;
            int startPageNum = 0;
            int fetchedCount = 0;
            int errorCount = 0;
            string startedAt = null;

            if (!freshRun)
            {
                if (!string.IsNullOrEmpty(resumeTarget) && resumeTarget != "auto")
                {
                    if (Directory.Exists(resumeTarget))
                        inboxDir = Path.GetFullPath(resumeTarget);
                    else if (Directory.Exists(Path.Combine(pnmInboxBase, resumeTarget)))
                        inboxDir = Path.Combine(pnmInboxBase, resumeTarget);
                    else
                    {
                        Console.WriteLine("[ERROR] Specified resume directory does not exist: " + resumeTarget);
                        return 1;
                    }
                    isResuming = true;
                }
                else if (!string.IsNullOrEmpty(customOutDir))
                {
                    if (Directory.Exists(customOutDir) && IsIncompleteRun(customOutDir, js))
                    {
                        inboxDir = Path.GetFullPath(customOutDir);
                        isResuming = true;
                    }
                }
                else if (Directory.Exists(pnmInboxBase))
                {
                    string candidate = FindLatestIncompleteRun(pnmInboxBase, js);
                    if (!string.IsNullOrEmpty(candidate))
                    {
                        inboxDir = candidate;
                        isResuming = true;
                    }
                }
            }

            if (isResuming && !string.IsNullOrEmpty(inboxDir))
            {
                runId = Path.GetFileName(inboxDir);
                string recordsDir = Path.Combine(inboxDir, "records");
                Directory.CreateDirectory(recordsDir);

                var validBatches = new HashSet<string>();
                int highestPage = -1;
                InspectBatches(recordsDir, validBatches, out highestPage, out fetchedCount);

                startPageNum = highestPage + 1;

                string provPath = Path.Combine(inboxDir, "provenance.jsonl");
                CleanProvenanceFile(provPath, validBatches);

                string manifestPath = Path.Combine(inboxDir, "manifest.json");
                if (File.Exists(manifestPath))
                {
                    try
                    {
                        var prevManifest = js.Deserialize<Dictionary<string, object>>(File.ReadAllText(manifestPath, Encoding.UTF8));
                        if (prevManifest != null && prevManifest.ContainsKey("started_at") && prevManifest["started_at"] != null)
                        {
                            startedAt = prevManifest["started_at"].ToString();
                        }
                        if (prevManifest != null && prevManifest.ContainsKey("error_count"))
                        {
                            int.TryParse(prevManifest["error_count"].ToString(), out errorCount);
                        }
                    }
                    catch { }
                }

                if (string.IsNullOrEmpty(startedAt))
                {
                    startedAt = Directory.GetCreationTimeUtc(inboxDir).ToString("yyyy-MM-ddTHH:mm:ssZ");
                }
            }
            else
            {
                isResuming = false;
                runId = startUtc.ToString("yyyy-MM-ddTHH-mm-ssZ");
                startedAt = startUtc.ToString("yyyy-MM-ddTHH:mm:ssZ");
                inboxDir = !string.IsNullOrEmpty(customOutDir)
                    ? Path.GetFullPath(customOutDir)
                    : Path.Combine(pnmInboxBase, runId);
                startPageNum = 0;
                fetchedCount = 0;
                Directory.CreateDirectory(Path.Combine(inboxDir, "records"));
            }

            string recordsDirActual = Path.Combine(inboxDir, "records");

            Console.WriteLine("=== PustakaTerbuka PNM Harvester (C# Native) ===");
            Console.WriteLine("Run ID:      " + runId + (isResuming ? " [RESUMING]" : " [NEW]"));
            Console.WriteLine("Inbox:       " + inboxDir);
            if (isResuming)
            {
                Console.WriteLine(string.Format("Resuming:    Starting at page {0} ({1} records already saved)", startPageNum, fetchedCount));
            }
            Console.WriteLine("Query:       " + query);
            Console.WriteLine("Page Size:   " + pageSize);
            Console.WriteLine("Max Pages:   " + (maxPages > 0 ? maxPages.ToString() : "Unlimited"));
            Console.WriteLine("Rate Delay:  " + delayMs + "ms");
            Console.WriteLine("================================================");

            StreamWriter provStream = null;
            int pageNum = startPageNum;
            int totalResults = (startPageNum + 1) * pageSize;
            int pagesFetchedThisRun = 0;
            string harvestStatus = "complete";
            string failureNotes = null;

            try
            {
                provStream = new StreamWriter(Path.Combine(inboxDir, "provenance.jsonl"), true, new UTF8Encoding(false));

                while (pageNum * pageSize < totalResults)
                {
                    if (maxPages > 0 && pagesFetchedThisRun >= maxPages)
                    {
                        break;
                    }

                    int startRecord = pageNum * pageSize + 1;
                    int endRecord = Math.Min((pageNum + 1) * pageSize, totalResults);
                    Console.WriteLine(string.Format("[PAGE] Fetching page {0} (records {1} - {2})...", pageNum, startRecord, endRecord));

                    string responseJson = FetchPageWithRetry(query, pageNum, pageSize, dateFrom, dateTo, js);
                    if (string.IsNullOrEmpty(responseJson))
                    {
                        Console.WriteLine("[WARN] Empty response received for page " + pageNum);
                        break;
                    }

                    var result = js.Deserialize<Dictionary<string, object>>(responseJson);
                    if (result != null && result.ContainsKey("totalResults"))
                    {
                        totalResults = Convert.ToInt32(result["totalResults"]);
                    }

                    if (result == null || !result.ContainsKey("data")) break;
                    var items = result["data"] as ArrayList;
                    if (items == null || items.Count == 0)
                    {
                        Console.WriteLine(string.Format("[INFO] No records returned for page {0}.", pageNum));
                        break;
                    }

                    StringBuilder xml = new StringBuilder();
                    xml.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
                    xml.AppendLine("<collection xmlns=\"http://www.loc.gov/MARC21/slim\">");

                    int recordIndexInBatch = 0;
                    foreach (object objItem in items)
                    {
                        var item = objItem as Dictionary<string, object>;
                        if (item == null) continue;

                        string id = GetStr(item, "id");
                        var identifiers = item.ContainsKey("identifiers") ? item["identifiers"] as Dictionary<string, object> : null;
                        string localId = identifiers != null ? GetStr(identifiers, "local") : id;
                        if (string.IsNullOrEmpty(localId)) localId = id;

                        string title = GetStr(item, "title");
                        if (string.IsNullOrEmpty(title) || string.IsNullOrEmpty(localId))
                        {
                            Console.WriteLine(string.Format("[WARN] Skipping invalid record: missing {0}", string.IsNullOrEmpty(localId) ? "control ID" : "title (245)"));
                            errorCount++;
                            continue;
                        }

                        // Determine Issuance (monograph vs serial)
                        string issuanceType = "m"; // default monograph
                        if (item.ContainsKey("materialTabs"))
                        {
                            var tabsArray = item["materialTabs"] as ArrayList;
                            if (tabsArray != null)
                            {
                                foreach (object tabObj in tabsArray)
                                {
                                    var t = tabObj as Dictionary<string, object>;
                                    if (t != null && t.ContainsKey("issuance"))
                                    {
                                        var issArray = t["issuance"] as ArrayList;
                                        if (issArray != null)
                                        {
                                            foreach (object iss in issArray)
                                            {
                                                if (iss != null && iss.ToString().Trim().ToLower() == "serial")
                                                {
                                                    issuanceType = "s";
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                    if (issuanceType == "s") break;
                                }
                            }
                        }

                        xml.AppendLine("  <record>");
                        xml.AppendLine(string.Format("    <leader>00000na{0} a2200000Ia 4500</leader>", issuanceType));
                        xml.AppendLine(string.Format("    <controlfield tag=\"001\">{0}</controlfield>", EscapeXml(localId)));

                        // Language (041 $a)
                        string language = GetStr(item, "language");
                        if (!string.IsNullOrEmpty(language))
                        {
                            xml.AppendLine("    <datafield tag=\"041\" ind1=\" \" ind2=\" \">");
                            xml.AppendLine(string.Format("      <subfield code=\"a\">{0}</subfield>", EscapeXml(language)));
                            xml.AppendLine("    </datafield>");
                        }

                        // Extract detailed data from materialTabs
                        var isbns = new HashSet<string>();
                        var localIds = new HashSet<string>();
                        var editions = new HashSet<string>();
                        var descriptions = new HashSet<string>();
                        var formats = new HashSet<string>();
                        var urls = new HashSet<string>();
                        var locations = new HashSet<string>();
                        string callNumber = null;

                        if (identifiers != null && identifiers.ContainsKey("isbn"))
                        {
                            var rawIsbn = identifiers["isbn"];
                            if (rawIsbn is ArrayList)
                            {
                                foreach (var v in (ArrayList)rawIsbn)
                                    if (v != null && !string.IsNullOrEmpty(v.ToString().Trim())) isbns.Add(v.ToString().Trim());
                            }
                            else if (rawIsbn != null && !string.IsNullOrEmpty(rawIsbn.ToString().Trim()))
                            {
                                isbns.Add(rawIsbn.ToString().Trim());
                            }
                        }

                        if (item.ContainsKey("materialTabs"))
                        {
                            var materialTabs = item["materialTabs"] as ArrayList;
                            if (materialTabs != null)
                            {
                                foreach (object tabObj in materialTabs)
                                {
                                    var tab = tabObj as Dictionary<string, object>;
                                    if (tab == null) continue;

                                    // Material Format
                                    string f = GetStr(tab, "name");
                                    if (!string.IsNullOrEmpty(f)) formats.Add(f.Trim());

                                    // Description/Summary
                                    string d = GetStr(tab, "description");
                                    if (!string.IsNullOrEmpty(d)) descriptions.Add(d.Trim());

                                    // Alternate Identifiers
                                    if (tab.ContainsKey("identifiedBy"))
                                    {
                                        var idBy = tab["identifiedBy"] as Dictionary<string, object>;
                                        if (idBy != null)
                                        {
                                            if (idBy.ContainsKey("isbn"))
                                            {
                                                var isbnArr = idBy["isbn"] as ArrayList;
                                                if (isbnArr != null)
                                                {
                                                    foreach (var v in isbnArr)
                                                        if (v != null && !string.IsNullOrEmpty(v.ToString().Trim())) isbns.Add(v.ToString().Trim());
                                                }
                                            }
                                            if (idBy.ContainsKey("local"))
                                            {
                                                var localArr = idBy["local"] as ArrayList;
                                                if (localArr != null)
                                                {
                                                    foreach (var v in localArr)
                                                        if (v != null && !string.IsNullOrEmpty(v.ToString().Trim())) localIds.Add(v.ToString().Trim());
                                                }
                                            }
                                        }
                                    }

                                    // URLs
                                    if (tab.ContainsKey("availability"))
                                    {
                                        var avail = tab["availability"] as Dictionary<string, object>;
                                        if (avail != null && avail.ContainsKey("urls"))
                                        {
                                            var urlArr = avail["urls"] as ArrayList;
                                            if (urlArr != null)
                                            {
                                                foreach (var v in urlArr)
                                                    if (v != null && !string.IsNullOrEmpty(v.ToString().Trim())) urls.Add(v.ToString().Trim());
                                            }
                                        }
                                    }
                                    if (tab.ContainsKey("multimediaLinks"))
                                    {
                                        var mmArr = tab["multimediaLinks"] as ArrayList;
                                        if (mmArr != null)
                                        {
                                            foreach (object mObj in mmArr)
                                            {
                                                var m = mObj as Dictionary<string, object>;
                                                if (m != null)
                                                {
                                                    string u = GetStr(m, "url");
                                                    if (!string.IsNullOrEmpty(u)) urls.Add(u.Trim());
                                                }
                                            }
                                        }
                                    }

                                    // Locations
                                    if (tab.ContainsKey("locations"))
                                    {
                                        var locArr = tab["locations"] as ArrayList;
                                        if (locArr != null)
                                        {
                                            foreach (object locObj in locArr)
                                            {
                                                var loc = locObj as Dictionary<string, object>;
                                                if (loc != null)
                                                {
                                                    string label = GetStr(loc, "label");
                                                    if (!string.IsNullOrEmpty(label)) locations.Add(label.Trim());
                                                }
                                            }
                                        }
                                    }

                                    // Editions & Call Numbers
                                    if (tab.ContainsKey("editions"))
                                    {
                                        var edArr = tab["editions"] as ArrayList;
                                        if (edArr != null)
                                        {
                                            foreach (object edObj in edArr)
                                            {
                                                var ed = edObj as Dictionary<string, object>;
                                                if (ed != null)
                                                {
                                                    string editionStr = GetStr(ed, "edition");
                                                    if (!string.IsNullOrEmpty(editionStr)) editions.Add(editionStr.Trim());

                                                    if (string.IsNullOrEmpty(callNumber))
                                                    {
                                                        string cn = GetStr(ed, "callNumber");
                                                        if (!string.IsNullOrEmpty(cn)) callNumber = cn.Trim();
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // ISBNs (020)
                        foreach (string isbn in isbns)
                        {
                            if (!string.IsNullOrEmpty(isbn))
                            {
                                xml.AppendLine("    <datafield tag=\"020\" ind1=\" \" ind2=\" \">");
                                xml.AppendLine(string.Format("      <subfield code=\"a\">{0}</subfield>", EscapeXml(isbn)));
                                xml.AppendLine("    </datafield>");
                            }
                        }

                        // ISSN (022)
                        if (identifiers != null && identifiers.ContainsKey("issn"))
                        {
                            string issn = GetStr(identifiers, "issn");
                            if (!string.IsNullOrEmpty(issn))
                            {
                                xml.AppendLine("    <datafield tag=\"022\" ind1=\" \" ind2=\" \">");
                                xml.AppendLine(string.Format("      <subfield code=\"a\">{0}</subfield>", EscapeXml(issn)));
                                xml.AppendLine("    </datafield>");
                            }
                        }

                        // VTLS System IDs (035)
                        foreach (string lid in localIds)
                        {
                            if (!string.IsNullOrEmpty(lid) && lid != localId)
                            {
                                xml.AppendLine("    <datafield tag=\"035\" ind1=\" \" ind2=\" \">");
                                xml.AppendLine(string.Format("      <subfield code=\"a\">{0}</subfield>", EscapeXml(lid)));
                                xml.AppendLine("    </datafield>");
                            }
                        }

                        // Author (100)
                        var agent = item.ContainsKey("primaryAgent") ? item["primaryAgent"] as Dictionary<string, object> : null;
                        if (agent != null)
                        {
                            string author = GetStr(agent, "label");
                            if (!string.IsNullOrEmpty(author))
                            {
                                xml.AppendLine("    <datafield tag=\"100\" ind1=\"1\" ind2=\" \">");
                                xml.AppendLine(string.Format("      <subfield code=\"a\">{0}</subfield>", EscapeXml(author)));
                                xml.AppendLine("    </datafield>");
                            }
                        }

                        // Title (245)
                        xml.AppendLine("    <datafield tag=\"245\" ind1=\"0\" ind2=\"0\">");
                        xml.AppendLine(string.Format("      <subfield code=\"a\">{0}</subfield>", EscapeXml(title)));
                        xml.AppendLine("    </datafield>");

                        // Edition (250)
                        foreach (string ed in editions)
                        {
                            if (!string.IsNullOrEmpty(ed))
                            {
                                xml.AppendLine("    <datafield tag=\"250\" ind1=\" \" ind2=\" \">");
                                xml.AppendLine(string.Format("      <subfield code=\"a\">{0}</subfield>", EscapeXml(ed)));
                                xml.AppendLine("    </datafield>");
                            }
                        }

                        // Publication Date (264)
                        string pubYear = GetStr(item, "publicationDate");
                        if (!string.IsNullOrEmpty(pubYear))
                        {
                            xml.AppendLine("    <datafield tag=\"264\" ind1=\" \" ind2=\"1\">");
                            xml.AppendLine(string.Format("      <subfield code=\"c\">{0}</subfield>", EscapeXml(pubYear)));
                            xml.AppendLine("    </datafield>");
                        }

                        // Series Title (490)
                        string series = GetStr(item, "seriesTitle");
                        if (!string.IsNullOrEmpty(series))
                        {
                            xml.AppendLine("    <datafield tag=\"490\" ind1=\"0\" ind2=\" \">");
                            xml.AppendLine(string.Format("      <subfield code=\"a\">{0}</subfield>", EscapeXml(series)));
                            xml.AppendLine("    </datafield>");
                        }

                        // Summary (520)
                        foreach (string desc in descriptions)
                        {
                            if (!string.IsNullOrEmpty(desc))
                            {
                                xml.AppendLine("    <datafield tag=\"520\" ind1=\" \" ind2=\" \">");
                                xml.AppendLine(string.Format("      <subfield code=\"a\">{0}</subfield>", EscapeXml(desc)));
                                xml.AppendLine("    </datafield>");
                            }
                        }

                        // Format/Genre (655)
                        foreach (string format in formats)
                        {
                            if (!string.IsNullOrEmpty(format))
                            {
                                xml.AppendLine("    <datafield tag=\"655\" ind1=\" \" ind2=\"7\">");
                                xml.AppendLine(string.Format("      <subfield code=\"a\">{0}</subfield>", EscapeXml(format)));
                                xml.AppendLine("      <subfield code=\"2\">local</subfield>");
                                xml.AppendLine("    </datafield>");
                            }
                        }

                        // Call Number & Locations (852)
                        if (!string.IsNullOrEmpty(callNumber) || locations.Count > 0)
                        {
                            xml.AppendLine("    <datafield tag=\"852\" ind1=\" \" ind2=\" \">");
                            if (!string.IsNullOrEmpty(callNumber))
                            {
                                xml.AppendLine(string.Format("      <subfield code=\"h\">{0}</subfield>", EscapeXml(callNumber)));
                            }
                            foreach (string locStr in locations)
                            {
                                if (!string.IsNullOrEmpty(locStr))
                                {
                                    xml.AppendLine(string.Format("      <subfield code=\"b\">{0}</subfield>", EscapeXml(locStr)));
                                }
                            }
                            xml.AppendLine("    </datafield>");
                        }

                        // URLs (856)
                        foreach (string url in urls)
                        {
                            if (!string.IsNullOrEmpty(url))
                            {
                                xml.AppendLine("    <datafield tag=\"856\" ind1=\"4\" ind2=\"0\">");
                                xml.AppendLine(string.Format("      <subfield code=\"u\">{0}</subfield>", EscapeXml(url)));
                                xml.AppendLine("    </datafield>");
                            }
                        }

                        xml.AppendLine("  </record>");

                        // Provenance
                        var prov = new Dictionary<string, object>
                        {
                            { "source_001", localId },
                            { "source_url", SOURCE_BASE_URL + "search/resource/" + id },
                            { "harvested_at", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ") },
                            { "file", string.Format("batch_{0}.xml", pageNum) },
                            { "index", recordIndexInBatch }
                        };
                        provStream.WriteLine(js.Serialize(prov));

                        recordIndexInBatch++;
                        fetchedCount++;
                    }

                    xml.AppendLine("</collection>");
                    string batchPath = Path.Combine(recordsDirActual, string.Format("batch_{0}.xml", pageNum));
                    File.WriteAllText(batchPath, xml.ToString(), new UTF8Encoding(false));

                    Console.WriteLine(string.Format("[SAVE] Wrote {0} records to batch_{1}.xml (Total fetched: {2} / {3})", recordIndexInBatch, pageNum, fetchedCount, totalResults));
                    pageNum++;
                    pagesFetchedThisRun++;

                    if (pageNum * pageSize < totalResults && (maxPages <= 0 || pagesFetchedThisRun < maxPages))
                    {
                        Thread.Sleep(delayMs);
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("[ERROR] Fatal error during harvest: " + ex.Message);
                harvestStatus = fetchedCount > 0 ? "partial" : "failed";
                failureNotes = ex.Message;
            }
            finally
            {
                if (provStream != null)
                {
                    provStream.Flush();
                    provStream.Close();
                }

                DateTime finishUtc = DateTime.UtcNow;
                string finishedAt = finishUtc.ToString("yyyy-MM-ddTHH:mm:ssZ");

                var manifest = new Dictionary<string, object>
                {
                    { "schema_version", "1.0" },
                    { "source_code", SOURCE_CODE },
                    { "source_name", SOURCE_NAME },
                    { "source_base_url", SOURCE_BASE_URL },
                    { "terms_url", TERMS_URL },
                    { "terms_verified_on", termsVerifiedOn }, // Strictly YYYY-MM-DD
                    { "harvester_name", HARVESTER_NAME },
                    { "harvester_version", HARVESTER_VERSION },
                    { "run_id", runId },
                    { "mode", mode },
                    { "started_at", startedAt },
                    { "finished_at", finishedAt },
                    { "record_count", fetchedCount },
                    { "error_count", errorCount },
                    { "status", harvestStatus },
                    { "user_agent", USER_AGENT },
                    { "notes", failureNotes != null
                        ? "Status " + harvestStatus + ": " + failureNotes
                        : (isResuming ? "Harvest resumed and completed successfully from PNM Vega Discover REST API." : "Harvest completed successfully from PNM Vega Discover REST API.") }
                };

                string manifestPath = Path.Combine(inboxDir, "manifest.json");
                File.WriteAllText(manifestPath, js.Serialize(manifest), new UTF8Encoding(false));

                Console.WriteLine("================================================");
                Console.WriteLine(string.Format("Harvest finished: status = {0}, records = {1}, errors = {2}", harvestStatus, fetchedCount, errorCount));
                Console.WriteLine("Manifest written to: " + manifestPath);
                Console.WriteLine("================================================");
            }

            if (harvestStatus != "complete")
            {
                Console.WriteLine("\n[WARN] Harvest ended with status '" + harvestStatus + "'. Automated pipeline will not run on incomplete data.");
                return 1;
            }

            bool isInsideRepo = File.Exists(Path.Combine(repoRoot, "package.json"));
            if (isInsideRepo && !skipPipeline)
            {
                Console.WriteLine();
                Console.WriteLine("================================================");
                Console.WriteLine(" Running PustakaTerbuka Pipeline Automatically ");
                Console.WriteLine("================================================");

                Console.WriteLine("\n[Step 1/3] Validating inbox...");
                int exitCode = RunCommand("npm run validate-inbox -- \"" + inboxDir + "\"", repoRoot);
                if (exitCode != 0)
                {
                    Console.WriteLine("\n[ERROR] Pipeline stopped: validation failed with exit code " + exitCode);
                    return exitCode;
                }

                Console.WriteLine("\n[Step 2/3] Merging & deduplicating records into catalog...");
                exitCode = RunCommand("npm run merge -- \"" + inboxDir + "\"", repoRoot);
                if (exitCode != 0)
                {
                    Console.WriteLine("\n[ERROR] Pipeline stopped: merge failed with exit code " + exitCode);
                    return exitCode;
                }

                Console.WriteLine("\n[Step 3/3] Building static OPAC and search index...");
                exitCode = RunCommand("npm run build", repoRoot);
                if (exitCode != 0)
                {
                    Console.WriteLine("\n[ERROR] Pipeline stopped: build failed with exit code " + exitCode);
                    return exitCode;
                }

                Console.WriteLine();
                Console.WriteLine("================================================");
                Console.WriteLine(" Pipeline Completed: Catalog Updated & Built! ");
                Console.WriteLine("================================================");
            }

            return 0;
        }

        static string FetchPageWithRetry(string query, int pageNum, int pageSize, int? dateFrom, int? dateTo, JavaScriptSerializer js)
        {
            int maxRetries = 5;
            var payload = new Dictionary<string, object>
            {
                { "searchText", query },
                { "searchType", "everything" },
                { "pageNum", pageNum },
                { "pageSize", pageSize },
                { "resourceType", "FormatGroup" }
            };
            if (dateFrom.HasValue) payload["dateFrom"] = dateFrom.Value;
            if (dateTo.HasValue) payload["dateTo"] = dateTo.Value;

            string jsonPayload = js.Serialize(payload);
            byte[] data = Encoding.UTF8.GetBytes(jsonPayload);

            for (int attempt = 1; attempt <= maxRetries; attempt++)
            {
                try
                {
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create(BASE_API_URL);
                    request.Method = "POST";
                    request.Headers.Add("iii-customer-domain", "pnm.ap.iiivega.com");
                    request.Headers.Add("iii-host-domain", "opac.pnm.gov.my");
                    request.Headers.Add("api-version", "2");
                    request.UserAgent = USER_AGENT;
                    request.ContentType = "application/json";
                    request.ContentLength = data.Length;
                    request.Timeout = 30000;

                    using (var stream = request.GetRequestStream())
                    {
                        stream.Write(data, 0, data.Length);
                    }

                    using (var response = (HttpWebResponse)request.GetResponse())
                    using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    {
                        return reader.ReadToEnd();
                    }
                }
                catch (WebException wex)
                {
                    int backoffMs = Math.Min(300000, 5000 * (int)Math.Pow(2, attempt - 1));
                    int statusCode = 0;

                    if (wex.Response is HttpWebResponse)
                    {
                        var httpResp = (HttpWebResponse)wex.Response;
                        statusCode = (int)httpResp.StatusCode;
                        string retryAfter = httpResp.GetResponseHeader("Retry-After");
                        int retryAfterSec;
                        if (!string.IsNullOrEmpty(retryAfter) && int.TryParse(retryAfter, out retryAfterSec))
                        {
                            backoffMs = retryAfterSec * 1000;
                        }
                    }

                    Console.WriteLine(string.Format("[WARN] HTTP error {0} on page {1} (attempt {2}/{3}). Backing off {4}s...", statusCode, pageNum, attempt, maxRetries, backoffMs / 1000));
                    if (attempt == maxRetries) throw;
                    Thread.Sleep(backoffMs);
                }
                catch (Exception ex)
                {
                    int backoffMs = Math.Min(300000, 5000 * (int)Math.Pow(2, attempt - 1));
                    Console.WriteLine(string.Format("[WARN] Error on page {0} (attempt {1}/{2}): {3}. Backing off {4}s...", pageNum, attempt, maxRetries, ex.Message, backoffMs / 1000));
                    if (attempt == maxRetries) throw;
                    Thread.Sleep(backoffMs);
                }
            }

            return null;
        }

        static string ExtractCallNumber(Dictionary<string, object> item)
        {
            if (item == null || !item.ContainsKey("materialTabs")) return "";
            var tabs = item["materialTabs"] as ArrayList;
            if (tabs == null) return "";

            foreach (object tabObj in tabs)
            {
                var tab = tabObj as Dictionary<string, object>;
                if (tab != null && tab.ContainsKey("editions"))
                {
                    var editions = tab["editions"] as ArrayList;
                    if (editions != null)
                    {
                        foreach (object edObj in editions)
                        {
                            var edition = edObj as Dictionary<string, object>;
                            if (edition != null)
                            {
                                string callNum = GetStr(edition, "callNumber");
                                if (!string.IsNullOrEmpty(callNum)) return callNum;
                            }
                        }
                    }
                }
            }
            return "";
        }

        static string FindRepoRoot(string startDir)
        {
            string current = Path.GetFullPath(startDir);
            while (!string.IsNullOrEmpty(current))
            {
                if (File.Exists(Path.Combine(current, "package.json")))
                {
                    return current;
                }
                DirectoryInfo parent = Directory.GetParent(current);
                if (parent == null) break;
                current = parent.FullName;
            }
            return startDir;
        }

        static string GetStr(Dictionary<string, object> dict, string key)
        {
            if (dict != null && dict.ContainsKey(key) && dict[key] != null)
            {
                return dict[key].ToString();
            }
            return "";
        }

        static string EscapeXml(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\uFFFD", "")
                    .Replace("&", "&amp;")
                    .Replace("<", "&lt;")
                    .Replace(">", "&gt;")
                    .Replace("\"", "&quot;")
                    .Replace("'", "&apos;");
        }

        static int RunCommand(string command, string workingDir)
        {
            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c " + command,
                WorkingDirectory = workingDir,
                UseShellExecute = false
            };
            using (var proc = Process.Start(psi))
            {
                proc.WaitForExit();
                return proc.ExitCode;
            }
        }

        static bool IsIncompleteRun(string dir, JavaScriptSerializer js)
        {
            string manifestPath = Path.Combine(dir, "manifest.json");
            if (!File.Exists(manifestPath))
            {
                // No manifest means interrupted mid-run
                return Directory.Exists(Path.Combine(dir, "records"));
            }
            try
            {
                string json = File.ReadAllText(manifestPath, Encoding.UTF8);
                var manifest = js.Deserialize<Dictionary<string, object>>(json);
                if (manifest != null && manifest.ContainsKey("status"))
                {
                    string status = manifest["status"] != null ? manifest["status"].ToString() : "";
                    return status != "complete";
                }
            }
            catch
            {
                return true;
            }
            return false;
        }

        static string FindLatestIncompleteRun(string baseDir, JavaScriptSerializer js)
        {
            if (!Directory.Exists(baseDir)) return null;
            var dirs = Directory.GetDirectories(baseDir);
            Array.Sort(dirs);
            Array.Reverse(dirs); // Newest first

            foreach (var dir in dirs)
            {
                if (IsIncompleteRun(dir, js))
                {
                    return dir;
                }
            }
            return null;
        }

        static void InspectBatches(string recordsDir, HashSet<string> validBatches, out int highestPage, out int recordCount)
        {
            highestPage = -1;
            recordCount = 0;
            if (!Directory.Exists(recordsDir)) return;

            var files = Directory.GetFiles(recordsDir, "batch_*.xml");
            var regex = new Regex(@"batch_(\d+)\.xml$", RegexOptions.IgnoreCase);

            foreach (var file in files)
            {
                string fileName = Path.GetFileName(file);
                var match = regex.Match(fileName);
                if (match.Success)
                {
                    int pNum = int.Parse(match.Groups[1].Value);
                    string content = File.ReadAllText(file, Encoding.UTF8);

                    // A complete batch file must have the closing </collection> tag
                    if (content.IndexOf("</collection>", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        validBatches.Add(fileName);
                        if (pNum > highestPage) highestPage = pNum;

                        // Count <record> occurrences
                        int recs = Regex.Matches(content, @"<record[\s>]").Count;
                        recordCount += recs;
                    }
                    else
                    {
                        Console.WriteLine("[RESUME] Removing corrupt/incomplete batch file: " + fileName);
                        try { File.Delete(file); } catch { }
                    }
                }
            }
        }

        static void CleanProvenanceFile(string provPath, HashSet<string> validBatches)
        {
            if (!File.Exists(provPath)) return;

            var validLines = new List<string>();
            var regex = new Regex(@"""file""\s*:\s*""([^""]+)""", RegexOptions.IgnoreCase);

            using (var reader = new StreamReader(provPath, Encoding.UTF8))
            {
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    var match = regex.Match(line);
                    if (match.Success)
                    {
                        string file = match.Groups[1].Value;
                        if (validBatches.Contains(file))
                        {
                            validLines.Add(line);
                        }
                    }
                }
            }

            File.WriteAllLines(provPath, validLines.ToArray(), new UTF8Encoding(false));
        }

        static void PrintHelp()
        {
            Console.WriteLine(@"
PustakaTerbuka PNM Harvester (C#)

Usage:
  PNM-Harvester.exe [options]

Options:
  --max-pages <num>          Maximum number of pages to fetch (default: 0 for all records)
  --page-size <num>          Records per page, max 100 (default: 100)
  --query <str>              Search query string (default: ""*"")
  --delay <ms>               Delay between page requests in ms (default: 2000)
  --mode <full|incremental>  Harvest mode (default: ""full"")
  --date-from <year>         Filter records by starting publication year
  --date-to <year>           Filter records by ending publication year
  --partitioned              Harvest catalog using query partitioning (bypasses OpenSearch 10k window)
  --out-dir <path>           Override output inbox directory
  --skip-pipeline            Skip automated validate, merge, and build steps
  --fresh, --no-resume       Always start a new harvest run (do not resume incomplete run)
  --resume [run-id]          Resume a specific run ID or folder (default: auto-resumes latest incomplete run)
  -h, --help                 Show this help message
");
        }
    }
}
