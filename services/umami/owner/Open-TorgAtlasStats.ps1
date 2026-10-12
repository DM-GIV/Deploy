# Opens the private TorgAtlas Umami dashboard through an SSH tunnel. No passwords or secrets are stored here.
# Auth: your normal SSH key/agent (the alias below must already work: `ssh auction-core-v01 true`).
param(
  [string]$SshTarget = $(if ($env:TORGATLAS_SSH_TARGET) { $env:TORGATLAS_SSH_TARGET } else { 'auction-core-v01' }),
  [int]$LocalPort = 19120
)
$ErrorActionPreference = 'Stop'
$url = "http://127.0.0.1:$LocalPort/"

function Test-Port([int]$port) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $port); $c.Close(); return $true } catch { return $false }
}

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  Write-Host 'OpenSSH client not found. Enable "OpenSSH Client" in Windows Optional Features.' -ForegroundColor Red; Read-Host 'Press Enter'; exit 1
}
function Test-Umami([int]$port) {
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/heartbeat" -TimeoutSec 3 -ErrorAction Stop
    return $response.ok -eq $true
  } catch { return $false }
}

if (Test-Port $LocalPort) {
  if (-not (Test-Umami $LocalPort)) {
    Write-Host "Port $LocalPort is occupied by a service other than Umami (or the tunnel is unhealthy)." -ForegroundColor Red
    Read-Host 'Press Enter'; exit 1
  }
  Write-Host "Existing local Umami tunnel detected on port $LocalPort."
} else {
  $sshArgs = @('-N','-L',"127.0.0.1:${LocalPort}:127.0.0.1:19120",'-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3',$SshTarget)
  $p = Start-Process -FilePath 'ssh' -ArgumentList $sshArgs -PassThru -WindowStyle Minimized
  for ($i = 0; $i -lt 40 -and -not (Test-Port $LocalPort); $i++) {
    if ($p.HasExited) { Write-Host 'SSH tunnel failed to start. Check: ssh ' $SshTarget -ForegroundColor Red; Read-Host 'Press Enter'; exit 1 }
    Start-Sleep -Milliseconds 500
  }
  if (-not (Test-Port $LocalPort)) { Write-Host 'Tunnel did not come up in 20 s.' -ForegroundColor Red; Stop-Process -Id $p.Id -ErrorAction SilentlyContinue; Read-Host 'Press Enter'; exit 1 }
  if (-not (Test-Umami $LocalPort)) { Write-Host 'Tunnel endpoint is not a healthy Umami instance.' -ForegroundColor Red; Stop-Process -Id $p.Id -ErrorAction SilentlyContinue; Read-Host 'Press Enter'; exit 1 }
}
Start-Process $url
Write-Host "Dashboard: $url  (log in with your Umami admin account). Close the minimized ssh window to end the session."
