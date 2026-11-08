# JiuQuest Unreal character pilot

This is a separate, content-only Unreal Engine **5.8** project for the original JiuQuest fighters. Unreal **5.8.4** is installed locally and the three original scenes now import and render in the actual Editor. This remains a local character pilot, not a packaged production build. No C++ compiler, paid content, MetaHuman conversion, app route or public host is required. The existing application is unchanged.

The first comparison uses standing stance, rear naked choke and armbar from source commit `abb747c2772bc690fc7e2aa8ec4cb8e477a082b9`. `pilot-assets.json` pins their sizes and SHA-256 values. Source assets and license records remain in `public/animations/bjj` and `tools/assets/jiuquest-realistic/README.md`; no second tracked copy is added.

## Current validation boundary

The preparer can verify/stage source files and extract their existing embedded textures without Unreal. Source-selection tests can establish exact preservation of binary animation, geometry and image data. They cannot establish successful Unreal import, shader compilation, correct paired poses, acceptable appearance, cooking, performance or streaming. Those require the actual Editor and rendered review. Do not describe a staging success or an Editor process ID as a working Unreal preview.

Python is an Editor production tool. A saved LevelSequence supplies one local playback clock for parent transforms and all skeletal parts. This project does **not** implement a runtime JiuQuest Pixel Streaming command receiver, connected React state bridge, seek/replay UI or multiplayer. Pixel Streaming 2 is enabled for the local pilot and matching infrastructure. No live endpoint is configured.

## Prepare and import

From the repository root:

```powershell
node tools/prepare_unreal_pilot.mjs
node --test tools/prepare_unreal_pilot.test.mjs
python unreal/JiuQuestCharacters/Tests/test_pilot_source.py
pwsh -File tools/unreal_pilot.ps1 -Action Check
pwsh -File tools/unreal_pilot.ps1 -Action Import
```

After checking the completed import and captures, open the interactive native scene:

```powershell
pwsh -File tools/unreal_pilot.ps1 -Action Preview -Clip standing_stance
```

`-Clip` also accepts `rear_naked_choke` and `armbar`. Standing loops; ground clips pause at their final pose. The run-specific game-mode Blueprint has no default pawn, so Unreal does not add a gray player sphere. For supervised localhost browser playback and the pinned signalling server, see [local streaming setup](../../docs/unreal-local-streaming.md). `Preview -StreamLocal` uses only `ws://127.0.0.1:49088` and renders offscreen.

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

## Capture the actual imported Editor scenes

After a successful import, run this in a fresh Editor session with no unsaved work:

```powershell
pwsh -File tools/unreal_pilot.ps1 -Action Capture
```

This action uses the existing successful import report; it does not stage or import again. The equivalent explicit invocation is:

```powershell
& '<Unreal install>/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' `
  '<repo>/unreal/JiuQuestCharacters/JiuQuestCharacters.uproject' `
  '-ExecutePythonScript=<repo>/unreal/JiuQuestCharacters/Content/Python/capture_pilot.py' `
  -unattended -nop4 -nosplash
