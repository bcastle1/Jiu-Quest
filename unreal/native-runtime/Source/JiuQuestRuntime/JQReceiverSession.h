#pragma once
#include "JQProtocol.h"
#include "JQPlaybackBoundary.h"

namespace JQ
{
struct FNativePlayback
{
    double Seconds = 0, Duration = 0, SampleInterval = 0;
    bool bPlaying = false;
};

// The production adapter must report real native state, never simulated progress.
class IPreviewDriver
{
public:
    virtual ~IPreviewDriver() = default;
    virtual bool Apply(const FCommand& Command) = 0;
    virtual bool Read(FNativePlayback& Out) const = 0;
    virtual void Pause() = 0;
};

// Transport peer is supplied out-of-band. Responses are always addressed to it.
class FReceiverSession
{
public:
    using FSend = TFunction<void(const FString& Peer, const FString& Json)>;
    FReceiverSession(FProfile InProfile, IPreviewDriver& InDriver, FSend InSend);
    bool Receive(const FString& Peer, const FString& Descriptor);
    void Tick();
    void Disconnect(const FString& Peer);
    void Stop();
    const FString& GetOwnerPeer() const { return Gate.GetOwnerPeer(); }
private:
    void SendReady(const FCommand& C);
    void SendError(const FCommand& C);
    void SendState(bool bAllowCompletion);
    FProfile Profile;
    IPreviewDriver& Driver;
    FSend Send;
    FSessionGate Gate;
    FPlaybackBoundary Boundary;
    FCommand Current;
    bool bActive = false;
};
}
