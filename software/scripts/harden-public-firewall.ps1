[CmdletBinding(SupportsShouldProcess=$true)]
param(
  [switch]$EnablePublicProfile
)
$ErrorActionPreference='Stop'
$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Run this script from an Administrator PowerShell.' }
# MySQL and Ollama must never be reachable from the LAN or the public internet.
# The Web is exposed only through Nginx (8080/8443) and Cloudflare Tunnel.
foreach ($port in @(3306,11434)) {
  $name='Yuqiao block external '+$port
  if ($PSCmdlet.ShouldProcess($name,'Block inbound TCP')) {
    $existing=Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
    if ($existing) { Remove-NetFirewallRule -DisplayName $name }
    New-NetFirewallRule -DisplayName $name -Enabled True -Direction Inbound -Action Block -Protocol TCP -LocalPort $port -Profile Any -RemoteAddress Any | Out-Null
    Write-Output ('Blocked inbound TCP '+$port+'.')
  }
}
if ($EnablePublicProfile) {
  if ($PSCmdlet.ShouldProcess('Public firewall profile','Enable')) {
    Set-NetFirewallProfile -Profile Public -Enabled True
    Write-Output 'Public firewall profile enabled.'
  }
} elseif (-not (Get-NetFirewallProfile -Profile Public).Enabled) {
  Write-Warning 'Public firewall profile is disabled. The block rules above will not filter until it is enabled. Re-run with -EnablePublicProfile after checking other apps on this machine.'
}
