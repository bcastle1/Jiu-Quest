#include "JQPixelStreamingTransport.h"
#include "JQControlWire.h"
#include "JQTransportPolicy.h"
#include "IPixelStreaming2Module.h"
#include "IPixelStreaming2Streamer.h"
#include "PixelStreaming2VideoProducers.h"
#include "PixelStreaming2Delegates.h"
#include "IWebSocket.h"
#include "WebSocketsModule.h"
#include "HAL/PlatformMisc.h"
#include "HAL/IConsoleManager.h"
#include "Containers/StringConv.h"

namespace {
std::string Bytes(const FString& S) {
    const FTCHARToUTF8 Utf8(*S); return std::string(Utf8.Get(), Utf8.Length());
}
FString String(const std::string& S) {
    const FUTF8ToTCHAR Text(S.data(), static_cast<int32>(S.size())); return FString(Text.Length(), Text.Get());
}
bool DefaultsDisabled() {
    const auto& Console = IConsoleManager::Get();
    auto* Init = Console.FindConsoleVariable(TEXT("PixelStreaming2.InitializeDefaultStreamer"));
    auto* Auto = Console.FindConsoleVariable(TEXT("PixelStreaming2.AutoStartStream"));
    return Init && Auto && !Init->GetBool() && !Auto->GetBool();
}
}
struct FJQPixelStreamingTransport::FImpl {
    FString Id, Url, Secret;
    FMessage Message; FPeerLost Lost; FFailure Failure;
    TSharedPtr<IPixelStreaming2Streamer> Streamer;
    TSharedPtr<IWebSocket> Control;
    TWeakObjectPtr<UPixelStreaming2Delegates> Delegates;
    FDelegateHandle ReadyHandle, SignallingHandle, ConnectedHandle, MessageHandle, ClosedHandle, ErrorHandle, BinaryHandle;
    JQControl::Gate Gate;
    bool bStarted = false, bStopping = false;
};
FJQPixelStreamingTransport::FJQPixelStreamingTransport() : Impl(MakeUnique<FImpl>()) {}
FJQPixelStreamingTransport::~FJQPixelStreamingTransport() { Stop(); }
bool FJQPixelStreamingTransport::Start(const FString& Id, const FString& Url, FMessage Message, FPeerLost Lost, FFailure Failure) {
    if (!JQ::bVideoOnlyControlCandidateEnabled || !IsInGameThread() || Impl->bStarted || Id.IsEmpty() || Id.Len() > 80 || !JQ::IsReviewedLocalUrl(Url)) return false;
    for (TCHAR C : Id) if (!((C >= 'a' && C <= 'z') || (C >= 'A' && C <= 'Z') || (C >= '0' && C <= '9') || C == '_' || C == '-')) return false;
    // Supplied only to the owned child process by the local gateway launcher.
    // Never place this secret in command arguments, assets, UI, logs, or receipts.
    Impl->Secret = FPlatformMisc::GetEnvironmentVariable(TEXT("JIUQUEST_LOCAL_CONTROL_TOKEN"));
    FPlatformMisc::SetEnvironmentVar(TEXT("JIUQUEST_LOCAL_CONTROL_TOKEN"), TEXT(""));
    if (!JQControl::Hex(Bytes(Impl->Secret), 64)) { Impl->Secret.Reset(); return false; }
    Impl->Id = Id; Impl->Url = Url; Impl->Message = MoveTemp(Message); Impl->Lost = MoveTemp(Lost); Impl->Failure = MoveTemp(Failure);
    Impl->bStarted = true;
    auto& Module = IPixelStreaming2Module::Get();
    if (!DefaultsDisabled()) { Fail(); return false; }
    const TWeakPtr<FJQPixelStreamingTransport> Weak = AsShared();
    if (Module.IsReady()) StartReady();
    else Impl->ReadyHandle = Module.OnReady().AddLambda([Weak](IPixelStreaming2Module&) {
        if (auto Self = Weak.Pin(); Self && IsInGameThread()) Self->StartReady();
    });
    return Impl->bStarted;
}
void FJQPixelStreamingTransport::StartReady() {
    if (!IsInGameThread() || !Impl->bStarted || Impl->bStopping || Impl->Streamer || !IPixelStreaming2Module::IsAvailable()) return;
    auto& Module = IPixelStreaming2Module::Get();
    if (Impl->ReadyHandle.IsValid()) { Module.OnReady().Remove(Impl->ReadyHandle); Impl->ReadyHandle.Reset(); }
    if (!DefaultsDisabled()) { Fail(); return; }
    // This runtime owns its only streamer; no default or unrelated input path.
    if (!Module.GetStreamerIds().IsEmpty()) { Fail(); return; }
    Impl->Streamer = Module.CreateStreamer(Impl->Id);
    if (!Impl->Streamer) { Fail(); return; }
    // This MUST precede any connection. RTC returns on null BEFORE Multiplexed,
    // ChannelRelayStatus, InputHandler or native helper processing. SCTP itself
    // may still negotiate; it is not our control path or readiness signal.
    Impl->Streamer->SetInputHandler(nullptr);
    if (Impl->Streamer->GetInputHandler().IsValid()) { Fail(); return; }
    const auto Video = UE::PixelStreaming2::CreateVideoProducerBackBuffer();
    if (!Video) { Fail(); return; }
    Impl->Streamer->SetVideoProducer(Video);
    Impl->Streamer->SetConnectionURL(Impl->Url);
    const TWeakPtr<FJQPixelStreamingTransport> Weak = AsShared();
    auto* D = UPixelStreaming2Delegates::Get();
    if (!D) { Fail(); return; }
    Impl->Delegates = D;
    Impl->SignallingHandle = D->OnDisconnectedFromSignallingServerNative.AddLambda([Weak](FString Id) {
        if (auto Self = Weak.Pin(); Self && IsInGameThread() && Id.Equals(Self->Impl->Id, ESearchCase::CaseSensitive)) Self->Fail();
    });
    Impl->Control = FWebSocketsModule::Get().CreateWebSocket(TEXT("ws://127.0.0.1:49081/native"));
    if (!Impl->Control) { Fail(); return; }
    // Lws honors this cap. Installed WinHttp logs this as unimplemented, so the
    // owned loopback server also bounds every outgoing frame to 8300 bytes.
    Impl->Control->SetTextMessageMemoryLimit(JQControl::MaxWire);
    Impl->ConnectedHandle = Impl->Control->OnConnected().AddLambda([Weak]() {
        if (auto Self = Weak.Pin(); Self && IsInGameThread()) Self->ControlConnected();
    });
    Impl->MessageHandle = Impl->Control->OnMessage().AddLambda([Weak](const FString& Wire) {
        if (auto Self = Weak.Pin(); Self && IsInGameThread()) Self->ControlMessage(Wire);
    });
    Impl->ErrorHandle = Impl->Control->OnConnectionError().AddLambda([Weak](const FString&) {
        if (auto Self = Weak.Pin(); Self && IsInGameThread()) Self->Fail();
    });
    Impl->ClosedHandle = Impl->Control->OnClosed().AddLambda([Weak](int32, const FString&, bool) {
        if (auto Self = Weak.Pin(); Self && IsInGameThread()) Self->Fail();
    });
    Impl->BinaryHandle = Impl->Control->OnBinaryMessage().AddLambda([Weak](const void*, SIZE_T, bool) {
        if (auto Self = Weak.Pin(); Self && IsInGameThread()) Self->Fail();
    });
    // Installed Lws GameThreadTick and WinHttp GameThreadTick deliver callbacks
    // serially on game thread. Weak handlers are removed before Close/Stop.
    Impl->Control->Connect();
    if (Impl->bStarted && Impl->Streamer) Impl->Streamer->StartStreaming();
}
void FJQPixelStreamingTransport::ControlConnected() {
    if (!Impl->bStarted || Impl->bStopping || !Impl->Control || !Impl->Control->IsConnected() || !JQControl::Hex(Bytes(Impl->Secret), 64)) { Fail(); return; }
    Impl->Control->Send(TEXT("NATIVE\n") + Impl->Secret); Impl->Secret.Reset();
}
void FJQPixelStreamingTransport::ControlMessage(const FString& Wire) {
    if (!Impl->bStarted || Impl->bStopping || !Impl->Streamer || Impl->Streamer->GetInputHandler().IsValid()) { Fail(); return; }
    const auto R = Impl->Gate.Receive(Bytes(Wire));
    switch (R.Kind) {
    case JQControl::Action::Ready: break;
    case JQControl::Action::Attach: break;
    case JQControl::Action::Detach: if (Impl->Lost) Impl->Lost(String(R.Peer)); break;
    case JQControl::Action::Command: if (Impl->Message) Impl->Message(String(R.Peer), String(R.Descriptor)); break;
    default: Fail(); break;
    }
}
void FJQPixelStreamingTransport::Fail() {
    if (!Impl->bStarted || Impl->bStopping) return;
    const auto Failure = Impl->Failure; Stop(); if (Failure) Failure();
}
void FJQPixelStreamingTransport::Stop() {
    if (!Impl || Impl->bStopping) return;
    check(IsInGameThread()); Impl->bStopping = true; Impl->bStarted = false;
    if (IPixelStreaming2Module::IsAvailable() && Impl->ReadyHandle.IsValid()) IPixelStreaming2Module::Get().OnReady().Remove(Impl->ReadyHandle);
    Impl->ReadyHandle.Reset();
    if (auto* D = Impl->Delegates.Get()) D->OnDisconnectedFromSignallingServerNative.Remove(Impl->SignallingHandle);
    Impl->Delegates.Reset();
    if (Impl->Control) {
        Impl->Control->OnConnected().Remove(Impl->ConnectedHandle); Impl->Control->OnMessage().Remove(Impl->MessageHandle);
        Impl->Control->OnClosed().Remove(Impl->ClosedHandle); Impl->Control->OnConnectionError().Remove(Impl->ErrorHandle);
        Impl->Control->OnBinaryMessage().Remove(Impl->BinaryHandle); Impl->Control->Close(1000, TEXT("Local preview stopped"));
    }
    Impl->Control.Reset(); Impl->Gate.Clear(); Impl->Secret.Reset();
    if (Impl->Streamer) {
        Impl->Streamer->SetInputHandler(nullptr); Impl->Streamer->StopStreaming(); Impl->Streamer->SetVideoProducer(nullptr);
        if (IPixelStreaming2Module::IsAvailable()) IPixelStreaming2Module::Get().DeleteStreamer(Impl->Streamer);
    }
    Impl->Streamer.Reset(); Impl->Message = nullptr; Impl->Lost = nullptr; Impl->Failure = nullptr; Impl->bStopping = false;
}
bool FJQPixelStreamingTransport::Send(const FString& Peer, const FString& Json) {
    if (!IsInGameThread() || !IsRunning()) return false;
    const auto Wire = Impl->Gate.Response(Bytes(Peer), Bytes(Json));
    if (Wire.empty()) return false;
    Impl->Control->Send(String(Wire)); return true; // Submitted, not delivery proof.
}
bool FJQPixelStreamingTransport::IsRunning() const {
    return Impl->bStarted && !Impl->bStopping && DefaultsDisabled() && Impl->Streamer && !Impl->Streamer->GetInputHandler().IsValid()
        && Impl->Control && Impl->Control->IsConnected() && Impl->Gate.Ready();
}
