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

Controls include play/pause, replay, timeline seeking, quarter/half speed, camera presets, free rotation, and supported-browser fullscreen. Reduced motion starts paused; hidden tabs pause. Phone layouts give the scene a taller viewport, 44px touch controls, and collapsed appearance options. Camera fitting covers the complete motion envelope and adjusts to the viewport; compact rendering targets 30fps and desktop 60fps. These are target rates, not measured physical-device performance claims.

If Unity cannot initialize, the view reports the error and offers the existing snapshot view without resetting the active match or saved progress.

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

Viewport emulation and network throttling run on a desktop browser/GPU. Physical iPhone Safari and Android Chrome loading, sustained frame time, thermal behavior and memory remain separate device checks. Before broad release, review a cold load, several move changes, portrait/landscape rotation, touch seeking, free rotation, fullscreen where supported, and ten minutes of play on both devices. Choreography still requires qualified BJJ review before presenting it as verified instruction.

Native apps, real-time PvP simulation, NPC quests and networking are later scope. No networking provider or paid asset has been purchased for this candidate.
