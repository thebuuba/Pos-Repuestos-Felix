param([string]$Notes = '')
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $workspace

$config = Get-Content -LiteralPath src-tauri/tauri.conf.json -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $config.version
$tag = 'v' + $version
$releaseDir = Join-Path $workspace 'dist/releases'
$installer = Join-Path $releaseDir ('Repuestos-Felix-' + $version + '-windows-x64-setup.exe')
$sig = $installer + '.sig'
$latest = Join-Path $releaseDir 'latest.json'
$sha = Join-Path $releaseDir 'SHA256.txt'

foreach ($file in @($installer, $sig, $latest, $sha)) {
  if (-not (Test-Path -LiteralPath $file)) {
    throw ('Falta el artefacto de release: ' + $file + '. Ejecuta primero pnpm build:windows.')
  }
}

if (-not $Notes) {
  $Notes = 'Repuestos Félix POS ' + $tag + ' para Windows (con actualización automática firmada).'
}

$exists = $false
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& gh release view $tag *> $null
if ($LASTEXITCODE -eq 0) { $exists = $true }
$ErrorActionPreference = $prevEap

if ($exists) {
  & gh release upload $tag $installer $sig $latest $sha --clobber
  if ($LASTEXITCODE -ne 0) { throw 'No se pudieron subir los archivos del release existente.' }
} else {
  & gh release create $tag $installer $sig $latest $sha --title ('Repuestos Félix ' + $tag) --notes $Notes --latest
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el release en GitHub.' }
}

Write-Output ('Release publicado en GitHub: ' + $tag)
