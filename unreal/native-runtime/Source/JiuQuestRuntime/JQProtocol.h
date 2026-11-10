#pragma once

#include "CoreMinimal.h"
#include "Misc/Crc.h"

// Ignored draft. Compile and run native automation before using in a runtime.
namespace JQ
{
constexpr int32 MaxMessageBytes = 8192;
constexpr uint64 MaxRequestSerial = 9007199254740991ULL;
struct FExactStringKeyFuncs : DefaultKeyFuncs<FString, false>
{
    static bool Matches(KeyInitType A, KeyInitType B) { return A.Equals(B, ESearchCase::CaseSensitive); }
    static uint32 GetKeyHash(KeyInitType Key) { return FCrc::StrCrc32(*Key); }
};
using FExactStringSet = TSet<FString, FExactStringKeyFuncs>;

struct FProfile
{
    FString Channel = TEXT("jiuquest.combat");
    // Empty by default: no animation is advertised merely because it has a name.
    FExactStringSet VerifiedMoveIds;
};

struct FAthlete
{
    FString Name, SkinTone, HairColor, HairStyle, GiTop, GiPants, Belt;
    int32 Stripes = 0;
};

struct FCommand
{
    FString Channel, InstanceId, SessionId, RequestId, Type;
    uint64 Serial = 0;
    FString MoveId, PerformerSide, Camera;
    double Speed = 1, Progress = 0;
    bool bCompactViewport = false, bPaused = true;
    FAthlete Fighter, Opponent;
};

// No asset paths, URLs, console commands, or arbitrary fields are accepted.
bool ParseCommand(const FString& Descriptor, const FProfile& Profile, FCommand& Out);
// PS2 has already removed message ID50. Payload is uint16LE length + UTF16LE.
bool DecodeUIInteraction(TConstArrayView<uint8> Payload, FString& OutDescriptor);

// A transport-supplied peer ID owns the session; JSON cannot impersonate it.
class FSessionGate
{
public:
    bool Accept(const FString& PeerId, const FCommand& Command);
    bool Disconnect(const FString& PeerId);
    const FString& GetOwnerPeer() const { return OwnerPeer; }
private:
    FString OwnerPeer, CurrentKey;
    uint64 LastRequest = 0;
    FExactStringSet Retired;
};
}
