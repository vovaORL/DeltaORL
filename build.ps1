param([switch]$EngineOnly, [switch]$UiOnly, [switch]$Test, [switch]$StageOnly)
$ErrorActionPreference = 'Stop'
$workspace = $PSScriptRoot
$outputDirectory = Join-Path $workspace 'build'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
Push-Location $workspace
try {
    if (-not $UiOnly) {
        $compilerCommand = Get-Command g++.exe -ErrorAction SilentlyContinue
        $compiler = if ($compilerCommand) { $compilerCommand.Source } else { 'C:\msys64\ucrt64\bin\g++.exe' }
        if (-not (Test-Path -LiteralPath $compiler)) { throw 'Install MSYS2 UCRT64 GCC or use engine/CMakeLists.txt with MSVC.' }
        $sourceFiles = @(Get-ChildItem -LiteralPath (Join-Path $workspace 'engine\src') -Filter '*.cpp' | ForEach-Object { $_.FullName })
        $compilerArguments = @('-std=c++20', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-DNOMINMAX', '-DWIN32_LEAN_AND_MEAN', '-Iengine/include')
        & $compiler @compilerArguments @sourceFiles '-o' 'build/delta_engine.exe' '-lws2_32' '-lcrypt32' '-static'
        if ($LASTEXITCODE -ne 0) { throw 'C++ build failed.' }
        if ($Test) {
            & $compiler @compilerArguments 'engine/tests/engine_tests.cpp' 'engine/src/ClusterAggregator.cpp' 'engine/src/MT5FileReader.cpp' '-o' 'build/engine_tests.exe' '-static'
            if ($LASTEXITCODE -ne 0) { throw 'C++ test build failed.' }
            Push-Location $outputDirectory
            try { & '.\engine_tests.exe'; if ($LASTEXITCODE -ne 0) { throw 'C++ tests failed.' } }
            finally { Pop-Location }
        }
        if (-not $StageOnly) {
            try { Copy-Item -LiteralPath (Join-Path $outputDirectory 'delta_engine.exe') -Destination (Join-Path $workspace 'engine\delta_engine.exe') -Force }
            catch { throw 'Close the running DeltaORL engine and retry; the executable could not be replaced. The new build is ready in build/delta_engine.exe.' }
        }
    }
    if (-not $EngineOnly) {
        Push-Location (Join-Path $workspace 'ui')
        try {
            if (-not (Test-Path -LiteralPath 'node_modules\typescript')) { throw 'Run npm.cmd ci in ui first.' }
            & npm.cmd run build
            if ($LASTEXITCODE -ne 0) { throw 'UI build failed.' }
            if ($Test) { & npm.cmd test; if ($LASTEXITCODE -ne 0) { throw 'UI tests failed.' } }
        } finally { Pop-Location }
    }
} finally { Pop-Location }
