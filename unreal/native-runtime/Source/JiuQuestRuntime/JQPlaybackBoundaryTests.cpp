#include "JQPlaybackBoundary.h"
#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FJQPlaybackBoundaryTest,"JiuQuest.Runtime.PlaybackBoundary",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FJQPlaybackBoundaryTest::RunTest(const FString&)
{
    JQ::FPlaybackBoundary State;
    State.PositionCommand(0,false);
    auto End=State.Observe(53.0,54.0,1.0,false);
    TestTrue(TEXT("native stopped final sample completes once"),End.bCompletedNow);
    TestEqual(TEXT("complete state normalizes endpoint"),End.Progress,1.0);
    End=State.Observe(53.0,54.0,1.0,false);
    TestFalse(TEXT("periodic state does not duplicate completion"),End.bCompletedNow);
    TestEqual(TEXT("periodic and nonposition controls retain100"),End.Progress,1.0);
    State.PositionCommand(0,false);
    State.SetPlayingIntent(false); // User pause or owner disconnect.
    End=State.Observe(53.0,54.0,1.0,false);
    TestFalse(TEXT("ordinary pause on last sample is not completion"),End.bCompletedNow);
    TestEqual(TEXT("ordinary paused progress remains raw"),End.Progress,53.0/54.0);
    State.PositionCommand(1,true);
    End=State.Observe(53.0,54.0,1.0,false);
    TestFalse(TEXT("explicit end seek is state, not earned completion"),End.bCompletedNow);
    TestEqual(TEXT("explicit end seek100"),End.Progress,1.0);
    State.PositionCommand(.25,true);
    End=State.Observe(13.5,54.0,1.0,false);
    TestEqual(TEXT("earlier seek clears endpoint marker"),End.Progress,.25);
    State.PositionCommand(0,false);
    End=State.Observe(52.0,54.0,1.0,false);
    TestFalse(TEXT("early native stop must not complete"),End.bCompletedNow);
    State.PositionCommand(0,true);
    TestEqual(TEXT("reset returns0"),State.Observe(0,54,1,false).Progress,0.0);
    return true;
}
#endif
