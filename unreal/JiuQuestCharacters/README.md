# JiuQuest Unreal character pilot

This is a separate, content-only Unreal Engine **5.8** project for the original JiuQuest fighters. It contains project configuration and an Editor import recipe, not a validated Unreal build. No C++ compiler, paid content, MetaHuman conversion, app route or public host is required by this scaffold. The existing application is unchanged.

The first comparison uses standing stance, rear naked choke and armbar from source commit `abb747c2772bc690fc7e2aa8ec4cb8e477a082b9`. `pilot-assets.json` pins their sizes and SHA-256 values. Source assets and license records remain in `public/animations/bjj` and `tools/assets/jiuquest-realistic/README.md`; no second tracked copy is added.

## Current validation boundary

The preparer can verify/stage source files and extract their existing embedded textures without Unreal. Source-selection tests can establish exact preservation of binary animation, geometry and image data. They cannot establish successful Unreal import, shader compilation, correct paired poses, acceptable appearance, cooking, performance or streaming. Those require the actual Editor and rendered review. Do not describe a staging success or an Editor process ID as a working Unreal preview.

Python is an Editor production tool. This project does **not** implement a runtime Pixel Streaming input receiver, React state bridge, shared animation clock, seek/replay UI or multiplayer. Pixel Streaming 2 is explicitly disabled until a playable native preview and matching infrastructure are ready. No live endpoint is configured.

## Prepare and import

From the repository root:

```powershell
node tools/prepare_unreal_pilot.mjs
node --test tools/prepare_unreal_pilot.test.mjs
python unreal/JiuQuestCharacters/Tests/test_pilot_source.py
pwsh -File tools/unreal_pilot.ps1 -Action Check
pwsh -File tools/unreal_pilot.ps1 -Action Import
```

The first command is read-only. The Import launcher checks the installation, stages the allowlisted sources with `node tools/prepare_unreal_pilot.mjs --stage`, and starts the full Editor. Epic account setup, installation and license prompts must be completed by the user. Install **5.8**; using another minor version requires reviewing the plugin/API contract first.

The equivalent explicit Editor command is:

```powershell
& '<Unreal install>/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' `
  '<repo>/unreal/JiuQuestCharacters/JiuQuestCharacters.uproject' `
  '-ExecutePythonScript=<repo>/unreal/JiuQuestCharacters/Content/Python/import_pilot.py' `
  -unattended -nop4 -nosplash
```

Use a fresh Editor session, with no unsaved work: level creation changes the current level. Use the full Editor script mode above, not `-run=pythonscript`, because scene creation requires Editor level facilities. Each run gets a new `/Game/Pilot/Run_<UTC timestamp>` directory; existing imported assets are not overwritten. A failed run may leave partial generated content for diagnosis. Do not delete another run automatically.

The launch process returning is not completion. Read `Saved/PilotReview/editor-import.json` and the Unreal log. `editor_import_completed_visual_validation_pending` means only that the scripted import/setup completed. `failed` includes the failing step/traceback. The report deliberately leaves `renderValidated`, `pairedMotionValidated` and `pixelStreamingValidated` false.

## What the recipe builds

- Three independent maps, imported through Interchange scene import so source actor hierarchy/transforms are available for inspection. Per-component animation assignment uses an exact skeleton match and checks duration within one 30 fps frame. Missing/ambiguous bindings stop the script; they are not guessed from array order. Imported pairing and root motion still require actual frame comparisons.
- Original GLBs retained byte-for-byte in ignored `Saved/PilotStaging`. A separately hashed import-only derivative selects Slick hair for both roles. It removes only the mesh/skin attachment from the eight unused hair nodes; all node indices, non-hair attachments, materials, UV definitions, skins, animation JSON and binary chunks remain exact. Body, eyes, brows, gi and selected hair are asserted present. No source GLB is changed.
- Material graphs rebuilt from source material metadata: cloth color/fold normals use UV1; roughness uses UV0 and the glTF G channel. Numeric textures are linear, color textures are sRGB. OpenGL normal maps use Unreal's green-channel flip and retain source normal strength. Skin uses Unreal's default Subsurface Profile pending look tuning; cotton uses Cloth shading. No new facial detail texture is synthesized. The pilot uses a fixed White/Navy palette with dark hair and blue/purple belts; runtime appearance customization is not wired.
- A simple review floor, three area lights and camera. This is character look development, not a recreation of the reference background. Existing folds are authored geometry/normal detail; no Chaos Cloth simulation is enabled.

Only project/configuration/scripts/manifest are tracked. `Saved`, `Content/Pilot`, caches, binaries and intermediate products are ignored. Do not commit raw generated assets or a release until an explicit packaging and verification plan is established.

## Required in-Editor review

Open each reported map and inspect both fighter roles at the first frame, midpoint and finish. Check unit scale, handedness, world/root transforms, skeleton identity, animation duration, seams, skin/eye alignment, UV0/UV1 registration and Slick hair visibility. Inspect face/cloth under matched camera and light angles. A source-preserving import can still change appearance or pair contact; rendering quality is not established by hashes.

Confirm material compilation and the intended Subsurface Profile/Cloth behavior under the project's explicit non-Substrate configuration. Tune skin scatter, light exposure and cotton fuzz only after the first rendered comparison. Preserve original motion while addressing any Interchange conversion issues. If scene import cannot preserve the paired motion, stop and prepare a separately audited FBX import; do not silently replace choreography.

For a future browser pilot, package/launch the native Unreal application, enable Pixel Streaming 2, and use the matching **UE5.8** infrastructure branch. Start on localhost. Production streaming requires a running render host, signalling/session handling and network validation; this static scaffold does not supply them or authorize vendor purchases.

## Official API references

The implementation follows Epic's current 5.8 reflected APIs. The installed Python bindings and actual execution remain unvalidated until the Editor runs.

- [Interchange import workflow](https://dev.epicgames.com/documentation/en-us/unreal-engine/importing-assets-using-interchange-in-unreal-engine) and [synchronous scene import](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/InterchangeEngine/UInterchangeManager/ImportScene).
- [Import parameters](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/InterchangeEngine/FImportAssetParameters) and [asset import tasks](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/UnrealEd/UAssetImportTask).
- [Material editing](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/MaterialEditingLibrary), [texture sampling](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UMaterialExpressionTextureSample) and [Subsurface Profile](https://dev.epicgames.com/documentation/en-us/unreal-engine/subsurface-profile-shading-model-in-unreal-engine).
- [Level creation](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/LevelEditorSubsystem), [actor creation](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/UnrealEd/UEditorActorSubsystem/SpawnActorFromClass) and [serialized single-animation data](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/SkeletalMeshComponent).
- [Editor-only Python and command-line execution](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python), [Pixel Streaming setup](https://dev.epicgames.com/documentation/en-us/unreal-engine/getting-started-with-pixel-streaming-in-unreal-engine) and [version-matched infrastructure](https://github.com/EpicGames/PixelStreamingInfrastructure).
