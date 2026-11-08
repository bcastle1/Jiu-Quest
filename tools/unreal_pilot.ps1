[CmdletBinding()]
param(
    [ValidateSet('Check', 'Import')][string]$Action = 'Check',
    [string]$EngineRoot = 'C:\Program Files\Epic Games\UE_5.8'
)

$ErrorActionPreference = 'Stop'
$jqRoot = Split-Path -Parent $PSScriptRoot
$jqProject = Join-Path $jqRoot 'unreal/JiuQuestCharacters/JiuQuestCharacters.uproject'
$jqImporter = Join-Path $jqRoot 'unreal/JiuQuestCharacters/Content/Python/import_pilot.py'
$jqEditor = Join-Path $EngineRoot 'Engine/Binaries/Win64/UnrealEditor-Cmd.exe'
$jqVersionFile = Join-Path $EngineRoot 'Engine/Build/Build.version'
$jqInstalled = (Test-Path -LiteralPath $jqEditor -PathType Leaf) -and (Test-Path -LiteralPath $jqVersionFile -PathType Leaf)
$jqVersion = if ($jqInstalled) { Get-Content -LiteralPath $jqVersionFile -Raw | ConvertFrom-Json } else { $null }
$jqCompatible = $jqInstalled -and $jqVersion.MajorVersion -eq 5 -and $jqVersion.MinorVersion -eq 8
$jqReport = [ordered]@{
    checkedAtUtc = [DateTime]::UtcNow.ToString('o')
    engineRoot = $EngineRoot
    engineInstalled = [bool]$jqInstalled
    expectedEngineVersion = '5.8'
    engineVersion = $(if ($jqInstalled) { '{0}.{1}.{2}' -f $jqVersion.MajorVersion, $jqVersion.MinorVersion, $jqVersion.PatchVersion } else { $null })
    compatibleVersion = [bool]$jqCompatible
    projectExists = Test-Path -LiteralPath $jqProject -PathType Leaf
    importerExists = Test-Path -LiteralPath $jqImporter -PathType Leaf
    importedAssetsValidated = $false
    renderedCharactersValidated = $false
    pixelStreamingValidated = $false
    status = $(if ($jqCompatible) { 'engine_available_import_and_render_not_yet_verified' } else { 'awaiting_matching_engine_installation' })
}

if ($Action -eq 'Check') {
    $jqReport | ConvertTo-Json -Depth 4
    exit 0
}
if (-not $jqCompatible) { throw 'Install Unreal Engine 5.8 through Epic Games Launcher, or pass -EngineRoot to its installed directory. No import was started.' }
if (-not $jqReport.projectExists -or -not $jqReport.importerExists) { throw 'The Unreal pilot project or importer is missing. No import was started.' }

Push-Location $jqRoot
try {
    & node tools/prepare_unreal_pilot.mjs --stage
    if ($LASTEXITCODE -ne 0) { throw 'Pilot staging failed. No Unreal process was started.' }
    $jqLogs = Join-Path $jqRoot 'tmp/unreal-pilot'
    New-Item -ItemType Directory -Path $jqLogs -Force | Out-Null
    $jqLog = Join-Path $jqLogs ('import-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.log')
    # ExecutePythonScript starts the full editor; the Python commandlet cannot
    # provide every level/editor subsystem used by the scene importer.
    $jqArguments = @(('"' + $jqProject + '"'), ('-ExecutePythonScript="' + $jqImporter + '"'), '-unattended', '-nop4', '-nosplash', ('-log="' + $jqLog + '"'))
    $jqProcess = Start-Process -FilePath $jqEditor -ArgumentList $jqArguments -WorkingDirectory $jqRoot -WindowStyle Hidden -PassThru
    [ordered]@{ status='import_started_not_validated'; processId=$jqProcess.Id; log=$jqLog; project=$jqProject } | ConvertTo-Json
} finally {
    Pop-Location
}
