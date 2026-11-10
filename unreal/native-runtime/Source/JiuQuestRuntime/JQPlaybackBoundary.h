#pragma once
#include "CoreMinimal.h"

namespace JQ
{
struct FPlaybackObservation
{
    double Progress = 0;
    bool bPlaying = false;
    bool bCompletedNow = false;
};

// Operates on the native player's observed time. This is not a synthetic clock.
class FPlaybackBoundary
{
public:
    void PositionCommand(double Progress, bool bPaused)
    {
        bEndpointRequested = Progress >= 1;
        bWantsPlaying = !bPaused && Progress < 1;
        bCompletionEmitted = false;
    }
    void SetPlayingIntent(bool bPlaying) { bWantsPlaying = bPlaying; }
    FPlaybackObservation Observe(double Seconds, double Duration, double SampleInterval, bool bNativePlaying);
private:
    bool bEndpointRequested = false, bWantsPlaying = false, bCompletionEmitted = false;
};
}
