[CmdletBinding()]
param(
    [ValidateSet('Check', 'Import', 'Capture', 'Preview')][string]$Action = 'Check',
    [string]$EngineRoot = 'C:\Program Files\Epic Games\UE_5.8',
    [ValidateSet('standing_stance', 'rear_naked_choke', 'armbar')][string]$Clip = 'standing_stance',
    [switch]$StreamLocal
)

$ErrorActionPreference = 'Stop'

function Assert-JqCharacterRecipes {
    param($ImportedClip, [string]$RecipeDirectory)
    $jqExpectedRecipes = @('import_pilot.py', 'pilot_source.py', 'ready_hands.py', 'pilot_look.py', 'pilot_hair.py', 'pilot_hair_shape.py')
    if ($null -eq $ImportedClip.characterRefinement -or $null -eq $ImportedClip.characterRefinement.recipeFiles) {
        throw 'The character refinement inventory is missing. Import again before previewing or capturing.'
    }
    $jqRecipeProperties = @($ImportedClip.characterRefinement.recipeFiles.PSObject.Properties)
    $jqRecipeNames = @($jqRecipeProperties | ForEach-Object Name)
    if ($jqRecipeProperties.Count -ne $jqExpectedRecipes.Count -or
        @(Compare-Object -ReferenceObject $jqExpectedRecipes -DifferenceObject $jqRecipeNames -CaseSensitive).Count -ne 0) {
        throw 'The character recipe inventory is incomplete or changed. Import again before previewing or capturing.'
    }
    foreach ($jqRecipe in $jqRecipeProperties) {
        if ($jqRecipe.Value -isnot [string] -or $jqRecipe.Value -cnotmatch '^[0-9a-f]{64}$') {
            throw 'Invalid imported character recipe hash.'
        }
        $jqRecipePath = Join-Path $RecipeDirectory $jqRecipe.Name
        if ((Get-FileHash -LiteralPath $jqRecipePath -Algorithm SHA256).Hash -ne $jqRecipe.Value) {
            throw 'The character refinement has changed since import. Import again before previewing or capturing.'
        }
    }
}

$jqRoot = Split-Path -Parent $PSScriptRoot
$jqProject = Join-Path $jqRoot 'unreal/JiuQuestCharacters/JiuQuestCharacters.uproject'
$jqImporter = Join-Path $jqRoot 'unreal/JiuQuestCharacters/Content/Python/import_pilot.py'
$jqCapture = Join-Path $jqRoot 'unreal/JiuQuestCharacters/Content/Python/capture_pilot.py'
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
    captureScriptExists = Test-Path -LiteralPath $jqCapture -PathType Leaf
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
if (-not $jqReport.projectExists) { throw 'The Unreal pilot project is missing. No Editor process was started.' }
$jqScript = if ($Action -eq 'Import') { $jqImporter } else { $jqCapture }
if (-not (Test-Path -LiteralPath $jqScript -PathType Leaf)) { throw 'The requested Unreal Editor script is missing. No process was started.' }
if ($StreamLocal -and $Action -ne 'Preview') { throw 'StreamLocal is supported only by Preview.' }
if ($Action -in @('Capture', 'Preview')) {
    $jqImportReport = Join-Path $jqRoot 'unreal/JiuQuestCharacters/Saved/PilotReview/editor-import.json'
    if (-not (Test-Path -LiteralPath $jqImportReport -PathType Leaf)) { throw 'Import the character pilot before capturing it.' }
    $jqImported = Get-Content -LiteralPath $jqImportReport -Raw | ConvertFrom-Json
    if ($jqImported.status -ne 'editor_import_completed_visual_validation_pending') { throw 'The previous character import did not complete. No capture was started.' }
    $jqVerifiedText = & node (Join-Path $jqRoot 'tools/prepare_unreal_pilot.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Original character source verification failed. No preview or capture was started.' }
    $jqVerified = ($jqVerifiedText -join [Environment]::NewLine) | ConvertFrom-Json
    if ($jqImported.baselineCommit -ne $jqVerified.baselineCommit -or $jqImported.sourceFingerprint -ne $jqVerified.fingerprint) {
        throw 'The imported characters do not match the current pinned sources. Import again before previewing or capturing.'
    }
    foreach ($jqImportedClip in $jqImported.clips) {
        Assert-JqCharacterRecipes -ImportedClip $jqImportedClip -RecipeDirectory (Join-Path $jqRoot 'unreal/JiuQuestCharacters/Content/Python')
    }
}

Push-Location $jqRoot
try {
    if ($Action -eq 'Import') {
        & node tools/prepare_unreal_pilot.mjs --stage
        if ($LASTEXITCODE -ne 0) { throw 'Pilot staging failed. No Unreal process was started.' }
    }
    $jqLogs = Join-Path $jqRoot 'tmp/unreal-pilot'
    New-Item -ItemType Directory -Path $jqLogs -Force | Out-Null
    $jqLog = Join-Path $jqLogs ($Action.ToLowerInvariant() + '-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.log')
    # ExecutePythonScript starts the full editor; the Python commandlet cannot
    # provide every level/editor subsystem used by the scene importer.
    $jqArguments = @(('"' + $jqProject + '"'), ('-ExecutePythonScript="' + $jqScript + '"'), '-unattended', '-nop4', '-nosplash', ('-abslog="' + $jqLog + '"'))
    if ($Action -eq 'Preview') {
        $jqMap = @($jqImported.clips | Where-Object { $_.name -eq $Clip })
        if ($jqMap.Count -ne 1 -or $jqMap[0].map -notmatch ('^/Game/Pilot/Run_[A-Za-z0-9_]+/Maps/' + [regex]::Escape($Clip) + '$')) { throw 'The imported preview map is missing or outside this pilot.' }
        $jqEditor = Join-Path $EngineRoot 'Engine/Binaries/Win64/UnrealEditor.exe'
        $jqArguments = @(('"' + $jqProject + '"'), $jqMap[0].map, '-game', '-windowed', '-ResX=1280', '-ResY=720', '-ForceRes', '-unattended', '-nop4', '-nosplash', ('-abslog="' + $jqLog + '"'))
        if ($StreamLocal) {
            $jqPlugin = (Get-Content -LiteralPath $jqProject -Raw | ConvertFrom-Json).Plugins | Where-Object Name -eq 'PixelStreaming2'
            if (-not $jqPlugin.Enabled) { throw 'Pixel Streaming 2 is not enabled in this local pilot.' }
            $jqArguments += @('-PixelStreamingURL=ws://127.0.0.1:49088', '-RenderOffScreen', '-AudioMixer')
        }
    }
    # Native Preview is an interactive window for reviewing the fighters.
    # Import, capture and the offscreen browser renderer remain hidden.
    $jqWindowStyle = if ($Action -eq 'Preview' -and -not $StreamLocal) { 'Normal' } else { 'Hidden' }
    $jqProcess = Start-Process -FilePath $jqEditor -ArgumentList $jqArguments -WorkingDirectory $jqRoot -WindowStyle $jqWindowStyle -PassThru
    [ordered]@{ status=($Action.ToLowerInvariant() + '_started_not_validated'); processId=$jqProcess.Id; log=$jqLog; project=$jqProject } | ConvertTo-Json
} finally {
    Pop-Location
}
