#include "JQPlaybackBoundary.h"

namespace JQ
{
FPlaybackObservation FPlaybackBoundary::Observe(double Seconds, double Duration, double SampleInterval, bool bNativePlaying)
{
    FPlaybackObservation Out;
    if (!FMath::IsFinite(Seconds) || !FMath::IsFinite(Duration) || Duration <= 0 ||
        !FMath::IsFinite(SampleInterval) || SampleInterval <= 0 || SampleInterval > Duration) return Out;
    const double Raw = FMath::Clamp(Seconds/Duration,0.0,1.0);
    const double LastSample = 1.0-SampleInterval/Duration-1e-5;
    Out.Progress = Raw;
    Out.bPlaying = bNativePlaying;
    if (bWantsPlaying && !bCompletionEmitted && (Raw >= 1-1e-5 || (!bNativePlaying && Raw >= LastSample)))
    {
        bCompletionEmitted = true;
        bEndpointRequested = true;
        bWantsPlaying = false;
        Out.bCompletedNow = true;
        Out.bPlaying = false; // Caller must pause the native player on this transition.
    }
    if (bEndpointRequested && !Out.bPlaying && Raw >= LastSample) Out.Progress = 1;
    return Out;
}
}
