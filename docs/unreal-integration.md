# Unreal renderer pilot inside JiuQuest

The purchased-gi MetaHuman now has a separately verified local Win64 standalone idle/walk preview. It is not the paired-character Editor receiver described below and does not yet advertise combat moves. The two DGX Sparks have authenticated hardware inventories; their installed-software compatibility gaps and the remaining release checks are recorded in [Unreal Spark hosting](unreal-spark-hosting.md).

The experimental [native character receiver](../unreal/native-runtime/README.md) separates video from local playback commands. Its `jiuquest.characterPreview` channel is limited to the human idle/walk study. It is not connected to this app's combat bridge, and importing its source does not start a listener or change the production renderer. See its validation table for the exact compiled, tested and still-pending boundaries.

The local development app can select an Unreal Pixel Streaming preview in its actual Training and Arena views. This is restricted to a Vite development build at `http://127.0.0.1:5178`; use `?engine=unreal` or the local **Character graphics** selector. Production renderer selection is unchanged. The local iframe loads the pinned Epic UE5.8 library from the loopback service described in `docs/unreal-local-streaming.md`. This integration does not supply a public GPU host. A working Unreal receiver, actual imported characters, controls and presented video must be verified together; protocol tests alone do not prove rendering.

## Public character preview (captured stills)

jiuquest.com shows three captured stills of the saved purchased-gi character at `/?preview=unreal`, linked from the Overview. Per the local capture receipt recorded November 10, 2026, they are unedited native viewport captures from the verified character-control scene: white gi standing, a face and collar close-up, and navy gi during the walk animation. `src/unreal/characterPreview.js` pins each file's size and SHA-256, and `tests/unrealCharacterPreview.test.js` fails if a file is replaced or re-encoded. Change the pinned values only together with a newly verified capture.

The page is a static gallery. It never mounts the game, reads or writes saved progress, opens a stream, or changes renderer selection; the production combat renderer remains Unity. `tools/test_unreal_character_preview.mjs` checks the built page in a browser: image decoding, view selection, phone layouts and the absence of saved-progress writes. That check covers still images only. It is not evidence of Unreal rendering, browser video or paired choreography, which remain the separate runtime checks described below.

## Unreal athlete in the Fighter Creator (tintable stills)

The Fighter Creator offers two looks for a fighter: **Unreal athlete** and **Classic**. The Unreal athlete is the purchased-gi character as a front-view still. It appears on the profile stage, in the round portraits, beside the proficiency test in Training, on the rank path in Insights, and in the Overview hero when the hero is at least 700 pixels wide (narrower heroes keep the classic art). Arena and Training position art are unchanged and still use the classic appearance choices.

The picture is four still layers that the browser adds together:

    picture = base + jacket x giTop + pants x giPants + belt x beltColor

The athlete stays dark until the body and all three gi layers have loaded, so a gi never shows without the person wearing it; a layer that fails to load does not hold the others back.

`tools/build_unreal_athlete_layers.py` derives the layers from three aligned renders in the local `Unreal-render-pack/athlete-01/front` set: white gi, black gi, and black gi with a white belt. The render receipt of November 11, 2026 records them as unedited 2400 by 3000 native renders of the hip-belt variant `BP_AthleteGi_HipBelt`, in which the belt sits on the hips. The published layers are 900 by 1760. They are derived images, not direct renders. With every color white the sum gives back the white-gi render (mean difference 0.013 of 255 on the gi). Every other color is computed rather than rendered, and there is no rendered reference for a jacket and pants in different colors, because the current materials color the whole gi at once; the tool separates the two at the jacket hem it finds in the white-gi render. The belt takes the rank color; stripes are not drawn on the athlete. The pack also holds side, back and portrait renders, which the site does not use yet.

