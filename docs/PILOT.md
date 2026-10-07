# PustakaTerbuka Pilot Procedure

This document outlines the procedure for running a scale pilot of the PustakaTerbuka platform.

## 1. Prerequisites

Ensure you have Node.js (>=20.0.0) installed and all dependencies have been installed:
```bash
npm install
```

## 2. Generating Fixtures

We use `tools/gen-fixtures.js` to generate synthetic records.
This tool produces a manifest, synthetic MARC XML records, and a provenance JSONL file.
The fake records include:
- Content in English, Malay, Chinese, Tamil, and Jawi
- Valid ISBN-10 and ISBN-13 checksums
- Both LCC and DDC classification numbers
- Deliberate duplicates for merge testing
- Hostile strings (e.g. XSS vectors, SQL injection attempts) to verify robustness
- Sample holdings data

Usage:
```bash
node tools/gen-fixtures.js --count <number-of-records> --outdir <output-directory>
```

## 3. Running the Scale Pilot Report

To automate the testing of the end-to-end pipeline (generation -> merging -> building), we use `tools/pilot-report.js`.

Usage:
```bash
node tools/pilot-report.js --sizes 5000,50000
```

This script will:
1. Generate fixtures of the specified sizes.
2. Run the `merge.js` script to process the fixtures into the unified data directory.
3. Run the `build.js` script to generate the static site output.
4. Measure and output the time taken for each step to help identify performance bottlenecks.

## 4. Validating the Results

The pilot report script will output a `pilot-report.json` containing the metrics.
Verify that all steps complete successfully.
Check the generated `pilot-dist-<size>` directory to ensure the static site was correctly built.
```bash
npx serve pilot-dist-5000
```
