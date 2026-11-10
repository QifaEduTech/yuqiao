param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$rootPrefix = $projectRoot.TrimEnd('\') + '\'
function Resolve-ProjectPath([string]$relative) {
    $absolute = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
    if (-not $absolute.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Outside project: $absolute" }
    $cursor = $absolute
    while ($cursor -ne $projectRoot) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Reparse point: $cursor" }
        $cursor = Split-Path $cursor -Parent
    }
    return $absolute
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$candidates = @(
    @{ path='models/gpt-sovits/.runtime-dl/pretrained_models.zip'; destination='models/gpt-sovits/GPT_SoVITS'; prefix=''; replacement='' },
    @{ path='models/gpt-sovits/GPT_SoVITS/text/G2PWModel_1.1.zip'; destination='models/gpt-sovits/GPT_SoVITS/text'; prefix='G2PWModel_1.1/'; replacement='G2PWModel/' },
    @{ path='.runtime-logs/avatar-probe/base_female.zip'; destination='public/avatar-candidates'; prefix=''; replacement='' },
    @{ path='.runtime-logs/avatar-probe/avatarsample_e.zip'; destination='public/avatar-candidates'; prefix=''; replacement='' }
)
$report = [Collections.Generic.List[object]]::new()
foreach ($candidate in $candidates) {
    $path = Resolve-ProjectPath $candidate.path
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $zip = [IO.Compression.ZipFile]::OpenRead($path)
    $mismatches = @()
    try {
        foreach ($entry in $zip.Entries) {
            if (-not $entry.Name) { continue }
            $entryPath = $entry.FullName
            if ($candidate.prefix -and $entryPath.StartsWith($candidate.prefix)) { $entryPath = $candidate.replacement + $entryPath.Substring($candidate.prefix.Length) }
            $target = Resolve-ProjectPath (Join-Path $candidate.destination $entryPath)
            if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Get-Item -LiteralPath $target).Length -ne $entry.Length) { $mismatches += $entry.FullName }
        }
    } finally { $zip.Dispose() }
    $bytes = (Get-Item -LiteralPath $path).Length
    $status = if ($mismatches.Count) { 'kept-extraction-mismatch' } elseif ($Apply) { 'deleted' } else { 'eligible' }
    if ($status -eq 'deleted') { Remove-Item -LiteralPath $path -Force }
    $report.Add(@{path=$candidate.path; bytes=$bytes; status=$status; reason='Archive entries checked against extracted file paths and sizes'; mismatches=$mismatches})
}
$parts = Resolve-ProjectPath '.runtime-logs/asr-setup/onnx-parts'
if (Test-Path -LiteralPath $parts) {
    $model = Resolve-ProjectPath 'models/sensevoice-small-int8/model.int8.onnx'
    $expected = 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51'
    if ((Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'ASR model checksum mismatch: keep download parts' }
    $files = @(Get-ChildItem -LiteralPath $parts -File -Force)
    if (@($files | Where-Object { $_.Extension -ne '.part' }).Count -or @(Get-ChildItem -LiteralPath $parts -Directory -Force).Count) { throw 'Unexpected contents in ASR parts directory' }
    $bytes = ($files | Measure-Object Length -Sum).Sum
    if ($Apply) { Remove-Item -LiteralPath (Resolve-ProjectPath '.runtime-logs/asr-setup/onnx-parts') -Recurse -Force }
    $report.Add(@{path='.runtime-logs/asr-setup/onnx-parts';bytes=$bytes;status=$(if($Apply){'deleted'}else{'eligible'});reason='Installed ASR model SHA-256 matches source manifest'})
}
$deletedBytes = 0L
foreach ($entry in $report) { if ($entry.status -eq 'deleted') { $deletedBytes += $entry.bytes } }
$output = @{date='2026-10-14';applied=[bool]$Apply;items=@($report.ToArray());deletedBytes=$deletedBytes}
$output | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Resolve-ProjectPath 'docs/assets/cleanup-2026-10-14.json') -Encoding utf8
$output | ConvertTo-Json -Depth 6
