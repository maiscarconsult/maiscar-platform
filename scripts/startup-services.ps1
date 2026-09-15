# Brings the whole @mais.car autonomous pipeline back up after a reboot,
# without needing Claude Code or any manual step. Registered as a Windows
# Scheduled Task ("MaisCarStartupServices", trigger: at log on).

$logFile = "C:\Users\paula\AppData\Local\Temp\claude\startup-services.log"
"[$(Get-Date)] startup-services.ps1 running" | Out-File -Append $logFile

# 1. Docker Desktop (needed for Postgres/Redis containers)
$docker = Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
if (-not $docker) {
  Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  Start-Sleep -Seconds 45
}

# 2. Wait for the Docker engine to actually accept commands (Desktop can take
# a while to finish booting even after the process starts).
$dockerReady = $false
for ($i = 0; $i -lt 24; $i++) {
  docker ps *> $null
  if ($LASTEXITCODE -eq 0) { $dockerReady = $true; break }
  Start-Sleep -Seconds 5
}
"[$(Get-Date)] docker ready: $dockerReady" | Out-File -Append $logFile

Set-Location "C:\Users\paula\OneDrive\Desktop\claude automacao\content-intelligence-platform\platform"
docker compose up -d postgres redis *>> $logFile
Start-Sleep -Seconds 10

# 3. Backend API + worker (worker is what actually publishes scheduled posts)
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev:backend >> `"$logFile`" 2>&1" -WorkingDirectory "C:\Users\paula\OneDrive\Desktop\claude automacao\content-intelligence-platform\platform" -WindowStyle Hidden
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npx tsx watch src/jobs/worker.ts >> `"$logFile`" 2>&1" -WorkingDirectory "C:\Users\paula\OneDrive\Desktop\claude automacao\content-intelligence-platform\platform\packages\backend" -WindowStyle Hidden

"[$(Get-Date)] backend + worker launch attempted" | Out-File -Append $logFile
