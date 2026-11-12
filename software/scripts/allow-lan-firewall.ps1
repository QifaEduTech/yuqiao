[CmdletBinding(SupportsShouldProcess=$true)]
param(
  [int[]]$Ports=@(8443,8080),
  [ValidateSet('Private','Public','Domain')][string[]]$Profile=@('Private','Public')
)
$ErrorActionPreference='Stop'
$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Run this script from an Administrator PowerShell. It only opens the selected ports to the local subnet.' }
foreach ($profileName in $Profile) {
  $state=Get-NetFirewallProfile -Profile $profileName
  if (-not $state.Enabled) { Write-Warning ("Firewall profile {0} is disabled. The rule will be created but will not filter until the profile is enabled." -f $profileName) }
}
foreach ($port in $Ports) {
  $name='Yuqiao LAN TCP '+$port
  if ($PSCmdlet.ShouldProcess($name,'Allow inbound TCP from LocalSubnet')) {
    $existing=Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
    if ($existing) { Remove-NetFirewallRule -DisplayName $name }
    New-NetFirewallRule -DisplayName $name -Enabled True -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile $Profile -RemoteAddress LocalSubnet | Out-Null
    Write-Output ('Allowed inbound TCP '+$port+' from LocalSubnet on '+($Profile -join ',')+'.')
  }
}
