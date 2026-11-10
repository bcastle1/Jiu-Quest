#include "JQReceiverSession.h"
#include "JQTransportPolicy.h"
#include "JQControlWire.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonReader.h"
#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS
namespace
{
struct FObservedDriver : JQ::IPreviewDriver
{
    JQ::FNativePlayback State{0,1,1.0/54,false};
    int32 ApplyCalls=0,PauseCalls=0;
    bool bFailNext=false;
    FString LastType;
    bool Apply(const JQ::FCommand& C) override
    {
        ++ApplyCalls; LastType=C.Type;
        if (bFailNext) { bFailNext=false; return false; }
        if (C.Type.Equals(TEXT("play"),ESearchCase::CaseSensitive)) { State.Seconds=C.Progress; State.bPlaying=!C.bPaused; }
        if (C.Type.Equals(TEXT("pause"),ESearchCase::CaseSensitive)) State.bPlaying=false;
        if (C.Type.Equals(TEXT("resume"),ESearchCase::CaseSensitive)) State.bPlaying=true;
        if (C.Type.Equals(TEXT("seek"),ESearchCase::CaseSensitive)||C.Type.Equals(TEXT("reset"),ESearchCase::CaseSensitive)) { State.Seconds=C.Progress; State.bPlaying=false; }
        return true;
    }
    bool Read(JQ::FNativePlayback& Out) const override { Out=State; return true; }
    void Pause() override { ++PauseCalls; State.bPlaying=false; }
};
FString Setup(const TCHAR* Session=TEXT("view:1"))
{ return FString::Printf(TEXT(R"({"channel":"jiuquest.characterPreview","protocolVersion":1,"instanceId":"view","sessionId":"%s","requestId":"%s:setup","type":"configure"})"),Session,Session); }
FString Command(const TCHAR* Type,int32 Serial,double Progress=0,const TCHAR* Move=TEXT("human_idle"),const TCHAR* Session=TEXT("view:1"))
{
    const FString Person=TEXT(R"({"name":"Athlete","skinTone":"#d99b71","hairColor":"#11131c","hairStyle":"short fringe","giTop":"#ffffff","giPants":"#ffffff","belt":"#2368ff","stripes":0})");
    return FString::Printf(TEXT(R"({"channel":"jiuquest.characterPreview","protocolVersion":1,"instanceId":"view","sessionId":"%s","requestId":"%s:%d","type":"%s","moveId":"%s","performerSide":"fighter","speed":1,"camera":"side","compactViewport":false,"fighter":%s,"opponent":%s,"progress":%.12f,"paused":false})"),Session,Session,Serial,Type,Move,*Person,*Person,Progress);
}
TSharedPtr<FJsonObject> Object(const FString& Json)
{ TSharedPtr<FJsonObject> O; FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json),O); return O; }
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FJQReceiverSessionTest,"JiuQuest.Runtime.ReceiverSession",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FJQReceiverSessionTest::RunTest(const FString&)
{
    FObservedDriver Driver; JQ::FProfile Profile; Profile.Channel=TEXT("jiuquest.characterPreview");
    Profile.VerifiedMoveIds.Add(TEXT("human_idle")); Profile.VerifiedMoveIds.Add(TEXT("human_walk"));
    TArray<FString> Peers,Messages;
    JQ::FReceiverSession Receiver(Profile,Driver,[&](const FString& P,const FString& M) { Peers.Add(P); Messages.Add(M); });
    TestFalse(TEXT("no apply before setup"),Receiver.Receive(TEXT("peer"),Command(TEXT("play"),1)));
    TestEqual(TEXT("no native mutation before ownership"),Driver.ApplyCalls,0);
    TestTrue(TEXT("configure ready"),Receiver.Receive(TEXT("peer"),Setup()));
    TestEqual(TEXT("ready scoped to owner"),Peers.Last(),FString(TEXT("peer")));
    const auto Ready=Object(Messages.Last());
    TestTrue(TEXT("separate preview capability"),Ready&&Ready->GetObjectField(TEXT("capabilities"))->GetStringField(TEXT("scope")).Equals(TEXT("single-human-preview"),ESearchCase::CaseSensitive));
    TestTrue(TEXT("play applied"),Receiver.Receive(TEXT("peer"),Command(TEXT("play"),1)));
    TestTrue(TEXT("native playing is observed"),Object(Messages.Last())->GetBoolField(TEXT("playing")));
    TestFalse(TEXT("case-only peer blocked before native apply"),Receiver.Receive(TEXT("PEER"),Command(TEXT("pause"),2)));
    TestEqual(TEXT("foreign peer did not mutate driver"),Driver.ApplyCalls,1);
    Driver.State.Seconds=53.0/54; Driver.State.bPlaying=false; Receiver.Tick();
    TestEqual(TEXT("natural final native sample completes"),Object(Messages.Last())->GetStringField(TEXT("type")),FString(TEXT("completed")));
    TestEqual(TEXT("completion normalized to one"),Object(Messages.Last())->GetNumberField(TEXT("progress")),1.0);
    Receiver.Tick();
    TestEqual(TEXT("periodic state does not repeat completion"),Object(Messages.Last())->GetStringField(TEXT("type")),FString(TEXT("state")));
    TestEqual(TEXT("periodic state stays at one"),Object(Messages.Last())->GetNumberField(TEXT("progress")),1.0);
    TestTrue(TEXT("camera after completion"),Receiver.Receive(TEXT("peer"),Command(TEXT("setCamera"),2)));
    TestEqual(TEXT("camera keeps logical endpoint"),Object(Messages.Last())->GetNumberField(TEXT("progress")),1.0);
    TestTrue(TEXT("earlier seek"),Receiver.Receive(TEXT("peer"),Command(TEXT("seek"),3,.5)));
    TestFalse(TEXT("seek forces paused despite false paused input"),Driver.State.bPlaying);
    TestEqual(TEXT("earlier seek clears endpoint"),Object(Messages.Last())->GetNumberField(TEXT("progress")),.5);
    TestTrue(TEXT("replay resets completion boundary"),Receiver.Receive(TEXT("peer"),Command(TEXT("play"),4)));
    Driver.State.Seconds=53.0/54;
    TestTrue(TEXT("ordinary near-end pause"),Receiver.Receive(TEXT("peer"),Command(TEXT("pause"),5)));
    TestEqual(TEXT("pause does not earn completion"),Object(Messages.Last())->GetStringField(TEXT("type")),FString(TEXT("state")));
    TestTrue(TEXT("pause retains actual below-end progress"),Object(Messages.Last())->GetNumberField(TEXT("progress"))<1);
    Receiver.Disconnect(TEXT("PEER"));
    TestTrue(TEXT("wrong peer did not retire owner"),Receiver.GetOwnerPeer().Equals(TEXT("peer"),ESearchCase::CaseSensitive));
    Receiver.Disconnect(TEXT("peer")); const int32 Count=Messages.Num(); Receiver.Tick();
    TestEqual(TEXT("no response or completion after disconnect"),Messages.Num(),Count);
    TestFalse(TEXT("retired configure rejected"),Receiver.Receive(TEXT("peer"),Setup()));
    TestTrue(TEXT("new session configures paused"),Receiver.Receive(TEXT("new-peer"),Setup(TEXT("view:2"))));
    TestFalse(TEXT("configure cannot auto resume"),Driver.State.bPlaying);
    Driver.bFailNext=true;
    TestFalse(TEXT("native apply failure is not acknowledged"),Receiver.Receive(TEXT("new-peer"),Command(TEXT("play"),1,0,TEXT("human_walk"),TEXT("view:2"))));
    TestEqual(TEXT("native failure returns bounded error"),Object(Messages.Last())->GetStringField(TEXT("type")),FString(TEXT("error")));
    TestFalse(TEXT("failed native apply is paused"),Driver.State.bPlaying);
    TestTrue(TEXT("later valid play can recover"),Receiver.Receive(TEXT("new-peer"),Command(TEXT("play"),2,0,TEXT("human_walk"),TEXT("view:2"))));
    TestFalse(TEXT("other clip cannot sneak through requestState"),Receiver.Receive(TEXT("new-peer"),Command(TEXT("requestState"),3,0,TEXT("human_idle"),TEXT("view:2"))));
    TestFalse(TEXT("invalid clip control pauses"),Driver.State.bPlaying);
    Receiver.Stop();
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FJQTransportPolicyTest,"JiuQuest.Runtime.TransportPolicy",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FJQTransportPolicyTest::RunTest(const FString&)
{
    // V3 has no RTC dispatch route at all. Native control framing is separate.
    JQControl::Gate Gate;
    for (const char* Name:{"Command","UIInteraction","RequestInitialSettings","Multiplexed","ChannelRelayStatus","KeyDown","IFrameRequest"})
        TestTrue(TEXT("stock RTC message is not a control envelope"),Gate.Receive(Name).Kind==JQControl::Action::Reject);
    const std::string Epoch(32,'e'), Peer(32,'a');
    TestTrue(TEXT("owned gateway ready"),Gate.Receive("READY\n"+Epoch).Kind==JQControl::Action::Ready);
    TestTrue(TEXT("server owner attach"),Gate.Receive("ATTACH\n"+Peer).Kind==JQControl::Action::Attach);
    TestTrue(TEXT("wrong owner command rejected"),Gate.Receive("COMMAND\n"+std::string(32,'b')+"\n{}").Kind==JQControl::Action::Reject);
    TestTrue(TEXT("authorized raw descriptor"),Gate.Receive("COMMAND\n"+Peer+"\n{}").Kind==JQControl::Action::Command);
    TestTrue(TEXT("detach revokes route"),Gate.Receive("DETACH\n"+Peer).Kind==JQControl::Action::Detach);
    TestTrue(TEXT("late response cannot route"),Gate.Response(Peer,"{}").empty());
    TestTrue(TEXT("reviewed loopback accepted"),JQ::IsReviewedLocalUrl(TEXT("ws://127.0.0.1:49088")));
    for (const TCHAR* Url:{TEXT("ws://example.com:49088"),TEXT("ws://127.0.0.1:49088@evil.test"),TEXT("ws://127.0.0.1:49089"),TEXT("wss://127.0.0.1:49088"),TEXT("ws://127.0.0.1:49088/?token=x")})
        TestFalse(TEXT("unreviewed endpoint rejected"),JQ::IsReviewedLocalUrl(Url));
    return true;
}
#endif
