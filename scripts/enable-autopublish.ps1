# Run this ONCE, on your own machine, when YOU decide the MAIS CAR pipeline
# should publish Reels automatically at 09:00/19:00 without further review.
# Claude never runs this script for you — publishing unattended to a real
# public account is a standing decision only you can make.
#
# This does two things: (1) flips the autopublish.flag.json the pipeline
# itself checks before ever calling media_publish, and (2) registers two
# Windows Scheduled Tasks that run the full cycle unattended — no Claude
# Code session needs to be open for these to fire.
#
# Usage:  powershell -ExecutionPolicy Bypass -File enable-autopublish.ps1

$BackendDir = Join-Path (Split-Path -Parent $PSScriptRoot) "packages\backend"
$FlagDir = Join-Path $BackendDir ".cache"
$FlagPath = Join-Path $FlagDir "autopublish.flag.json"
New-Item -ItemType Directory -Force -Path $FlagDir | Out-Null

$flag = @{
  enabled   = $true
  enabledAt = (Get-Date).ToUniversalTime().ToString("o")
  enabledBy = $env:USERNAME
} | ConvertTo-Json

Set-Content -Path $FlagPath -Value $flag -Encoding utf8

$NpxPath = (Get-Command npx.cmd -ErrorAction SilentlyContinue).Source
if (-not $NpxPath) { $NpxPath = (Get-Command npx -ErrorAction SilentlyContinue).Source }
if (-not $NpxPath) { throw "npx not found on PATH — install Node.js before enabling autopublish." }

$Action = New-ScheduledTaskAction -Execute $NpxPath -Argument "tsx scripts/autonomousReelCycle.ts" -WorkingDirectory $BackendDir

foreach ($job in @(@{Name = "MaisCarReel_0900"; Time = "09:00"}, @{Name = "MaisCarReel_1900"; Time = "19:00"})) {
  Unregister-ScheduledTask -TaskName $job.Name -Confirm:$false -ErrorAction SilentlyContinue
  $trigger = New-ScheduledTaskTrigger -Daily -At $job.Time
  Register-ScheduledTask -TaskName $job.Name -Action $Action -Trigger $trigger -Description "MAIS CAR autonomous Reel cycle ($($job.Time) daily) — MAISCAR_FULL_AUTONOMOUS_AVATAR_REEL_MASTER" | Out-Null
  Write-Host "Scheduled task '$($job.Name)' registered for $($job.Time) daily."
}

Write-Host "AUTO_PUBLISH enabled. The 09:00/19:00 scheduled tasks will now publish automatically when every gate passes."
Write-Host "Run disable-autopublish.ps1 at any time to stop this."
