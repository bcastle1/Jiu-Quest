#include "JQPreviewReceiverComponent.h"
#include "JQPixelStreamingTransport.h"
#include "JQReceiverSession.h"
#include "JQTransportPolicy.h"
#include "Animation/AnimSingleNodeInstance.h"
#include "Animation/AnimSequence.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"

namespace
{
bool Exact(const FString& A,const TCHAR* B) { return A.Equals(B,ESearchCase::CaseSensitive); }
FLinearColor PreviewColor(const FString& Hex,float Alpha)
{ FLinearColor C=FLinearColor::FromSRGBColor(FColor::FromHex(Hex)); C.A=Alpha; return C; }
bool Same(const FLinearColor& A,const FLinearColor& B) { return A.Equals(B,1e-6f); }
struct FMaterialSnapshot
{
    TArray<FMaterialParameterInfo> VectorInfo,ScalarInfo,TextureInfo;
    TArray<FLinearColor> Vectors;
    TArray<float> Scalars;
    TArray<UTexture*> Textures;
    bool Read(UMaterialInterface* M)
    {
        TArray<FGuid> Ids;
        M->GetAllVectorParameterInfo(VectorInfo,Ids); M->GetAllScalarParameterInfo(ScalarInfo,Ids); M->GetAllTextureParameterInfo(TextureInfo,Ids);
        for (const auto& P:VectorInfo) { FLinearColor V; if (P.Association!=EMaterialParameterAssociation::GlobalParameter || !M->GetVectorParameterValue(P,V)) return false; Vectors.Add(V); }
        for (const auto& P:ScalarInfo) { float V; if (!M->GetScalarParameterValue(P,V)) return false; Scalars.Add(V); }
        for (const auto& P:TextureInfo) { UTexture* V=nullptr; if (!M->GetTextureParameterValue(P,V)) return false; Textures.Add(V); }
        for (const TCHAR* Name:{TEXT("BaseColor"),TEXT("AccentColor"),TEXT("BeltColor"),TEXT("Metal-Spec-Roughness")})
            if (!VectorInfo.ContainsByPredicate([Name](const FMaterialParameterInfo& P) { return P.Name.ToString().Equals(Name,ESearchCase::CaseSensitive); })) return false;
        return true;
    }
    bool ApplyAndVerify(UMaterialInstanceDynamic* M,const FString& Gi,const FString& Belt) const
    {
        for (int32 I=0;I<VectorInfo.Num();++I)
        {
            const FString N=VectorInfo[I].Name.ToString();
            if (Exact(N,TEXT("BaseColor"))||Exact(N,TEXT("AccentColor"))||Exact(N,TEXT("BeltColor")))
                M->SetVectorParameterValue(VectorInfo[I].Name,PreviewColor(Exact(N,TEXT("BeltColor"))?Belt:Gi,Vectors[I].A));
        }
        for (int32 I=0;I<VectorInfo.Num();++I)
        {
            FLinearColor V; const FString N=VectorInfo[I].Name.ToString();
            const bool bColor=Exact(N,TEXT("BaseColor"))||Exact(N,TEXT("AccentColor"))||Exact(N,TEXT("BeltColor"));
            const FLinearColor Expected=bColor?PreviewColor(Exact(N,TEXT("BeltColor"))?Belt:Gi,Vectors[I].A):Vectors[I];
            if (!M->GetVectorParameterValue(VectorInfo[I],V) || (bColor?!Same(V,Expected):V!=Expected)) return false;
        }
        for (int32 I=0;I<ScalarInfo.Num();++I) { float V; if (!M->GetScalarParameterValue(ScalarInfo[I],V)||V!=Scalars[I]) return false; }
        for (int32 I=0;I<TextureInfo.Num();++I) { UTexture* V=nullptr; if (!M->GetTextureParameterValue(TextureInfo[I],V)||V!=Textures[I]) return false; }
        return true;
    }
};
}

