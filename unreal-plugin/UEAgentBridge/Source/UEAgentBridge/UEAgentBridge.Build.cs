using UnrealBuildTool;

public class UEAgentBridge : ModuleRules
{
	public UEAgentBridge(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new[]
		{
			"Core",
			"CoreUObject",
			"Engine"
		});

		PrivateDependencyModuleNames.AddRange(new[]
		{
			"HTTPServer",
			"ImageWrapper",
			"Json",
			"JsonUtilities",
			"MessageLog",
			"Projects",
			"RenderCore",
			"UnrealEd"
		});

		if (Target.Platform == UnrealTargetPlatform.Win64)
		{
			PrivateDependencyModuleNames.Add("LiveCoding");
		}
	}
}
