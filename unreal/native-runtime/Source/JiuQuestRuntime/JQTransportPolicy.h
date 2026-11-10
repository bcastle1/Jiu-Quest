#pragma once
#include "CoreMinimal.h"
namespace JQ {
// Candidate implementation only; not shipped or native-runtime verified.
inline constexpr bool bVideoOnlyControlCandidateEnabled = true;
inline bool IsReviewedLocalUrl(const FString& Url) {
    return Url.Equals(TEXT("ws://127.0.0.1:49088"), ESearchCase::CaseSensitive);
}
}