struct UJQPreviewReceiverComponent::FImpl : JQ::IPreviewDriver
{
    explicit FImpl(UJQPreviewReceiverComponent& InOwner):Owner(InOwner) {}
    UJQPreviewReceiverComponent& Owner;
    TSharedPtr<FJQPixelStreamingTransport> Transport;
    TUniquePtr<JQ::FReceiverSession> Session;
    TArray<FMaterialSnapshot> Materials;
    TWeakObjectPtr<USkeletalMesh> BodyAsset,FaceAsset;
    TWeakObjectPtr<USkinnedAsset> OutfitAsset;
    TWeakObjectPtr<UClass> FaceClass,OldBodyClass;
    EAnimationMode::Type OldBodyMode=EAnimationMode::AnimationBlueprint;
    TWeakObjectPtr<UAnimationAsset> OldAnimation;
    float OldTime=0,OldRate=1; bool bOldPlaying=false,bOldLooping=false,bBodyChanged=false;
    TWeakObjectPtr<AActor> OldViewTarget;
    TArray<FTransform> CameraTransforms;
    TArray<float> CameraFOVs;
    UAnimSequence* ActiveSequence=nullptr;
    FString Mode=TEXT("side"); bool bCompact=false;
    double StateTimer=0,StartTime=0,OrbitSeconds=0;
    bool bFailed=false;

    bool Bindings() const
    {
        return IsValid(Owner.Body) && IsValid(Owner.Face) && IsValid(Owner.Outfit) &&
            Owner.Body->GetSkeletalMeshAsset()==BodyAsset.Get() && Owner.Face->GetSkeletalMeshAsset()==FaceAsset.Get() &&
            Owner.Face->GetAnimClass()==FaceClass.Get() && Owner.Outfit->GetSkinnedAsset()==OutfitAsset.Get() &&
            Owner.Outfit->LeaderPoseComponent.Get()==Owner.Body && Owner.PreviewMaterials.Num()==Owner.Outfit->GetNumMaterials();
    }
    UAnimSequence* Sequence(const FString& Id) const
    { return Exact(Id,TEXT("human_idle"))?Owner.VerifiedIdle.Get():Exact(Id,TEXT("human_walk"))?Owner.VerifiedWalk.Get():nullptr; }
    bool Camera(const FString& NewMode,bool Compact)
    {
        for (const auto& C:Owner.Cameras) if (C.Mode.Equals(NewMode,ESearchCase::CaseSensitive))
        {
            if (!IsValid(C.Camera)||!IsValid(Owner.LocalController)) return false;
            C.Camera->GetCameraComponent()->SetFieldOfView(Compact?C.CompactFOV:C.WideFOV);
            Owner.LocalController->SetViewTarget(C.Camera);
            Mode=NewMode; bCompact=Compact;
            return Owner.LocalController->GetViewTarget()==C.Camera && FMath::IsNearlyEqual(C.Camera->GetCameraComponent()->FieldOfView,Compact?C.CompactFOV:C.WideFOV);
        }
        return false;
    }
    bool Apply(const JQ::FCommand& C) override
    {
        if (!Bindings()) return false;
        UAnimSingleNodeInstance* Player=Owner.Body->GetSingleNodeInstance();
        if (!Player) return false;
        if (Exact(C.Type,TEXT("play")))
        {
            UAnimSequence* Next=Sequence(C.MoveId);
            const JQ::FAthlete& Athlete=Exact(C.PerformerSide,TEXT("fighter"))?C.Fighter:C.Opponent;
            // Whole-gi only: reject a requested split instead of silently misrepresenting it.
            if (!Next || FColor::FromHex(Athlete.GiTop)!=FColor::FromHex(Athlete.GiPants)) return false;
            for (int32 I=0;I<Materials.Num();++I)
                if (Owner.Outfit->GetMaterial(I)!=Owner.PreviewMaterials[I] || !Materials[I].ApplyAndVerify(Owner.PreviewMaterials[I],Athlete.GiTop,Athlete.Belt)) return false;
            if (!Camera(C.Camera,C.bCompactViewport)) return false;
            ActiveSequence=Next; Player->SetAnimationAsset(Next,false,static_cast<float>(C.Speed));
            Player->SetLooping(false); Player->SetPosition(static_cast<float>(C.Progress*Next->GetPlayLength()),false);
            Player->SetPlaying(!C.bPaused&&C.Progress<1);
        }
        else if (!ActiveSequence || Player->GetAnimationAsset()!=ActiveSequence) return false;
        else if (Exact(C.Type,TEXT("pause"))) Player->SetPlaying(false);
        else if (Exact(C.Type,TEXT("resume"))) Player->SetPlaying(Player->GetCurrentTime()<Player->GetLength());
        else if (Exact(C.Type,TEXT("seek"))||Exact(C.Type,TEXT("reset")))
        { Player->SetPlaying(false); Player->SetPosition(static_cast<float>(C.Progress*Player->GetLength()),false); }
        else if (Exact(C.Type,TEXT("setSpeed"))) Player->SetPlayRate(static_cast<float>(C.Speed));
        else if (Exact(C.Type,TEXT("setCamera"))||Exact(C.Type,TEXT("setViewport"))) return Camera(C.Camera,C.bCompactViewport);
        else if (!Exact(C.Type,TEXT("requestState"))) return false;
        return Bindings() && !Player->IsLooping() && FMath::IsFinite(Player->GetCurrentTime());
    }
    bool Read(JQ::FNativePlayback& Out) const override
    {
        if (!Bindings()||!ActiveSequence) return false;
        UAnimSingleNodeInstance* Player=Owner.Body->GetSingleNodeInstance();
        if (!Player||Player->GetAnimationAsset()!=ActiveSequence) return false;
        const double Rate=ActiveSequence->GetSamplingFrameRate().AsDecimal();
        if (!FMath::IsFinite(Rate)||Rate<=0) return false;
        Out={Player->GetCurrentTime(),Player->GetLength(),1.0/Rate,Player->IsPlaying()}; return true;
    }
    void Pause() override { if (IsValid(Owner.Body)) if (auto* Player=Owner.Body->GetSingleNodeInstance()) Player->SetPlaying(false); }
    void Orbit(float Delta)
    {
        if (!Exact(Mode,TEXT("orbit"))||!IsValid(Owner.OrbitPivot)) return;
        OrbitSeconds+=Delta;
        for (int32 I=0;I<Owner.Cameras.Num();++I) if (Exact(Owner.Cameras[I].Mode,TEXT("orbit")) && IsValid(Owner.Cameras[I].Camera))
        {
            const FVector Pivot=Owner.OrbitPivot->GetActorLocation();
            const FVector Offset=(CameraTransforms[I].GetLocation()-Pivot).RotateAngleAxis(OrbitSeconds*6,FVector::UpVector);
            Owner.Cameras[I].Camera->SetActorLocationAndRotation(Pivot+Offset,(-Offset).Rotation());
        }
    }
};

