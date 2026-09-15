# Stops the MAIS CAR pipeline from auto-publishing and removes the
# 09:00/19:00 Windows Scheduled Tasks entirely.
#
# Usage:  powershell -ExecutionPolicy Bypass -File disable-autopublish.ps1

$FlagDir = Join-Path (Split-Path -Parent $PSScriptRoot) "packages\backend\.cache"
$FlagPath = Join-Path $FlagDir "autopublish.flag.json"
New-Item -ItemType Directory -Force -Path $FlagDir | Out-Null

$flag = @{ enabled = $false; disabledAt = (Get-Date).ToUniversalTime().ToString("o") } | ConvertTo-Json
Set-Content -Path $FlagPath -Value $flag -Encoding utf8

foreach ($taskName in @("MaisCarReel_0900", "MaisCarReel_1900")) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Scheduled task '$taskName' removed (if it existed)."
}

Write-Host "AUTO_PUBLISH disabled. No scheduled Reel jobs remain."
