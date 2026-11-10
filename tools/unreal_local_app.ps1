[CmdletBinding()]
param([string]$EngineRoot='C:\Program Files\Epic Games\UE_5.8')
$ErrorActionPreference='Stop'
$jqRoot=Split-Path -Parent $PSScriptRoot
if (Get-Process -Name 'UnrealEditor','UnrealEditor-Cmd' -ErrorAction SilentlyContinue) { throw 'Close the current Unreal preview before starting the app preview.' }
$jqVersion=Get-Content -LiteralPath (Join-Path $EngineRoot 'Engine/Build/Build.version') -Raw | ConvertFrom-Json
if ($jqVersion.MajorVersion -ne 5 -or $jqVersion.MinorVersion -ne 8) { throw 'The local app preview requires Unreal Engine5.8.' }
$jqListener=@(Get-NetTCPConnection -State Listen -LocalPort 49088 -ErrorAction SilentlyContinue)
if ($jqListener.Count -ne 1 -or $jqListener[0].LocalAddress -ne '127.0.0.1') { throw 'Start the guarded loopback Pixel Streaming server first.' }
$jqProject=Join-Path $jqRoot 'unreal/JiuQuestCharacters/JiuQuestCharacters.uproject'
$jqScript=Join-Path $jqRoot 'unreal/JiuQuestCharacters/Content/Python/local_app_preview.py'
$jqOut=Join-Path $jqRoot 'tmp/unreal-local-app'
New-Item -ItemType Directory -Path $jqOut -Force | Out-Null
$jqLog=Join-Path $jqOut ('preview-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'.log')
$jqArgs=@(('"'+$jqProject+'"'),('-ExecutePythonScript="'+$jqScript+'"'),'-unattended','-nop4','-nosplash',('-abslog="'+$jqLog+'"'),
 '-PixelStreamingEditorAutoStreamPIE=false','-PixelStreamingEditorStartOnLaunch=false','-PixelStreamingEditorUseRemoteSignallingServer=true',
 '-PixelStreamingAutoStartStream=false','-PixelStreamingURL=ws://127.0.0.1:49088','-AudioMixer','-RenderOffScreen','-notraceserver','-traceautostart=0')
$jqProcess=Start-Process -FilePath (Join-Path $EngineRoot 'Engine/Binaries/Win64/UnrealEditor-Cmd.exe') -ArgumentList $jqArgs -WorkingDirectory $jqRoot -WindowStyle Hidden -PassThru
[ordered]@{status='local_editor_preview_starting_not_validated';processId=$jqProcess.Id;log=$jqLog;script=$jqScript} | ConvertTo-Json
