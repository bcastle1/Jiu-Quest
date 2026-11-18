# Rebuild the Athletic V2 website stills

Use an isolated website checkout with its Node dependencies installed. The position and head builders use `sharp`. The front builder needs Python with NumPy and Pillow. Set `$task` to the absolute native Athletic V2 task directory and `$bundle` to the absolute destination for the verified catalog. Run the examples in PowerShell 7.

## Verify the catalog copy

The catalog requires 24 successful native runs, 78 front PNGs, 83 standing PNGs and 74 customization keys per scene. The native pack must bind the exact V2 preparation index, configuration, report and result files, and each PNG's size and SHA-256. Keep all three front and five standing references, Dean's white front pass, both mixed standing bases and both mixed white passes.

For a new catalog-only QA copy, choose a new dated child of the native delivery tool's approved root. The native tools generate manifests with absolute paths to that destination.

```powershell
$c = Join-Path $task 'delivery-tools/catalog'
$name = Split-Path -Leaf $bundle
$plan = Join-Path $c "prepared/$name/copy-plan.local.json"
node "$task/plans-v2/make_pack.mjs" --check &&
  node "$task/plans-v2/make_pack.mjs" &&
  node "$c/prepare_catalog.mjs" --destination "$bundle" &&
  node "$c/verify_prepared_catalog.mjs" "$plan" &&
  node "$c/copy_catalog.mjs" "$plan" --copy
```

For every copied bundle, run its delivered verifier before rebuilding. A moved bundle requires explicit path rebasing and renewed verification. The general delivery tool owns the master inventory check and final delivery receipt.

```powershell
node "$bundle/custom/catalog/verify_catalog.mjs" "$bundle"
```

## Rebuild body layers, then heads

From the website checkout, run the body builder and retain its receipt. It checks the delivered verifier against the native tools, materializes the eight verified aliases, rebuilds all eleven body layers, updates the source and file pins, and installs the staged outputs. It reads the protected hem classification and garment proof from the native task. The four fresh front layers also supply the occlusion outline for the Fighter Creator mat.

```powershell
$body = python tools/rebuild_athletic_v2_bodies.py "$bundle" "$task" --install | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Body rebuild failed' }
node tools/build_unreal_athlete_heads.mjs "$bundle/heads.json" --layer-input-public ./public --layer-input-receipt "$($body.receipt)" --debug "$($body.stage)/head-debug" > "$($body.stage)/head-build-report.json"
if ($LASTEXITCODE -ne 0) { throw 'Head rebuild failed' }
```

The head builder reads the selected public input root and validates its five base/jacket files and all eight native reference hashes against the body-build receipt. It writes both `athleteHeads.data.js` and `athleteHeads.pins.js`. To redirect the head outputs, supply both `--public` and `--module`; keep `--layer-input-public` pointed at the freshly rebuilt bodies.

| Scene | Native crop [left, top, width, height] | Site size | Head boxes in site pixels | Body layers |
| --- | --- | --- | --- | --- |
| Front | [538, 166, 1400, 2738] | 900 × 1760 | [261, 0, 324, 306] | Base, jacket, pants, belt |
| Standing | [510, 255, 1620, 1080] | 1620 × 1080 | Lead [500, 80, 250, 280], other [880, 40, 250, 280] | Base and each athlete's jacket, pants, belt |

The front split uses 1,400 verified boundary rows in cropped-native coordinates. Candidate white-minus-black gi light supplies both cloth layers. The builder checks their sum before encoding, and derives base and belt from the same candidate passes. With jacket `#7f8794`, pants `#b61f2b` and a white belt, the viewer-left jacket tip stays gray down to the burgundy pants. Standing uses the existing polygons, four-pixel split ramp, cloth thresholds `times: 4` and `rise: 0.15`, and tinted-layer quality 96.

The V2 head build produced 232 WebPs across both scenes, including face bases, collar layers and thumbnails. The default is `original/fringe/black/none`. Dean's front uses his native black-gi and white-gi passes. Each standing role uses its matching mixed black-gi and white-gi passes. For the verified V2 configuration and preparation index, the three base reports must each record zero `pixelsTakenFromReference`. Applying the older reference blend to this batch cut a notch into the front collar, cut into the lead nape and introduced a dark spot at the other nape. Inspect the base and jacket debug images alongside their native passes.

## Check the installed images

Run `node --test tests/*.test.js` and the normal production build, then use the existing `tools/test_unreal_athlete.mjs`, `tools/test_unreal_athlete_heads.mjs` and `tools/test_unreal_position_still.mjs` against that build. Review both faces and standing roles in Fighter Creator, Arena and Training, including white gi and the gray/burgundy/white palette with Dean gray coil-buzz and stubble. Check saved choices, collar and head-box seams, garment edges, hands and independent clothing colors.
