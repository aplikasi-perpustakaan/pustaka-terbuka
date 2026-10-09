<#
.SYNOPSIS
    Publishes the PustakaTerbuka catalog.
.DESCRIPTION
    Automated pipeline to harvest, validate, merge, build, and publish the catalog.
#>
[CmdletBinding()]
param (
    [switch]$WhatIf,
    [switch]$SkipHarvest,
    [switch]$SkipPublish,
    [switch]$Force,
    [string]$Message = "Automated publish"
)

$ErrorActionPreference = "Stop"

# If Force is not provided, make WhatIf default
if (-not $Force -and -not $WhatIf) {
    Write-Host "WARNING: -Force not specified. Defaulting to -WhatIf mode." -ForegroundColor Yellow
    $WhatIf = $true
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmm"
$LogFile = "logs/publish-$Timestamp.log"

if (-not (Test-Path "logs")) {
    New-Item -ItemType Directory -Path "logs" -Force | Out-Null
}

function Write-Log {
    param ([string]$Msg)
    $Formatted = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Msg"
    Write-Host $Formatted
    Add-Content -Path $LogFile -Value $Formatted
}

Write-Log "Starting Publish-Catalog pipeline..."
Write-Log "WhatIf: $WhatIf, SkipHarvest: $SkipHarvest, SkipPublish: $SkipPublish, Force: $Force"

# Handle core.longpaths
Write-Log "Configuring git core.longpaths..."
git config core.longpaths true

# Step 1: Load config/config.json
if (-not (Test-Path "config/config.json")) {
    Write-Log "ERROR: config/config.json not found."
    Write-Log "Please copy config/config.example.json to config/config.json and configure it."
    exit 1
} else {
    Write-Log "Config loaded."
}

function Invoke-GateCommand {
    param ([string]$Command)
    Write-Log "Executing: $Command"
    
    # We use cmd.exe /c for robust execution of npm scripts on Windows
    # to accurately capture the exit code.
    cmd.exe /c $Command
    $ExitCode = $LASTEXITCODE
    
    if ($ExitCode -ne 0) {
        Write-Log "ERROR: Command failed with exit code $ExitCode : $Command"
        exit 1
    }
}

# Step 2: Harvest
if (-not $SkipHarvest) {
    if (Test-Path "harvest/config.json") {
        Write-Log "Harvesting sources from harvest/config.json..."
        try {
            $HarvestConfig = Get-Content "harvest/config.json" -Raw | ConvertFrom-Json
            # Accommodate arrays or wrapper objects
            $Harvesters = @()
            if ($HarvestConfig -is [array]) {
                $Harvesters = $HarvestConfig
            } elseif ($null -ne $HarvestConfig.sources) {
                $Harvesters = $HarvestConfig.sources
            } elseif ($null -ne $HarvestConfig.harvesters) {
                $Harvesters = $HarvestConfig.harvesters
            } else {
                $Harvesters = @($HarvestConfig)
            }
            
            foreach ($Source in $Harvesters) {
                if ($Source.enabled) {
                    Write-Log "Harvesting: $($Source.name)"
                    Invoke-GateCommand $Source.command
                }
            }
        } catch {
            Write-Log "ERROR: Failed to parse harvest/config.json: $_"
            exit 1
        }
    } else {
        Write-Log "No harvest/config.json found, skipping harvest."
    }
} else {
    Write-Log "Skipping harvest phase."
}

# Steps 3-7: Enforce Gates
Write-Log "Validating and merging inbox..."
$Sources = Get-ChildItem -Path "harvest/inbox" -Directory
foreach ($Source in $Sources) {
    $Runs = Get-ChildItem -Path $Source.FullName -Directory
    foreach ($Run in $Runs) {
        $ManifestFile = Join-Path -Path $Run.FullName -ChildPath "manifest.json"
        if (Test-Path $ManifestFile) {
            Invoke-GateCommand "npm run validate-inbox -- `"$($Run.FullName)`""
            Invoke-GateCommand "npm run merge -- `"$($Run.FullName)`""
        }
    }
}

Write-Log "Validating holdings..."
Invoke-GateCommand "npm run validate-holdings"

Write-Log "Building catalog..."
Invoke-GateCommand "npm run build"

Write-Log "Running tests..."
Invoke-GateCommand "npm test"

# Step 9: Git Commit (Source data)
if ($WhatIf) {
    Write-Log "[WhatIf] Would run: git add data/"
    Write-Log "[WhatIf] Would run: git commit -m `"Publish: $Message`""
} else {
    Write-Log "Committing data..."
    git add data/
    $status = git status --porcelain data/
    if ($status) {
        git commit -m "Publish: $Message"
        if ($LASTEXITCODE -ne 0) {
            Write-Log "ERROR: git commit failed."
            exit 1
        }
    } else {
        Write-Log "No changes in data/ to commit."
    }
}

# Step 10: Git Tag
$TagName = "catalog-$Timestamp"
if ($WhatIf) {
    Write-Log "[WhatIf] Would run: git tag -a $TagName -m `"Catalog release $TagName`""
    Write-Log "[WhatIf] Would run: git push origin main"
    Write-Log "[WhatIf] Would run: git push origin $TagName"
} else {
    Write-Log "Tagging release $TagName..."
    git tag -a $TagName -m "Catalog release $TagName"
    Write-Log "Pushing main and tag to origin..."
    git push origin main
    git push origin $TagName
}

# Step 11: Publish to gh-pages
if ($SkipPublish) {
    Write-Log "Skipping publish to gh-pages (-SkipPublish)."
} elseif ($WhatIf) {
    Write-Log "[WhatIf] Would checkout orphan branch gh-pages, commit dist/, and force-push."
    Write-Log "Publishing to gh-pages branch..."
    $RemoteUrl = git config --get remote.origin.url
    $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "pustakaterbuka-ghpages-$Timestamp"
    if (Test-Path $TempDir) {
        Remove-Item -Path $TempDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

    if (Test-Path "dist") {
        Copy-Item -Path "dist\*" -Destination $TempDir -Recurse -Force
        git -C $TempDir init -b gh-pages
        $userName = git config user.name
        $userEmail = git config user.email
        if ($userName) { git -C $TempDir config user.name $userName }
        if ($userEmail) { git -C $TempDir config user.email $userEmail }
        git -C $TempDir add -A
        git -C $TempDir commit -m "Deploy gh-pages for $TagName"
        git -C $TempDir remote add origin $RemoteUrl
        Write-Log "Force-pushing to gh-pages..."
        git -C $TempDir push origin gh-pages --force
        Remove-Item -Path $TempDir -Recurse -Force
        Write-Log "Successfully published to gh-pages branch."
    } else {
        Write-Log "WARNING: dist/ folder not found. Skipping gh-pages push."
    }
}

# Step 12: Upload dumps
if ($SkipPublish) {
    Write-Log "Skipping upload dumps (-SkipPublish)."
} elseif ($WhatIf) {
    Write-Log "[WhatIf] Would run: gh release create $TagName dumps/*"
} else {
    if (Test-Path "dumps") {
        $Files = Get-ChildItem "dumps\*" -File
        if ($Files.Count -gt 0) {
            Write-Log "Uploading dumps via gh release..."
            Invoke-GateCommand "gh release create $TagName dumps/* --title `"Catalog $Timestamp`" --notes `"$Message`""
        } else {
            Write-Log "dumps/ folder is empty."
        }
    } else {
        Write-Log "No dumps/ folder found to upload."
    }
}

Write-Log "Publish-Catalog pipeline complete."
exit 0
