$ErrorActionPreference = 'Stop'
$jqRoot = Split-Path -Parent $PSScriptRoot
$jqLauncher = Join-Path $PSScriptRoot 'unreal_pilot.ps1'
$jqTokens = $null
$jqErrors = $null
$jqAst = [System.Management.Automation.Language.Parser]::ParseFile($jqLauncher, [ref]$jqTokens, [ref]$jqErrors)
if ($jqErrors.Count -ne 0) { throw 'Launcher syntax errors.' }
$jqGuard = $jqAst.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-JqCharacterRecipes' }, $false)
if ($null -eq $jqGuard) { throw 'Missing launcher recipe guard.' }
# Evaluate only the guard definition: the launcher's process-start code never runs.
Invoke-Expression $jqGuard.Extent.Text
$jqDirectory = Join-Path $jqRoot 'unreal/JiuQuestCharacters/Content/Python'
$jqRecipes = [ordered]@{}
foreach ($jqName in @('import_pilot.py', 'pilot_source.py', 'ready_hands.py', 'pilot_look.py', 'pilot_hair.py', 'pilot_hair_shape.py', 'pilot_gi_body.py')) {
    $jqRecipes[$jqName] = (Get-FileHash -LiteralPath (Join-Path $jqDirectory $jqName) -Algorithm SHA256).Hash.ToLowerInvariant()
}
$jqValid = [pscustomobject]@{ characterRefinement = [pscustomobject]@{ recipeFiles = [pscustomobject]$jqRecipes } }
Assert-JqCharacterRecipes -ImportedClip $jqValid -RecipeDirectory $jqDirectory
function Copy-JqClip { $jqValid | ConvertTo-Json -Depth 5 | ConvertFrom-Json }
$jqCases = @([pscustomobject]@{}, [pscustomobject]@{characterRefinement=[pscustomobject]@{}},
    [pscustomobject]@{characterRefinement=[pscustomobject]@{recipeFiles=[pscustomobject]@{}}})
$jqPartial = Copy-JqClip; $jqPartial.characterRefinement.recipeFiles.PSObject.Properties.Remove('pilot_hair_shape.py'); $jqCases += $jqPartial
$jqOldSix = Copy-JqClip; $jqOldSix.characterRefinement.recipeFiles.PSObject.Properties.Remove('pilot_gi_body.py'); $jqCases += $jqOldSix
$jqExtra = Copy-JqClip; $jqExtra.characterRefinement.recipeFiles | Add-Member -NotePropertyName '../unexpected.py' -NotePropertyValue ('0' * 64); $jqCases += $jqExtra
$jqMalformed = Copy-JqClip; $jqMalformed.characterRefinement.recipeFiles.'pilot_hair.py' = 'invalid'; $jqCases += $jqMalformed
$jqWrongType = Copy-JqClip; $jqWrongType.characterRefinement.recipeFiles.'pilot_hair.py' = 42; $jqCases += $jqWrongType
$jqStale = Copy-JqClip; $jqStale.characterRefinement.recipeFiles.'pilot_hair.py' = '0' * 64; $jqCases += $jqStale
$jqStaleBody = Copy-JqClip; $jqStaleBody.characterRefinement.recipeFiles.'pilot_gi_body.py' = '0' * 64; $jqCases += $jqStaleBody
foreach ($jqCase in $jqCases) {
    $jqRejected = $false
    try { Assert-JqCharacterRecipes -ImportedClip $jqCase -RecipeDirectory $jqDirectory } catch { $jqRejected = $true }
    if (-not $jqRejected) { throw 'Invalid or stale recipe inventory was accepted.' }
}
Write-Output ('Recipe guard passed: current inventory accepted; {0} invalid inventories rejected; no process launched.' -f $jqCases.Count)
