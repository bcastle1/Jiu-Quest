param(
    [string]$UnityEditor,
    [switch]$TestOnly,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$projectPath = Join-Path $repoRoot 'unity\JiuQuestCombat'
$evidencePath = Join-Path $repoRoot 'tmp\unity'
New-Item -ItemType Directory -Path $evidencePath -Force | Out-Null

if (-not $UnityEditor) {
    $candidates = @(
        'C:\Unity\6000.3.28f1\Editor\Unity.exe',
        (Join-Path $env:LOCALAPPDATA 'Unity\Editors\6000.3.28f1\6000.3.28f1\Editor\Unity.exe'),
        (Join-Path $env:LOCALAPPDATA 'Unity\Editors\6000.3.28f1\Editor\Unity.exe'),
        'C:\Program Files\Unity\Hub\Editor\6000.3.28f1\Editor\Unity.exe'
    )
    $UnityEditor = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $UnityEditor -or -not (Test-Path -LiteralPath $UnityEditor -PathType Leaf)) {
    throw 'Unity 6000.3.28f1 was not found. Supply -UnityEditor with its full executable path.'
}
$version = (Get-Item -LiteralPath $UnityEditor).VersionInfo.ProductVersion
if ($version -notlike '6000.3.28f1*') {
    throw "This preview is pinned to Unity 6000.3.28f1; selected editor reports $version."
}

$logPath = Join-Path $evidencePath $(if ($TestOnly) { 'editmode.log' } else { 'web-build.log' })
$arguments = @('-batchmode', '-nographics', '-projectPath', $projectPath, '-logFile', $logPath)
if ($TestOnly) {
    $testResults = Join-Path $evidencePath 'editmode-results.xml'
    $arguments += @('-runTests', '-testPlatform', 'EditMode', '-testResults', $testResults)
} else {
    if (-not $OutputPath) { $OutputPath = Join-Path $repoRoot 'public\unity' }
    $OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
    $nodeExecutable = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    # Select WebGL at startup so Unity references its platform-only assemblies.
    # Passing only BuildPlayerOptions.target after a standalone import is insufficient.
    $arguments += @('-buildTarget', 'WebGL', '-quit', '-executeMethod', 'JiuQuest.Combat.Editor.CombatPreviewBuild.BuildWebGL', '-jiuquestOutput', $OutputPath, '-jiuquestNode', $nodeExecutable)
}

# ArgumentList passes each path literally, including paths containing spaces.
$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $UnityEditor
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
foreach ($argument in $arguments) { $startInfo.ArgumentList.Add($argument) }
$process = [System.Diagnostics.Process]::Start($startInfo)
Write-Output "Unity PID $($process.Id). Log: $logPath"
$process.WaitForExit()
if ($process.ExitCode -ne 0) {
    $reason = if ($process.ExitCode -eq 198) { ' Activate an eligible Unity Editor license before retrying.' } else { '' }
    throw "Unity exited with code $($process.ExitCode). Inspect $logPath.$reason"
}

if ($TestOnly) {
    if (-not (Test-Path -LiteralPath $testResults)) { throw "Unity produced no test results. Inspect $logPath." }
    [xml]$results = Get-Content -LiteralPath $testResults -Raw
    if ($results.'test-run'.result -ne 'Passed' -or [int]$results.'test-run'.total -lt 1) {
        throw "Unity tests did not pass. Inspect $testResults."
    }
    Write-Output "Unity EditMode tests passed. Results: $testResults"
} else {
    $manifestPath = Join-Path $OutputPath 'build-manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Unity produced no build manifest. Inspect $logPath." }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    foreach ($key in @('loaderUrl', 'dataUrl', 'frameworkUrl', 'codeUrl')) {
        if (-not $manifest.$key) { throw "Build manifest is missing $key." }
    }
    foreach ($key in @('dataUrl', 'frameworkUrl', 'codeUrl')) {
        if ($manifest.$key -notlike '*.unityweb') { throw "Build is missing static-host decompression fallback: $key." }
    }
    & $nodeExecutable (Join-Path $repoRoot 'tools\unity_release.mjs') verify-snapshot --output (Join-Path $OutputPath 'build-source.json')
    if ($LASTEXITCODE -ne 0) { throw 'The Unity build source fingerprint does not match this checkout.' }
    Write-Output "Unity Web build complete: $manifestPath"
}
