#pragma once
#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "JQPreviewReceiverComponent.generated.h"

class USkeletalMeshComponent;
class USkinnedMeshComponent;
class UAnimSequence;
class ACameraActor;
class APlayerController;
class UMaterialInterface;
class UMaterialInstanceDynamic;

USTRUCT(BlueprintType)
struct FJQPreviewCamera
{
    GENERATED_BODY()
    UPROPERTY(EditAnywhere,BlueprintReadWrite) FString Mode;
    UPROPERTY(EditAnywhere,BlueprintReadWrite) TObjectPtr<ACameraActor> Camera;
    UPROPERTY(EditAnywhere,BlueprintReadWrite,meta=(ClampMin="20",ClampMax="80")) float WideFOV=35;
    UPROPERTY(EditAnywhere,BlueprintReadWrite,meta=(ClampMin="20",ClampMax="80")) float CompactFOV=45;
};

// A single verified human preview, explicitly separate from combat choreography.
UCLASS(ClassGroup=(JiuQuest),meta=(BlueprintSpawnableComponent))
class JIUQUESTRUNTIME_API UJQPreviewReceiverComponent : public UActorComponent
{
    GENERATED_BODY()
public:
    UJQPreviewReceiverComponent();
    virtual ~UJQPreviewReceiverComponent() override;
    UPROPERTY(EditAnywhere,Category="Reviewed preview") bool bEnableVerifiedHumanPreview=false;
    UPROPERTY(EditInstanceOnly,Category="Reviewed preview") TObjectPtr<USkeletalMeshComponent> Body;
    UPROPERTY(EditInstanceOnly,Category="Reviewed preview") TObjectPtr<USkeletalMeshComponent> Face;
    UPROPERTY(EditInstanceOnly,Category="Reviewed preview") TObjectPtr<USkinnedMeshComponent> Outfit;
    UPROPERTY(EditAnywhere,Category="Reviewed preview") TObjectPtr<UAnimSequence> VerifiedIdle;
    UPROPERTY(EditAnywhere,Category="Reviewed preview") TObjectPtr<UAnimSequence> VerifiedWalk;
    UPROPERTY(EditInstanceOnly,Category="Reviewed preview") TObjectPtr<APlayerController> LocalController;
    UPROPERTY(EditInstanceOnly,Category="Reviewed preview") TArray<FJQPreviewCamera> Cameras;
    UPROPERTY(EditInstanceOnly,Category="Reviewed preview") TObjectPtr<AActor> OrbitPivot;
    // No BeginPlay auto-start. This explicit local operation is not exposed to JSON.
    UFUNCTION(BlueprintCallable,Category="JiuQuest local preview") bool StartLocalPreview();
    UFUNCTION(BlueprintCallable,Category="JiuQuest local preview") void StopLocalPreview();
    UFUNCTION(BlueprintPure,Category="JiuQuest local preview") FString GetLastPreviewError() const { return LastError; }
    virtual void TickComponent(float DeltaTime,ELevelTick TickType,FActorComponentTickFunction* ThisTickFunction) override;
protected:
    virtual void EndPlay(const EEndPlayReason::Type Reason) override;
private:
    struct FImpl;
    // UHT's generated vtable constructor sees FImpl incomplete. Keep deletion
    // out of line, where the complete private implementation is available.
    struct FImplDeleter { void operator()(FImpl* Value) const; };
    TUniquePtr<FImpl,FImplDeleter> Impl;
    UPROPERTY(Transient) TArray<TObjectPtr<UMaterialInterface>> OriginalMaterials;
    UPROPERTY(Transient) TArray<TObjectPtr<UMaterialInstanceDynamic>> PreviewMaterials;
    UPROPERTY(Transient) FString LastError;
    void FailPreview();
};
