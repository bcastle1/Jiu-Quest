# Unreal hosting on the two DGX Sparks

Status checked November 10, 2026 against the installed Unreal Engine 5.8.4 source and authenticated, read-only inventories of both machines.

The Sparks have plausible graphics and video-encoding hardware, but the installed Unreal streaming stack is **not ready to deploy on Linux ARM64**. A Windows executable copied to a Spark would not establish compatibility. A custom ARM build remains possible research; it has not been compiled or run for JiuQuest.

## What has been verified

Both machines report `aarch64`, Ubuntu 24.04.5 LTS and 127,595,088 KiB of system memory (about 121.7 GiB each). The second machine reports NVIDIA GB10 and driver 580.178.04. The first inventory's GPU row was discarded by an overly narrow local output filter, so its GPU model and driver remain unverified. No remote packages, services or workloads were changed.

NVIDIA documents a 20-core Arm CPU, 128 GB of unified memory, and one NVENC encoder and one NVDEC decoder in [DGX Spark's hardware specification](https://docs.nvidia.com/dgx/dgx-spark/hardware.html). Its [PyNvVideoCodec release notes](https://docs.nvidia.com/video-technologies/pynvvideocodec/read-me/release-notes-v10.html) also document Spark encode/decode support. Hardware encoding is present; interoperability with this Unreal build still needs execution proof.

The GPU memory field `[N/A]` is consistent with NVIDIA's [unified-memory reporting explanation](https://nvidia.custhelp.com/app/answers/detail/a_id/5775/). Do not treat it as missing physical memory or as a separate VRAM allocation.

## Installed software gaps

Paths below are relative to the installed engine's `Engine` directory. These findings describe this version and installation, not every possible Epic distribution.

| Component | Observed constraint |
| --- | --- |
| `Plugins/Media/PixelStreaming2/PixelStreaming2.uplugin` | Runtime platform allowlists omit the distinct `LinuxArm64` target. |
| `Plugins/Media/PixelCapture/PixelCapture.uplugin` | Capture module allowlists also omit `LinuxArm64`. |
| `Plugins/Experimental/AVCodecs/NVCodecs/NVCodecs.uplugin` | NVIDIA codec modules allow `Win64` and `Linux`, not `LinuxArm64`. |
| `Source/ThirdParty/WebRTC/WebRTC.Build.cs` | The enabled Unix branch requires `UnrealArch.X64`. |
| `Plugins/Media/PixelStreaming2/Source/ThirdParty/EpicRtc/EpicRtc.Build.cs` | Contains a Linux ARM64 library path, but this installation contains no Linux EpicRtc library payload. |

The base engine registers a Linux ARM64 target and RigLogic has ARM64 build handling. Those are useful starting points, not proof that the complete MetaHuman, groom, Vulkan, CUDA and encoder path works. Removing plugin allowlists alone does not supply missing libraries or validate rendering.

Epic's [Pixel Streaming reference](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-pixel-streaming-reference?application_version=5.8) describes supported operating systems and encoders generally. Its Linux wording is not a Linux ARM64 execution result for these machines.

## Current working path

The existing Windows NVIDIA computer already has the required C++ tools. The purchased-gi MetaHuman preview successfully built, cooked and ran as a Win64 standalone app. Its saved sequence played idle, walking and the return to idle, and the process closed normally. That preview is separate from the earlier imported paired-character Editor pilot and is not yet integrated into live Arena or Training.

Keep the renderer and initial local signalling/control services together on that working computer while verifying:

1. The refined character at close and Arena distances, including first-visible loading and automatic hair detail changes.
2. The native control boundary, actual hardware encoder and newly presented browser video.
3. Appearance changes, pause/seek/replay, disconnect and reconnection against actual native playback.
4. Exact paired jiu-jitsu choreography for advertised Arena and Training moves.
5. Authenticated public sessions, availability, capacity and signed-in production playback before changing the production renderer.

The Sparks could later run compatible supporting services. Such services would not make the Windows character executable run on ARM or replace the GPU renderer. No new paid hosting, public endpoint or firewall change is part of this assessment.

## What a Spark-only trial must prove

Start with one Spark and a Linux ARM64 package of the actual character scene. Establish Vulkan rendering, the required ARM dependencies, working NVENC interoperability, delivered browser frames, controls, frame time and sustained capacity. Preserve existing workloads during a separately scoped trial.

The two successful inventories do not prove the high-speed interconnect, tensor parallel operation or spare compute capacity. Tensor parallel model inference does not establish a combined graphics device or shared Unreal rendering memory. JiuQuest has no verified multi-host rendering implementation.
