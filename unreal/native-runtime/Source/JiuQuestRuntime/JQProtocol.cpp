#include "JQProtocol.h"
#include "Containers/StringConv.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include <initializer_list>

namespace JQ
{
namespace
{
bool Unicode(const FString& Text)
{
    for (int32 I = 0; I < Text.Len(); ++I)
    {
        const uint32 C = static_cast<uint32>(Text[I]);
        if (C == 0 || C > 0x10ffff) return false;
        if (C >= 0xd800 && C <= 0xdbff)
        {
            if (++I >= Text.Len()) return false;
            const uint32 Low = static_cast<uint32>(Text[I]);
            if (Low < 0xdc00 || Low > 0xdfff) return false;
        }
        else if (C >= 0xdc00 && C <= 0xdfff) return false;
    }
    return true;
}

bool Identifier(const FString& Text)
{
    if (Text.IsEmpty() || Text.Len() > 160) return false;
    for (const TCHAR C : Text)
        if (!((C >= 'A' && C <= 'Z') || (C >= 'a' && C <= 'z') ||
              (C >= '0' && C <= '9') || C == ':' || C == '_' || C == '-')) return false;
    return true;
}

bool Color(const FString& Text)
{
    if (Text.Len() != 7 || Text[0] != '#') return false;
    for (int32 I = 1; I < 7; ++I)
        if (!((Text[I] >= '0' && Text[I] <= '9') || (Text[I] >= 'a' && Text[I] <= 'f') ||
              (Text[I] >= 'A' && Text[I] <= 'F'))) return false;
    return true;
}

bool Keys(const TSharedPtr<FJsonObject>& Object, std::initializer_list<const TCHAR*> Names)
{
    if (!Object || Object->Values.Num() != static_cast<int32>(Names.size())) return false;
    // Do not rely on DOM lookup casing or FString's case-insensitive operators.
    for (const auto& Pair : Object->Values)
    {
        const FString Actual(*Pair.Key);
        bool bFound = false;
        for (const TCHAR* Name : Names) bFound |= Actual.Equals(Name, ESearchCase::CaseSensitive);
        if (!bFound) return false;
    }
    return true;
}

// FJsonSerializer normally overwrites duplicate keys. Reject them before DOM parsing.
bool UniqueKeysAndDepth(const FString& Text)
{
    // FString's case-insensitive set is intentional ONLY here: no allowed
    // schema has case-variant keys, and the DOM can collapse their casing.
    struct FScope { bool bObject; TSet<FString> Keys; };
    TArray<FScope> Stack;
    const auto Reader = TJsonReaderFactory<>::Create(Text);
    EJsonNotation Token;
    int32 RootCount = 0;
    while (Reader->ReadNext(Token))
    {
        if (Token == EJsonNotation::Error) return false;
        const bool bEnd = Token == EJsonNotation::ObjectEnd || Token == EJsonNotation::ArrayEnd;
        if (!bEnd && !Stack.IsEmpty() && Stack.Last().bObject)
        {
            const FString Key = Reader->GetIdentifier();
            if (Stack.Last().Keys.Contains(Key)) return false;
            Stack.Last().Keys.Add(Key);
        }
        if (Token == EJsonNotation::ObjectStart || Token == EJsonNotation::ArrayStart)
        {
            if (Stack.IsEmpty() && (++RootCount != 1 || Token != EJsonNotation::ObjectStart)) return false;
            if (Stack.Num() >= 16) return false;
            Stack.Add({Token == EJsonNotation::ObjectStart, {}});
        }
        else if (bEnd)
        {
            if (Stack.IsEmpty()) return false;
            Stack.Pop(EAllowShrinking::No);
        }
        else if (Stack.IsEmpty()) return false;
    }
    return RootCount == 1 && Stack.IsEmpty() && Reader->GetErrorMessage().IsEmpty();
}

bool String(const TSharedPtr<FJsonObject>& O, const TCHAR* K, FString& Out)
{
    return O->HasTypedField<EJson::String>(K) && O->TryGetStringField(K, Out) && Unicode(Out);
}
bool Number(const TSharedPtr<FJsonObject>& O, const TCHAR* K, double& Out)
{
    return O->HasTypedField<EJson::Number>(K) && O->TryGetNumberField(K, Out) && FMath::IsFinite(Out);
}
bool Boolean(const TSharedPtr<FJsonObject>& O, const TCHAR* K, bool& Out)
{
    return O->HasTypedField<EJson::Boolean>(K) && O->TryGetBoolField(K, Out);
}

bool Athlete(const TSharedPtr<FJsonObject>& O, FAthlete& A)
{
    if (!Keys(O, {TEXT("name"),TEXT("skinTone"),TEXT("hairColor"),TEXT("hairStyle"),
                  TEXT("giTop"),TEXT("giPants"),TEXT("belt"),TEXT("stripes")})) return false;
    double Stripes;
    if (!String(O,TEXT("name"),A.Name) || A.Name.Len() > 100 ||
        !String(O,TEXT("hairStyle"),A.HairStyle) || A.HairStyle.IsEmpty() || A.HairStyle.Len() > 40 ||
        !String(O,TEXT("skinTone"),A.SkinTone) || !Color(A.SkinTone) ||
        !String(O,TEXT("hairColor"),A.HairColor) || !Color(A.HairColor) ||
        !String(O,TEXT("giTop"),A.GiTop) || !Color(A.GiTop) ||
        !String(O,TEXT("giPants"),A.GiPants) || !Color(A.GiPants) ||
        !String(O,TEXT("belt"),A.Belt) || !Color(A.Belt) ||
        !Number(O,TEXT("stripes"),Stripes) || Stripes < 0 || Stripes > 4 ||
        FMath::FloorToDouble(Stripes) != Stripes) return false;
    A.Stripes = static_cast<int32>(Stripes);
    return true;
}
}

bool DecodeUIInteraction(TConstArrayView<uint8> Payload, FString& OutDescriptor)
{
    static_assert(sizeof(TCHAR) == 2, "This first draft targets Win64 UTF16 TCHAR.");
    if (Payload.Num() < 2 || Payload.Num() > 2+2*MaxMessageBytes) return false;
    const int32 Count = Payload[0] | (static_cast<int32>(Payload[1]) << 8);
    if (Count < 1 || Count > MaxMessageBytes || Payload.Num() != 2+2*Count) return false;
    FString Result;
    Result.Reserve(Count);
    for (int32 I=0; I<Count; ++I)
        Result.AppendChar(static_cast<TCHAR>(Payload[2+2*I] | (static_cast<uint16>(Payload[3+2*I]) << 8)));
    if (!Unicode(Result) || FTCHARToUTF8(*Result).Length() > MaxMessageBytes) return false;
    OutDescriptor = MoveTemp(Result);
    return true;
}

bool ParseCommand(const FString& Descriptor, const FProfile& Profile, FCommand& Out)
{
    if (Descriptor.Len() > MaxMessageBytes || !Unicode(Descriptor) ||
        FTCHARToUTF8(*Descriptor).Length() > MaxMessageBytes || !UniqueKeysAndDepth(Descriptor)) return false;
    TSharedPtr<FJsonObject> O;
    const auto Reader = TJsonReaderFactory<>::Create(Descriptor);
    if (!FJsonSerializer::Deserialize(Reader, O) || !O) return false;
    FCommand C;
    double Version;
    if (!String(O,TEXT("channel"),C.Channel) || !C.Channel.Equals(Profile.Channel,ESearchCase::CaseSensitive) ||
        !Number(O,TEXT("protocolVersion"),Version) || Version != 1 ||
        !String(O,TEXT("instanceId"),C.InstanceId) || !Identifier(C.InstanceId) ||
        !String(O,TEXT("sessionId"),C.SessionId) || !Identifier(C.SessionId) ||
        !String(O,TEXT("requestId"),C.RequestId) || !Identifier(C.RequestId) ||
        !String(O,TEXT("type"),C.Type) ||
        !C.SessionId.StartsWith(C.InstanceId+TEXT(":"),ESearchCase::CaseSensitive)) return false;
    if (C.Type.Equals(TEXT("configure"),ESearchCase::CaseSensitive))
    {
        if (!Keys(O,{TEXT("channel"),TEXT("protocolVersion"),TEXT("instanceId"),TEXT("sessionId"),TEXT("requestId"),TEXT("type")}) ||
            !C.RequestId.Equals(C.SessionId+TEXT(":setup"),ESearchCase::CaseSensitive)) return false;
        Out = MoveTemp(C); return true;
    }
    static const FExactStringSet Controls = {TEXT("play"),TEXT("pause"),TEXT("resume"),TEXT("seek"),TEXT("reset"),
        TEXT("setSpeed"),TEXT("setCamera"),TEXT("setViewport"),TEXT("requestState")};
    static const FExactStringSet Cameras = {TEXT("front"),TEXT("focus"),TEXT("side"),TEXT("overhead"),TEXT("orbit")};
    if (!Controls.Contains(C.Type) || !Keys(O,{TEXT("channel"),TEXT("protocolVersion"),TEXT("instanceId"),TEXT("sessionId"),TEXT("requestId"),TEXT("type"),
        TEXT("moveId"),TEXT("performerSide"),TEXT("speed"),TEXT("camera"),TEXT("compactViewport"),TEXT("fighter"),TEXT("opponent"),TEXT("progress"),TEXT("paused")})) return false;
    const FString Prefix = C.SessionId+TEXT(":");
    if (!C.RequestId.StartsWith(Prefix,ESearchCase::CaseSensitive)) return false;
    const FString Digits = C.RequestId.Mid(Prefix.Len());
    if (Digits.IsEmpty() || Digits[0] == '0' || Digits.Len() > 16) return false;
    for (const TCHAR Digit : Digits)
    {
        if (Digit < '0' || Digit > '9') return false;
        C.Serial = C.Serial*10 + static_cast<uint64>(Digit-'0');
        if (C.Serial > MaxRequestSerial) return false;
    }
    if (!String(O,TEXT("moveId"),C.MoveId) || !Profile.VerifiedMoveIds.Contains(C.MoveId) ||
        !String(O,TEXT("performerSide"),C.PerformerSide) || (!C.PerformerSide.Equals(TEXT("fighter"),ESearchCase::CaseSensitive) && !C.PerformerSide.Equals(TEXT("opponent"),ESearchCase::CaseSensitive)) ||
        !String(O,TEXT("camera"),C.Camera) || !Cameras.Contains(C.Camera) ||
        !Number(O,TEXT("speed"),C.Speed) || (C.Speed != .25 && C.Speed != .5 && C.Speed != 1) ||
        !Number(O,TEXT("progress"),C.Progress) || C.Progress < 0 || C.Progress > 1 ||
        !Boolean(O,TEXT("paused"),C.bPaused) || !Boolean(O,TEXT("compactViewport"),C.bCompactViewport)) return false;
    const TSharedPtr<FJsonObject>* Fighter;
    const TSharedPtr<FJsonObject>* Opponent;
    if (!O->TryGetObjectField(TEXT("fighter"),Fighter) || !O->TryGetObjectField(TEXT("opponent"),Opponent) ||
        !Athlete(*Fighter,C.Fighter) || !Athlete(*Opponent,C.Opponent)) return false;
    Out = MoveTemp(C); return true;
}

bool FSessionGate::Accept(const FString& PeerId, const FCommand& C)
{
    if (PeerId.IsEmpty() || PeerId.Len() > 256 || (!OwnerPeer.IsEmpty() && !OwnerPeer.Equals(PeerId,ESearchCase::CaseSensitive))) return false;
    const FString Key = C.InstanceId+TEXT("\n")+C.SessionId;
    if (C.Type.Equals(TEXT("configure"),ESearchCase::CaseSensitive))
    {
        if (Retired.Contains(Key)) return false;
        if (!CurrentKey.Equals(Key,ESearchCase::CaseSensitive))
        {
            if (Retired.Num() >= 512) return false;
            if (!CurrentKey.IsEmpty()) Retired.Add(CurrentKey);
            CurrentKey = Key; LastRequest = 0;
        }
        OwnerPeer = PeerId; return true;
    }
    if (OwnerPeer.IsEmpty() || !CurrentKey.Equals(Key,ESearchCase::CaseSensitive) || C.Serial == 0 || C.Serial <= LastRequest) return false;
    LastRequest = C.Serial; return true;
}

bool FSessionGate::Disconnect(const FString& PeerId)
{
    if (OwnerPeer.IsEmpty() || !OwnerPeer.Equals(PeerId,ESearchCase::CaseSensitive)) return false;
    if (!CurrentKey.IsEmpty()) Retired.Add(CurrentKey);
    OwnerPeer.Reset(); CurrentKey.Reset(); LastRequest = 0;
    return true;
}
}
