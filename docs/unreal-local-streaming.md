# Local Unreal Pixel Streaming preparation

`tools/pixel_streaming_local.cjs` is an original local harness around Epic's UE5.8
signalling SDK and reference frontend. It does not create a public app endpoint or
replace the live JiuQuest renderer. Verify the native Unreal character preview
before starting streaming. The project must separately enable Pixel Streaming 2.
Source import, successful builds, `/healthz`, and streamer registration do not prove
that Unreal video renders or plays correctly in a browser.

## Pinned infrastructure

Use the official [UE5.8 infrastructure branch](https://github.com/EpicGamesExt/PixelStreamingInfrastructure/tree/UE5.8),
at commit `4afd64170216002070a42fa52a87a44d4e97e77c`. The launcher checks this revision,
unchanged tracked vendor source, package versions, protocol version, and built frontend
before opening any sockets. The vendor tree, dependencies, logs and outputs remain
under ignored `tmp/unreal-pilot`; none belongs in the JiuQuest source commit.

From the repository root, for a new setup:

```powershell
git clone --depth 1 --branch UE5.8 --single-branch https://github.com/EpicGamesExt/PixelStreamingInfrastructure.git tmp/unreal-pilot/PixelStreamingInfrastructure-UE5.8
git -C tmp/unreal-pilot/PixelStreamingInfrastructure-UE5.8 fetch --depth 1 origin 4afd64170216002070a42fa52a87a44d4e97e77c
git -C tmp/unreal-pilot/PixelStreamingInfrastructure-UE5.8 checkout --detach 4afd64170216002070a42fa52a87a44d4e97e77c
```

Use an existing Node installation and a local npm CLI. Preparation was checked with
Node 24.22.1 and npm 12.2.2. npm was obtained from the official npm registry into
`tmp/unreal-pilot/npm-runtime/package`, with the tarball checked against registry
SHA-512 integrity before extraction; no global package installation is required.
If npm is already available, substitute `npm` for the local Node/npm CLI invocation.

```powershell
Set-Location tmp/unreal-pilot/PixelStreamingInfrastructure-UE5.8
node ../npm-runtime/package/bin/npm-cli.js ci --ignore-scripts --no-audit --no-fund --cache ../npm-cache --workspace Common --workspace Signalling --workspace SignallingWebServer --workspace Frontend/library --workspace Frontend/ui-library --workspace Frontend/implementations/typescript --include-workspace-root
```

Build in dependency order using the installed TypeScript CLI. The generated protocol
TypeScript is already in the pinned source; no protoc download, package lifecycle
script, or SFU build is required. From the infrastructure directory:

```powershell
$infraRoot = (Get-Location).Path
$tsc = Join-Path $infraRoot 'node_modules/typescript/bin/tsc'
$steps = @(
  @('Common','tsconfig.cjs.json'), @('Common','tsconfig.esm.json'),
  @('Signalling','tsconfig.cjs.json'), @('SignallingWebServer','tsconfig.json'),
  @('Frontend/library','tsconfig.cjs.json'), @('Frontend/library','tsconfig.esm.json'),
  @('Frontend/ui-library','tsconfig.cjs.json'), @('Frontend/ui-library','tsconfig.esm.json')
)
foreach ($step in $steps) {
  Push-Location (Join-Path $infraRoot $step[0])
  try { node $tsc --project $step[1]; if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed' } }
  finally { Pop-Location }
}
Push-Location (Join-Path $infraRoot 'Frontend/implementations/typescript')
try {
  node (Join-Path $infraRoot 'node_modules/webpack/bin/webpack.js') --config webpack.prod.js
  if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
} finally { Pop-Location }
```

## Check and run under supervision

Back at the JiuQuest repository root:

```powershell
node --test tools/pixel_streaming_local.test.cjs
node tools/pixel_streaming_local.cjs --check
```

Both commands are socket-free. After native preview verification and any applicable
tool review, run the service directly in a supervised terminal session:

```powershell
node tools/pixel_streaming_local.cjs
```

Leave that terminal running. In a second terminal at the repository root, launch
the actual offscreen renderer:

```powershell
pwsh -File tools/unreal_pilot.ps1 -Action Preview -Clip standing_stance -StreamLocal
```

Open `http://127.0.0.1:49080` and choose **Click to start**. The launcher reports
the renderer's process ID and log path. To review another clip, stop that renderer
first, then launch with `-Clip rear_naked_choke` or `-Clip armbar` and reload the
browser. Only one renderer and one browser subscriber are supported by this pilot.

When finished, stop the reported Unreal process in Task Manager, checking that its
command line points to this project. Then use Ctrl+C in the signalling terminal.
Stopping signalling alone does not stop the offscreen renderer or release its GPU.

The launcher discovers paths relative to its own file, so another current directory
does not change its vendor or public roots. There is no detached helper, global
service registration, firewall change, or configurable public binding. Ctrl+C/SIGINT
or SIGTERM closes both owned listeners and accepted sockets, including upgraded
WebSockets. A failed second bind or SDK/socket exception terminates the process and
cleans up the first listener rather than leaving a partial service.

After launch, inspect the owning Node process with `Get-NetTCPConnection`: the two
listeners must be `127.0.0.1:49080` and `127.0.0.1:49088`. The launcher also checks
actual bind addresses before constructing the SDK.

The project and launcher disable automatic Editor/Simulate streaming. UE5.8
otherwise starts its own embedded web/signalling listeners on wildcard ports
80 and 8888, separately from this Node service. Import/Capture explicitly pass
`-PixelStreamingEditorAutoStreamPIE=false`,
`-PixelStreamingEditorStartOnLaunch=false`,
`-PixelStreamingEditorUseRemoteSignallingServer=true` and
`-PixelStreamingAutoStartStream=false`. Only `Preview -StreamLocal` enables
runtime autostart with the fixed loopback URL above. Fifteen listener samples
during the final seventeen-view Simulate capture showed no 80/8888 listeners;
the subsequent local game preview also had none. Repeat that ownership check
after changing the engine or streaming configuration.

These settings do not constrain every socket in the installed Editor. Its
separate TraceLog control listener was observed on wildcard TCP 1985; the
installed source has no verified runtime flag to change that binding.
`-notraceserver -traceautostart=0` suppresses separate trace-server startup and
automatic recording, but does not prove that 1985 is closed. No firewall rule is
created or widened by this project. This Editor pilot is not a production host.

- Browser: `http://127.0.0.1:49080`
- Local health: `http://127.0.0.1:49080/healthz`
- Unreal launch argument: `-PixelStreamingURL=ws://127.0.0.1:49088`

Use the render resolution and codec already validated by the native preview. Epic's
[getting-started guide](https://dev.epicgames.com/documentation/unreal-engine/getting-started-with-pixel-streaming-in-unreal-engine)
documents enabling Pixel Streaming 2 and supplying this URL argument. No codec or
hardware compatibility is established by this harness.

## Bind and protocol contract

Both HTTP servers bind explicitly to `127.0.0.1`; the SDK reuses those servers and
cannot create an additional wildcard streamer listener. The player WebSocket accepts
only loopback requests with origin `http://127.0.0.1:49080`. The native streamer may
omit Origin or use that page origin or the observed UE5.8 host-only origin
`http://127.0.0.1`, but must still be loopback. Other origins are rejected.
HTTP Host is pinned to `127.0.0.1:49080`;
the `localhost` spelling is deliberately not an interchangeable browser URL.
Encoded path traversal and symlink escapes are rejected.

SFU is omitted, subscribers are limited to one, and `peerOptions.iceServers` is empty.
No external STUN/TURN service is contacted through this configuration. Browser camera,
microphone and geolocation permissions are disabled for the preview. These bindings
govern signalling and HTTP; Unreal and the browser negotiate their own WebRTC media
sockets. Review those separately if requiring restrictions beyond local signalling.

The pinned SDK versions are Common 0.1.0, Signalling 0.2.0, Frontend 0.1.3 and UI 0.1.2,
all with the `-ue5.8` package suffix. Signalling protocol is **1.3.0**: JSON WebSocket
messages negotiate config, streamer identity, offer/answer and ICE. Video and input
then use WebRTC. The stock frontend exposes `window.pixelStreaming` with
`emitUIInteraction(descriptor)` and `addResponseEventListener(name, listener)` for
a future explicit UE handler. This harness supplies no JiuQuest gameplay bridge,
scoring writes, console-command enablement, or remote-control API.
