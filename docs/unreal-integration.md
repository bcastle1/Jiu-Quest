# Unreal renderer pilot inside JiuQuest

The purchased-gi MetaHuman now has a separately verified local Win64 standalone idle/walk preview. It is not the paired-character Editor receiver described below and does not yet advertise combat moves. The two DGX Sparks have authenticated hardware inventories; their installed-software compatibility gaps and the remaining release checks are recorded in [Unreal Spark hosting](unreal-spark-hosting.md).

The experimental [native character receiver](../unreal/native-runtime/README.md) separates video from local playback commands. Its `jiuquest.characterPreview` channel is limited to the human idle/walk study. It is not connected to this app's combat bridge, and importing its source does not start a listener or change the production renderer. See its validation table for the exact compiled, tested and still-pending boundaries.

The local development app can select an Unreal Pixel Streaming preview in its actual Training and Arena views. This is restricted to a Vite development build at `http://127.0.0.1:5178`; use `?engine=unreal` or the local **Character graphics** selector. Production renderer selection is unchanged. The local iframe loads the pinned Epic UE5.8 library from the loopback service described in `docs/unreal-local-streaming.md`. This integration does not supply a public GPU host. A working Unreal receiver, actual imported characters, controls and presented video must be verified together; protocol tests alone do not prove rendering.

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