```

Use the full Editor with working graphics; do not add `-run=pythonscript` or `-NullRHI`. The capture script checks UE5.8, the pinned source fingerprint, successful import status, exact imported maps/cameras/components, animation skeleton bindings and durations. It fails explicitly if the installed Editor lacks the required capture or Python keep-alive APIs.

The script creates eleven 1280×720 PNGs: first, midpoint and finish for each of the three imported clips, followed by a face/collar close-up for each standing fighter. Each map runs in an actual Simulate game world so skeletal components evaluate normally; advancing only the Editor sequence clock previously left limb poses stale. The script strictly rebinds the recorded actor/component inventory in that game world and seeks the same saved sequence used by native playback. Exact display-frame seeks avoid float rounding to the preceding frame. Simulation ends before changing maps and before final cleanup; no temporary pose or camera changes are saved.

The first nine images retain the original full-body camera. Close-ups resolve each imported Head bone unambiguously and record the actual camera transform. The report includes the authoritative sequence time, game-world identity and evaluated Head/hand world transforms for both fighters. After at least 30 ticks and two seconds of settling, the screenshot's separate high-resolution viewport receives 64 warmup frames. The previous warmup setting is restored on success or failure. The script waits for its automation task and complete PNG before proceeding and never sleeps on the Editor thread. High-resolution captures have still shown temporal shadow grain at this setting; compare the actual running viewport/browser before judging lighting quality.

After a completed capture, run the standard-library source comparison:

```text
python tools/audit_unreal_capture.py unreal/JiuQuestCharacters/Saved/PilotReview/captures/<UTC timestamp>
```

This verifies all eleven image hashes, the shared sequence times and the world positions of each fighter's head and hands against the pinned original GLB animation. It writes `source-pose-comparison.json` beside the images and exits unsuccessfully if validation fails or a sampled joint differs by more than 0.1 cm. Six joints at three paused times per clip plus the standing close-ups do not establish all-frame, full-rig or paired-contact correctness.

Actual UE5.8.4 validation on November 8, 2026 produced all eleven images in run `20261108_224754_815103`. Image integrity and all 66 sampled joint positions passed; the maximum source-to-Unreal world-position error was **0.0058502 cm**, below the 0.1 cm limit. The capture restored the previous screenshot setting, released game-world Python references before interpreter shutdown and reached the normal `LogExit: Exiting` / log-closed sequence without a fatal error. The supervising monitor observed process exit but did not retain a numeric exit code. Four offline lifecycle tests cover reentrant callbacks, failure cleanup, exact-frame seeking and simulation shutdown; they do not replace this actual rendering evidence.

All eleven final images were visually reviewed. Both fighters remain framed in the full-body shots, ground poses change across the sampled times, and both close-ups include the head and collar. Cotton weave and lapel detail are visible, but the faces remain smooth, the hair has conspicuous polygonal strips, and shoulders/sleeves still read as rounded separate forms. Dark garment seams/openings around the shoulder, underarm and waist need further source-versus-import diagnosis. Temporal grain remains visible in high-resolution captures. These images establish a working local character preview, not reference-level character fidelity or complete contact correctness.

Results are isolated under ignored `Saved/PilotReview/captures/<UTC timestamp>/`, with a `capture-report.json` recording the import-report hash, image hashes and observed animation times. A `captured_unreviewed` result means the files were captured; visual correctness, face/gi quality, paired contact and Pixel Streaming remain unapproved. Inspect all eleven images and the Unreal log before making those claims. A reentrancy guard prevents native loading and screenshot operations from recursively running the Slate callback; this addresses an observed UE5.8.4 capture crash and has an offline lifecycle regression test.

The Slate callback has a three-minute deadline per image and a fifteen-minute overall deadline, with listener and keep-alive cleanup on completion or failure. Deadlines are checked between Editor calls; the supervising caller must monitor the returned process ID and terminate a hung native load or graphics driver call. The launcher starts the process and returns its ID; it does not provide a watchdog. A failed run retains its partial evidence and records `failed`. Do not treat process creation, a queued screenshot or a partial image as a successful capture.

## What the recipe builds

- Three independent maps, imported through Interchange scene import. Each original parent-motion LevelSequence retains its two actor transform tracks and gains 22 skeletal animation sections matched by exact skeleton identity. A saved LevelSequenceActor drives both from one clock; independent component autoplay is disabled. The playback window includes the final authored sample, and ground clips pause there. Missing/ambiguous bindings stop the script; they are not guessed from array order. A run-specific no-pawn game mode preserves the Player0 review camera. Imported pairing and root motion require actual frame/source comparisons.
- Original GLBs retained byte-for-byte in ignored `Saved/PilotStaging`. A separately hashed import-only derivative selects Slick hair for both roles. It removes only the mesh/skin attachment from the eight unused hair nodes; all node indices, non-hair attachments, materials, UV definitions, skins, animation JSON and binary chunks remain exact. Body, eyes, brows, gi and selected hair are asserted present. No source GLB is changed.
- Material graphs rebuilt from source material metadata: cloth color/fold normals use UV1; roughness uses UV0 and the glTF G channel. Numeric textures are linear, color textures are sRGB. OpenGL normal maps use Unreal's green-channel flip and retain source normal strength. Cloth uses `DeriveTangentBasis` with UV1 and a world-space material normal so it does not interpret panel-map detail in the mesh's UV0 frame. The public MakeMaterialAttributes ClearCoat pin carries the cloth amount; Unreal hides the equivalent direct Python enum. Skin uses Unreal's default Subsurface Profile pending further look tuning. No new facial detail texture is synthesized. The pilot uses a fixed White/Navy palette with dark hair and blue/purple belts; runtime appearance customization is not wired.
- A simple review floor, three movable area lights with explicit candela units and virtual shadow maps, and a camera with fixed manual exposure (-7 compensation, physical camera exposure off, bloom off). DirectX 12 explicitly targets SM6; the base engine's SM5 fallback cannot supply the intended Lumen/VSM feature set. Actual bracket captures showed the original adaptive view clipped faces, white cotton and dark hair. A broader camera-side fill reveals shadowed gi folds. Skin scatter/specular and dark hair response are restrained, while the underlying model and textures remain original. This is character look development, not a recreation of the reference background. Existing folds are authored geometry/normal detail; no Chaos Cloth simulation is enabled.

Only project/configuration/scripts/manifest are tracked. `Saved`, `Content/Pilot`, caches, binaries and intermediate products are ignored. Do not commit raw generated assets or a release until an explicit packaging and verification plan is established.

## Required in-Editor review

Open each reported map and inspect both fighter roles at the first frame, midpoint and finish. Check unit scale, handedness, world/root transforms, skeleton identity, animation duration, seams, skin/eye alignment, UV0/UV1 registration and Slick hair visibility. Inspect face/cloth under matched camera and light angles. A source-preserving import can still change appearance or pair contact; rendering quality is not established by hashes.

Confirm material compilation and the intended Subsurface Profile/Cloth behavior under the project's explicit non-Substrate configuration. Tune skin scatter, light exposure and cotton fuzz only after the first rendered comparison. Preserve original motion while addressing any Interchange conversion issues. If scene import cannot preserve the paired motion, stop and prepare a separately audited FBX import; do not silently replace choreography.

The local browser pilot uses the standalone game and matching **UE5.8** infrastructure branch on localhost. Production streaming still requires a running render host, signalling/session handling and network validation; this project does not supply a production host or authorize vendor purchases.

## Official API references

The implementation follows Epic's 5.8 reflected APIs. Import, material graph creation and capture have now run against the installed 5.8.4 Editor; offline CI still cannot establish rendering or streaming quality.

- [Interchange import workflow](https://dev.epicgames.com/documentation/en-us/unreal-engine/importing-assets-using-interchange-in-unreal-engine) and [synchronous scene import](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/InterchangeEngine/UInterchangeManager/ImportScene).
- [Import parameters](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/InterchangeEngine/FImportAssetParameters) and [asset import tasks](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/UnrealEd/UAssetImportTask).
- [Material editing](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/MaterialEditingLibrary), [texture sampling](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UMaterialExpressionTextureSample) and [Subsurface Profile](https://dev.epicgames.com/documentation/en-us/unreal-engine/subsurface-profile-shading-model-in-unreal-engine).
- [Level creation](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/LevelEditorSubsystem), [actor creation](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/UnrealEd/UEditorActorSubsystem/SpawnActorFromClass) and [serialized single-animation data](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/SkeletalMeshComponent).
- [Editor-only Python and command-line execution](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python), [Pixel Streaming setup](https://dev.epicgames.com/documentation/en-us/unreal-engine/getting-started-with-pixel-streaming-in-unreal-engine) and [version-matched infrastructure](https://github.com/EpicGames/PixelStreamingInfrastructure).
- [Editor screenshot API](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AutomationLibrary), [screenshot task completion](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AutomationEditorTask) and [Python keep-alive](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/EditorPythonScripting). Required bindings are checked in the installed Editor before capture starts.
