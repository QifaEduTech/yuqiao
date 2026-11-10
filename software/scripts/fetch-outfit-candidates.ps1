param([switch]$Download)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$assetRoot = Join-Path $projectRoot 'assets/source-outfits'
New-Item -ItemType Directory -Force -Path $assetRoot | Out-Null
$repository = 'k3yg4n/glamcam-makehuman-clothing-assets'
$cache = Join-Path $assetRoot 'github-tree.json'
if (Test-Path -LiteralPath $cache) { $tree = Get-Content -Raw -LiteralPath $cache | ConvertFrom-Json }
else { $tree = Invoke-RestMethod "https://api.github.com/repos/$repository/git/trees/main?recursive=1" -TimeoutSec 45; $tree | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $cache -Encoding utf8 }
$folders = @('T-shirt_Basic_Tucked','Retro_top','M_Trousers_02')
$manifest = @()
foreach ($folder in $folders) {
  $destination = Join-Path $assetRoot $folder
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  $files = $tree.tree | Where-Object { $_.path.StartsWith("finalized_clothes/$folder/") -and $_.type -eq 'blob' -and $_.path -match '\.(mhclo|mhmat|thumb|obj|png)$' }
  foreach ($file in $files) {
    if (-not $Download -and $file.path -notmatch '\.(mhclo|mhmat|thumb)$') { continue }
    if ($file.size -gt 12582912) { throw "Asset exceeds 12 MiB review limit: $($file.path)" }
    $target = Join-Path $destination ([IO.Path]::GetFileName($file.path))
    if (-not (Test-Path -LiteralPath $target)) {
      $blob = Invoke-RestMethod "https://api.github.com/repos/$repository/git/blobs/$($file.sha)" -TimeoutSec 60
      if ($blob.encoding -ne 'base64') { throw 'Unexpected GitHub encoding' }
      $bytes = [Convert]::FromBase64String($blob.content)
      $header = [Text.Encoding]::UTF8.GetBytes("blob $($bytes.Length)`0")
      $sha = [Convert]::ToHexString([Security.Cryptography.SHA1]::HashData([byte[]]($header + $bytes))).ToLower()
      if ($sha -ne $file.sha) { throw "Git blob hash mismatch: $($file.path)" }
      [IO.File]::WriteAllBytes($target, $bytes)
    }
    $manifest += [ordered]@{path=$file.path;file="assets/source-outfits/$folder/$([IO.Path]::GetFileName($file.path))";bytes=(Get-Item -LiteralPath $target).Length;gitBlob=$file.sha;sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower()}
    if ($file.path -match '\.mhclo$') { Get-Content -LiteralPath $target -TotalCount 18 }
  }
}
[ordered]@{repository="https://github.com/$repository";tree=$tree.sha;downloadedAt=(Get-Date -Format 'yyyy-MM-dd');files=$manifest} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $assetRoot 'manifest.json') -Encoding utf8
Write-Output "Saved $($manifest.Count) files to $assetRoot"
