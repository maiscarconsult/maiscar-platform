# MAIS CAR — run-reel-now.ps1 (owner-approved single-shot, 2026-09-15 rev-2).
# The .bat wrapper (RUN-REEL-NOW.bat) invokes this. Handles ORDER:
#   1. TSC (packages\backend, tsconfig.json)
#   2. TESTS (packages\backend, vitest — non-fatal continue)
#   3. run-reel-and-publish-now.ps1 (health / render / gates / publish / insights)
# Every step's stdout+stderr is teed into a single timestamped log so the
# Cowork orchestrator can read it back from OneDrive.

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot   # scripts\  →  platform\
Set-Location $root

$cache = "packages\backend\.cache"
if (-not (Test-Path $cache)) { New-Item -ItemType Directory -Path $cache | Out-Null }
$ts = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$log = Join-Path $cache "run-reel-now-$ts.log"
"===== MAIS CAR RUN-REEL-NOW ($ts UTC) =====" | Tee-Object -FilePath $log

function Say($msg) { $msg | Tee-Object -FilePath $log -Append }

Say ""
Say "===== STEP 1: TSC (npx tsc --noEmit -p packages\backend\tsconfig.json) ====="
Push-Location "packages\backend"
& npx tsc --noEmit -p tsconfig.json 2>&1 | Tee-Object -FilePath "..\..\$log" -Append
$tscExit = $LASTEXITCODE
Pop-Location
if ($tscExit -ne 0) {
    Say ""
    Say "BLOCKER: TSC failed with exit $tscExit. NOT running the pipeline. NOT publishing."
    Say "The full TSC error list is above — the Cowork orchestrator will read this log and issue the fixes."
    Say "===== FINAL: TSC=FAIL PUBLISHED=NO ====="
    exit 3
}
Say "TSC: PASS"

Say ""
Say "===== STEP 2: TESTS (npm test in packages\backend) ====="
Push-Location "packages\backend"
& npm test --silent 2>&1 | Tee-Object -FilePath "..\..\$log" -Append
$testExit = $LASTEXITCODE
Pop-Location
if ($testExit -ne 0) {
    Say "TESTS: FAIL (exit $testExit) — continuing to render+gates because autonomousReelCycle.ts is the authoritative publish decision (its hard gates are the actual bar). Cowork will read this log and decide whether the test failures block acceptance."
} else {
    Say "TESTS: PASS"
}

Say ""
Say "===== STEP 3-8: HEALTH -> RENDER -> QA -> PUBLISH -> INSIGHTS ====="
Say "Delegating to scripts\run-reel-and-publish-now.ps1 (its own log at packages\backend\.cache\reel-run-*.log will ALSO be created; both are captured here)."
& powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\run-reel-and-publish-now.ps1" 2>&1 | Tee-Object -FilePath $log -Append
$psExit = $LASTEXITCODE

Say ""
Say "===== FINAL ====="
Say "run-reel-and-publish-now.ps1 exited $psExit."
Say ("If HARD_GATE_FAIL appears above, nothing was published (that is the safe path — hard gates in autonomousReelCycle.ts blocked the publish).")
Say ("If PUBLISHED: {...} appears above, the Reel is live — Cowork will parse mediaId/permalink from that line.")
Say ("Log path: $log")

exit $psExit
