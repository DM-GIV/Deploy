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
if (Test-Port $LocalPort) {
  Write-Host "Port $LocalPort already in use - assuming the tunnel is open."
} else {
  $sshArgs = @('-N','-L',"127.0.0.1:${LocalPort}:127.0.0.1:19120",'-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3',$SshTarget)
  $p = Start-Process -FilePath 'ssh' -ArgumentList $sshArgs -PassThru -WindowStyle Minimized
  for ($i = 0; $i -lt 40 -and -not (Test-Port $LocalPort); $i++) {
    if ($p.HasExited) { Write-Host 'SSH tunnel failed to start. Check: ssh ' $SshTarget -ForegroundColor Red; Read-Host 'Press Enter'; exit 1 }
    Start-Sleep -Milliseconds 500
  }
  if (-not (Test-Port $LocalPort)) { Write-Host 'Tunnel did not come up in 20 s.' -ForegroundColor Red; Stop-Process -Id $p.Id -ErrorAction SilentlyContinue; Read-Host 'Press Enter'; exit 1 }
}
Start-Process $url
Write-Host "Dashboard: $url  (log in with your Umami admin account). Close the minimized ssh window to end the session."
