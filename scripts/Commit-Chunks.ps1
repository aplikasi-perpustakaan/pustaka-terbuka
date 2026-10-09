param(
    [switch]$NoPush = $false
)

$ErrorActionPreference = "Stop"

# Remaining 31 Crockford Base32 prefixes (0 is already committed and pushed)
$prefixes = @(
    '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
    'j', 'k', 'm', 'n', 'p', 'q', 'r', 's',
    't', 'v', 'w', 'x', 'y', 'z'
)

$total = $prefixes.Count
$idx = 0

foreach ($char in $prefixes) {
    $idx++
    Write-Host "[$idx/$total] Staging shard $char*..."
    git add "data/bib/$char*"
    
    $status = git status --porcelain "data/bib/$char*"
    if ($status) {
        Write-Host "[$idx/$total] Committing shard $char*..."
        git commit -m "data: catalog shard $char"
        
        if (-not $NoPush) {
            Write-Host "[$idx/$total] Pushing shard $char* to origin main..."
            git push origin main
        }
    } else {
        Write-Host "[$idx/$total] Shard $char* has no uncommitted changes."
    }
}

Write-Host "Staging aliases and manifest metadata..."
git add data/aliases.jsonl data/bib/manifest.json
$metaStatus = git status --porcelain data/aliases.jsonl data/bib/manifest.json
if ($metaStatus) {
    Write-Host "Committing metadata..."
    git commit -m "data: update aliases and bib manifest for full 422k catalog"
    if (-not $NoPush) {
        Write-Host "Pushing metadata to origin main..."
        git push origin main
    }
}

Write-Host "All shards and metadata committed and pushed to origin main successfully!"
