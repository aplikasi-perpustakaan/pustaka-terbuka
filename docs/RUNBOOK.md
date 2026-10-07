# PustakaTerbuka Runbook

Operational guide for running the PustakaTerbuka catalog pipeline.

## Full Pipeline Explanation

The `Publish-Catalog.ps1` script is the main entry point for updating and deploying the catalog. When executed, it performs the following steps:

1.  **Configuration Loading**: Reads `config/config.json`.
2.  **Harvesting**: Reads `harvest/config.json` and executes commands for enabled harvesters (skip with `-SkipHarvest`).
3.  **Validation (Inbox)**: Validates downloaded records using `npm run validate-inbox`.
4.  **Merging**: Merges the harvested records into the core dataset using `npm run merge`.
5.  **Validation (Holdings)**: Verifies the integrity of holding data using `npm run validate-holdings`.
6.  **Building**: Builds the web catalog and indices using `npm run build`.
7.  **Testing**: Runs the automated test suite using `npm test`.
8.  **Gate Enforcement**: Any failure in steps 3-7 immediately halts the pipeline.
9.  **Git Commit**: Commits the updated source `data/` directory to the repository.
10. **Git Tag**: Creates a timestamped release tag (e.g., `catalog-20261007-1530`).
11. **Publish to gh-pages**: Force-pushes a clean, orphan commit of the `dist/` directory to the `gh-pages` branch for hosting (skip with `-SkipPublish`).
12. **Upload Dumps**: Uploads distribution dumps to a GitHub release associated with the newly created tag.

By default, running `Publish-Catalog.ps1` operates in **dry-run** mode (`-WhatIf`) unless the `-Force` switch is explicitly provided. This prevents accidental data commits or deployments.

## Recovery from a Lost Machine

If the machine running the pipeline is lost, you can recover operations by:

1.  Cloning the repository to a new machine:
    ```bash
    git clone <repository_url> pustaka-terbuka
    cd pustaka-terbuka
    ```
2.  Installing dependencies:
    ```bash
    npm ci
    ```
3.  Recreating the configuration files from their examples:
    - `copy config/config.example.json config/config.json`
    - Update `config/config.json` with the correct local paths and API keys if applicable.
4.  The system is now fully restored. Since all source data and code are checked into Git, no catalog data is lost.

## Rollback to a Previous Tag

If a bad catalog publish occurs and is pushed to `gh-pages`, you can rollback to a known good state:

1.  Identify the previous stable release tag:
    ```bash
    git tag
    ```
2.  Checkout the data state from that tag:
    ```bash
    git checkout <previous_tag> -- data/
    ```
3.  Commit the rollback:
    ```bash
    git commit -m "Rollback data to <previous_tag>"
    ```
4.  Run the pipeline again to build and deploy the restored data:
    ```powershell
    pwsh scripts/Publish-Catalog.ps1 -Force -SkipHarvest -Message "Rollback deployment"
    ```

## Training a Second Operator

When training a new team member to run operations, emphasize these points:

-   **Dry-Run First**: Always run `Publish-Catalog.ps1` without the `-Force` flag first. Observe the WhatIf logs to understand what will be modified.
-   **Review Errors**: If the pipeline stops, it is usually because one of the data gates failed (e.g., a badly formatted ISBN in holdings). The logs will specify which command exited with code 1. Operators should fix the data in `data/` or `harvest/inbox/` and re-run.
-   **No Manual Deployments**: Do not manually build and push to `gh-pages`. The publish script guarantees that all tests pass and a corresponding Git tag is created. Manual pushes break this lineage.

## Publishing to Zenodo

PustakaTerbuka optionally archives catalog releases to Zenodo for long-term preservation and DOIs. The automated pipeline prepares the data dump, but we cannot automate the final Zenodo publish.

1. Ensure the organization owner has approved Zenodo's access in the organization's GitHub settings.
2. Log in to [Zenodo](https://zenodo.org/) using the connected GitHub account.
3. Go to the GitHub integration page on Zenodo and flip the switch to ON for this repository.
4. When a new GitHub Release is created by the pipeline, Zenodo will automatically detect it and create a new record.
5. In Zenodo, navigate to "Uploads", find the new draft record, and verify the metadata.
6. Click **Publish** to mint the DOI.
