# Native character control pilot

This is authored source for an explicit local character preview. It is not enabled by the website or the packaged character scene. It supports one verified character's `human_idle` and `human_walk` clips under `jiuquest.characterPreview`; these are not grappling techniques or Arena outcomes. No purchased content, compiled binaries, credentials or machine-specific project files are included.

## Verification boundary

| Check | Result |
| --- | --- |
| UE 5.8.4 UHT, Win64 Development Editor C++ compile and link | Passed with MSVC 14.44.35230 and SDK 10.0.26100.0 |
| Offline gateway/browser tests | 22 passed; injected sockets, no listeners |
| Portable C++ wire checks | 28 passed with MSVC; g++ command runs in offline CI |
| Native automation | Four exact tests passed in NullRHI; normal exit, zero native errors and initialized-harness/source preservation passed |
| Actual character binding, video-only streaming and browser controls | Not yet verified |
| Paired Arena/Training choreography, packaged receiver and public hosting | Not implemented or verified by this module |

The four native tests cover protocol validation, session ownership, playback boundaries and transport policy. They do not render a character or start a streaming connection. The initial run's hold on Editor-created config and empty directories is retained separately; the clean rerun used a frozen initialized harness with the same test assertions. The separate packaged character scene has been visually reviewed, but it does not contain this receiver.

## Layout and offline checks

`Source/JiuQuestRuntime` contains the runtime module and Unreal automation tests. `bridge` contains the local control gateway and embedded-browser client. `Tests` contains two Node test files and the standalone C++ wire executable; keep its `main` outside the Unreal module.

From the repository root:

```sh
npm run test:unreal-native
g++ -std=c++17 -Wall -Wextra -Werror -pedantic -I unreal/native-runtime/Source/JiuQuestRuntime unreal/native-runtime/Tests/control-wire-tests.cpp -o /tmp/jiuquest-control-wire-tests
/tmp/jiuquest-control-wire-tests
```

For MSVC, use a developer command prompt and compile the same test with `/std:c++17 /EHsc /W4 /WX /O2` and `/I` pointing to the module folder. These tests use standard libraries and fake transport; they do not require a GPU, SDK download or network service.

## Reproduce the native build

Use a new local UE 5.8 C++ project. Copy this module to its `Source/JiuQuestRuntime` folder. Add the runtime module to the project's `Modules` list with `LoadingPhase: Default`, enable the `PixelStreaming2` plugin, and include `JiuQuestRuntime` in the Editor target's `ExtraModuleNames`. A minimal target is:

```csharp
using UnrealBuildTool;
public class JQNativeControlEditorTarget : TargetRules
{
    public JQNativeControlEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.Latest;
        ExtraModuleNames.Add("JiuQuestRuntime");
    }
}
```

Before any Editor launch, add this to `Config/DefaultEngine.ini`:

```ini
[SystemSettings]
PixelStreaming2.InitializeDefaultStreamer=0
PixelStreaming2.AutoStartStream=0
```

Create an empty `Content` folder. Editor initialization may generate its own input/plugin config; establish and preserve that isolated harness baseline before a clean test run. Do not copy those generated settings or tokens into the repository. The transport checks both disabled defaults and rejects an existing streamer before creating its dedicated one.

Build with the installed engine's `Build.bat`:

```text
JQNativeControlEditor Win64 Development -Project=<absolute-project.uproject> -WaitMutex -NoHotReloadFromIDE -NoUBA
```

`-NoUBA` prevents the build accelerator listener observed during the initial build attempt. A compiled Editor module cannot be injected into an existing packaged game: a separately authored Game target and package are required.

Run the four tests with `UnrealEditor-Cmd.exe` and fresh report/log/user directories:

```text
<absolute-project.uproject> -NullRHI -unattended -nosound -nosplash -nop4 -ExecCmds="Automation RunTests StartsWith:JiuQuest.Runtime." -TestExit="Automation Test Queue Empty" -ReportExportPath=<fresh-report> -abslog=<fresh-log> -UserDir=<fresh-user-dir> -UDPMESSAGING_TRANSPORT_ENABLE=false -notraceserver -traceautostart=0
```

Require exactly `JiuQuest.Runtime.Protocol`, `ReceiverSession`, `PlaybackBoundary` and `TransportPolicy`, all successful, plus normal process exit, no native Error/Fatal severity and unchanged protected source/config. Queue completion alone is insufficient.

## Local transport boundary

The owned Pixel Streaming 2 streamer calls `SetInputHandler(nullptr)` before starting. Installed UE 5.8 source returns before handling Multiplexed, relay and helper input when this handler is null. SCTP/data-channel negotiation may still occur; this disables application input handling, not the RTC transport. No engine patch is used.

Controls use a separate strictly loopback gateway. The trusted launcher must bind `127.0.0.1:49081` exclusively before launching the native child. Create a fresh 256-bit native credential in memory and pass it only through `JIUQUEST_LOCAL_CONTROL_TOKEN`; never put it in arguments, logs, URLs, assets or checked-in files. The child clears its environment copy after reading. Exact browser Origin checks and short-lived, single-use browser credentials are local admission controls, not public hosting authentication. Malicious processes running as the same local user are outside this boundary.

There is one native owner and one browser lease. Framing, identities, byte limits, duplicate/case-colliding JSON keys, stale requests, rates and buffers are checked. Descriptor bytes reach the native parser unchanged. The trusted gateway bounds native incoming messages; the installed Windows WebSocket backend does not implement its text-memory-limit API, so that API is not claimed as an additional enforced bound.

On `DETACH`, the session pauses and clears ownership. On transport failure it pauses immediately, then component cleanup restores the scene's prior animation, materials and camera. Stopping the preview likewise restores prior scene state. There is no automatic reconnect or gameplay reward path.

See [integration-seams.md](integration-seams.md) for the remaining local app wiring and actual-runtime acceptance checks.
