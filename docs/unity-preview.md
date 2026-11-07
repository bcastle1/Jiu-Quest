# Unity combat release candidate

Unity 6.3 LTS/URP presents paired animation inside the existing React app. React retains combat outcomes, athlete customization, and saved progress. Unity does not decide winners, award progress, or implement online multiplayer.

## Routes and coverage

- `/?preview=unity` opens the isolated scene reviewer without mounting the persisted app or reading/writing player progress.
- `/?engine=unity` explicitly enables supported Unity moves in Training/Arena.
- `/?engine=snapshot` explicitly uses the existing position snapshots.
- A release build enables Unity by default with `VITE_COMBAT_ENGINE=unity`. Ordinary `pnpm build`/development remains opt-in unless that flag is supplied.

Sixteen paired clips are available in the reviewer. Exact curriculum mappings are deliberately limited to:

| Curriculum move | Paired animation |
| --- | --- |
| Trap and roll escape | `trap_roll_escape` |
| Double-leg takedown | `double_leg` |
| Triangle choke | `triangle_choke` |
| Rear-naked choke | `rear_naked_choke` |

Failed attacks and unsupported lessons retain clearly labeled settled-position snapshots. A generic armbar or guard pass is not substituted for another named technique. All clips are authored choreography, not motion capture or coach-reviewed instruction. Double-leg, triangle and rear-naked-choke choreography has been refined for contact, grounded positions and clearer finishes; the technical review remains separate from a qualified BJJ review.

Controls include play/pause, replay, timeline seeking, quarter/half speed, camera presets, free rotation, and supported-browser fullscreen. The initial Side view presents both athletes in profile; a manually selected view persists through technique, appearance and Replay changes. Reduced motion starts paused; hidden tabs pause. Phone layouts give the scene a taller viewport and 44px touch controls. The preview offers three kit palettes and six hair silhouettes, with no saved-fighter writes. Camera fitting covers the complete motion envelope and adjusts to the viewport; compact rendering targets 30fps and desktop 60fps. These are target rates, not measured physical-device performance claims.

If Unity cannot initialize, the view reports the error and offers the existing snapshot view without resetting the active match or saved progress.

## Character art and appearance

The candidate uses adult action-anime fighters derived from the MakeHuman/MPFB core CC0 assets, fitted to the existing 65-bone paired rig. A deterministic Blender step enlarges the fitted eyes and upper head, tapers the chin, and adds shaped brows and solid hair locks. Gi panels, trousers and a flat belt are skinned with the athlete; covered body geometry is removed. The character size remains constant while crouching and moving to the ground. The generated style-comparison image is reference art only and is not used in the game.

Skin stays at 2K resolution; six shared skin, eye, cloth and hair maps are embedded in each paired GLB. The release descriptor records current per-clip sizes; the limit remains 7 MiB. Both athletes share embedded images, and clips load when selected. Hair and brows are opaque geometry. Following the supplied fighting-game reference, Unity uses a continuous URP metallic/roughness light response, restrained dielectric highlights and subtle edge definition in one color pass. Referenced skin retains 80% of its authored texture variation, while eyes and brows remain distinct material families. Cotton normal and roughness maps contribute actual surface detail; authored occlusion maps, when present, affect ambient light. Each map retains its own glTF UV channel and transform. Unity and the existing Three renderer apply appearance colors relative to declared texture references in linear light; the new light response is specific to Unity. Bald removes scalp hair without removing eyebrows.

The original Summit Dojo replaces the enclosed gray arena with chamfered stone, woven jade tatami, bronze inlays, cedar gates, folded pennants, lanterns and layered alpine scenery. The winter reference pass adds selective snow caps to the pines and outcrops, shallow peripheral drifts, finer low-contrast rock strata and cooler daylight with a restrained warm rim. Snow stays outside the clear grappling surface. Architecture combines into at most sixteen material groups, including a single atmospheric sky draw; the snow additions reuse an existing material. Tatami, slate, cedar, alpine rock, pine boughs and softly rippled snow use shared deterministic 128–256px textures created at runtime; there are no new image downloads or third-party assets. Conifer clusters vary in height and width. Distant scenery casts no shadows. One directional key casts soft shadows, using a 2048 atlas for larger viewports and 1024 for compact viewports. Pennant tails and subtle cloud movement follow the sampled combat clock, with matching loop endpoints and no independent wall-time animation. Paused study and reduced-motion startup freeze both fighters and scenery. The supplied reference guides composition, material depth and atmosphere; shipped assets remain original or covered by the existing CC0 records, and equivalent commercial-game fidelity is not asserted.

The refinement uses tapered rolled lapels, hems and cuffs, directional garment folds and asymmetric solid hair locks. Separate shoulder shells are removed, the chest and sleeve envelope is softer, and fine stitching replaces heavy sleeve/knee borders. Seven overlapping rear hair locks and a closer-fitting nape break up the rounded cap silhouette. The latest detail pass adds bounded adult jaw/chin, cheek, nose and brow planes with a shared skin/eye/lid warp. Fuller finger sides and palm backs use existing vertices while retaining the original wrist and contact undersides. Integrated lapel channels replace separate raised stitch ribbons, with restrained sleeve folds and cuff edging. This pass preserves all embedded images, hair, trousers, rigs and choreography. Separate garment islands may still show small intersections in extreme bends; sampled visual review does not certify every frame. Current geometry and download sizes are recorded with each release. The landscape uses lower foreground hills, smoother distant ridges, clustered pines and stone foundations beneath the gates and lanterns.

