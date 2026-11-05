# Unity combat preview

This branch adds an opt-in Unity 6.3 LTS combat renderer to the existing React app. The app remains responsible for combat outcomes and saved progress. Unity only presents paired character animation.

## Review routes

- `/?preview=unity` opens the isolated scene review page. It does not mount the persisted app or read/write player progress.
- `/?engine=unity` enables supported Unity movement previews in Training and Arena.
- `/` retains the existing renderer.

The preview has pause, replay, speed, timeline and camera controls, with fighter appearance and performer-role swapping. Reduced-motion preference starts animation paused. Failed or unsupported arena exchanges retain a labeled settled-position snapshot. A missing player build produces an explicit error; a snapshot is never presented as a working Unity animation.

The existing paired GLBs are authored choreography, not motion capture. They have not been reviewed by a BJJ coach. A generic armbar finish or guard pass must not stand in for a different named curriculum technique. The browser bridge accepts only explicitly supported IDs.

## Local build

Required tools: Node 24, pnpm 11, Unity `6000.3.28f1` with Web Build Support, and an activated eligible editor license. No secret, license file or account credential belongs in this repository.

From the repository root in PowerShell 7:

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm unity:test
pnpm unity:build
pnpm build
pnpm preview
```

If the editor is installed elsewhere, pass its executable explicitly:

```powershell
pwsh -NoProfile -File tools/build_unity_preview.ps1 -UnityEditor 'C:\Unity\6000.3.28f1\Editor\Unity.exe' -TestOnly
pwsh -NoProfile -File tools/build_unity_preview.ps1 -UnityEditor 'C:\Unity\6000.3.28f1\Editor\Unity.exe'
```

The Unity build stages and hashes the paired GLBs, generates its URP scene, and writes `public/unity/build-manifest.json` plus the actual player files. Logs and EditMode results stay in ignored `tmp/unity`. Player binaries, staged assets, Unity caches and local logs are ignored. Commit source, package locks and tests. A hosting build must produce or receive the verified Unity player before `pnpm build`; building React alone does not create the game.

Do not treat a successful React build or an HTTP 200 response as proof that Unity runs. The following browser acceptance checks require the real player, without a simulated loader:

1. Load the standalone preview from a fresh browser context; confirm visible paired fighters, URP scene, and actual movement.
2. Pause and seek both fighters together, change speed/camera, and replay. Verify the chosen frame is stable while paused.
3. Swap the performer and both kits. Fighter identity, skin, hair and belt must remain attached to the intended athlete.
4. Switch moves rapidly, navigate away and return, retry an asset failure, and check for stale scenes or surviving WebGL contexts.
5. In Training/Arena, verify a supported success and reversed NPC success. Failed attacks and unsupported techniques must not display a completed successful animation.
6. With reduced motion, confirm the first scene is paused. Hidden tabs must pause playback.
7. Confirm saved player progress is unchanged by the standalone preview.
8. Measure loading, sustained frame time and memory on physical iPhone Safari and Android Chrome. A desktop viewport emulation is a layout check, not a mobile GPU test.

## Release boundary

This is a review branch. Merging the default branch triggers the existing GitHub Pages production workflow, so merge and production release require approval. No multiplayer provider, paid asset, new hosting service or purchase is part of this preview. Future real-time PvP requires its own authoritative simulation and networking design; this renderer does not implement online combat.

## Observed verification — November 5, 2026

- 69 Node tests and 25 Unity EditMode tests passed; the actual WebGL player and React build succeeded.
- Edge loaded and rendered all 16 authored clips without simulated assets or engine events. Pause, seek, replay, role and kit changes, four camera modes, rapid move changes, and Training teardown/remount passed. Quarter-speed playback measured 0.2497 times normal playback.
- The standalone preview did not read or write JiuQuest progression. Missing-build, asset/loading failure handling, startup timeout, and stale-event safeguards were checked separately.
- At a 390 px emulated phone viewport, the real player started paused with reduced motion, explicit Play worked, and there was no horizontal overflow. This uses a desktop GPU; physical iPhone/Android loading, memory and frame performance remain unmeasured. Closer mobile framing also needs review.
- All 16 exported GLBs match source and staged copies by bytes and SHA-256. Generated performance-test resources are excluded from non-test builds and checked before a build manifest is published.

These checks establish a working engine preview, not coach-approved choreography, online multiplayer, a physical-phone performance guarantee, or a production release. The current GitHub Pages workflow still builds only React; approved release work must add the verified Unity player to the deployment artifact before exposing these routes publicly.
