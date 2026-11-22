param([switch]$SkipFrontend)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $workspace
$cargoDirectory = Join-Path $env:USERPROFILE '.cargo/bin'
if (-not (Test-Path -LiteralPath (Join-Path $cargoDirectory 'cargo.exe'))) { throw 'Instala Rust/Cargo antes de compilar Windows.' }
$env:PATH = $cargoDirectory + [IO.Path]::PathSeparator + $env:PATH
$env:CARGO_BUILD_JOBS = '2'

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Faltan las herramientas de C++ de Visual Studio.' }
$buildTools = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $buildTools) { throw 'Falta el componente C++ x64 de Visual Studio.' }
$devShell = Join-Path $buildTools 'Common7/Tools/Launch-VsDevShell.ps1'
& $devShell -Arch amd64 -HostArch amd64 -SkipAutomaticLocation | Out-Null
Set-Location -LiteralPath $workspace

if (-not $SkipFrontend) {
  & pnpm.cmd build
  if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de la interfaz.' }
}
& node.exe scripts/build-windows.mjs
if ($LASTEXITCODE -ne 0) { throw 'Falló la preparación del paquete Windows.' }
& pnpm.cmd exec tauri build --target x86_64-pc-windows-msvc --bundles nsis
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación del instalador Windows.' }
& node.exe scripts/build-windows.mjs --verify
if ($LASTEXITCODE -ne 0) { throw 'El paquete cambió durante la compilación.' }

$config = Get-Content -LiteralPath src-tauri/tauri.conf.json -Raw -Encoding UTF8 | ConvertFrom-Json
$installerName = $config.productName + '_' + $config.version + '_x64-setup.exe'
$installer = Join-Path $workspace ('src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/' + $installerName)
$releaseDirectory = Join-Path $workspace 'dist/releases'
New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
$deliveryName = 'Repuestos-Felix-' + $config.version + '-windows-x64-setup.exe'
$delivery = Join-Path $releaseDirectory $deliveryName
Copy-Item -LiteralPath $installer -Destination $delivery
$hash = (Get-FileHash -LiteralPath $delivery -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $releaseDirectory 'SHA256.txt'), $hash + '  ' + $deliveryName + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Output ('Instalador: ' + $delivery)
Write-Output ('SHA-256: ' + $hash)