The standing idle now includes an opposed 18mm pelvis sway and gentle knee flex, solving each leg back to its original ankle contact and preserving the planted foot orientation. This changes only `standing_stance` choreography; the other 15 clips remain unchanged by the movement pass. The 1.8-second export starts at time zero so the loop has no one-frame hold. CPU regression checks sample between exported keys for ankle/forefoot drift, sole rotation, fixed leg lengths, natural scale and position/velocity continuity. This is an idle presentation change, not a new technique or a claim of coaching accuracy.

The optional Close-up view follows the current paired pose, bringing grounded holds nearer while retaining both athletes. It samples cached bone positions with a conservative surface allowance; it does not bake meshes every frame. Front, Side, Overhead and Free rotate still use the complete motion envelope. Perspective projection, dimensional models and orbit control remain; the Side default does not flatten the scene. Preset transitions settle to an exact orientation so paused study frames remain still. Front and Close-up share a 14-degree elevation so the bounded current pose cannot widen the camera fit. The five view buttons wrap into two rows on narrow phones.

The self-contained [character source and license records](../tools/assets/jiuquest-realistic/README.md) support offline Blender regeneration without the MPFB add-on. The distributed character/texture assets are CC0; the add-on itself is not bundled. No paid character asset was purchased.

## Build the player after source or animation changes

Required: Node 24, pnpm 11, Unity `6000.3.28f1` with Web Build Support and an activated eligible editor license. Never commit a license file, account credential, cache or raw editor log.

```powershell
pnpm install --frozen-lockfile
pnpm unity:test
pnpm unity:build
pnpm release:pack
pnpm test
pnpm release:build
pnpm exec playwright install chromium
pnpm test:browser
pnpm preview --port 4173 --strictPort
```

For an editor outside the default locations:

```powershell
pwsh -NoProfile -File tools/build_unity_preview.ps1 -UnityEditor 'C:\Unity\6000.3.28f1\Editor\Unity.exe'
```

Only one Unity Editor may operate on the project at a time. Stop this checkout's local Vite development/preview servers before building or restoring the player: Windows directory watchers can lock the generated output during replacement. Editor output and test results stay in ignored `tmp/unity`. The builder stages and hashes all GLBs, prepares a generated URP scene, takes a normalized source snapshot, and verifies that snapshot after compilation. It excludes generated performance-test metadata and checks the packed-asset report before publishing a successful build.

The player uses gzip with Unity decompression fallback, so a static host need not supply custom Content-Encoding headers. Hashed engine filenames and build-specific GLB requests prevent old cached content from silently mixing with a new player. This follows [Unity's static hosting guidance](https://docs.unity.com/en-us/engine/6000.3/manual/platform-specific/webgl/develop/class-player-settings-web-gl).

`release:pack` creates the allowlisted, versioned `releases/unity/player.bundle.gz` and its SHA-256 descriptor. The archive includes the engine and build metadata; canonical GLBs are already in the repo and are not duplicated inside it. Source or asset changes require rebuilding and repackaging. [Release package details](../releases/unity/README.md).

## Review and production workflow

GitHub Actions restores and validates the pinned player before building the website. It runs Node tests and actual Chromium/WebGL browser checks, then saves a downloadable release-candidate artifact and browser evidence. Pull requests cannot execute the production deployment job.

`release:build` also checks the exact Unity file set, sizes, SHA-256 values and CNAME in the finished website. A React build alone does not establish a complete game release. The workflow records the exact Git commit, Unity source fingerprint and archive hash in release.json.

An approved merge to main triggers the existing GitHub Pages production workflow. A manual production run is restricted to main. **Erik's approval is required before merging or deploying.** No production change is authorized by preparing this candidate.

After approval and deployment, verify the deployed release.json, real Unity rendering on jiuquest.com, supported Training/Arena outcomes, athlete identity, persistence after reload, and the snapshot fallback. Roll back to the previous approved commit through Pages if those checks fail; never delete saved player progress as a rollback step.

## Verification boundaries

Automated checks cover paired GLB structure, curriculum mapping, combat role/outcome correctness, saved-progress behavior, lifecycle and failure handling, portrait/landscape framing, source provenance, archive corruption/path rejection, real-player loading, playback controls and phone-width layouts. Browser reports and screenshots are in ignored tmp/browser and the corresponding CI artifact.

The browser harness saves atomic progress checkpoints at clip, capture and lifecycle boundaries. Render-frame waits, failure diagnostics and shutdown are bounded, so an interrupted run retains its completed checks. The GitHub build job allows 45 minutes for software-rendered browser verification; this runner budget is not an estimate of a player's loading or playback performance.

Cold-start timing uses a passive in-page observer. It requires the current player's paused initial move, a visible ready canvas and enabled controls, followed by two animation frames with the same state. The 90-second gate uses that navigation-relative timestamp. Reports retain the test controller's elapsed time, factory and move milestones, and resource timings separately so slow automation round trips cannot be mistaken for loading time. Actual screenshots and the existing runtime-state assertions still verify the loaded scene.

The application keeps one 90-second initialization deadline through its first settled scene. Factory completion and handshake events do not shorten or restart that deadline. Later technique changes use a 30-second watchdog. An expired initialization cannot be revived by late events; cleanup releases an existing player, while an unresolved factory retains its loader lease until it can finish and quit. With the preview server running, `node tools/test_unity_startup_budget.mjs` reproduces a first GLB download held for 32 seconds and verifies the real player loads after that request continues unchanged.

Viewport emulation and network throttling run on a desktop browser/GPU. Physical iPhone Safari and Android Chrome loading, sustained frame time, thermal behavior and memory remain separate device checks. Before broad release, review a cold load, several move changes, portrait/landscape rotation, touch seeking, free rotation, fullscreen where supported, and ten minutes of play on both devices. Choreography still requires qualified BJJ review before presenting it as verified instruction.

Native apps, real-time PvP simulation, NPC quests and networking are later scope. No networking provider or paid asset has been purchased for this candidate.
