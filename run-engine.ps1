$ErrorActionPreference = 'Stop'
$workspace = $PSScriptRoot
$installed = Join-Path $workspace 'engine\delta_engine.exe'
$staged = Join-Path $workspace 'build\delta_engine.exe'
if ((Test-Path -LiteralPath $staged) -and ((-not (Test-Path -LiteralPath $installed)) -or (Get-Item -LiteralPath $staged).LastWriteTimeUtc -gt (Get-Item -LiteralPath $installed).LastWriteTimeUtc)) {
    try { Copy-Item -LiteralPath $staged -Destination $installed -Force }
    catch { throw 'Close the running DeltaORL engine first; the updated executable is ready in build/delta_engine.exe.' }
}
if (-not (Test-Path -LiteralPath $installed)) { throw 'Run build.ps1 before starting the engine.' }
Push-Location (Split-Path -Parent $installed)
try { & $installed; exit $LASTEXITCODE }
finally { Pop-Location }
