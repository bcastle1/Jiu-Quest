# Video-derived reference motion

This pipeline turns a phone video of a two-person jiu-jitsu technique into an animation of JiuQuest's two athletes on the JiuQuest athlete rig, to preview in the browser and to import into Unreal Engine 5.8. The first clip is a leg hook takedown. Status checked November 19, 2026: the Unreal import script's offline tests pass. Nothing described here has been imported into Unreal, rendered there or reviewed by a coach yet.

## What this is

The result is a paired choreography GLB with the layout of `public/animations/bjj/*.glb`: two athletes under `JQ_Pair`, `JQ_Attacker` (the performer) and `JQ_Defender`, each a 65-joint skin with Unreal-mannequin joint names (see `tools/video_motion/rig.py`). Only the animation is new. Meshes, materials, skins and hair options are the template's.

It is reference motion fitted to 2D evidence from one phone camera. It is not motion capture: depth, hidden limbs, grips and contact are estimates made from pose detectors, keyframe annotations and the rig's limits. Every GLB is a draft. `write_paired_glb.py` sets its scene extra `JQ_motion_type` to `video-reference-fit` and `JQ_review_status` to "VIDEO-DERIVED DRAFT - fitted from a reference video; requires qualified BJJ coach review". A draft is not published or offered as instruction before a qualified BJJ coach has reviewed it against the video.

## Provenance and rights

- The source video, its frames and crops, and its metadata, including any location and device data the phone wrote into the file, are never committed. They stay in a local work directory outside the repository. Reports may name that directory and frame numbers.
- The derived motion holds joint rotations and positions, not images of the people in the video. Whether it is published is the owner's decision.
- Ultralytics YOLO11 pose (`yolo11x-pose.pt`; library and weights AGPL-3.0) is used only as a local analysis tool that finds body keypoints in the frames. It is not part of the app or of this repository. MediaPipe Pose Landmarker (`pose_landmarker_heavy.task`, Apache-2.0) is used the same way. Both model files stay in the work directory. `tools/video_motion/requirements.txt` lists the Python packages.

## Steps

Unless a step says otherwise, commands run from the repository root with the packages of `tools/video_motion/requirements.txt`, and work files go to the work directory.

1. **Tracking.** `detect_people.py` runs YOLO11 pose and MediaPipe Pose Landmarker on every decoded frame. `identify_people.py` tells the two athletes apart by trouser colour, and `stabilize.py` registers every frame to one reference frame on the static background.
   Command: _to be filled in._
2. **Keyframe annotation.** `make_annotation_images.py` makes gridded crops, detector overlays and context strips of chosen keyframes. Annotators mark each athlete's joints, facing, posture, planted feet and contacts on them, and `build_observations.py` merges their votes with the detections into `obs.npz`.
   Command: _to be filled in._
3. **3D fit.** `fit_motion.py` fits the camera and both athletes' poses on the rig to `obs.npz` and writes `motion.npz` (the motion file contract in `write_paired_glb.py`) and `fit.json`. `debug_views.py` draws the reprojected skeletons over the stabilised frames beside top and side views.
   Command: _to be filled in._
4. **GLB writing.** `write_paired_glb.py` copies a paired template and replaces only its animation, and sets the draft's scene extras. The template's images, vertex data, indices and inverse bind matrices keep their exact bytes.
   Command: _to be filled in._
5. **Previews.** `render_preview.mjs` renders the GLB in headless Chromium with three.js (SwiftShader, no GPU) to PNG frames and an MP4.
   Command: _to be filled in._
