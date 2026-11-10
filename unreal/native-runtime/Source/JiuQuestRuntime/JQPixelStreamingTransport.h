#pragma once
#include "CoreMinimal.h"

// Unintegrated candidate: PS2 application input is null; controls use a separate
// authenticated loopback WebSocket. UHT/native runtime checks remain required.
class FJQPixelStreamingTransport : public TSharedFromThis<FJQPixelStreamingTransport>
{
public:
    using FMessage = TFunction<void(const FString& Peer,const FString& Descriptor)>;
    using FPeerLost = TFunction<void(const FString& Peer)>;
    using FFailure = TFunction<void()>;
    FJQPixelStreamingTransport();
    ~FJQPixelStreamingTransport();
    // Only this exact reviewed loopback endpoint is accepted in the initial draft.
    bool Start(const FString& StreamerId,const FString& LocalUrl,FMessage Message,FPeerLost Lost,FFailure Failure);
    void Stop();
    bool Send(const FString& Peer,const FString& Json);
    bool IsRunning() const;
private:
    void StartReady();
    void ControlMessage(const FString& Wire);
    void ControlConnected();
    void Fail();
    struct FImpl;
    TUniquePtr<FImpl> Impl;
};