`src/unreal/athlete.js` pins the SHA-256 of the three source renders and the size and SHA-256 of each published layer, and `tests/unrealAthlete.test.js` fails if a layer is replaced or re-encoded or if the tool and the page disagree about the sources. Replace the layers only by rerunning the tool on newly verified renders and updating the pinned values together. The first published layers (November 11, 2026, #24) came from four lower-resolution captures in `Unreal-gi-color-preview` with the belt at the waist; the still preview at `/?preview=unreal` still shows captures of that earlier variant.

There is one athlete: one face, build and hairstyle, in one pose. While it is selected the Fighter Creator hides gender, hair, skin tone and patch emblem, and keeps their saved values for the way back to Classic. New fighters and first visits start as the Unreal athlete. A fighter saved before this change moves to the Unreal athlete only if it still has the stock face, hair, skin and emblem; a fighter someone designed keeps its classic art until its owner switches.

`tools/test_unreal_athlete.mjs` checks the built site in a browser: layer decoding and blending, painted colors after each choice, both looks, saved fighters, reload, and 390 and 320 pixel layouts. Like the preview check, it covers still images only and is not evidence of Unreal rendering, browser video or paired choreography. Selecting the athlete never opens a stream and is not an input to renderer selection.

## Pre-rendered Unreal clips (Arena standing stance)

The Arena shows a pre-rendered Unreal clip while both athletes are on their feet and no exchange has settled: before a match starts, and through the first sequence of a standing start. It is the `standing_stance` clip from the render pack: 1280 by 720, 30 frames a second, 54 frames, looping, in side and front views. Once an exchange settles, and for every other position, the Arena shows the Unity animation where one exists, otherwise the position picture (see the position stills below). No other move has a clip yet.

`tools/import_unreal_clips.py` copies each MP4 from the render pack unchanged, after checking it against the pack's `technique-clips.json` (size and SHA-256) and with ffprobe (H.264 High, yuv420p, picture size, frame rate, frame count, index before media, no audio). It re-encodes each lossless poster as a smaller lossy WebP and writes `src/unreal/techniqueClips.data.js`, which pins every published file. `tests/unrealTechniqueClips.test.js` fails if a file is replaced, if a clip names a move the game does not know, or if a file is published without being pinned.

The outfits in a clip are fixed: the player's fighter in a white gi and the opponent in navy, both in black belts, whatever the player's own fighter wears. The stage says so beside the picture. Both athletes are the same character. The render receipt of November 11, 2026 records per-frame pose and contact checks and a review of sampled frames. It also records that no qualified choreography review has been done (`choreographyReviewed` is false) and that its author decoded the encoded files but did not watch them play.

`tools/test_unreal_clip_stage.mjs` checks the built site in a browser: the clip plays, loops, pauses and changes camera; reduced motion starts paused on the poster; a clip that cannot load gives way to the position snapshot; the stance gives way once an exchange settles; 390 and 320 pixel layouts. It covers a video file played by the browser. It is not evidence of Unreal rendering in the browser or of a stream. The local live preview (`?engine=unreal` on localhost) is unchanged and renders the stance itself.

## Unreal position stills (standing, tintable)

Where the Arena and Training show a picture of a settled position, a player who chose the Unreal athlete now sees two Unreal athletes for the standing position, each in their own jacket, pants and belt colors. It is used in Training as the position reference for techniques that start standing, in the Arena when an exchange settles with both athletes on their feet, and in the Overview's scenario teaser. Every other position still shows the classic picture, because Unreal has not rendered it yet.

The still is the first frame of the `standing_stance` clip, rendered five times at 2560 by 1440: everything black, each athlete's gi in white, each athlete's belt in white. `tools/build_unreal_position_layers.py` checks each render against the pack's `positions.json` (size and SHA-256), crops to the three-to-two stage, splits each gi into jacket and pants at the jacket hem, and writes seven lossy WebP layers plus `src/unreal/positionStills.data.js`, which pins every published file and the hashes of the renders. The browser adds the layers:

`picture = base + leadJacket x lead.giTop + leadPants x lead.giPants + leadBelt x lead belt + the same three for the other athlete`

With a white gi the layers give back the white-gi render to a mean error of 0.03 out of 255. "Lead" is the athlete on top or in control; in a neutral position it is the athlete on the left, the player.

`chooseUnrealPositionStill` decides between the still and the classic picture. The still is used where it shows the exact position (the neutral standing stance). It also stands in, labeled as a general reference, where the classic picture was already only a general reference (rear clinch, standing headlock). It is not used where the classic picture shows the exact setup and the still does not: the clinch, whose picture shows the grips, and the Position Lab, whose text describes a grip exchange. A fighter with the classic look keeps the classic pictures and downloads no still. If any layer fails to load, the stage shows the classic picture and never a half-colored athlete.

Limits: both athletes are the same character, belts show no rank stripes, and the pose has had no owner or coach review (`poseReviewed` is false). `tests/unrealPositionStills.test.js` pins the files and the selection rule. `tools/test_unreal_position_still.mjs` checks the built site in a browser, including that the painted colors match the layer arithmetic. It covers still images composited by the browser, not Unreal running in the browser.

## Showcase cards (generated illustrations, not Unreal renders)

The five example-fighter cards on the Overview page (Crimson Guard, Void Striker, Blue Surge, Emerald Guard, Gold Hunter) are generated illustrations made to match the look of the Unreal athlete: photoreal skin, hair and woven gi, with each card's earlier aura, stance and gi colors kept. They are not renders of Unreal characters, and the game has no Unreal athlete with those faces or hairstyles. `tools/import_showcase_cards.py` checks each picture against the image job's `receipt.json`, trims it to four by five and publishes a 900 by 1125 WebP; `src/showcaseCards.data.js` pins the published files and the hashes of the source pictures. The five cards total about 0.7 MB; the illustrations they replace were 13 MB. `tests/showcaseCards.test.js` and `tools/test_showcase_cards.mjs` cover them.

## Stance pictures and the narrow hero (generated illustrations and an Unreal poster)

For a fighter with the Unreal look, the Profile's stance picker shows the Unreal athlete in each of the seven fighting stances, on the dark studio mat. These seven pictures are generated illustrations made to match the Unreal renders of that athlete. They are not Unreal renders, and their gi and belt are always white. The Arena's starting-stance picker (`src/components/StancePicker.jsx`, see [Starting stances](unreal-stances.md)) shows the same seven pictures to every fighter, whatever their look, because the clip above it always shows the Unreal athletes. `tools/import_stance_pictures.py` checks each picture against the image job's `receipt.json` and publishes a 480 by 600 WebP; `src/unreal/stancePictures.data.js` pins the published files. In the Profile, a fighter with the classic look keeps the classic stance figures, drawn in that fighter's own colors. `tests/unrealStancePictures.test.js` and `tools/test_unreal_athlete.mjs` cover the picker.

On a hero too narrow to stand the athlete beside the headline (phones, and desktop layouts under 700 pixels of hero width), a fighter with the Unreal look now sees the opening frame of the `standing_stance` clip behind the headline. That picture is the real Unreal poster already published for the clip. A fighter with the classic look keeps the classic hero art.

## Ownership and integration seams

React remains authoritative for curriculum ordering, training reps, unlocks, match outcomes, scores, ownership of positions, and persistence. `App.jsx` resolves training tests and Arena turns before renderer playback. Renderer messages describe playback only; a completed animation must never call `updateProgress`, resolve another Arena turn, or write saved state.

`GrapplingStage` selects the renderer at the existing `App.jsx` and `CombatArenaView.jsx` seams. `UnrealGrapplingStage` owns only playback and connection state. Existing Unity and position-snapshot paths remain available. `src/unreal/contract.js` reuses the exact move mapping and cosmetic sanitizer from `src/unity/bridge.js`; no technique is renamed or substituted. Arena may show `standing_stance` before an exchange only when its actual position is standing. Other positions retain snapshots until an exact supported result is available.

The current 1 vs 1 view is a paired, authored player/NPC technique. This integration does not add network multiplayer. `performerSide` follows the resolved technique actor (`actorIsPlayer`), which can differ from the eventual match winner. Both characters must use a single playback clock.

## Epic frontend boundary

The injected interface matches Epic's [UE5.8 PixelStreaming frontend implementation](https://github.com/EpicGamesExt/PixelStreamingInfrastructure/blob/UE5.8/Frontend/library/src/PixelStreaming/PixelStreaming.ts), inspected on 2026-11-08:

- `emitUIInteraction(descriptor)` accepts an object and serializes it; `false` means it could not send. The adapter passes an object, not an already serialized string.
- `addResponseEventListener(name, listener)` receives Unreal response strings; `removeResponseEventListener(name)` removes that listener.
- `addEventListener` and `removeEventListener` register lifecycle callbacks. The adapter invalidates its session on `webRtcDisconnected`, `webRtcFailed`, `streamPreDisconnect`, or `streamReconnect`.

No `emitCommand`, console command or arbitrary URL is exposed. The local frontend uses infrastructure commit `4afd64170216002070a42fa52a87a44d4e97e77c`, matching UE5.8, checked by the loopback launcher. Package and interface checks do not establish that imported assets render correctly.

The caller owns the Epic client, connection, video element and teardown. Create the bridge with a fresh unique ID for each mounted surface (for example `crypto.randomUUID()`). After the client's data channel can send, call `attach(client)`. A send rejection immediately returns the bridge to offline. Retry by attaching after the actual connection is usable, rather than treating a socket connection as success.

```js
const bridge = createUnrealBridge({
  instanceId: crypto.randomUUID(),
  onStatus: updatePlaybackConnectionState,
  onEvent: updatePlaybackOnly,
});
bridge.setScene({
  moveId: 'double_leg',
  performerSide: 'opponent',
  fighter, fighterBelt,
  opponent, opponentBelt,
  speed: 1, camera: 'side', compactViewport: false,
}, false);
// After a real Epic client has a usable data channel:
bridge.attach(client);
// On unmount: bridge.dispose(), then the owner tears down its Epic client.
```

This illustrates the bridge used by `UnrealGrapplingStage`. Its callbacks only update connection/playback UI. The iframe reports an open data channel only after Epic's actual `isDataChannelOpen()` returns true. After each `play`, it waits for a matching receiver `state` acknowledgement and two subsequent `requestVideoFrameCallback` presentations with nonzero video dimensions. The parent accepts that proof only for its current play request. A 45-second initial deadline prevents an endless startup state. `receiverReady` alone does not enable the stage controls or prove visible video, correct assets, quality or performance.

## Receiver protocol, version 1

Every command and response uses this envelope:

```json
{
  "channel": "jiuquest.combat",
  "protocolVersion": 1,
  "instanceId": "unique-mounted-surface",
  "sessionId": "unique-mounted-surface:1",
  "requestId": "unique-mounted-surface:1:setup",
  "type": "configure"
}
```

`attach` advances the session. Only `configure` is sent before the receiver handshake. The receiver must echo the instance, session and setup request and advertise only assets actually imported and ready in that runtime:

```json
{
  "channel": "jiuquest.combat",
  "protocolVersion": 1,
  "instanceId": "unique-mounted-surface",
  "sessionId": "unique-mounted-surface:1",
  "requestId": "unique-mounted-surface:1:setup",
  "type": "ready",
  "capabilities": { "moves": ["standing_stance", "double_leg"] }
}
```

There are 16 recognized canonical IDs in `UNREAL_MOVE_IDS`; recognition does not assert Unreal support. Only advertised IDs can play. The existing four curriculum mappings remain exact: `trap-roll-escape`, `double-leg-takedown`, `triangle-choke`, and `rear-naked-choke`. A generic armbar or pass must not stand in for an unmatched lesson. An empty capability list is valid but enables no playback controls.

The latest queued scene plays after a valid handshake. It contains:

| Field | Contract |
| --- | --- |
| `moveId` | Recognized and advertised canonical technique |
| `performerSide` | `fighter` or `opponent`; maps actor identity, not match result |
| `fighter`, `opponent` | Name, skin/hair colors, hair style, gi top/pants colors, belt color, stripes 0–4 only |
| `progress` | Finite number 0–1, shared by both actors |
| `paused` | Boolean |
| `speed` | 0.25, 0.5 or 1 |
| `camera` | `front`, `focus`, `side`, `overhead` or `orbit` |
| `compactViewport` | Boolean composition hint |

After readiness, the controls are `pause`, `resume`, `seek`, `reset`, `setSpeed`, `setCamera`, `setViewport`, and `requestState`. Controls carry the full sanitized scene snapshot and a new request ID; only `play` should replace/load a clip. Seek and reset pause; reset seeks to zero. Appearance changes use `setScene`, which sends a new `play` snapshot. No separate appearance or actor-clock command exists. A known but unadvertised selection pauses the previous scene and disables controls until a supported selection is made.

The receiver sends `state` and `completed` with the exact current request ID, current move ID, progress and playing boolean. A completion must report progress 1 and playing false. `error` has a plain message of 1–240 characters and optionally the active move ID; a configure error uses the setup request. Errors take the bridge offline. Stale sessions, stale requests, wrong moves and protocol versions are ignored. The receiver must similarly discard superseded asynchronous loads and commands from prior sessions.

All responses are JSON strings limited to 8,192 UTF-8 bytes. IDs are bounded and contain only letters, digits, colon, underscore and hyphen. Outbound values are explicitly selected; extra renderer fields cannot propagate scores or persistence actions to the app. The Unreal receiver must independently validate the same schema and restrict operations to this command list. These bounds are not session authentication: the hosting layer must authorize and isolate clients.

## Disconnect and lifecycle behavior

- A missing application handshake times out after 15 seconds. Transport connectivity never enables controls by itself.
- Visibility/reduced-motion pauses and viewport hints received before readiness update the queued scene without sending a control early or resetting saved playback progress.
- Stream loss, rejected sends and receiver errors disable controls and freeze the last confirmed progress with playing false.
- Reattach changes the session, repeats the handshake and sends the latest scene paused at its last confirmed position. It does not resolve another turn or award a rep.
- Dispose removes response/lifecycle listeners and rejects late callbacks and all subsequent controls. It does not own or disconnect a shared Epic client; that client must be stopped by its owner when appropriate.
- The local stage pauses on a hidden tab, respects reduced motion for automatic playback, and preserves app state if video never arrives or disconnects. Explicit Play/Replay remains available after genuine readiness. Retry replaces the iframe and nonce, advances the bridge session, and restores the last confirmed position paused. It requires new receiver/video proof; no playback callback awards a rep or resolves an exchange.

## Local browser boundary

The embedded page is fixed at `http://127.0.0.1:49080/jiuquest/embed`. Parent and child check the exact peer origin, window source, fresh per-mount UUID nonce and a bounded JSON-string envelope. Only protocol v1 scene commands, validated receiver responses, transport lifecycle and actual video-frame proof can cross that boundary. The frame CSP permits only the exact development app as an ancestor. Signalling remains on the original loopback ports, and the stock `/` frontend remains unchanged. Keyboard, mouse, touch, gamepad, camera and microphone capture are disabled in the embedded Epic client; app controls send the bounded JiuQuest protocol only.

Only advertised imported clips can play. The initial receiver targets `standing_stance`, `rear_naked_choke` and the generic `armbar` pilot; the armbar is not an exact guide mapping. The local preview currently has one imported spiked hairstyle and labels that limitation. A public runtime, authenticated session allocation, hosted stream URL, production engine switch and additional hairstyles are outside this local mode.

## Actual pilot and hosting still required

First prove a local stream using two actual characters, standing stance and one exact curriculum technique. Verify both performer directions, both actors' appearance, paired timing, controls, stream loss/reconnect and an actual displayed frame. Capture standing, face/gi close-up and ground finish frames; compare those rendered assets with the user's clothing/face references. Protocol tests provide no evidence of that visual quality.

The current GitHub Pages workflow publishes a static `dist` artifact. It can eventually deliver the embedded frontend while jiuquest.com remains the user-facing app, but that artifact cannot run an Unreal GPU process, signalling service or session allocator. A hosted runtime requires separately configured GPU capacity, trusted HTTPS/WSS endpoints, authenticated per-user sessions, session cleanup and capacity limits, and any required TURN connectivity. No vendor, paid service, public endpoint or production deployment is selected or purchased by this change. Keep runtime credentials outside the frontend and repository.

Run `node --test tests/unrealBridge.test.js` for the offline protocol/transport cases, or `node --test tests/*.test.js` for the repository's JavaScript suite (the same command as its package test script). These tests inject a fake transport solely to check message and lifecycle behavior; they are not a substitute for testing Epic's actual client, Unreal receiver, video stream or physical devices.
