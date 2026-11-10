using UnrealBuildTool;

public class JiuQuestRuntime : ModuleRules
{
    public JiuQuestRuntime(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine" });
        PrivateDependencyModuleNames.AddRange(new[] { "Json", "PixelStreaming2", "PixelStreaming2Core", "PixelStreaming2Input", "WebSockets" });
        // No UnrealEd, MetaHumanCharacterEditor, PythonScriptPlugin, or private include paths.
    }
}
