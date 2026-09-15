# MAIS CAR — run-reel-and-publish-now.ps1 (owner-approved single-shot, 2026-09-15).
# One command: HEALTH CHECK -> HEAD WRITER -> FACT CHECK -> REEL -> QA
#              -> MEDIA BRIDGE -> META -> PUBLISH -> INSIGHTS registration.
# Never flips the standing scheduler (enable-autopublish.ps1 stays untouched).
# The flag is enabled just for this run and reset in a finally{} block so a
# crash mid-pipeline still leaves the standing config as-is.
#
# Usage (from platform\ root):
#   powershell -ExecutionPolicy Bypass -File .\scripts\run-reel-and-publish-now.ps1
#
# Requires: Docker Desktop, gh CLI already device-code-authenticated, the
# social_account row for @mais.car with a valid encrypted Instagram-Login
# token in Postgres, PEXELS_API_KEY in .env, and the media-bridge repo
# maiscarconsult/maiscar-media-bridge existing and empty.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$flag = "packages/backend/.cache/autopublish.flag.json"
$flagBackup = "packages/backend/.cache/autopublish.flag.json.bak"

function Write-Section($title) {
    Write-Host ""
    Write-Host "===== $title =====" -ForegroundColor Cyan
}

function Fail($msg) {
    Write-Host "BLOCKER: $msg" -ForegroundColor Red
    exit 1
}

Write-Section "HEALTH CHECK"

# gh
try {
    $ghStatus = & gh auth status 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "gh CLI not authenticated. Run: gh auth login" }
    Write-Host "gh: OK"
} catch { Fail "gh CLI not installed or not on PATH" }

# Docker Desktop / Postgres
try {
    & docker ps > $null 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Docker Desktop not responding. Trying to bring it up (non-destructive)..." -ForegroundColor Yellow
        $ddExe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
        if (Test-Path $ddExe) {
            Start-Process -FilePath $ddExe
            # Poll for up to 90s
            for ($i = 0; $i -lt 18; $i++) {
                Start-Sleep -Seconds 5
                & docker ps > $null 2>&1
                if ($LASTEXITCODE -eq 0) { break }
            }
        }
    }
    & docker ps > $null 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "Docker Desktop is unreachable. Start it manually and re-run." }
    Write-Host "docker: OK"
} catch { Fail "docker command failed" }

try {
    & docker compose up -d postgres redis 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "docker compose up postgres/redis failed" }
    Write-Host "postgres/redis: UP"
} catch { Fail "docker compose command failed" }

# Wait for postgres to accept connections (OneDrive-volume fsync can take
# 2-3 min after a Windows restart per STATUS.md).
Write-Host "Waiting for postgres to accept connections..."
$pgReady = $false
for ($i = 0; $i -lt 60; $i++) {
    & docker exec $(docker compose ps -q postgres) pg_isready -q 2>$null
    if ($LASTEXITCODE -eq 0) { $pgReady = $true; break }
    Start-Sleep -Seconds 3
}
if (-not $pgReady) { Fail "postgres never became ready (waited 180s). Check Docker Desktop / OneDrive fsync." }
Write-Host "postgres: READY"

# .env sanity
$env_content = Get-Content .env -Raw
if ($env_content -notmatch "PEXELS_API_KEY=[^`n]{5,}") { Fail "PEXELS_API_KEY missing/short in .env" }
if ($env_content -notmatch "META_APP_ID=[^`n]{5,}")   { Fail "META_APP_ID missing in .env" }
Write-Host ".env: OK"

Write-Section "AUTOPUBLISH FLAG (single-shot)"

if (Test-Path $flag) { Copy-Item $flag $flagBackup -Force }

$onceFlag = @{
    enabled    = $true
    enabledAt  = (Get-Date).ToUniversalTime().ToString("o")
    enabledBy  = "vitor-oneshot-run-reel-and-publish-now.ps1"
    scheduled  = $false
} | ConvertTo-Json
Set-Content -Path $flag -Value $onceFlag -Encoding UTF8
Write-Host "flag: enabled for this run"

$permalink = ""
$mediaId   = ""
$publishedLine = ""

try {
    Write-Section "PIPELINE"
    # autonomousReelCycle.ts prints a JSON dump of the pilot result, then
    # either "AUTO_PUBLISH_DISABLED — ..." (won't happen — flag is on) or
    # "PUBLISHED: {mediaId, permalink}". We capture the full stdout and
    # parse the PUBLISHED line at the end.
    $log = "packages/backend/.cache/reel-run-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')).log"
    Write-Host "Running: npx tsx packages/backend/scripts/autonomousReelCycle.ts"
    Write-Host "Streaming output (also saved to $log)..."
    & npx tsx packages/backend/scripts/autonomousReelCycle.ts 2>&1 | Tee-Object -FilePath $log
    if ($LASTEXITCODE -ne 0) {
        Fail "pipeline exited $LASTEXITCODE — see $log"
    }

    $lines = Get-Content $log
    $publishedLine = ($lines | Where-Object { $_ -match "^PUBLISHED:\s*\{" } | Select-Object -Last 1)
    if (-not $publishedLine) { Fail "no PUBLISHED line in pipeline output — QA gate probably failed, see $log" }
    Write-Host ""
    Write-Host $publishedLine -ForegroundColor Green

    if ($publishedLine -match '"mediaId":"([^"]+)"')   { $mediaId   = $Matches[1] }
    if ($publishedLine -match '"permalink":"([^"]+)"') { $permalink = $Matches[1] }
}
finally {
    Write-Section "AUTOPUBLISH FLAG (restore)"
    if (Test-Path $flagBackup) {
        Move-Item $flagBackup $flag -Force
    } else {
        Set-Content -Path $flag -Value '{"enabled":false}' -Encoding UTF8
    }
    Write-Host "flag: restored to standing config"
}

Write-Section "REGISTER + INSIGHTS"

if ($mediaId) {
    # sync-insights.ts is the hourly runner. Firing it once now writes the
    # +0 snapshot for the just-published mediaId immediately; the hourly
    # scheduler picks it up thereafter for +1h/+6h/+24h/+72h.
    & npx tsx packages/backend/scripts/sync-insights.ts 2>&1 | Tee-Object -FilePath "packages/backend/.cache/insights-first-snapshot.log"
    Write-Host "insights: initial snapshot triggered"
}

Write-Section "RESULT"
Write-Host ("PERMALINK: {0}" -f (if ($permalink) { $permalink } else { "(missing — check Graph API response)" })) -ForegroundColor Green
Write-Host ("MEDIA_ID:  {0}" -f $mediaId)
Write-Host "Paste PUBLISHED line back into the Cowork session so it can log the editorial metadata."