UJQPreviewReceiverComponent::UJQPreviewReceiverComponent() { PrimaryComponentTick.bCanEverTick=true; }
void UJQPreviewReceiverComponent::FImplDeleter::operator()(FImpl* Value) const { delete Value; }
UJQPreviewReceiverComponent::~UJQPreviewReceiverComponent() = default;

bool UJQPreviewReceiverComponent::StartLocalPreview()
{
    if (!JQ::bVideoOnlyControlCandidateEnabled)
    { LastError=TEXT("Native transport is on security hold; no preview connection was started."); return false; }
    if (!IsInGameThread()||Impl||!GetWorld()||!GetWorld()->IsGameWorld()||!bEnableVerifiedHumanPreview) return false;
    LastError.Reset();
    if (!IsValid(Body)||!IsValid(Face)||!IsValid(Outfit)||Body==Face||Body->GetOwner()!=Face->GetOwner()||Body->GetOwner()!=Outfit->GetOwner()||
        Body->GetWorld()!=GetWorld()||!Body->IsRegistered()||!Face->IsRegistered()||!Outfit->IsRegistered()||!Body->GetSkeletalMeshAsset()||!Face->GetSkeletalMeshAsset()||
        !Face->GetAnimClass()||Outfit->LeaderPoseComponent.Get()!=Body||!IsValid(LocalController)||!LocalController->IsLocalController()||
        LocalController->GetWorld()!=GetWorld()||!IsValid(OrbitPivot)||OrbitPivot->GetWorld()!=GetWorld())
    { LastError=TEXT("Assign the reviewed body, face, outfit follower, local controller and camera pivot."); return false; }
    for (UAnimSequence* Seq:{VerifiedIdle.Get(),VerifiedWalk.Get()})
        if (!IsValid(Seq)||Seq->GetSkeleton()!=Body->GetSkeletalMeshAsset()->GetSkeleton()||!FMath::IsFinite(Seq->GetPlayLength())||Seq->GetPlayLength()<=0||Seq->GetSamplingFrameRate().AsDecimal()<=0)
        { LastError=TEXT("The verified idle and walk must match this body's exact skeleton."); return false; }
    JQ::FExactStringSet Modes;
    TSet<ACameraActor*> CameraActors;
    for (const auto& C:Cameras)
    {
        if (!IsValid(C.Camera)||C.Camera->GetWorld()!=GetWorld()||CameraActors.Contains(C.Camera)||Modes.Contains(C.Mode)||
            !FMath::IsFinite(C.WideFOV)||!FMath::IsFinite(C.CompactFOV)||C.WideFOV<20||C.WideFOV>80||C.CompactFOV<20||C.CompactFOV>80)
        { LastError=TEXT("Assign five distinct reviewed cameras with bounded framing."); return false; }
        Modes.Add(C.Mode); CameraActors.Add(C.Camera);
    }
    if (Modes.Num()!=5) return false;
    for (const TCHAR* Mode:{TEXT("front"),TEXT("focus"),TEXT("side"),TEXT("overhead"),TEXT("orbit")}) if (!Modes.Contains(Mode)) return false;
    Impl.Reset(new FImpl(*this));
    Impl->BodyAsset=Body->GetSkeletalMeshAsset(); Impl->FaceAsset=Face->GetSkeletalMeshAsset(); Impl->FaceClass=Face->GetAnimClass(); Impl->OutfitAsset=Outfit->GetSkinnedAsset();
    Impl->OldBodyMode=Body->GetAnimationMode(); Impl->OldBodyClass=Body->GetAnimClass(); Impl->OldViewTarget=LocalController->GetViewTarget();
    if (auto* P=Body->GetSingleNodeInstance())
    { Impl->OldAnimation=P->GetAnimationAsset(); Impl->OldTime=P->GetCurrentTime(); Impl->OldRate=P->GetPlayRate(); Impl->bOldLooping=P->IsLooping(); Impl->bOldPlaying=P->IsPlaying(); }
    for (const auto& C:Cameras) { Impl->CameraTransforms.Add(C.Camera->GetActorTransform()); Impl->CameraFOVs.Add(C.Camera->GetCameraComponent()->FieldOfView); }
    const int32 Slots=Outfit->GetNumMaterials();
    if (Slots<1||Slots>8) { FailPreview(); return false; }
    for (int32 I=0;I<Slots;++I)
    {
        UMaterialInterface* Original=Outfit->GetMaterial(I); FMaterialSnapshot Snapshot;
        if (!Original||!Snapshot.Read(Original)) { FailPreview(); return false; }
        OriginalMaterials.Add(Original);
        auto* MID=UMaterialInstanceDynamic::Create(Original,this);
        if (!MID) { FailPreview(); return false; }
        PreviewMaterials.Add(MID); Impl->Materials.Add(MoveTemp(Snapshot)); Outfit->SetMaterial(I,MID);
    }
    Body->SetAnimationMode(EAnimationMode::AnimationSingleNode); Impl->bBodyChanged=true;
    if (!Body->GetSingleNodeInstance()) { FailPreview(); return false; }
    // A configured preview starts at the real idle asset's first frame, paused.
    Impl->ActiveSequence=VerifiedIdle;
    Body->GetSingleNodeInstance()->SetAnimationAsset(VerifiedIdle,false,1);
    Body->GetSingleNodeInstance()->SetPosition(0,false);
    Impl->Pause();
    if (!Impl->Bindings()||!Impl->Camera(TEXT("side"),false)) { FailPreview(); return false; }
    Impl->Transport=MakeShared<FJQPixelStreamingTransport>();
    const TWeakObjectPtr<UJQPreviewReceiverComponent> Weak(this);
    JQ::FProfile Profile; Profile.Channel=TEXT("jiuquest.characterPreview");
    Profile.VerifiedMoveIds.Add(TEXT("human_idle")); Profile.VerifiedMoveIds.Add(TEXT("human_walk"));
    Impl->Session=MakeUnique<JQ::FReceiverSession>(MoveTemp(Profile),*Impl,[Weak](const FString& Peer,const FString& Json)
    { if (auto* Self=Weak.Get(); Self&&Self->Impl&&Self->Impl->Transport) Self->Impl->Transport->Send(Peer,Json); });
    Impl->StartTime=FPlatformTime::Seconds();
    const bool Started=Impl->Transport->Start(TEXT("JiuQuestHumanPreview"),TEXT("ws://127.0.0.1:49088"),
        [Weak](const FString& Peer,const FString& Json) { if (auto* Self=Weak.Get(); Self&&Self->Impl&&Self->Impl->Session) Self->Impl->Session->Receive(Peer,Json); },
        [Weak](const FString& Peer) { if (auto* Self=Weak.Get(); Self&&Self->Impl&&Self->Impl->Session) Self->Impl->Session->Disconnect(Peer); },
        [Weak]() { if (auto* Self=Weak.Get(); Self&&Self->Impl) { Self->Impl->bFailed=true; Self->Impl->Pause(); } });
    if (!Started || Impl->bFailed) { FailPreview(); return false; }
    return true;
}

