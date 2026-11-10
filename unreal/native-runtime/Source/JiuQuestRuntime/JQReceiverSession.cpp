#include "JQReceiverSession.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Containers/StringConv.h"

namespace JQ
{
namespace
{
TSharedRef<FJsonObject> Envelope(const FCommand& C, const TCHAR* Type)
{
    auto O = MakeShared<FJsonObject>();
    O->SetStringField(TEXT("channel"), C.Channel);
    O->SetNumberField(TEXT("protocolVersion"), 1);
    O->SetStringField(TEXT("instanceId"), C.InstanceId);
    O->SetStringField(TEXT("sessionId"), C.SessionId);
    O->SetStringField(TEXT("requestId"), C.RequestId);
    O->SetStringField(TEXT("type"), Type);
    return O;
}
FString Json(const TSharedRef<FJsonObject>& O)
{
    FString Result;
    const auto Writer = TJsonWriterFactory<TCHAR,TCondensedJsonPrintPolicy<TCHAR>>::Create(&Result);
    if (!FJsonSerializer::Serialize(O, Writer) || FTCHARToUTF8(*Result).Length() > MaxMessageBytes) return {};
    return Result;
}
bool Is(const FCommand& C, const TCHAR* Type) { return C.Type.Equals(Type, ESearchCase::CaseSensitive); }
}

FReceiverSession::FReceiverSession(FProfile InProfile, IPreviewDriver& InDriver, FSend InSend)
    : Profile(MoveTemp(InProfile)), Driver(InDriver), Send(MoveTemp(InSend)) {}

bool FReceiverSession::Receive(const FString& Peer, const FString& Descriptor)
{
    FCommand C;
    if (!ParseCommand(Descriptor, Profile, C) || !Gate.Accept(Peer, C)) return false;
    if (Is(C,TEXT("configure")))
    {
        Driver.Pause(); bActive = false; Boundary = FPlaybackBoundary();
        SendReady(C); return true;
    }
    // Nonposition controls cannot silently select an asset or apply a stale scene.
    if (!Is(C,TEXT("play")) && (!bActive || !C.MoveId.Equals(Current.MoveId,ESearchCase::CaseSensitive)))
    { Driver.Pause(); Boundary.SetPlayingIntent(false); bActive=false; SendError(C); return false; }
    if (Is(C,TEXT("pause")) || Is(C,TEXT("seek"))) C.bPaused = true;
    if (Is(C,TEXT("reset"))) { C.Progress = 0; C.bPaused = true; }
    if (Is(C,TEXT("resume"))) C.bPaused = false;
    if (!Driver.Apply(C))
    {
        Driver.Pause(); Boundary.SetPlayingIntent(false); bActive = false;
        SendError(C); return false;
    }
    if (Is(C,TEXT("play")) || Is(C,TEXT("seek")) || Is(C,TEXT("reset")))
        Boundary.PositionCommand(C.Progress,C.bPaused);
    else if (Is(C,TEXT("pause"))) Boundary.SetPlayingIntent(false);
    else if (Is(C,TEXT("resume"))) Boundary.SetPlayingIntent(true);
    Current = MoveTemp(C); bActive = true;
    SendState(true);
    return true;
}

void FReceiverSession::SendReady(const FCommand& C)
{
    const auto O = Envelope(C,TEXT("ready"));
    const auto Capabilities = MakeShared<FJsonObject>();
    TArray<FString> Ids = Profile.VerifiedMoveIds.Array();
    Ids.Sort([](const FString& A,const FString& B) { return A.Compare(B,ESearchCase::CaseSensitive) < 0; });
    TArray<TSharedPtr<FJsonValue>> Values;
    for (const FString& Id : Ids) Values.Add(MakeShared<FJsonValueString>(Id));
    Capabilities->SetArrayField(TEXT("moves"),Values);
    if (Profile.Channel.Equals(TEXT("jiuquest.characterPreview"),ESearchCase::CaseSensitive))
    {
        Capabilities->SetStringField(TEXT("scope"),TEXT("single-human-preview"));
        Capabilities->SetNumberField(TEXT("actorCount"),1);
        const auto Appearance = MakeShared<FJsonObject>();
        Appearance->SetBoolField(TEXT("wholeGi"),true);
        Appearance->SetBoolField(TEXT("beltColor"),true);
        Appearance->SetBoolField(TEXT("independentTopPants"),false);
        Appearance->SetBoolField(TEXT("skinHairStripes"),false);
        Capabilities->SetObjectField(TEXT("appearance"),Appearance);
    }
    O->SetObjectField(TEXT("capabilities"),Capabilities);
    Send(Gate.GetOwnerPeer(),Json(O));
}

void FReceiverSession::SendError(const FCommand& C)
{
    const auto O=Envelope(C,TEXT("error"));
    O->SetStringField(TEXT("moveId"),C.MoveId);
    O->SetStringField(TEXT("message"),TEXT("The requested preview could not be applied. Playback is paused."));
    Send(Gate.GetOwnerPeer(),Json(O));
}

void FReceiverSession::SendState(bool bAllowCompletion)
{
    if (!bActive || Gate.GetOwnerPeer().IsEmpty()) return;
    FNativePlayback Native;
    if (!Driver.Read(Native) || !FMath::IsFinite(Native.Seconds) || !FMath::IsFinite(Native.Duration) ||
        Native.Duration <= 0 || !FMath::IsFinite(Native.SampleInterval) || Native.SampleInterval <= 0 || Native.SampleInterval > Native.Duration)
    { Driver.Pause(); Boundary.SetPlayingIntent(false); bActive=false; SendError(Current); return; }
    const FPlaybackObservation Observed=Boundary.Observe(Native.Seconds,Native.Duration,Native.SampleInterval,Native.bPlaying);
    if (Observed.bCompletedNow) Driver.Pause();
    const auto O=Envelope(Current,Observed.bCompletedNow && bAllowCompletion ? TEXT("completed") : TEXT("state"));
    O->SetStringField(TEXT("moveId"),Current.MoveId);
    O->SetNumberField(TEXT("progress"),Observed.Progress);
    O->SetBoolField(TEXT("playing"),Observed.bPlaying);
    Send(Gate.GetOwnerPeer(),Json(O));
}
void FReceiverSession::Tick() { SendState(true); }
void FReceiverSession::Disconnect(const FString& Peer)
{
    if (Gate.Disconnect(Peer)) { Driver.Pause(); Boundary.SetPlayingIntent(false); bActive=false; }
}
void FReceiverSession::Stop()
{
    Driver.Pause(); Boundary.SetPlayingIntent(false); bActive=false;
    const FString Peer=Gate.GetOwnerPeer();
    if (!Peer.IsEmpty()) Gate.Disconnect(Peer);
}
}
