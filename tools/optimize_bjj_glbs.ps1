$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$assetDirectory = (Resolve-Path (Join-Path $root "public\animations\bjj")).Path

if (-not $assetDirectory.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Animation asset directory resolved outside the workspace: $assetDirectory"
}

$files = Get-ChildItem -LiteralPath $assetDirectory -Filter "*.glb" | Sort-Object Name
foreach ($file in $files) {
    $temporaryPath = Join-Path $assetDirectory ($file.BaseName + ".quantized.glb")
    & pnpm exec gltf-transform quantize $file.FullName $temporaryPath `
        --pattern "{POSITION,NORMAL}" `
        --quantize-position 14 `
        --quantize-normal 10
    if ($LASTEXITCODE -ne 0) {
        throw "glTF quantization failed for $($file.Name)"
    }

    & pnpm exec gltf-transform validate $temporaryPath
    if ($LASTEXITCODE -ne 0) {
        throw "glTF validation failed for $($file.Name)"
    }

    Move-Item -LiteralPath $temporaryPath -Destination $file.FullName -Force
}

Write-Host "Optimized and validated $($files.Count) paired BJJ animations."
