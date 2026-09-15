# Registers the MAIS CAR autonomous daily publish routine (2026-09-09) as two
# Windows Task Scheduler triggers, spaced 10 hours apart across the day.
# Each run: packages/backend/daily-cycle-and-publish.ts (hard 2-posts/day cap,
# real gates, real publish only when everything passes - see that file).
#
# Run this script once (elevated PowerShell not required for a per-user task):
#   powershell -ExecutionPolicy Bypass -File register-content-pipeline-task.ps1
#
# To inspect: Get-ScheduledTask -TaskName "MaisCarDailyCycle*"
# To disable without deleting: Disable-ScheduledTask -TaskName "MaisCarDailyCycle-Morning"
# To remove entirely: Unregister-ScheduledTask -TaskName "MaisCarDailyCycle-Morning" -Confirm:$false

$BackendDir = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $BackendDir "packages\backend"
$NpxPath = "C:\Program Files\nodejs\npx.cmd"
$ScriptPath = Join-Path $BackendDir "daily-cycle-and-publish.ts"

function Register-DailyCycleTask {
  param([string]$Name, [string]$Time)
  $action = New-ScheduledTaskAction -Execute $NpxPath -Argument "tsx `"$ScriptPath`"" -WorkingDirectory $BackendDir
  $trigger = New-ScheduledTaskTrigger -Daily -At $Time
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
  Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Settings $settings -Description "MAIS CAR autonomous content cycle - real gates, real publish, 2/day cap enforced in-script" -Force | Out-Null
  Write-Host "Registered $Name at $Time"
}

Register-DailyCycleTask -Name "MaisCarDailyCycle-Morning" -Time "09:00"
Register-DailyCycleTask -Name "MaisCarDailyCycle-Evening" -Time "19:00"

# AUTO INSIGHTS (2026-09-10) — hourly snapshot check for +1h/+6h/+24h/+72h
# windows on published Reels (insightsSync.ts only acts on windows that are
# actually due, so hourly is just a check cadence, not 24 real API hits/day).
$InsightsScript = Join-Path $BackendDir "sync-insights.ts"
$insightsAction = New-ScheduledTaskAction -Execute $NpxPath -Argument "tsx `"$InsightsScript`"" -WorkingDirectory $BackendDir
$insightsTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$insightsSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "MaisCarInsightsSync" -Action $insightsAction -Trigger $insightsTrigger -Settings $insightsSettings -Description "MAIS CAR hourly Insights snapshot check (+1h/+6h/+24h/+72h)" -Force | Out-Null
Write-Host "Registered MaisCarInsightsSync (hourly)"

Write-Host "Done. Verify with: Get-ScheduledTask -TaskName MaisCar*"
