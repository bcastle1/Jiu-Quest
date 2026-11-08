# Unreal renderer pilot inside JiuQuest

This is an offline integration foundation for an Unreal Pixel Streaming renderer inside the existing jiuquest.com app. It does not activate an Unreal route, load an Epic SDK, connect to a service, change the production renderer, or provide new character graphics. The Unreal receiver described below is not implemented by this JavaScript adapter. A working Unreal project, imported assets, receiver, stream and browser rendering still require direct verification.

## Ownership and integration seams

React remains authoritative for curriculum ordering, training reps, unlocks, match outcomes, scores, ownership of positions, and persistence. `App.jsx` resolves training tests and Arena turns before renderer playback. Renderer messages describe playback only; a completed animation must never call `updateProgress`, resolve another Arena turn, or write saved state.

The future embedded surface belongs where `UnityGrapplingStage` is currently used in `App.jsx` and `CombatArenaView.jsx`. It should preserve those controls and the existing fallback behavior. This pilot adds no calls at those seams. `src/unreal/contract.js` reuses the current exact move mapping and cosmetic sanitizer from `src/unity/bridge.js`; no Unity behavior is changed.

The current 1 vs 1 view is a paired, authored player/NPC technique. This integration does not add network multiplayer. `performerSide` follows the resolved technique actor (`actorIsPlayer`), which can differ from the eventual match winner. Both characters must use a single playback clock.

## Epic frontend boundary

The injected interface matches Epic's [UE5.8 PixelStreaming frontend implementation](https://github.com/EpicGamesExt/PixelStreamingInfrastructure/blob/UE5.8/Frontend/library/src/PixelStreaming/PixelStreaming.ts), inspected on 2026-11-08:

- `emitUIInteraction(descriptor)` accepts an object and serializes it; `false` means it could not send. The adapter passes an object, not an already serialized string.
- `addResponseEventListener(name, listener)` receives Unreal response strings; `removeResponseEventListener(name)` removes that listener.
- `addEventListener` and `removeEventListener` register lifecycle callbacks. The adapter invalidates its session on `webRtcDisconnected`, `webRtcFailed`, `streamPreDisconnect`, or `streamReconnect`.

No `emitCommand`, console command or arbitrary URL is exposed. A future frontend dependency must match the installed Unreal version and be pinned and checked then; this interface check does not establish that Unreal is installed or compatible with this project's assets.

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

This example is not wired into the app and does not fabricate a stream. Caller callbacks must only update connection/playback UI. The frontend must also observe an actual displayed video frame and enforce its own video-start deadline before declaring the graphics available. `receiverReady` means only that the application-level Unreal handshake succeeded; it does not prove visible video, correct assets, quality or performance.

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
- Stream loss, rejected sends and receiver errors disable controls and freeze the last confirmed progress with playing false.
- Reattach changes the session, repeats the handshake and sends the latest scene paused at its last confirmed position. It does not resolve another turn or award a rep.
- Dispose removes response/lifecycle listeners and rejects late callbacks and all subsequent controls. It does not own or disconnect a shared Epic client; that client must be stopped by its owner when appropriate.
- The eventual UI must pause on a hidden tab, respect reduced motion, and preserve the current app state if video never arrives or disconnects. These UI behaviors remain unimplemented for Unreal.

## Actual pilot and hosting still required

First prove a local stream using two actual characters, standing stance and one exact curriculum technique. Verify both performer directions, both actors' appearance, paired timing, controls, stream loss/reconnect and an actual displayed frame. Capture standing, face/gi close-up and ground finish frames; compare those rendered assets with the user's clothing/face references. Protocol tests provide no evidence of that visual quality.

The current GitHub Pages workflow publishes a static `dist` artifact. It can eventually deliver the embedded frontend while jiuquest.com remains the user-facing app, but that artifact cannot run an Unreal GPU process, signalling service or session allocator. A hosted runtime requires separately configured GPU capacity, trusted HTTPS/WSS endpoints, authenticated per-user sessions, session cleanup and capacity limits, and any required TURN connectivity. No vendor, paid service, public endpoint or production deployment is selected or purchased by this change. Keep runtime credentials outside the frontend and repository.

Run `node --test tests/unrealBridge.test.js` for the offline protocol/transport cases, or `node --test tests/*.test.js` for the repository's JavaScript suite (the same command as its package test script). These tests inject a fake transport solely to check message and lifecycle behavior; they are not a substitute for testing Epic's actual client, Unreal receiver, video stream or physical devices.
