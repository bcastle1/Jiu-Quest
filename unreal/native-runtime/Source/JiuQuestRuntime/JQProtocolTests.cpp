#include "JQProtocol.h"
#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FJQProtocolTest,"JiuQuest.Runtime.Protocol",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FJQProtocolTest::RunTest(const FString&)
{
    JQ::FProfile Profile;
    Profile.VerifiedMoveIds.Add(TEXT("standing_stance")); // Test catalog only, not shipped capabilities.
    const FString Setup = TEXT(R"({"channel":"jiuquest.combat","protocolVersion":1,"instanceId":"test","sessionId":"test:1","requestId":"test:1:setup","type":"configure"})");
    const FString Person = TEXT(R"({"name":"Athlete","skinTone":"#d99b71","hairColor":"#11131c","hairStyle":"short fringe","giTop":"#ffffff","giPants":"#000000","belt":"#2368ff","stripes":0})");
    const FString Scene = FString::Printf(TEXT(R"({"channel":"jiuquest.combat","protocolVersion":1,"instanceId":"test","sessionId":"test:1","requestId":"test:1:1","type":"play","moveId":"standing_stance","performerSide":"fighter","speed":1,"camera":"side","compactViewport":false,"fighter":%s,"opponent":%s,"progress":0,"paused":false})"),*Person,*Person);
    JQ::FCommand Command, Config;
    TestTrue(TEXT("configure accepted"),JQ::ParseCommand(Setup,Profile,Config));
    TArray<uint8> Wire = {static_cast<uint8>(Setup.Len() & 255),static_cast<uint8>(Setup.Len() >> 8)};
    for (TCHAR C : Setup) { Wire.Add(static_cast<uint8>(C & 255)); Wire.Add(static_cast<uint8>(C >> 8)); }
    FString Decoded;
    TestTrue(TEXT("exact Epic UIInteraction UTF16 wire decoded"),JQ::DecodeUIInteraction(Wire,Decoded));
    TestEqual(TEXT("wire JSON preserved"),Decoded,Setup);
    Wire.Add(0);
    TestFalse(TEXT("trailing wire byte rejected"),JQ::DecodeUIInteraction(Wire,Decoded));
    Wire.Pop(); Wire.Pop();
    TestFalse(TEXT("truncated UTF16 rejected"),JQ::DecodeUIInteraction(Wire,Decoded));
    const TArray<uint8> InvalidSurrogate = {1,0,0,0xd8};
    TestFalse(TEXT("wire unpaired surrogate rejected"),JQ::DecodeUIInteraction(InvalidSurrogate,Decoded));
    TestTrue(TEXT("canonical scene accepted"),JQ::ParseCommand(Scene,Profile,Command));
    TestEqual(TEXT("whole gi field distinct from belt"),Command.Fighter.GiTop,FString(TEXT("#ffffff")));
    TestEqual(TEXT("belt retained"),Command.Fighter.Belt,FString(TEXT("#2368ff")));
    const TArray<FString> Invalid = {
        TEXT("null"),TEXT("[]"),TEXT("\"double encoded\""),Setup+TEXT("{}"),
        Setup.Replace(TEXT("\"protocolVersion\":1"),TEXT("\"protocolVersion\":true")),
        Setup.Replace(TEXT("\"protocolVersion\":1"),TEXT("\"protocolVersion\":1,\"ProtocolVersion\":1")),
        Setup.Replace(TEXT("\"protocolVersion\":1"),TEXT("\"ProtocolVersion\":1,\"protocolVersion\":1")),
        Setup.Replace(TEXT("\"type\":\"configure\""),TEXT("\"type\":\"configure\",\"type\":\"configure\"")),
        Setup.Replace(TEXT("\"type\":\"configure\""),TEXT("\"type\":\"configure\",\"consoleCommand\":\"quit\"")),
        Scene.Replace(TEXT("\"progress\":0"),TEXT("\"progress\":true")),
        Scene.Replace(TEXT("\"progress\":0"),TEXT("\"progress\":1.01")),
        Scene.Replace(TEXT("test:1:1"),TEXT("test:1:01")),
        Scene.Replace(TEXT("test:1:1"),TEXT("test:1:9007199254740992")),
        Scene.Replace(TEXT("standing_stance"),TEXT("rear_naked_choke")),
        Scene.Replace(TEXT("standing_stance"),TEXT("Standing_Stance")),
        Scene.Replace(TEXT("\"type\":\"play\""),TEXT("\"type\":\"PLAY\"")),
        Scene.Replace(TEXT("\"camera\":\"side\""),TEXT("\"camera\":\"SIDE\"")),
        Scene.Replace(TEXT("protocolVersion"),TEXT("ProtocolVersion")),
        Scene.Replace(TEXT("\"stripes\":0"),TEXT("\"stripes\":false")),
        Scene.Replace(TEXT("\"name\":\"Athlete\""),TEXT("\"name\":\"\\ud800\"")),
        Scene.Replace(TEXT("#ffffff"),TEXT("javascript:bad")),
        Scene.Replace(TEXT("\"name\":\"Athlete\""),TEXT("\"name\":\"Athlete\",\"name\":\"Other\"")),
        Scene.Replace(TEXT("\"name\":\"Athlete\""),TEXT("\"name\":\"Athlete\",\"Name\":\"Athlete\"")),
        Scene.Replace(TEXT("\"name\":\"Athlete\""),TEXT("\"Name\":\"Athlete\",\"name\":\"Athlete\"")),
        FString::ChrN(JQ::MaxMessageBytes+1,' ')
    };
    for (int32 I=0;I<Invalid.Num();++I)
        TestFalse(FString::Printf(TEXT("reject invalid case %d"),I),JQ::ParseCommand(Invalid[I],Profile,Command));
    const FString UnicodeScene = Scene.Replace(TEXT("Athlete"),*FString::ChrN(100,static_cast<TCHAR>(0x4e00)));
    const FString ByteOverflow = FString::ChrN(JQ::MaxMessageBytes-UnicodeScene.Len(),' ')+UnicodeScene;
    TestEqual(TEXT("UTF8 test remains within character limit"),ByteOverflow.Len(),JQ::MaxMessageBytes);
    TestFalse(TEXT("UTF8 bytes independently bounded"),JQ::ParseCommand(ByteOverflow,Profile,Command));
    TestTrue(TEXT("largest JS exact serial accepted"),JQ::ParseCommand(Scene.Replace(TEXT("test:1:1"),TEXT("test:1:9007199254740991")),Profile,Command));
    JQ::FProfile EmptyCatalog;
    TestFalse(TEXT("no invented animation capabilities"),JQ::ParseCommand(Scene,EmptyCatalog,Command));
    TestTrue(TEXT("empty catalog still configures"),JQ::ParseCommand(Setup,EmptyCatalog,Config));
    TestTrue(TEXT("restore valid command"),JQ::ParseCommand(Scene,Profile,Command));
    JQ::FSessionGate Gate;
    TestFalse(TEXT("command before setup"),Gate.Accept(TEXT("peer-A"),Command));
    TestTrue(TEXT("first owner"),Gate.Accept(TEXT("peer-A"),Config));
    TestFalse(TEXT("second peer cannot steal"),Gate.Accept(TEXT("peer-B"),Config));
    TestFalse(TEXT("case-only peer cannot steal"),Gate.Accept(TEXT("PEER-A"),Config));
    TestTrue(TEXT("first serial"),Gate.Accept(TEXT("peer-A"),Command));
    TestFalse(TEXT("replay rejected"),Gate.Accept(TEXT("peer-A"),Command));
    TestTrue(TEXT("setup repeat is idempotent"),Gate.Accept(TEXT("peer-A"),Config));
    TestFalse(TEXT("repeat setup cannot reset serial"),Gate.Accept(TEXT("peer-A"),Command));
    TestFalse(TEXT("wrong peer disconnect ignored"),Gate.Disconnect(TEXT("peer-B")));
    TestFalse(TEXT("case-only peer disconnect ignored"),Gate.Disconnect(TEXT("PEER-A")));
    JQ::FCommand CaseChanged=Command;
    CaseChanged.InstanceId=TEXT("TEST"); CaseChanged.SessionId=TEXT("TEST:1"); CaseChanged.Serial=2;
    TestFalse(TEXT("case-only identity cannot reuse session"),Gate.Accept(TEXT("peer-A"),CaseChanged));
    TestTrue(TEXT("owner disconnect pauses caller"),Gate.Disconnect(TEXT("peer-A")));
    TestFalse(TEXT("retired session cannot reconnect"),Gate.Accept(TEXT("peer-A"),Config));
    const FString NewSetup=Setup.Replace(TEXT("test:1"),TEXT("test:2"));
    TestTrue(TEXT("new setup parses"),JQ::ParseCommand(NewSetup,Profile,Config));
    TestTrue(TEXT("new peer may own after disconnect"),Gate.Accept(TEXT("peer-B"),Config));
    TestFalse(TEXT("old command remains retired"),Gate.Accept(TEXT("peer-B"),Command));
    return true;
}
#endif