void UJQPreviewReceiverComponent::FailPreview()
{ LastError=TEXT("The local preview stopped because a reviewed runtime binding could not be verified."); StopLocalPreview(); }
void UJQPreviewReceiverComponent::StopLocalPreview()
{
    if (!Impl) return;
    if (Impl->Transport) Impl->Transport->Stop();
    if (Impl->Session) Impl->Session->Stop();
    if (IsValid(Outfit)) for (int32 I=0;I<OriginalMaterials.Num();++I) Outfit->SetMaterial(I,OriginalMaterials[I]);
    if (IsValid(Body)&&Impl->bBodyChanged)
    {
        Body->SetAnimationMode(Impl->OldBodyMode);
        if (Impl->OldBodyMode==EAnimationMode::AnimationBlueprint) Body->SetAnimInstanceClass(Impl->OldBodyClass.Get());
        else if (Impl->OldBodyMode==EAnimationMode::AnimationSingleNode) if (auto* P=Body->GetSingleNodeInstance())
        { P->SetAnimationAsset(Impl->OldAnimation.Get(),Impl->bOldLooping,Impl->OldRate); P->SetPosition(Impl->OldTime,false); P->SetPlaying(Impl->bOldPlaying); }
    }
    if (IsValid(LocalController)&&Impl->OldViewTarget.IsValid()) LocalController->SetViewTarget(Impl->OldViewTarget.Get());
    for (int32 I=0;I<Impl->CameraTransforms.Num();++I) if (Cameras.IsValidIndex(I)&&IsValid(Cameras[I].Camera))
    { Cameras[I].Camera->SetActorTransform(Impl->CameraTransforms[I]); Cameras[I].Camera->GetCameraComponent()->SetFieldOfView(Impl->CameraFOVs[I]); }
    Impl.Reset(); PreviewMaterials.Reset(); OriginalMaterials.Reset();
}
void UJQPreviewReceiverComponent::TickComponent(float Delta,ELevelTick TickType,FActorComponentTickFunction* Function)
{
    Super::TickComponent(Delta,TickType,Function);
    if (!Impl) return;
    if (Impl->bFailed || (!Impl->Transport->IsRunning()&&FPlatformTime::Seconds()-Impl->StartTime>30)) { FailPreview(); return; }
    Impl->Orbit(Delta); Impl->StateTimer+=Delta;
    if (Impl->StateTimer>=.1) { Impl->StateTimer=0; Impl->Session->Tick(); }
}
void UJQPreviewReceiverComponent::EndPlay(const EEndPlayReason::Type Reason)
{ StopLocalPreview(); Super::EndPlay(Reason); }