6. **Unreal import.** `import_video_motion.py`; see the next section.
7. **MetaHuman retarget.** The `--retarget-target` option of the same script; see [MetaHuman retarget](#metahuman-retarget-untested). Untested.

## Unreal import

`unreal/JiuQuestCharacters/Content/Python/import_video_motion.py` imports one GLB written by `write_paired_glb.py` into Unreal Engine 5.8 for review. Like `import_pilot.py`, it runs in a fresh full Editor session with no unsaved work through `-ExecutePythonScript`, not the Python commandlet, because it creates a level. It refuses any engine version other than 5.8.

### Run it on Windows

Give the GLB as an absolute path; the Editor does not run in the shell's directory. Environment variables are the most reliable way to pass it: the Editor inherits them from PowerShell, and the path may contain spaces.

```powershell
$repo = 'C:\path\to\Jiu-Quest'
$engine = 'C:\Program Files\Epic Games\UE_5.8'
$env:JQ_VIDEO_MOTION_GLB = 'D:\video motion\leg_hook_takedown.glb'
$env:JQ_VIDEO_MOTION_CLIP = 'leg_hook_takedown'
$project = Join-Path $repo 'unreal\JiuQuestCharacters\JiuQuestCharacters.uproject'
$script = Join-Path $repo 'unreal\JiuQuestCharacters\Content\Python\import_video_motion.py'
$log = Join-Path $repo ('tmp\video-motion\import-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.log')
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
$editorArgs = @(('"' + $project + '"'), ('-ExecutePythonScript="' + $script + '"'),
                '-unattended', '-nop4', '-nosplash', ('-abslog="' + $log + '"'))
$editor = Start-Process -FilePath (Join-Path $engine 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe') `
  -ArgumentList $editorArgs -WorkingDirectory $repo -PassThru
$editor.WaitForExit()
Remove-Item Env:JQ_VIDEO_MOTION_GLB, Env:JQ_VIDEO_MOTION_CLIP
$latest = Get-Content (Join-Path $repo 'unreal\JiuQuestCharacters\Saved\VideoMotion\latest-import.json') -Raw | ConvertFrom-Json
Get-Content $latest.report -Raw | ConvertFrom-Json | Select-Object status, failedStep, error, contentRoot, map
```

`JQ_VIDEO_MOTION_HAIR` (Crew, Long, Mohawk, Slick or Spikes; default Spikes), `JQ_VIDEO_MOTION_RETARGET_TARGET` and `JQ_VIDEO_MOTION_RETARGET_TARGET_IK_RIG` set the other options. Without a clip name the GLB's file name is used, each run of characters other than letters, digits and `_` made one `_`.

The options can instead follow the script path inside the quoted value: `('-ExecutePythonScript="' + $script + ' D:\motion\leg_hook_takedown.glb --clip leg_hook_takedown"')`. Unreal's Python plugin runs a value whose first token ends in `.py` as that file and gives it the other tokens as `sys.argv[1:]`. It splits the value at spaces, and the whole value must sit in one pair of double quotes right after the `=` (the form `tools/unreal_pilot.ps1` uses). So the repository path must not contain a space in either form, and in this form the GLB path must not either. The pilot scripts take no arguments, so this form has not been run in this repository. A third way is a JSON file `import_video_motion.json` beside the script with the keys `glb`, `clip`, `hair`, `retargetTarget` and `retargetTargetIkRig`; git ignores it. Arguments win over the environment and the environment over the file. The report records the source used and which others were present.

### What it builds

- A new run every time: content in `/Game/VideoMotion/<clip>/Run_<UTC>` (in this project ignored by git, like `/Game/Pilot`) and files in `Saved/VideoMotion/<clip>/<UTC>/`. An existing run directory or content folder is never overwritten, so a second run of one clip in the same second is refused.
- The GLB's size, SHA-256, key count, frame rate, first and last key time and scene extras are recorded, and its review status is written to the log. Nothing is pinned: these are review drafts.
- `pilot_source.select_hair` detaches the eight unselected hair meshes (one style for both athletes, Spikes by default). The binary chunk stays byte-for-byte and the rest of the JSON, animation and skins included, is unchanged. This copy, kept in the run directory with its own SHA-256 recorded, is what Interchange imports.
- Interchange scene import into a new map with a run-specific no-pawn game mode, then the pilot's binding: each skeletal mesh component (22 with one hairstyle) gets the AnimSequence of its skeleton with independent autoplay off, and the imported parent-motion LevelSequence gets a skeletal section per component. One clock drives the athletes' travel and every bone. The sequence plays once and holds the final pose (`KEEP_STATE`, pause at end). Each AnimSequence must be as long as the GLB's last key time within one frame, the length the pilot's capture audit observed.
- The pilot's floor and three lights, centred on the pair, and a CineCameraActor (35 mm lens, 16:9 filmback, no depth of field, the pilot camera's fixed exposure) at the side of the pair, 10 degrees above level. It looks across the line between the pelvises at the first key, from the side the pilot's lights face, far enough to keep the pelvis, head, hand and foot joints of both athletes in frame with a 30 cm margin at every sampled key (up to 200 keys spread over the clip). The attacker can therefore stand on either side of the image; the report says which. `render_preview.mjs`'s side view keeps the attacker on the left, so the two side views can be mirror images.

### The report

The report is `Saved/VideoMotion/<clip>/<UTC>/import-report.json` in the project the Editor ran. `Saved/VideoMotion/latest-import.json` names the newest report. A request that fails before a run directory exists is reported under `Saved/VideoMotion/_rejected/`. The Editor process ending is not completion: read the report and the log.

- `editor_import_completed_visual_validation_pending` means only that the scripted import and setup, and the retarget when asked for, completed and were saved. `renderValidated`, `pairedMotionValidated`, `coachReviewed` and `retargetValidated` are always false.
- `failed` names `failedStep` and holds `error` and `traceback`. `importCompleted` says whether the map and sequence had been saved. A report left at `importing` or `retargeting` means the Editor stopped during `currentStep`. A failed run may leave partial content for diagnosis; delete nothing automatically.
- `source` and `importSource` describe the two files; `components` and `animations` the bindings, with each AnimSequence's length and frames at the source rate; `sharedSequence` the duration, playback end, tick resolution and each parent actor's imported location beside the GLB's rest and first-key translation; `stage.camera` the framing and any lens setting the Editor rejected; `retarget` the optional retarget.

### MetaHuman retarget (untested)

`--retarget-target /Game/.../<SkeletalMesh>` retargets both athletes' AnimSequences onto that mesh, for example the owner's MetaHuman athlete body. For a mesh in another project, run the script with that project's `.uproject`: it loads its helper from its own folder and writes its content and report in that project. For each athlete it makes an IK Rig on the imported `JQ_<Role>_Body` with nineteen explicit retarget chains (spine, neck, head, clavicles, arms, legs and five fingers per hand) and the pelvis as retarget root. It then makes an IK Retargeter onto a target IK Rig that Unreal generates from its skeleton templates (or the one given with `--retarget-target-ik-rig`), maps the chains by name, adds Unreal 5.6's default retarget ops and aligns the target's retarget pose where those calls exist, and runs the batch retarget: `IKRetargetBatchOperation.run_batch_retarget`, or the older `duplicate_and_retarget` where only that exists. Results go to `<run>/Retarget/Animations` (with `duplicate_and_retarget`, beside the source AnimSequences) with the suffix `_RT_<target mesh>`. The chains are explicit because Interchange gives the Defender's joint names a 32-hex suffix, which Unreal's template recognition would not match.

This path has never run in an Editor. Its calls come from Epic's Python API reference. Each is looked up before use, and a missing one stops the step with a message that names it. A failure leaves the saved import in place and marks the run `failed` at step `retarget`.

The athletes' travel and turn (the `JQ_<Role>` node motion) is on the actor transform tracks of the imported LevelSequence, not in the AnimSequences, so retargeted animations play in place. To reproduce the travel, copy each `JQ_<Role>` transform track onto the MetaHuman's binding in Sequencer. That is not automated or tested.

Manual fallback, which the script's messages also give: in the Content Browser select an athlete's AnimSequence under `<run>/Clips/<clip>`, right-click **Retarget Animations**, choose that athlete's imported `JQ_<Role>_Body` as the source mesh and the MetaHuman body as the target mesh, choose an IK Retargeter or let the dialog generate one, set an export folder and export. For the Defender, assign its suffixed bones to the IK Rig chains by hand.

### How this differs from the pinned pilot import

`import_pilot.py` imports three staged clips pinned by size and SHA-256 in `pilot-assets.json`, rebuilds their look-development materials, applies the seven reviewed character refinements, writes one `Saved/PilotReview/editor-import.json`, loops the standing clip and views it through a fixed `CameraActor`. `import_video_motion.py` takes one unpinned GLB from anywhere on disk and records its SHA-256, applies only the hair selection, keeps Interchange's default glTF materials, writes one report per run, plays the clip once, frames a CineCameraActor from the GLB's joints and runs in any UE 5.8 project. `capture_pilot.py`, `tools/audit_unreal_capture.py` and `tools/unreal_pilot.ps1` read only pilot imports and do not apply to these runs.

### What has been verified

On Linux, without Unreal: 26 offline tests in `unreal/JiuQuestCharacters/Tests/test_import_video_motion.py` run the script against a stubbed `unreal` module. They cover the three request sources, run naming, refusal to overwrite, failure reports with step and traceback, SHA-256 recording, step order, the retarget's control flow and messages, and that every sampled joint of `double_leg.glb` projects inside the side camera's frame. Separate one-off checks: on all 126 keys of `double_leg.glb` the script's GLB reader gave the joint positions of `rig.py`'s forward kinematics within 0.0001 cm, and a GLB written by `write_paired_glb.py` passed the reader, the hair selection and the whole scripted run against the stubbed Editor.

Not verified: nothing has run in Unreal, and the PowerShell above has not been run. The calls copied from `import_pilot.py` ran there for the pilot. New and unverified are the `CineCameraActor` with its `filmback`, `current_focal_length` and `focus_settings` (a rejected lens setting is recorded, not fatal), the arguments in `sys.argv`, and every call of the retarget path, among them `IKRigController`, `IKRetargeterController`, `IKRetargetBatchOperation`, `IKRetargetBatchOperationInputs`, `EditorAssetLibrary.find_asset_data` and the IK Rig and IK Retargeter factories. The camera framing uses the glTF-to-Unreal axis mapping that the pilot's capture audit confirmed.
