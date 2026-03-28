#include "Modules/ModuleManager.h"

#include "Async/Async.h"
#include "Editor.h"
#include "EditorViewportClient.h"
#include "Components/LineBatchComponent.h"
#include "Engine/Engine.h"
#include "Engine/Level.h"
#include "Engine/Selection.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Actor.h"
#include "HAL/PlatformProcess.h"
#include "HttpPath.h"
#include "HttpRequestHandler.h"
#include "HttpRouteHandle.h"
#include "HttpServerModule.h"
#include "HttpServerRequest.h"
#include "HttpServerResponse.h"
#include "IHttpRouter.h"
#include "Interfaces/IPluginManager.h"
#include "IMessageLogListing.h"
#include "Kismet2/CompilerResultsLog.h"
#include "Logging/LogVerbosity.h"
#include "Logging/TokenizedMessage.h"
#include "MessageLogModule.h"
#include "Misc/App.h"
#include "Misc/Base64.h"
#include "Misc/CommandLine.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/DateTime.h"
#include "Misc/Optional.h"
#include "Misc/OutputDevice.h"
#include "Misc/Parse.h"
#include "ModuleDescriptor.h"
#include "Misc/ScopeLock.h"
#include "ImageUtils.h"
#include "Internationalization/Regex.h"
#include "RenderingThread.h"
#include "Serialization/JsonSerializer.h"
#include "UObject/UObjectIterator.h"
#include "Containers/StringConv.h"
#include "Templates/Function.h"

#if PLATFORM_WINDOWS
#include "ILiveCodingModule.h"
#endif

DEFINE_LOG_CATEGORY_STATIC(LogUEAgentBridge, Log, All);

namespace UEAgentBridge
{
	static constexpr uint32 DefaultPort = 30110;
	static constexpr int32 MaxBufferedLogEntries = 1024;
	static constexpr int32 MaxSliceLimit = 200;
	static constexpr int32 DefaultActorLimit = 100;
	static constexpr int32 DefaultOutputLimit = 50;
	static constexpr int32 DefaultViewportScreenshotMaxDimension = 1280;
	static constexpr int32 MinViewportScreenshotDimension = 256;
	static constexpr int32 MaxViewportScreenshotDimension = 4096;
	static constexpr TCHAR PluginName[] = TEXT("UEAgentBridge");
	static constexpr TCHAR PluginVersion[] = TEXT("0.3.0");
	static constexpr TCHAR ApiVersion[] = TEXT("v1");

	struct FBufferedLogEntry
	{
		FString Timestamp;
		FString Level;
		FString Category;
		FString Message;
	};

	struct FStructuredDiagnostic
	{
		FString Source;
		FString Severity;
		FString Category;
		FString Message;
		FString FilePath;
		int32 Line = 0;
		int32 Column = 0;
		int32 Priority = 0;
	};

	struct FViewportCapture
	{
		TArray<FColor> Pixels;
		int32 Width = 0;
		int32 Height = 0;
		FString ViewportType;
		FString ViewMode;
		bool bRealtime = false;
		FVector CameraLocation = FVector::ZeroVector;
		FRotator CameraRotation = FRotator::ZeroRotator;
	};

	struct FViewportScreenshotOptions
	{
		int32 MaxDimension = DefaultViewportScreenshotMaxDimension;
		TOptional<EViewModeIndex> ViewModeOverride;
		TOptional<FIntRect> CropRect;
	};

	struct FEndpointResult
	{
		bool bSuccess = false;
		EHttpServerResponseCodes HttpCode = EHttpServerResponseCodes::Ok;
		TSharedPtr<FJsonObject> Payload;
		FString ErrorCode;
		FString ErrorMessage;

		static FEndpointResult Success(const TSharedRef<FJsonObject>& InPayload, EHttpServerResponseCodes InCode = EHttpServerResponseCodes::Ok)
		{
			FEndpointResult Result;
			Result.bSuccess = true;
			Result.HttpCode = InCode;
			Result.Payload = InPayload;
			return Result;
		}

		static FEndpointResult Error(EHttpServerResponseCodes InCode, FString InErrorCode, FString InErrorMessage)
		{
			FEndpointResult Result;
			Result.HttpCode = InCode;
			Result.ErrorCode = MoveTemp(InErrorCode);
			Result.ErrorMessage = MoveTemp(InErrorMessage);
			return Result;
		}
	};

	static TMap<FString, FString> CreateSafeConsoleCommandMap()
	{
		return {
			{ TEXT("stat_fps"), TEXT("stat fps") },
			{ TEXT("stat_unit"), TEXT("stat unit") },
			{ TEXT("stat_memory"), TEXT("stat memory") },
			{ TEXT("show_bounds"), TEXT("show bounds") },
			{ TEXT("show_collision"), TEXT("show collision") },
			{ TEXT("show_navigation"), TEXT("show navigation") }
		};
	}

	static const TMap<FString, FString> SafeConsoleCommands = CreateSafeConsoleCommandMap();

	static TMap<FString, FString> CreatePreferredNativeSpawnClassPathMap()
	{
		return {
			{ TEXT("StaticMeshActor"), TEXT("/Script/Engine.StaticMeshActor") },
			{ TEXT("PointLight"), TEXT("/Script/Engine.PointLight") },
			{ TEXT("SpotLight"), TEXT("/Script/Engine.SpotLight") },
			{ TEXT("DirectionalLight"), TEXT("/Script/Engine.DirectionalLight") },
			{ TEXT("SkyLight"), TEXT("/Script/Engine.SkyLight") },
			{ TEXT("CameraActor"), TEXT("/Script/Engine.CameraActor") },
			{ TEXT("PlayerStart"), TEXT("/Script/Engine.PlayerStart") },
			{ TEXT("TargetPoint"), TEXT("/Script/Engine.TargetPoint") },
			{ TEXT("TriggerBox"), TEXT("/Script/Engine.TriggerBox") }
		};
	}

	static const TMap<FString, FString> PreferredNativeSpawnClassPaths = CreatePreferredNativeSpawnClassPathMap();

	static int32 LogRank(const FString& Level)
	{
		if (Level == TEXT("Verbose")) return 10;
		if (Level == TEXT("Log")) return 20;
		if (Level == TEXT("Display")) return 30;
		if (Level == TEXT("Warning")) return 40;
		return 50;
	}

	static int32 DiagnosticRank(const FString& Severity)
	{
		if (Severity == TEXT("Info")) return 10;
		if (Severity == TEXT("Warning")) return 20;
		return 30;
	}

	static FString NormalizeVerbosity(ELogVerbosity::Type Verbosity)
	{
		const ELogVerbosity::Type Masked = static_cast<ELogVerbosity::Type>(Verbosity & ELogVerbosity::VerbosityMask);

		switch (Masked)
		{
		case ELogVerbosity::Verbose:
		case ELogVerbosity::VeryVerbose:
			return TEXT("Verbose");
		case ELogVerbosity::Display:
			return TEXT("Display");
		case ELogVerbosity::Warning:
			return TEXT("Warning");
		case ELogVerbosity::Error:
		case ELogVerbosity::Fatal:
			return TEXT("Error");
		default:
			return TEXT("Log");
		}
	}

	static FString DiagnosticSeverityFromLevel(const FString& Level)
	{
		if (Level == TEXT("Error")) return TEXT("Error");
		if (Level == TEXT("Warning")) return TEXT("Warning");
		return TEXT("Info");
	}

	static FString DiagnosticSeverityFromMessageLog(EMessageSeverity::Type Severity)
	{
		if (Severity == EMessageSeverity::Error)
		{
			return TEXT("Error");
		}
		if (Severity == EMessageSeverity::Warning || Severity == EMessageSeverity::PerformanceWarning)
		{
			return TEXT("Warning");
		}
		return TEXT("Info");
	}

	static FString DiagnosticSourceFromCategory(const FString& Category)
	{
		if (Category == TEXT("LogLiveCoding"))
		{
			return TEXT("LiveCoding");
		}
		if (Category == TEXT("LogBlueprint"))
		{
			return TEXT("Blueprint");
		}
		if (Category == TEXT("LogAutomationTest"))
		{
			return TEXT("AutomationTest");
		}
		if (Category == TEXT("LogCompile") || Category == TEXT("LogClass") || Category == TEXT("LogHotReload"))
		{
			return TEXT("Compiler");
		}
		return TEXT("OutputLog");
	}

	static FString DiagnosticSourceFromMessageLogName(const FName& LogName)
	{
		if (LogName == FCompilerResultsLog::GetLogName())
		{
			return TEXT("Compiler");
		}
		if (LogName == TEXT("BlueprintLog") || LogName == TEXT("AnimBlueprintLog"))
		{
			return TEXT("Blueprint");
		}
		if (LogName == TEXT("PIE"))
		{
			return TEXT("PIE");
		}
		if (LogName == TEXT("MapCheck"))
		{
			return TEXT("MapCheck");
		}
		if (LogName == TEXT("LoadErrors"))
		{
			return TEXT("LoadErrors");
		}
		if (LogName == TEXT("PackagingResults"))
		{
			return TEXT("Packaging");
		}
		return TEXT("MessageLog");
	}

	static TArray<FName> GetDiagnosticMessageLogNames()
	{
		return {
			FCompilerResultsLog::GetLogName(),
			TEXT("BlueprintLog"),
			TEXT("AnimBlueprintLog"),
			TEXT("PIE"),
			TEXT("MapCheck"),
			TEXT("LoadErrors"),
			TEXT("PackagingResults")
		};
	}

	static int32 DiagnosticPriority(const FString& Source, const FString& Severity, const FString& Category, bool bHasFilePath)
	{
		int32 Priority = 0;

		if (Severity == TEXT("Error"))
		{
			Priority += 300;
		}
		else if (Severity == TEXT("Warning"))
		{
			Priority += 200;
		}
		else
		{
			Priority += 100;
		}

		if (Source == TEXT("LiveCoding"))
		{
			Priority += 80;
		}
		else if (Source == TEXT("Compiler"))
		{
			Priority += 70;
		}
		else if (Source == TEXT("Blueprint"))
		{
			Priority += 60;
		}

		if (bHasFilePath)
		{
			Priority += 40;
		}

		if (Category == TEXT("LogStreaming"))
		{
			Priority -= 50;
		}

		return Priority;
	}

	static bool TryParseCompilerLocation(const FString& Message, FString& OutFilePath, int32& OutLine, int32& OutColumn)
	{
		OutFilePath.Reset();
		OutLine = 0;
		OutColumn = 0;

		FRegexPattern WithColumnPattern(TEXT(R"((?:^|\s)([A-Za-z]:\\[^:(]+(?:\\[^:(]+)*)\((\d+),(\d+)\)\s*:\s*(?:fatal error|error|warning|note)\b)"));
		FRegexMatcher WithColumnMatcher(WithColumnPattern, Message);
		if (WithColumnMatcher.FindNext())
		{
			OutFilePath = WithColumnMatcher.GetCaptureGroup(1);
			OutLine = FCString::Atoi(*WithColumnMatcher.GetCaptureGroup(2));
			OutColumn = FCString::Atoi(*WithColumnMatcher.GetCaptureGroup(3));
			return true;
		}

		FRegexPattern NoColumnPattern(TEXT(R"((?:^|\s)([A-Za-z]:\\[^:(]+(?:\\[^:(]+)*)\((\d+)\)\s*:\s*(?:fatal error|error|warning|note)\b)"));
		FRegexMatcher NoColumnMatcher(NoColumnPattern, Message);
		if (NoColumnMatcher.FindNext())
		{
			OutFilePath = NoColumnMatcher.GetCaptureGroup(1);
			OutLine = FCString::Atoi(*NoColumnMatcher.GetCaptureGroup(2));
			return true;
		}

		return false;
	}

	static FStructuredDiagnostic BuildStructuredDiagnostic(const FBufferedLogEntry& Entry)
	{
		FStructuredDiagnostic Diagnostic;
		Diagnostic.Source = DiagnosticSourceFromCategory(Entry.Category);
		Diagnostic.Severity = DiagnosticSeverityFromLevel(Entry.Level);
		Diagnostic.Category = Entry.Category;
		Diagnostic.Message = Entry.Message;
		TryParseCompilerLocation(Entry.Message, Diagnostic.FilePath, Diagnostic.Line, Diagnostic.Column);
		Diagnostic.Priority = DiagnosticPriority(Diagnostic.Source, Diagnostic.Severity, Diagnostic.Category, !Diagnostic.FilePath.IsEmpty());
		return Diagnostic;
	}

	static FStructuredDiagnostic BuildStructuredDiagnosticFromMessageLog(const FName& LogName, const FTokenizedMessage& Message)
	{
		FStructuredDiagnostic Diagnostic;
		Diagnostic.Source = DiagnosticSourceFromMessageLogName(LogName);
		Diagnostic.Severity = DiagnosticSeverityFromMessageLog(Message.GetSeverity());
		Diagnostic.Category = LogName.ToString();
		Diagnostic.Message = Message.ToText().ToString().TrimStartAndEnd();
		TryParseCompilerLocation(Diagnostic.Message, Diagnostic.FilePath, Diagnostic.Line, Diagnostic.Column);
		Diagnostic.Priority = DiagnosticPriority(Diagnostic.Source, Diagnostic.Severity, Diagnostic.Category, !Diagnostic.FilePath.IsEmpty());

		if (LogName == FCompilerResultsLog::GetLogName())
		{
			Diagnostic.Priority += 50;
		}
		else if (LogName == TEXT("PIE") || LogName == TEXT("LoadErrors"))
		{
			Diagnostic.Priority += 20;
		}

		return Diagnostic;
	}

	static FString DiagnosticKey(const FStructuredDiagnostic& Diagnostic)
	{
		return FString::Printf(TEXT("%s|%s|%s|%s|%s|%d|%d"),
			*Diagnostic.Source,
			*Diagnostic.Severity,
			*Diagnostic.Category,
			*Diagnostic.Message,
			*Diagnostic.FilePath,
			Diagnostic.Line,
			Diagnostic.Column);
	}

	static FString ViewportTypeToString(ELevelViewportType ViewportType)
	{
		switch (ViewportType)
		{
		case LVT_Perspective: return TEXT("perspective");
		case LVT_OrthoXY: return TEXT("ortho_xy");
		case LVT_OrthoXZ: return TEXT("ortho_xz");
		case LVT_OrthoYZ: return TEXT("ortho_yz");
		case LVT_OrthoNegativeXY: return TEXT("ortho_negative_xy");
		case LVT_OrthoNegativeXZ: return TEXT("ortho_negative_xz");
		case LVT_OrthoNegativeYZ: return TEXT("ortho_negative_yz");
		default: return FString::Printf(TEXT("viewport_%d"), static_cast<int32>(ViewportType));
		}
	}

	static FString ViewModeToString(EViewModeIndex ViewMode)
	{
		switch (ViewMode)
		{
		case VMI_BrushWireframe: return TEXT("brush_wireframe");
		case VMI_Wireframe: return TEXT("wireframe");
		case VMI_Unlit: return TEXT("unlit");
		case VMI_Lit: return TEXT("lit");
		case VMI_Lit_DetailLighting: return TEXT("detail_lighting");
		case VMI_LightingOnly: return TEXT("lighting_only");
		case VMI_LightComplexity: return TEXT("light_complexity");
		case VMI_ShaderComplexity: return TEXT("shader_complexity");
		case VMI_LightmapDensity: return TEXT("lightmap_density");
		case VMI_ReflectionOverride: return TEXT("reflection_override");
		case VMI_StationaryLightOverlap: return TEXT("stationary_light_overlap");
		case VMI_CollisionPawn: return TEXT("collision_pawn");
		case VMI_CollisionVisibility: return TEXT("collision_visibility");
		case VMI_VisualizeBuffer: return TEXT("visualize_buffer");
		default: return FString::Printf(TEXT("view_mode_%d"), static_cast<int32>(ViewMode));
		}
	}

	static TSharedRef<FJsonObject> MakeVectorJson(const FVector& Value)
	{
		const TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
		Json->SetNumberField(TEXT("x"), Value.X);
		Json->SetNumberField(TEXT("y"), Value.Y);
		Json->SetNumberField(TEXT("z"), Value.Z);
		return Json;
	}

	static TSharedRef<FJsonObject> MakeRotatorJson(const FRotator& Value)
	{
		const TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
		Json->SetNumberField(TEXT("pitch"), Value.Pitch);
		Json->SetNumberField(TEXT("yaw"), Value.Yaw);
		Json->SetNumberField(TEXT("roll"), Value.Roll);
		return Json;
	}

	static TSharedRef<FJsonObject> MakeColorJson(const FLinearColor& Value)
	{
		const TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
		Json->SetNumberField(TEXT("r"), Value.R);
		Json->SetNumberField(TEXT("g"), Value.G);
		Json->SetNumberField(TEXT("b"), Value.B);
		Json->SetNumberField(TEXT("a"), Value.A);
		return Json;
	}

	static FString LineBatcherTypeToString(UWorld::ELineBatcherType Type)
	{
		switch (Type)
		{
		case UWorld::ELineBatcherType::World: return TEXT("world");
		case UWorld::ELineBatcherType::WorldPersistent: return TEXT("world_persistent");
		case UWorld::ELineBatcherType::Foreground: return TEXT("foreground");
		case UWorld::ELineBatcherType::ForegroundPersistent: return TEXT("foreground_persistent");
		default: return TEXT("unknown");
		}
	}

	static bool TryParseViewMode(const FString& Value, EViewModeIndex& OutViewMode)
	{
		const FString Normalized = Value.ToLower();

		if (Normalized == TEXT("current"))
		{
			return false;
		}
		if (Normalized == TEXT("lit"))
		{
			OutViewMode = VMI_Lit;
			return true;
		}
		if (Normalized == TEXT("unlit"))
		{
			OutViewMode = VMI_Unlit;
			return true;
		}
		if (Normalized == TEXT("wireframe"))
		{
			OutViewMode = VMI_Wireframe;
			return true;
		}
		if (Normalized == TEXT("detail_lighting"))
		{
			OutViewMode = VMI_Lit_DetailLighting;
			return true;
		}
		if (Normalized == TEXT("lighting_only"))
		{
			OutViewMode = VMI_LightingOnly;
			return true;
		}
		if (Normalized == TEXT("collision_pawn"))
		{
			OutViewMode = VMI_CollisionPawn;
			return true;
		}
		if (Normalized == TEXT("collision_visibility"))
		{
			OutViewMode = VMI_CollisionVisibility;
			return true;
		}

		return false;
	}

	static void AddVisibleDiagnostic(const FStructuredDiagnostic& Diagnostic, const FString& MinSeverity, TSet<FString>& SeenDiagnostics, TArray<FStructuredDiagnostic>& OutDiagnostics)
	{
		if (Diagnostic.Message.IsEmpty())
		{
			return;
		}

		if (DiagnosticRank(Diagnostic.Severity) < DiagnosticRank(MinSeverity))
		{
			return;
		}

		const FString Key = DiagnosticKey(Diagnostic);
		if (SeenDiagnostics.Contains(Key))
		{
			return;
		}

		SeenDiagnostics.Add(Key);
		OutDiagnostics.Add(Diagnostic);
	}

	template <typename TResult, typename TCallable>
	TResult RunOnGameThreadBlocking(TCallable&& Callable)
	{
		if (IsInGameThread())
		{
			return Callable();
		}

		TFunction<TResult()> Task = Forward<TCallable>(Callable);
		TOptional<TResult> Result;
		FEvent* Event = FPlatformProcess::GetSynchEventFromPool(true);

		AsyncTask(ENamedThreads::GameThread, [&Result, Task = MoveTemp(Task), Event]() mutable
		{
			Result.Emplace(Task());
			Event->Trigger();
		});

		Event->Wait();
		FPlatformProcess::ReturnSynchEventToPool(Event);
		check(Result.IsSet());
		return MoveTemp(Result.GetValue());
	}

	static FString Utf8BodyToString(const TArray<uint8>& Body)
	{
		if (Body.Num() == 0)
		{
			return FString();
		}

		FUTF8ToTCHAR Converter(reinterpret_cast<const ANSICHAR*>(Body.GetData()), Body.Num());
		return FString(Converter.Length(), Converter.Get());
	}

	static TSharedPtr<FJsonObject> ParseJsonBody(const FHttpServerRequest& Request, FString& OutError)
	{
		OutError.Reset();
		const FString BodyString = Utf8BodyToString(Request.Body);

		if (BodyString.TrimStartAndEnd().IsEmpty())
		{
			return MakeShared<FJsonObject>();
		}

		TSharedPtr<FJsonObject> JsonObject;
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(BodyString);
		if (!FJsonSerializer::Deserialize(Reader, JsonObject) || !JsonObject.IsValid())
		{
			OutError = TEXT("Request body must be valid JSON.");
		}

		return JsonObject;
	}

	static TUniquePtr<FHttpServerResponse> CreateJsonResponse(const TSharedRef<FJsonObject>& Payload, EHttpServerResponseCodes Code = EHttpServerResponseCodes::Ok);
	static TUniquePtr<FHttpServerResponse> CreateErrorResponse(EHttpServerResponseCodes Code, const FString& ErrorCode, const FString& ErrorMessage);
	static bool CompleteRequest(const FHttpResultCallback& OnComplete, FEndpointResult&& Result);
}

class FUEAgentBridgeOutputDevice final : public FOutputDevice
{
public:
	explicit FUEAgentBridgeOutputDevice(TFunction<void(const TCHAR*, ELogVerbosity::Type, const FName&)> InSink);

	virtual bool CanBeUsedOnAnyThread() const override;
	virtual void Serialize(const TCHAR* V, ELogVerbosity::Type Verbosity, const FName& Category) override;

private:
	TFunction<void(const TCHAR*, ELogVerbosity::Type, const FName&)> Sink;
};

class FUEAgentBridgeModule final : public IModuleInterface
{
public:
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;

private:
	uint32 Port = UEAgentBridge::DefaultPort;
	bool bRoutesRegistered = false;
	bool bLiveCodingDelegateBound = false;
	FString LastLiveCodingResult = TEXT("unknown");
	FDelegateHandle LiveCodingPatchHandle;
	TSharedPtr<IHttpRouter> Router;
	TArray<FHttpRouteHandle> RouteHandles;
	TUniquePtr<FUEAgentBridgeOutputDevice> OutputDevice;
	TArray<UEAgentBridge::FBufferedLogEntry> LogBuffer;
	mutable FCriticalSection LogBufferLock;

	uint32 ResolvePortFromCommandLine() const;
	void InstallOutputDevice();
	void RemoveOutputDevice();
	void RegisterRoutes();
	void UnregisterRoutes();
	void AppendLogEntry(const TCHAR* Message, ELogVerbosity::Type Verbosity, const FName& Category);
	TArray<UEAgentBridge::FBufferedLogEntry> CopyLogBuffer() const;
	TArray<UEAgentBridge::FStructuredDiagnostic> CopyMessageLogDiagnostics() const;
	FString GetProjectName() const;
	UWorld* GetEditorWorld() const;
	FViewport* GetActiveEditorViewport() const;
	FEditorViewportClient* GetActiveEditorViewportClient() const;
	FString GetCurrentMapPath() const;
	bool IsEditorWorldReadyForMutation(UWorld*& OutWorld, UEAgentBridge::FEndpointResult& OutError) const;
	UClass* ResolveActorClassByPath(const FString& ClassPath) const;
	TSet<FString> GetAllowedSpawnScriptScopes() const;
	FString JoinAllowedSpawnScriptScopes() const;
	bool TryResolveSafeSpawnClassByName(const FString& ClassName, UClass*& OutClass, UEAgentBridge::FEndpointResult& OutError) const;
	bool TryResolveSafeSpawnClass(const FString& ClassName, const FString& ClassPath, UClass*& OutClass, UEAgentBridge::FEndpointResult& OutError) const;
	bool IsSafeSpawnClass(const UClass& ActorClass, FString* OutReason = nullptr) const;
	TSharedRef<FJsonObject> BuildActorMutationPayload(const AActor& Actor, bool bIncludeSelected, bool bIncludeTransform) const;
	AActor* ResolveActorTarget(const FString& ActorName, const FString& ObjectPath) const;
	void RedrawActiveViewport() const;
	TSharedRef<FJsonObject> BuildActorJson(const AActor& Actor, bool bIncludeSelected) const;
	TSharedRef<FJsonObject> BuildViewportCameraStatePayload(FEditorViewportClient& ViewportClient, const FIntPoint& ViewportSize, const TOptional<EViewModeIndex>& EffectiveViewMode, const TOptional<FIntRect>& CropRect) const;
	FString NormalizeStringField(const TSharedPtr<FJsonObject>& RequestObject, const TCHAR* FieldName, UEAgentBridge::FEndpointResult& OutError) const;
	int32 ReadLimitField(const TSharedPtr<FJsonObject>& RequestObject, int32 DefaultLimit, UEAgentBridge::FEndpointResult& OutError) const;
	UEAgentBridge::FEndpointResult BuildHealthResult();
	UEAgentBridge::FEndpointResult BuildSelectedActorsResult(int32 Limit);
	UEAgentBridge::FEndpointResult BuildLevelActorsResult(int32 Limit, const FString& ClassNameFilter, const FString& NameContainsFilter);
	UEAgentBridge::FEndpointResult BuildOutputLogResult(int32 Limit, const FString& MinLevel);
	UEAgentBridge::FEndpointResult BuildDiagnosticsResult(int32 Limit, const FString& MinSeverity);
	TSharedRef<FJsonObject> GetLiveCodingStatusPayload();
	UEAgentBridge::FEndpointResult BuildEditorStateResult();
	UEAgentBridge::FEndpointResult BuildViewportCameraResult();
	UEAgentBridge::FEndpointResult BuildSetViewportCameraResult(const FVector& Location, const FRotator& Rotation);
	UEAgentBridge::FEndpointResult BuildSpawnActorResult(const FString& ClassName, const FString& ClassPath, const FVector& Location, const FRotator& Rotation, bool bSelectAfterSpawn, const FString& Label);
	UEAgentBridge::FEndpointResult BuildSelectActorResult(const FString& ActorName, const FString& ObjectPath);
	UEAgentBridge::FEndpointResult BuildDestroyActorResult(const FString& ActorName, const FString& ObjectPath);
	UEAgentBridge::FEndpointResult BuildFrameActorResult(const FString& ActorName, const FString& ObjectPath, bool bActiveViewportOnly);
	UEAgentBridge::FEndpointResult BuildViewportScreenshotResult(const UEAgentBridge::FViewportScreenshotOptions& Options);
	UEAgentBridge::FEndpointResult BuildDebugDrawStateResult(int32 Limit, bool bIncludePoints);
	UEAgentBridge::FEndpointResult BuildLiveCodingBuildResult();
	UEAgentBridge::FEndpointResult BuildRunSafeConsoleCommandResult(const FString& CommandId);
	FString LiveCodingResultToString(ELiveCodingCompileResult Result) const;
	void HandleLiveCodingPatchComplete();

	bool HandleHealth(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleSelectedActors(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleLevelActors(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleOutputLogSlice(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleEditorDiagnostics(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleEditorState(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleGetViewportCamera(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleSetViewportCamera(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleSpawnActor(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleSelectActor(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleDestroyActor(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleFrameActor(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleViewportScreenshot(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleDebugDrawState(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleLiveCodingStatus(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleLiveCodingBuild(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleRunSafeConsoleCommand(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
};

TUniquePtr<FHttpServerResponse> UEAgentBridge::CreateJsonResponse(const TSharedRef<FJsonObject>& Payload, EHttpServerResponseCodes Code)
{
	FString Body;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Body);
	FJsonSerializer::Serialize(Payload, Writer);

	TUniquePtr<FHttpServerResponse> Response = FHttpServerResponse::Create(Body, TEXT("application/json"));
	Response->Code = Code;
	return Response;
}

TUniquePtr<FHttpServerResponse> UEAgentBridge::CreateErrorResponse(EHttpServerResponseCodes Code, const FString& ErrorCode, const FString& ErrorMessage)
{
	const TSharedRef<FJsonObject> ErrorObject = MakeShared<FJsonObject>();
	const TSharedRef<FJsonObject> Envelope = MakeShared<FJsonObject>();
	ErrorObject->SetStringField(TEXT("code"), ErrorCode);
	ErrorObject->SetStringField(TEXT("message"), ErrorMessage);
	Envelope->SetObjectField(TEXT("error"), ErrorObject);
	return CreateJsonResponse(Envelope, Code);
}

bool UEAgentBridge::CompleteRequest(const FHttpResultCallback& OnComplete, FEndpointResult&& Result)
{
	if (Result.bSuccess && Result.Payload.IsValid())
	{
		OnComplete(CreateJsonResponse(Result.Payload.ToSharedRef(), Result.HttpCode));
	}
	else
	{
		OnComplete(CreateErrorResponse(Result.HttpCode, Result.ErrorCode, Result.ErrorMessage));
	}
	return true;
}

FUEAgentBridgeOutputDevice::FUEAgentBridgeOutputDevice(TFunction<void(const TCHAR*, ELogVerbosity::Type, const FName&)> InSink)
	: Sink(MoveTemp(InSink))
{
}

bool FUEAgentBridgeOutputDevice::CanBeUsedOnAnyThread() const
{
	return true;
}

void FUEAgentBridgeOutputDevice::Serialize(const TCHAR* V, ELogVerbosity::Type Verbosity, const FName& Category)
{
	Sink(V, Verbosity, Category);
}

void FUEAgentBridgeModule::StartupModule()
{
	if (!GIsEditor || IsRunningCommandlet())
	{
		return;
	}

	Port = ResolvePortFromCommandLine();
	InstallOutputDevice();
	RegisterRoutes();

	UE_LOG(LogUEAgentBridge, Display, TEXT("UEAgentBridge started on 127.0.0.1:%u"), Port);
}

void FUEAgentBridgeModule::ShutdownModule()
{
	UnregisterRoutes();
	RemoveOutputDevice();

#if PLATFORM_WINDOWS
	if (bLiveCodingDelegateBound)
	{
		if (ILiveCodingModule* LiveCoding = FModuleManager::GetModulePtr<ILiveCodingModule>(LIVE_CODING_MODULE_NAME))
		{
			LiveCoding->GetOnPatchCompleteDelegate().Remove(LiveCodingPatchHandle);
		}
	}
#endif
}

uint32 FUEAgentBridgeModule::ResolvePortFromCommandLine() const
{
	int32 ParsedPort = static_cast<int32>(UEAgentBridge::DefaultPort);
	FParse::Value(FCommandLine::Get(), TEXT("UEAgentBridgePort="), ParsedPort);

	if (ParsedPort == static_cast<int32>(UEAgentBridge::DefaultPort))
	{
		GConfig->GetInt(TEXT("UEAgentBridge"), TEXT("Port"), ParsedPort, GEngineIni);
	}

	return ParsedPort > 0 ? static_cast<uint32>(ParsedPort) : UEAgentBridge::DefaultPort;
}

void FUEAgentBridgeModule::InstallOutputDevice()
{
	if (!GLog || OutputDevice)
	{
		return;
	}

	OutputDevice = MakeUnique<FUEAgentBridgeOutputDevice>([this](const TCHAR* Message, ELogVerbosity::Type Verbosity, const FName& Category)
	{
		AppendLogEntry(Message, Verbosity, Category);
	});

	GLog->AddOutputDevice(OutputDevice.Get());
}

void FUEAgentBridgeModule::RemoveOutputDevice()
{
	if (GLog && OutputDevice)
	{
		GLog->RemoveOutputDevice(OutputDevice.Get());
	}

	OutputDevice.Reset();
}

void FUEAgentBridgeModule::RegisterRoutes()
{
	if (bRoutesRegistered)
	{
		return;
	}

	FHttpServerModule& HttpServer = FHttpServerModule::Get();
	Router = HttpServer.GetHttpRouter(Port, true);
	if (!Router.IsValid())
	{
		UE_LOG(LogUEAgentBridge, Error, TEXT("Failed to acquire HTTP router on port %u"), Port);
		return;
	}

	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/health")), EHttpServerRequestVerbs::VERB_GET, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleHealth)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/selected-actors")), EHttpServerRequestVerbs::VERB_POST, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleSelectedActors)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/level-actors")), EHttpServerRequestVerbs::VERB_POST, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleLevelActors)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/output-log/slice")), EHttpServerRequestVerbs::VERB_POST, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleOutputLogSlice)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/editor-diagnostics")), EHttpServerRequestVerbs::VERB_POST, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleEditorDiagnostics)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/editor-state")), EHttpServerRequestVerbs::VERB_GET, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleEditorState)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/viewport/camera")), EHttpServerRequestVerbs::VERB_GET, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleGetViewportCamera)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/viewport/camera")), EHttpServerRequestVerbs::VERB_POST, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleSetViewportCamera)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/actors/spawn-safe")), EHttpServerRequestVerbs::VERB_POST, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleSpawnActor)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/actors/select-safe")), EHttpServerRequestVerbs::VERB_POST, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleSelectActor)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/actors/destroy-safe")), EHttpServerRequestVerbs::VERB_POST, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleDestroyActor)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/viewport/frame-actor")), EHttpServerRequestVerbs::VERB_POST, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleFrameActor)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/viewport/screenshot")), EHttpServerRequestVerbs::VERB_POST, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleViewportScreenshot)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/debug-draw/state")), EHttpServerRequestVerbs::VERB_POST, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleDebugDrawState)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/live-coding/status")), EHttpServerRequestVerbs::VERB_GET, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleLiveCodingStatus)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/live-coding/build")), EHttpServerRequestVerbs::VERB_POST, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleLiveCodingBuild)));
	RouteHandles.Add(Router->BindRoute(FHttpPath(TEXT("/api/v1/console/run-safe")), EHttpServerRequestVerbs::VERB_POST, FHttpRequestHandler::CreateRaw(this, &FUEAgentBridgeModule::HandleRunSafeConsoleCommand)));

	HttpServer.StartAllListeners();
	bRoutesRegistered = true;
}

void FUEAgentBridgeModule::UnregisterRoutes()
{
	if (!Router.IsValid())
	{
		return;
	}

	for (const FHttpRouteHandle& Handle : RouteHandles)
	{
		Router->UnbindRoute(Handle);
	}

	RouteHandles.Reset();
	Router.Reset();
	bRoutesRegistered = false;
}

void FUEAgentBridgeModule::AppendLogEntry(const TCHAR* Message, ELogVerbosity::Type Verbosity, const FName& Category)
{
	if (!Message)
	{
		return;
	}

	UEAgentBridge::FBufferedLogEntry Entry;
	Entry.Timestamp = FDateTime::UtcNow().ToIso8601();
	Entry.Level = UEAgentBridge::NormalizeVerbosity(Verbosity);
	Entry.Category = Category.IsNone() ? TEXT("LogTemp") : Category.ToString();
	Entry.Message = FString(Message).TrimStartAndEnd();

	if (Entry.Message.IsEmpty())
	{
		return;
	}

	FScopeLock Lock(&LogBufferLock);
	LogBuffer.Add(MoveTemp(Entry));

	const int32 Overflow = LogBuffer.Num() - UEAgentBridge::MaxBufferedLogEntries;
	if (Overflow > 0)
	{
		LogBuffer.RemoveAt(0, Overflow, EAllowShrinking::No);
	}
}

TArray<UEAgentBridge::FBufferedLogEntry> FUEAgentBridgeModule::CopyLogBuffer() const
{
	FScopeLock Lock(&LogBufferLock);
	return LogBuffer;
}

TArray<UEAgentBridge::FStructuredDiagnostic> FUEAgentBridgeModule::CopyMessageLogDiagnostics() const
{
	TArray<UEAgentBridge::FStructuredDiagnostic> Diagnostics;
	FMessageLogModule* MessageLogModule = FModuleManager::LoadModulePtr<FMessageLogModule>(TEXT("MessageLog"));
	if (!MessageLogModule)
	{
		return Diagnostics;
	}

	for (const FName& LogName : UEAgentBridge::GetDiagnosticMessageLogNames())
	{
		const TSharedRef<IMessageLogListing> Listing = MessageLogModule->GetLogListing(LogName);
		const TArray<TSharedRef<FTokenizedMessage>>& Messages = Listing->GetFilteredMessages();

		for (const TSharedRef<FTokenizedMessage>& Message : Messages)
		{
			Diagnostics.Add(UEAgentBridge::BuildStructuredDiagnosticFromMessageLog(LogName, *Message));
		}
	}

	return Diagnostics;
}

FString FUEAgentBridgeModule::GetProjectName() const
{
	const FString ProjectName = FApp::GetProjectName();
	return ProjectName.IsEmpty() ? TEXT("UnknownProject") : ProjectName;
}

UWorld* FUEAgentBridgeModule::GetEditorWorld() const
{
	if (!GEditor)
	{
		return nullptr;
	}

	return GEditor->GetEditorWorldContext().World();
}

FViewport* FUEAgentBridgeModule::GetActiveEditorViewport() const
{
	if (!GEditor)
	{
		return nullptr;
	}

	return GEditor->GetActiveViewport();
}

FEditorViewportClient* FUEAgentBridgeModule::GetActiveEditorViewportClient() const
{
	FViewport* Viewport = GetActiveEditorViewport();
	if (!Viewport || !Viewport->GetClient())
	{
		return nullptr;
	}

	return static_cast<FEditorViewportClient*>(Viewport->GetClient());
}

FString FUEAgentBridgeModule::GetCurrentMapPath() const
{
	if (const UWorld* World = GetEditorWorld())
	{
		if (const UPackage* Package = World->GetPackage())
		{
			return Package->GetName();
		}
	}

	return FString();
}

bool FUEAgentBridgeModule::IsEditorWorldReadyForMutation(UWorld*& OutWorld, UEAgentBridge::FEndpointResult& OutError) const
{
	OutWorld = GetEditorWorld();
	if (!OutWorld)
	{
		OutError = UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Editor world is not ready."));
		return false;
	}

	if (OutWorld->WorldType != EWorldType::Editor)
	{
		OutError = UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Safe editor mutations are allowed only in the editor world."));
		return false;
	}

	return true;
}

UClass* FUEAgentBridgeModule::ResolveActorClassByPath(const FString& ClassPath) const
{
	UClass* ResolvedClass = FindObject<UClass>(nullptr, *ClassPath);
	if (!ResolvedClass)
	{
		ResolvedClass = LoadObject<UClass>(nullptr, *ClassPath);
	}

	return ResolvedClass;
}

TSet<FString> FUEAgentBridgeModule::GetAllowedSpawnScriptScopes() const
{
	TSet<FString> Scopes;

	const FString ProjectScope = GetProjectName();
	if (!ProjectScope.IsEmpty())
	{
		Scopes.Add(ProjectScope);
	}

	for (const TSharedRef<IPlugin>& Plugin : IPluginManager::Get().GetEnabledPlugins())
	{
		if (Plugin->GetLoadedFrom() != EPluginLoadedFrom::Project)
		{
			continue;
		}

		if (!Plugin->GetName().IsEmpty())
		{
			Scopes.Add(Plugin->GetName());
		}

		for (const FModuleDescriptor& Module : Plugin->GetDescriptor().Modules)
		{
			const FString ModuleName = Module.Name.ToString();
			if (!ModuleName.IsEmpty())
			{
				Scopes.Add(ModuleName);
			}
		}
	}

	return Scopes;
}

FString FUEAgentBridgeModule::JoinAllowedSpawnScriptScopes() const
{
	TArray<FString> Scopes = GetAllowedSpawnScriptScopes().Array();
	Scopes.Sort();
	return FString::Join(Scopes, TEXT(", "));
}

bool FUEAgentBridgeModule::TryResolveSafeSpawnClassByName(const FString& ClassName, UClass*& OutClass, UEAgentBridge::FEndpointResult& OutError) const
{
	OutClass = nullptr;

	if (ClassName.IsEmpty())
	{
		OutError = UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("Spawn-safe requires className or classPath."));
		return false;
	}

	if (const FString* PreferredClassPath = UEAgentBridge::PreferredNativeSpawnClassPaths.Find(ClassName))
	{
		OutClass = ResolveActorClassByPath(*PreferredClassPath);
		if (OutClass)
		{
			return true;
		}
	}

	TArray<UClass*> Matches;
	for (TObjectIterator<UClass> It; It; ++It)
	{
		UClass* Candidate = *It;
		if (!Candidate || Candidate->GetName() != ClassName)
		{
			continue;
		}

		FString RejectReason;
		if (IsSafeSpawnClass(*Candidate, &RejectReason))
		{
			Matches.Add(Candidate);
		}
	}

	if (Matches.Num() == 1)
	{
		OutClass = Matches[0];
		return true;
	}

	if (Matches.Num() > 1)
	{
		TArray<FString> MatchPaths;
		for (const UClass* Match : Matches)
		{
			MatchPaths.Add(Match->GetPathName());
		}

		MatchPaths.Sort();
		OutError = UEAgentBridge::FEndpointResult::Error(
			EHttpServerResponseCodes::BadRequest,
			TEXT("VALIDATION_ERROR"),
			FString::Printf(TEXT("className %s resolves to multiple allowed classes. Provide classPath instead. Matches: %s."), *ClassName, *FString::Join(MatchPaths, TEXT(", ")))
		);
		return false;
	}

	const TSet<FString> AllowedScopes = GetAllowedSpawnScriptScopes();
	for (const FString& Scope : AllowedScopes)
	{
		const FString CandidatePath = FString::Printf(TEXT("/Script/%s.%s"), *Scope, *ClassName);
		if (UClass* Candidate = ResolveActorClassByPath(CandidatePath))
		{
			FString RejectReason;
			if (IsSafeSpawnClass(*Candidate, &RejectReason))
			{
				OutClass = Candidate;
				return true;
			}
		}
	}

	OutError = UEAgentBridge::FEndpointResult::Error(
		EHttpServerResponseCodes::Forbidden,
		TEXT("UNSAFE_MUTATION"),
		FString::Printf(
			TEXT("className %s could not be resolved inside the allowed project/plugin spawn scope. Allowed native script scopes: %s. Provide classPath for project Blueprint actor classes."),
			*ClassName,
			*JoinAllowedSpawnScriptScopes()
		)
	);
	return false;
}

bool FUEAgentBridgeModule::TryResolveSafeSpawnClass(const FString& ClassName, const FString& ClassPath, UClass*& OutClass, UEAgentBridge::FEndpointResult& OutError) const
{
	OutClass = nullptr;

	if (!ClassPath.IsEmpty())
	{
		OutClass = ResolveActorClassByPath(ClassPath);
		if (!OutClass)
		{
			OutError = UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::NotFound, TEXT("NOT_FOUND"), FString::Printf(TEXT("Spawn-safe could not resolve actor class %s."), *ClassPath));
			return false;
		}
	}
	else if (!TryResolveSafeSpawnClassByName(ClassName, OutClass, OutError))
	{
		return false;
	}

	if (!OutClass->IsChildOf(AActor::StaticClass()))
	{
		OutError = UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::Forbidden, TEXT("UNSAFE_MUTATION"), TEXT("Spawn-safe only allows AActor subclasses."));
		return false;
	}

	FString RejectReason;
	if (!IsSafeSpawnClass(*OutClass, &RejectReason))
	{
		OutError = UEAgentBridge::FEndpointResult::Error(
			EHttpServerResponseCodes::Forbidden,
			TEXT("UNSAFE_MUTATION"),
			FString::Printf(TEXT("Resolved class %s is not allowed for spawn-safe: %s."), *OutClass->GetPathName(), *RejectReason)
		);
		return false;
	}

	return true;
}

bool FUEAgentBridgeModule::IsSafeSpawnClass(const UClass& ActorClass, FString* OutReason) const
{
	auto Reject = [&OutReason](const FString& Reason)
	{
		if (OutReason)
		{
			*OutReason = Reason;
		}

		return false;
	};

	const FString ClassPath = ActorClass.GetPathName();
	const FString PackagePath = ActorClass.GetOutermost() ? ActorClass.GetOutermost()->GetName() : FString();
	if (UEAgentBridge::PreferredNativeSpawnClassPaths.FindKey(ClassPath) != nullptr)
	{
		if (OutReason)
		{
			OutReason->Empty();
		}

		return true;
	}

	if (!ActorClass.IsChildOf(AActor::StaticClass()))
	{
		return Reject(TEXT("class is not an AActor subclass"));
	}

	if (ActorClass.HasAnyClassFlags(CLASS_Abstract))
	{
		return Reject(TEXT("class is abstract"));
	}

	if (ActorClass.HasAnyClassFlags(CLASS_Deprecated | CLASS_NewerVersionExists))
	{
		return Reject(TEXT("class is deprecated"));
	}

	if (ActorClass.HasAnyClassFlags(CLASS_Transient))
	{
		return Reject(TEXT("class is transient-only"));
	}

	if (ActorClass.HasAnyClassFlags(CLASS_NotPlaceable))
	{
		return Reject(TEXT("class is not placeable in the editor world"));
	}

	if (PackagePath.StartsWith(TEXT("/Game/")))
	{
		if (OutReason)
		{
			OutReason->Empty();
		}

		return true;
	}

	static const FString ScriptPrefix = TEXT("/Script/");
	if (!PackagePath.StartsWith(ScriptPrefix))
	{
		return Reject(TEXT("class is outside the allowed project/plugin spawn scope"));
	}

	const FString ScriptScope = PackagePath.RightChop(ScriptPrefix.Len());
	if (ScriptScope.IsEmpty())
	{
		return Reject(TEXT("class does not expose a valid script scope"));
	}

	if (!GetAllowedSpawnScriptScopes().Contains(ScriptScope))
	{
		return Reject(FString::Printf(TEXT("class is outside the allowed project/plugin spawn scope (%s)"), *JoinAllowedSpawnScriptScopes()));
	}

	if (OutReason)
	{
		OutReason->Empty();
	}

	return true;
}

AActor* FUEAgentBridgeModule::ResolveActorTarget(const FString& ActorName, const FString& ObjectPath) const
{
	UWorld* const World = GetEditorWorld();
	if (!World)
	{
		return nullptr;
	}

	for (TActorIterator<AActor> It(World); It; ++It)
	{
		AActor* const Actor = *It;
		if (!Actor)
		{
			continue;
		}

		if (!ObjectPath.IsEmpty() && Actor->GetPathName() == ObjectPath)
		{
			return Actor;
		}

		if (!ActorName.IsEmpty() && Actor->GetName() == ActorName)
		{
			return Actor;
		}
	}

	return nullptr;
}

TSharedRef<FJsonObject> FUEAgentBridgeModule::BuildActorMutationPayload(const AActor& Actor, bool bIncludeSelected, bool bIncludeTransform) const
{
	const TSharedRef<FJsonObject> Payload = BuildActorJson(Actor, bIncludeSelected);
	if (bIncludeTransform)
	{
		Payload->SetObjectField(TEXT("location"), UEAgentBridge::MakeVectorJson(Actor.GetActorLocation()));
		Payload->SetObjectField(TEXT("rotation"), UEAgentBridge::MakeRotatorJson(Actor.GetActorRotation()));
	}

	return Payload;
}

void FUEAgentBridgeModule::RedrawActiveViewport() const
{
	FViewport* const Viewport = GetActiveEditorViewport();
	FEditorViewportClient* const ViewportClient = GetActiveEditorViewportClient();
	if (!Viewport || !ViewportClient)
	{
		return;
	}

	ViewportClient->Invalidate();
	ViewportClient->RedrawRequested(Viewport);
	FlushRenderingCommands();
}

TSharedRef<FJsonObject> FUEAgentBridgeModule::BuildActorJson(const AActor& Actor, bool bIncludeSelected) const
{
	const TSharedRef<FJsonObject> ActorJson = MakeShared<FJsonObject>();
	ActorJson->SetStringField(TEXT("actorName"), Actor.GetName());
	ActorJson->SetStringField(TEXT("className"), Actor.GetClass()->GetName());
	ActorJson->SetStringField(TEXT("objectPath"), Actor.GetPathName());
#if WITH_EDITOR
	const FString ActorLabel = Actor.GetActorLabel();
	if (!ActorLabel.IsEmpty())
	{
		ActorJson->SetStringField(TEXT("actorLabel"), ActorLabel);
	}
#endif
	if (bIncludeSelected)
	{
		ActorJson->SetBoolField(TEXT("selected"), true);
	}
	return ActorJson;
}

TSharedRef<FJsonObject> FUEAgentBridgeModule::BuildViewportCameraStatePayload(FEditorViewportClient& ViewportClient, const FIntPoint& ViewportSize, const TOptional<EViewModeIndex>& EffectiveViewMode, const TOptional<FIntRect>& CropRect) const
{
	const TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
	const TSharedRef<FJsonObject> ViewportJson = MakeShared<FJsonObject>();
	const TSharedRef<FJsonObject> CameraJson = MakeShared<FJsonObject>();

	Payload->SetStringField(TEXT("capturedAt"), FDateTime::UtcNow().ToIso8601());
	Payload->SetStringField(TEXT("source"), TEXT("active_viewport"));
	Payload->SetBoolField(TEXT("pieActive"), GEditor && GEditor->PlayWorld != nullptr);

	const FString ProjectName = GetProjectName();
	if (ProjectName.IsEmpty())
	{
		Payload->SetField(TEXT("projectName"), MakeShared<FJsonValueNull>());
	}
	else
	{
		Payload->SetStringField(TEXT("projectName"), ProjectName);
	}

	const FString CurrentMap = GetCurrentMapPath();
	if (CurrentMap.IsEmpty())
	{
		Payload->SetField(TEXT("currentMap"), MakeShared<FJsonValueNull>());
	}
	else
	{
		Payload->SetStringField(TEXT("currentMap"), CurrentMap);
	}

	ViewportJson->SetStringField(TEXT("type"), UEAgentBridge::ViewportTypeToString(ViewportClient.GetViewportType()));
	ViewportJson->SetStringField(TEXT("viewMode"), UEAgentBridge::ViewModeToString(EffectiveViewMode.IsSet() ? EffectiveViewMode.GetValue() : ViewportClient.GetViewMode()));
	ViewportJson->SetBoolField(TEXT("realtime"), ViewportClient.IsRealtime());
	ViewportJson->SetNumberField(TEXT("width"), ViewportSize.X);
	ViewportJson->SetNumberField(TEXT("height"), ViewportSize.Y);
	if (CropRect.IsSet())
	{
		const FIntRect ResolvedCropRect = CropRect.GetValue();
		const TSharedRef<FJsonObject> CropJson = MakeShared<FJsonObject>();
		CropJson->SetNumberField(TEXT("x"), ResolvedCropRect.Min.X);
		CropJson->SetNumberField(TEXT("y"), ResolvedCropRect.Min.Y);
		CropJson->SetNumberField(TEXT("width"), ResolvedCropRect.Width());
		CropJson->SetNumberField(TEXT("height"), ResolvedCropRect.Height());
		ViewportJson->SetObjectField(TEXT("crop"), CropJson);
	}

	CameraJson->SetObjectField(TEXT("location"), UEAgentBridge::MakeVectorJson(ViewportClient.GetViewLocation()));
	CameraJson->SetObjectField(TEXT("rotation"), UEAgentBridge::MakeRotatorJson(ViewportClient.GetViewRotation()));

	Payload->SetObjectField(TEXT("viewport"), ViewportJson);
	Payload->SetObjectField(TEXT("camera"), CameraJson);
	return Payload;
}

FString FUEAgentBridgeModule::NormalizeStringField(const TSharedPtr<FJsonObject>& RequestObject, const TCHAR* FieldName, UEAgentBridge::FEndpointResult& OutError) const
{
	FString Value;
	if (RequestObject->HasField(FieldName) && !RequestObject->TryGetStringField(FieldName, Value))
	{
		OutError = UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), FString::Printf(TEXT("%s must be a string."), FieldName));
	}
	return Value;
}

int32 FUEAgentBridgeModule::ReadLimitField(const TSharedPtr<FJsonObject>& RequestObject, int32 DefaultLimit, UEAgentBridge::FEndpointResult& OutError) const
{
	int32 Limit = DefaultLimit;
	if (RequestObject->HasField(TEXT("limit")))
	{
		double RawLimit = 0.0;
		if (!RequestObject->TryGetNumberField(TEXT("limit"), RawLimit))
		{
			OutError = UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("limit must be an integer."));
			return Limit;
		}

		Limit = static_cast<int32>(RawLimit);
	}

	if (Limit < 1)
	{
		OutError = UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("limit must be at least 1."));
	}
	else if (Limit > UEAgentBridge::MaxSliceLimit)
	{
		OutError = UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("LIMIT_EXCEEDED"), FString::Printf(TEXT("limit must be <= %d."), UEAgentBridge::MaxSliceLimit));
	}

	return Limit;
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildHealthResult()
{
	const bool bEditorAvailable = GEditor != nullptr;
	const bool bWorldAvailable = GetEditorWorld() != nullptr;
	const bool bViewportAvailable = GetActiveEditorViewport() != nullptr && GetActiveEditorViewportClient() != nullptr;
	const bool bOutputAvailable = static_cast<bool>(OutputDevice);
	const TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
	const TSharedRef<FJsonObject> EditorJson = MakeShared<FJsonObject>();
	const TSharedRef<FJsonObject> CapabilitiesJson = MakeShared<FJsonObject>();
	const TSharedRef<FJsonObject> LiveCodingJson = GetLiveCodingStatusPayload();
	TArray<TSharedPtr<FJsonValue>> WarningsJson;

	EditorJson->SetBoolField(TEXT("available"), bEditorAvailable);
	EditorJson->SetStringField(TEXT("projectName"), GetProjectName());

	CapabilitiesJson->SetBoolField(TEXT("ue_get_selected_actors"), bEditorAvailable);
	CapabilitiesJson->SetBoolField(TEXT("ue_get_level_actors"), bWorldAvailable);
	CapabilitiesJson->SetBoolField(TEXT("ue_get_output_log"), bOutputAvailable);
	CapabilitiesJson->SetBoolField(TEXT("ue_get_editor_diagnostics"), bOutputAvailable);
	CapabilitiesJson->SetBoolField(TEXT("ue_get_editor_state"), bEditorAvailable);
	CapabilitiesJson->SetBoolField(TEXT("ue_get_viewport_camera"), bViewportAvailable);
	CapabilitiesJson->SetBoolField(TEXT("ue_set_viewport_camera"), bViewportAvailable);
	CapabilitiesJson->SetBoolField(TEXT("ue_spawn_actor_safe"), bEditorAvailable && bWorldAvailable);
	CapabilitiesJson->SetBoolField(TEXT("ue_select_actor_safe"), bEditorAvailable && bWorldAvailable);
	CapabilitiesJson->SetBoolField(TEXT("ue_destroy_actor_safe"), bEditorAvailable && bWorldAvailable);
	CapabilitiesJson->SetBoolField(TEXT("ue_frame_actor"), bEditorAvailable && bWorldAvailable && bViewportAvailable);
	CapabilitiesJson->SetBoolField(TEXT("ue_get_viewport_screenshot"), bViewportAvailable);
	CapabilitiesJson->SetBoolField(TEXT("ue_capture_actor_screenshot"), bEditorAvailable && bWorldAvailable && bViewportAvailable);
	CapabilitiesJson->SetBoolField(TEXT("ue_get_debug_draw_state"), bWorldAvailable);
	CapabilitiesJson->SetBoolField(TEXT("ue_get_live_coding_status"), true);
	CapabilitiesJson->SetBoolField(TEXT("ue_trigger_live_coding_build_safe"), LiveCodingJson->GetBoolField(TEXT("available")));
	CapabilitiesJson->SetBoolField(TEXT("ue_run_console_command_safe"), bEditorAvailable);

	if (!bWorldAvailable)
	{
		WarningsJson.Add(MakeShared<FJsonValueString>(TEXT("Editor world is not ready yet.")));
	}
	if (!bViewportAvailable)
	{
		WarningsJson.Add(MakeShared<FJsonValueString>(TEXT("Active editor viewport is not available for screenshot capture.")));
	}
	if (!LiveCodingJson->GetBoolField(TEXT("available")))
	{
		WarningsJson.Add(MakeShared<FJsonValueString>(LiveCodingJson->GetStringField(TEXT("message"))));
	}

	Payload->SetStringField(TEXT("pluginName"), UEAgentBridge::PluginName);
	Payload->SetStringField(TEXT("pluginVersion"), UEAgentBridge::PluginVersion);
	Payload->SetStringField(TEXT("apiVersion"), UEAgentBridge::ApiVersion);
	Payload->SetObjectField(TEXT("editor"), EditorJson);
	Payload->SetObjectField(TEXT("capabilities"), CapabilitiesJson);
	Payload->SetArrayField(TEXT("warnings"), WarningsJson);
	return UEAgentBridge::FEndpointResult::Success(Payload);
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildSelectedActorsResult(int32 Limit)
{
	if (!GEditor)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Editor selection is unavailable because GEditor is null."));
	}

	const TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
	TArray<TSharedPtr<FJsonValue>> ActorsJson;
	int32 Count = 0;

	for (FSelectionIterator It(*GEditor->GetSelectedActors()); It && Count < Limit; ++It)
	{
		if (const AActor* Actor = Cast<AActor>(*It))
		{
			ActorsJson.Add(MakeShared<FJsonValueObject>(BuildActorJson(*Actor, true)));
			++Count;
		}
	}

	Payload->SetArrayField(TEXT("actors"), ActorsJson);
	Payload->SetNumberField(TEXT("limitApplied"), Limit);
	return UEAgentBridge::FEndpointResult::Success(Payload);
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildLevelActorsResult(int32 Limit, const FString& ClassNameFilter, const FString& NameContainsFilter)
{
	UWorld* World = GetEditorWorld();
	if (!World)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Editor world is not ready."));
	}

	const FString ClassFilter = ClassNameFilter.ToLower();
	const FString NameFilter = NameContainsFilter.ToLower();
	const TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
	TArray<TSharedPtr<FJsonValue>> ActorsJson;
	int32 Count = 0;

	for (TActorIterator<AActor> It(World); It && Count < Limit; ++It)
	{
		AActor* Actor = *It;
		if (!Actor)
		{
			continue;
		}

		const FString ActorName = Actor->GetName();
#if WITH_EDITOR
		const FString ActorLabel = Actor->GetActorLabel();
#else
		const FString ActorLabel;
#endif

		if (!ClassFilter.IsEmpty() && !Actor->GetClass()->GetName().Equals(ClassFilter, ESearchCase::IgnoreCase))
		{
			continue;
		}
		if (!NameFilter.IsEmpty() && !ActorName.ToLower().Contains(NameFilter) && !ActorLabel.ToLower().Contains(NameFilter))
		{
			continue;
		}

		ActorsJson.Add(MakeShared<FJsonValueObject>(BuildActorJson(*Actor, false)));
		++Count;
	}

	Payload->SetArrayField(TEXT("actors"), ActorsJson);
	Payload->SetNumberField(TEXT("limitApplied"), Limit);
	return UEAgentBridge::FEndpointResult::Success(Payload);
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildOutputLogResult(int32 Limit, const FString& MinLevel)
{
	const TArray<UEAgentBridge::FBufferedLogEntry> Snapshot = CopyLogBuffer();
	TArray<TSharedPtr<FJsonValue>> EntriesJson;
	TArray<UEAgentBridge::FBufferedLogEntry> Filtered;

	for (const UEAgentBridge::FBufferedLogEntry& Entry : Snapshot)
	{
		if (UEAgentBridge::LogRank(Entry.Level) >= UEAgentBridge::LogRank(MinLevel))
		{
			Filtered.Add(Entry);
		}
	}

	const int32 StartIndex = FMath::Max(Filtered.Num() - Limit, 0);
	for (int32 Index = StartIndex; Index < Filtered.Num(); ++Index)
	{
		const UEAgentBridge::FBufferedLogEntry& Entry = Filtered[Index];
		const TSharedRef<FJsonObject> EntryJson = MakeShared<FJsonObject>();
		EntryJson->SetStringField(TEXT("timestamp"), Entry.Timestamp);
		EntryJson->SetStringField(TEXT("level"), Entry.Level);
		EntryJson->SetStringField(TEXT("category"), Entry.Category);
		EntryJson->SetStringField(TEXT("message"), Entry.Message);
		EntriesJson.Add(MakeShared<FJsonValueObject>(EntryJson));
	}

	const TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
	Payload->SetArrayField(TEXT("entries"), EntriesJson);
	Payload->SetNumberField(TEXT("limitApplied"), Limit);
	return UEAgentBridge::FEndpointResult::Success(Payload);
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildDiagnosticsResult(int32 Limit, const FString& MinSeverity)
{
	const TArray<UEAgentBridge::FBufferedLogEntry> Snapshot = CopyLogBuffer();
	const TArray<UEAgentBridge::FStructuredDiagnostic> MessageLogSnapshot = CopyMessageLogDiagnostics();
	TArray<TSharedPtr<FJsonValue>> DiagnosticsJson;
	TArray<UEAgentBridge::FStructuredDiagnostic> Filtered;
	TSet<FString> SeenDiagnostics;

	for (const UEAgentBridge::FBufferedLogEntry& Entry : Snapshot)
	{
		UEAgentBridge::AddVisibleDiagnostic(UEAgentBridge::BuildStructuredDiagnostic(Entry), MinSeverity, SeenDiagnostics, Filtered);
	}

	for (const UEAgentBridge::FStructuredDiagnostic& Diagnostic : MessageLogSnapshot)
	{
		UEAgentBridge::AddVisibleDiagnostic(Diagnostic, MinSeverity, SeenDiagnostics, Filtered);
	}

	Filtered.Sort([](const UEAgentBridge::FStructuredDiagnostic& Left, const UEAgentBridge::FStructuredDiagnostic& Right)
	{
		if (Left.Priority != Right.Priority)
		{
			return Left.Priority > Right.Priority;
		}

		return Left.Message < Right.Message;
	});

	const int32 Count = FMath::Min(Limit, Filtered.Num());
	for (int32 Index = 0; Index < Count; ++Index)
	{
		const UEAgentBridge::FStructuredDiagnostic& Diagnostic = Filtered[Index];
		const TSharedRef<FJsonObject> DiagnosticJson = MakeShared<FJsonObject>();
		DiagnosticJson->SetStringField(TEXT("source"), Diagnostic.Source);
		DiagnosticJson->SetStringField(TEXT("severity"), Diagnostic.Severity);
		DiagnosticJson->SetStringField(TEXT("category"), Diagnostic.Category);
		DiagnosticJson->SetStringField(TEXT("message"), Diagnostic.Message);
		if (!Diagnostic.FilePath.IsEmpty())
		{
			DiagnosticJson->SetStringField(TEXT("filePath"), Diagnostic.FilePath);
		}
		if (Diagnostic.Line > 0)
		{
			DiagnosticJson->SetNumberField(TEXT("line"), Diagnostic.Line);
		}
		if (Diagnostic.Column > 0)
		{
			DiagnosticJson->SetNumberField(TEXT("column"), Diagnostic.Column);
		}
		DiagnosticsJson.Add(MakeShared<FJsonValueObject>(DiagnosticJson));
	}

	const TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
	Payload->SetArrayField(TEXT("diagnostics"), DiagnosticsJson);
	Payload->SetNumberField(TEXT("limitApplied"), Limit);
	return UEAgentBridge::FEndpointResult::Success(Payload);
}

TSharedRef<FJsonObject> FUEAgentBridgeModule::GetLiveCodingStatusPayload()
{
	const TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();

#if PLATFORM_WINDOWS
	ILiveCodingModule* LiveCoding = FModuleManager::LoadModulePtr<ILiveCodingModule>(LIVE_CODING_MODULE_NAME);
	if (!LiveCoding)
	{
		Payload->SetBoolField(TEXT("available"), false);
		Payload->SetBoolField(TEXT("enabled"), false);
		Payload->SetBoolField(TEXT("busy"), false);
		Payload->SetStringField(TEXT("lastResult"), TEXT("not_started"));
		Payload->SetStringField(TEXT("message"), TEXT("Live Coding module is unavailable in this session."));
		return Payload;
	}

	if (!bLiveCodingDelegateBound)
	{
		LiveCodingPatchHandle = LiveCoding->GetOnPatchCompleteDelegate().AddRaw(this, &FUEAgentBridgeModule::HandleLiveCodingPatchComplete);
		bLiveCodingDelegateBound = true;
	}

	const bool bAvailable = LiveCoding->HasStarted() || LiveCoding->CanEnableForSession() || LiveCoding->IsEnabledForSession();
	const FString ErrorText = LiveCoding->GetEnableErrorText().ToString();
	const FString Message = bAvailable
		? (LiveCoding->IsCompiling() ? TEXT("Live Coding compile is in progress.") : TEXT("Live Coding endpoint is ready."))
		: (!ErrorText.IsEmpty() ? ErrorText : TEXT("Live Coding is not ready in this editor session."));

	Payload->SetBoolField(TEXT("available"), bAvailable);
	Payload->SetBoolField(TEXT("enabled"), LiveCoding->IsEnabledForSession());
	Payload->SetBoolField(TEXT("busy"), LiveCoding->IsCompiling());
	Payload->SetStringField(TEXT("lastResult"), LastLiveCodingResult);
	Payload->SetStringField(TEXT("message"), Message);
	return Payload;
#else
	Payload->SetBoolField(TEXT("available"), false);
	Payload->SetBoolField(TEXT("enabled"), false);
	Payload->SetBoolField(TEXT("busy"), false);
	Payload->SetStringField(TEXT("lastResult"), TEXT("not_started"));
	Payload->SetStringField(TEXT("message"), TEXT("Live Coding is only supported on Windows in this plugin."));
	return Payload;
#endif
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildEditorStateResult()
{
	const TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
	const TSharedRef<FJsonObject> CapabilityReadiness = MakeShared<FJsonObject>();
	const TSharedRef<FJsonObject> LiveCodingJson = GetLiveCodingStatusPayload();
	const bool bEditorAvailable = GEditor != nullptr;
	const bool bWorldAvailable = GetEditorWorld() != nullptr;
	const bool bViewportAvailable = GetActiveEditorViewport() != nullptr && GetActiveEditorViewportClient() != nullptr;

	Payload->SetStringField(TEXT("projectName"), GetProjectName());
	const FString CurrentMap = GetCurrentMapPath();
	if (CurrentMap.IsEmpty())
	{
		Payload->SetField(TEXT("currentMap"), MakeShared<FJsonValueNull>());
	}
	else
	{
		Payload->SetStringField(TEXT("currentMap"), CurrentMap);
	}
	Payload->SetBoolField(TEXT("pieActive"), GEditor && GEditor->PlayWorld != nullptr);
	Payload->SetObjectField(TEXT("liveCoding"), LiveCodingJson);

	CapabilityReadiness->SetBoolField(TEXT("ue_get_selected_actors"), bEditorAvailable);
	CapabilityReadiness->SetBoolField(TEXT("ue_get_level_actors"), bWorldAvailable);
	CapabilityReadiness->SetBoolField(TEXT("ue_get_output_log"), static_cast<bool>(OutputDevice));
	CapabilityReadiness->SetBoolField(TEXT("ue_get_editor_diagnostics"), static_cast<bool>(OutputDevice));
	CapabilityReadiness->SetBoolField(TEXT("ue_get_editor_state"), bEditorAvailable);
	CapabilityReadiness->SetBoolField(TEXT("ue_get_viewport_camera"), bViewportAvailable);
	CapabilityReadiness->SetBoolField(TEXT("ue_set_viewport_camera"), bViewportAvailable);
	CapabilityReadiness->SetBoolField(TEXT("ue_spawn_actor_safe"), bEditorAvailable && bWorldAvailable);
	CapabilityReadiness->SetBoolField(TEXT("ue_select_actor_safe"), bEditorAvailable && bWorldAvailable);
	CapabilityReadiness->SetBoolField(TEXT("ue_destroy_actor_safe"), bEditorAvailable && bWorldAvailable);
	CapabilityReadiness->SetBoolField(TEXT("ue_frame_actor"), bEditorAvailable && bWorldAvailable && bViewportAvailable);
	CapabilityReadiness->SetBoolField(TEXT("ue_get_viewport_screenshot"), bViewportAvailable);
	CapabilityReadiness->SetBoolField(TEXT("ue_capture_actor_screenshot"), bEditorAvailable && bWorldAvailable && bViewportAvailable);
	CapabilityReadiness->SetBoolField(TEXT("ue_get_debug_draw_state"), bWorldAvailable);
	CapabilityReadiness->SetBoolField(TEXT("ue_get_live_coding_status"), true);
	CapabilityReadiness->SetBoolField(TEXT("ue_trigger_live_coding_build_safe"), LiveCodingJson->GetBoolField(TEXT("available")));
	CapabilityReadiness->SetBoolField(TEXT("ue_run_console_command_safe"), bEditorAvailable);
	Payload->SetObjectField(TEXT("capabilityReadiness"), CapabilityReadiness);
	return UEAgentBridge::FEndpointResult::Success(Payload);
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildViewportCameraResult()
{
	FViewport* const Viewport = GetActiveEditorViewport();
	FEditorViewportClient* const ViewportClient = GetActiveEditorViewportClient();
	if (!Viewport || !ViewportClient)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Active editor viewport is not available."));
	}

	const FIntPoint ViewportSize = Viewport->GetSizeXY();
	if (ViewportSize.X <= 0 || ViewportSize.Y <= 0)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Active editor viewport has no drawable size."));
	}

	return UEAgentBridge::FEndpointResult::Success(BuildViewportCameraStatePayload(*ViewportClient, ViewportSize, TOptional<EViewModeIndex>(), TOptional<FIntRect>()));
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildSetViewportCameraResult(const FVector& Location, const FRotator& Rotation)
{
	FEditorViewportClient* const ViewportClient = GetActiveEditorViewportClient();
	if (!ViewportClient)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Active editor viewport is not available."));
	}

	ViewportClient->SetViewLocation(Location);
	ViewportClient->SetViewRotation(Rotation);
	RedrawActiveViewport();
	return BuildViewportCameraResult();
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildSpawnActorResult(const FString& ClassName, const FString& ClassPath, const FVector& Location, const FRotator& Rotation, bool bSelectAfterSpawn, const FString& Label)
{
	if (!GEditor)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Editor actor spawning is unavailable because GEditor is null."));
	}

	UEAgentBridge::FEndpointResult Validation;
	UWorld* World = nullptr;
	if (!IsEditorWorldReadyForMutation(World, Validation))
	{
		return Validation;
	}

	UClass* ActorClass = nullptr;
	if (!TryResolveSafeSpawnClass(ClassName, ClassPath, ActorClass, Validation))
	{
		return Validation;
	}

	ULevel* TargetLevel = World->GetCurrentLevel();
	if (!TargetLevel)
	{
		TargetLevel = World->PersistentLevel.Get();
	}
	if (!TargetLevel)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Editor world does not have an active level for spawning."));
	}

	FActorSpawnParameters SpawnParameters;
	SpawnParameters.OverrideLevel = TargetLevel;
	SpawnParameters.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	SpawnParameters.ObjectFlags = RF_Transactional;

	AActor* const SpawnedActor = World->SpawnActor<AActor>(ActorClass, Location, Rotation, SpawnParameters);
	if (!SpawnedActor)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServerError, TEXT("INTERNAL_ERROR"), TEXT("Unreal failed to spawn the requested actor class."));
	}

#if WITH_EDITOR
	if (!Label.IsEmpty())
	{
		SpawnedActor->SetActorLabel(Label, true);
	}
#endif

	if (bSelectAfterSpawn)
	{
		GEditor->SelectNone(false, true, false);
		GEditor->SelectActor(SpawnedActor, true, true, true);
		GEditor->NoteSelectionChange();
	}

	TargetLevel->MarkPackageDirty();
	World->MarkPackageDirty();
	RedrawActiveViewport();

	return UEAgentBridge::FEndpointResult::Success(BuildActorMutationPayload(*SpawnedActor, bSelectAfterSpawn, true));
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildSelectActorResult(const FString& ActorName, const FString& ObjectPath)
{
	if (!GEditor)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Editor actor selection is unavailable because GEditor is null."));
	}

	UEAgentBridge::FEndpointResult Validation;
	UWorld* World = nullptr;
	if (!IsEditorWorldReadyForMutation(World, Validation))
	{
		return Validation;
	}

	AActor* const Actor = ResolveActorTarget(ActorName, ObjectPath);
	if (!Actor)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::NotFound, TEXT("NOT_FOUND"), TEXT("Target actor was not found in the current editor world."));
	}

	GEditor->SelectNone(false, true, false);
	GEditor->SelectActor(Actor, true, true, true);
	GEditor->NoteSelectionChange();
	RedrawActiveViewport();

	return UEAgentBridge::FEndpointResult::Success(BuildActorMutationPayload(*Actor, true, false));
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildDestroyActorResult(const FString& ActorName, const FString& ObjectPath)
{
	if (!GEditor)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Editor actor destruction is unavailable because GEditor is null."));
	}

	UEAgentBridge::FEndpointResult Validation;
	UWorld* World = nullptr;
	if (!IsEditorWorldReadyForMutation(World, Validation))
	{
		return Validation;
	}

	AActor* const Actor = ResolveActorTarget(ActorName, ObjectPath);
	if (!Actor)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::NotFound, TEXT("NOT_FOUND"), TEXT("Target actor was not found in the current editor world."));
	}

	FString RejectReason;
	if (!IsSafeSpawnClass(*Actor->GetClass(), &RejectReason))
	{
		return UEAgentBridge::FEndpointResult::Error(
			EHttpServerResponseCodes::Forbidden,
			TEXT("UNSAFE_MUTATION"),
			FString::Printf(TEXT("Destroy-safe only supports actors inside the allowed project/plugin spawn scope: %s."), *RejectReason)
		);
	}

	const TSharedRef<FJsonObject> Payload = BuildActorMutationPayload(*Actor, false, false);
	Payload->SetBoolField(TEXT("destroyed"), true);

	if (!World->EditorDestroyActor(Actor, true))
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServerError, TEXT("INTERNAL_ERROR"), TEXT("Unreal failed to destroy the target actor."));
	}

	World->MarkPackageDirty();
	RedrawActiveViewport();
	return UEAgentBridge::FEndpointResult::Success(Payload);
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildFrameActorResult(const FString& ActorName, const FString& ObjectPath, bool bActiveViewportOnly)
{
	if (!GEditor)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Editor viewport framing is unavailable because GEditor is null."));
	}

	AActor* const Actor = ResolveActorTarget(ActorName, ObjectPath);
	if (!Actor)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::NotFound, TEXT("NOT_FOUND"), TEXT("Target actor was not found in the current editor world."));
	}

	FViewport* const Viewport = GetActiveEditorViewport();
	FEditorViewportClient* const ViewportClient = GetActiveEditorViewportClient();
	if (!Viewport || !ViewportClient)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Active editor viewport is not available."));
	}

	FVector BoundsOrigin = Actor->GetActorLocation();
	FVector BoundsExtent = FVector::ZeroVector;
	Actor->GetActorBounds(true, BoundsOrigin, BoundsExtent);

	const double BoundsRadius = FMath::Max(BoundsExtent.Size(), 50.0);
	FVector ViewDirection = (BoundsOrigin - ViewportClient->GetViewLocation()).GetSafeNormal();
	if (ViewDirection.IsNearlyZero())
	{
		ViewDirection = FVector(-1.5, -1.0, 0.75).GetSafeNormal();
	}

	const double CameraDistance = FMath::Max(BoundsRadius * 3.0, 150.0);
	const FVector CameraLocation = BoundsOrigin - ViewDirection * CameraDistance;
	const FRotator CameraRotation = (BoundsOrigin - CameraLocation).Rotation();

	ViewportClient->SetViewLocation(CameraLocation);
	ViewportClient->SetViewRotation(CameraRotation);

	if (!bActiveViewportOnly)
	{
		GEditor->MoveViewportCamerasToActor(*Actor, false);
	}

	RedrawActiveViewport();

	const TSharedRef<FJsonObject> Payload = BuildViewportCameraStatePayload(*ViewportClient, Viewport->GetSizeXY(), TOptional<EViewModeIndex>(), TOptional<FIntRect>());
	Payload->SetObjectField(TEXT("target"), BuildActorJson(*Actor, false));
	Payload->SetBoolField(TEXT("activeViewportOnly"), bActiveViewportOnly);
	return UEAgentBridge::FEndpointResult::Success(Payload);
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildViewportScreenshotResult(const UEAgentBridge::FViewportScreenshotOptions& Options)
{
	FViewport* Viewport = GetActiveEditorViewport();
	FEditorViewportClient* ViewportClient = GetActiveEditorViewportClient();
	if (!Viewport || !ViewportClient)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Active editor viewport is not available."));
	}

	const FIntPoint ViewportSize = Viewport->GetSizeXY();
	if (ViewportSize.X <= 0 || ViewportSize.Y <= 0)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Active editor viewport has no drawable size."));
	}

	const EViewModeIndex OriginalViewMode = ViewportClient->GetViewMode();
	const bool bViewModeChanged = Options.ViewModeOverride.IsSet() && Options.ViewModeOverride.GetValue() != OriginalViewMode;
	if (bViewModeChanged)
	{
		ViewportClient->SetViewMode(Options.ViewModeOverride.GetValue());
		RedrawActiveViewport();
	}

	TArray<FColor> SourcePixels;
	FReadSurfaceDataFlags ReadFlags(RCM_UNorm);
	ReadFlags.SetLinearToGamma(true);
	if (!Viewport->ReadPixels(SourcePixels, ReadFlags))
	{
		if (bViewModeChanged)
		{
			ViewportClient->SetViewMode(OriginalViewMode);
			RedrawActiveViewport();
		}
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServerError, TEXT("INTERNAL_ERROR"), TEXT("Failed to read pixels from the active editor viewport."));
	}

	if (bViewModeChanged)
	{
		ViewportClient->SetViewMode(OriginalViewMode);
		RedrawActiveViewport();
	}

	for (FColor& Pixel : SourcePixels)
	{
		Pixel.A = 255;
	}

	int32 SourceWidth = ViewportSize.X;
	int32 SourceHeight = ViewportSize.Y;
	TArray<FColor> WorkingPixels = MoveTemp(SourcePixels);

	if (Options.CropRect.IsSet())
	{
		const FIntRect CropRect = Options.CropRect.GetValue();
		if (CropRect.Min.X < 0 || CropRect.Min.Y < 0 || CropRect.Max.X > ViewportSize.X || CropRect.Max.Y > ViewportSize.Y || CropRect.Width() <= 0 || CropRect.Height() <= 0)
		{
			return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("crop must stay within the active viewport bounds."));
		}

		SourceWidth = CropRect.Width();
		SourceHeight = CropRect.Height();
		TArray<FColor> CroppedPixels;
		CroppedPixels.SetNumUninitialized(SourceWidth * SourceHeight);

		for (int32 Row = 0; Row < SourceHeight; ++Row)
		{
			const int32 SourceOffset = (CropRect.Min.Y + Row) * ViewportSize.X + CropRect.Min.X;
			const int32 TargetOffset = Row * SourceWidth;
			FMemory::Memcpy(CroppedPixels.GetData() + TargetOffset, WorkingPixels.GetData() + SourceOffset, sizeof(FColor) * SourceWidth);
		}

		WorkingPixels = MoveTemp(CroppedPixels);
	}

	int32 OutputWidth = SourceWidth;
	int32 OutputHeight = SourceHeight;
	TArray<FColor> OutputPixels = MoveTemp(WorkingPixels);

	const int32 LargestDimension = FMath::Max(SourceWidth, SourceHeight);
	if (LargestDimension > Options.MaxDimension)
	{
		const double Scale = static_cast<double>(Options.MaxDimension) / static_cast<double>(LargestDimension);
		OutputWidth = FMath::Max(1, FMath::RoundToInt(static_cast<double>(SourceWidth) * Scale));
		OutputHeight = FMath::Max(1, FMath::RoundToInt(static_cast<double>(SourceHeight) * Scale));

		TArray<FColor> ResizedPixels;
		FImageUtils::ImageResize(SourceWidth, SourceHeight, OutputPixels, OutputWidth, OutputHeight, ResizedPixels, true, true);
		OutputPixels = MoveTemp(ResizedPixels);
	}

	TArray64<uint8> CompressedPng;
	const FImageView ImageView(OutputPixels.GetData(), OutputWidth, OutputHeight);
	if (!FImageUtils::CompressImage(CompressedPng, TEXT("png"), ImageView))
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServerError, TEXT("INTERNAL_ERROR"), TEXT("Failed to encode viewport screenshot as PNG."));
	}

	const TSharedRef<FJsonObject> Payload = BuildViewportCameraStatePayload(*ViewportClient, ViewportSize, bViewModeChanged ? TOptional<EViewModeIndex>(Options.ViewModeOverride.GetValue()) : TOptional<EViewModeIndex>(), Options.CropRect);

	Payload->SetStringField(TEXT("mimeType"), TEXT("image/png"));
	Payload->SetStringField(TEXT("dataBase64"), FBase64::Encode(CompressedPng.GetData(), static_cast<uint32>(CompressedPng.Num())));
	Payload->SetNumberField(TEXT("width"), OutputWidth);
	Payload->SetNumberField(TEXT("height"), OutputHeight);
	return UEAgentBridge::FEndpointResult::Success(Payload);
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildDebugDrawStateResult(int32 Limit, bool bIncludePoints)
{
	UWorld* World = GetEditorWorld();
	if (!World)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Editor world is not ready."));
	}

	const TArray<UWorld::ELineBatcherType> BatcherTypes = {
		UWorld::ELineBatcherType::World,
		UWorld::ELineBatcherType::WorldPersistent,
		UWorld::ELineBatcherType::Foreground,
		UWorld::ELineBatcherType::ForegroundPersistent
	};

	const TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
	const TSharedRef<FJsonObject> SummaryJson = MakeShared<FJsonObject>();
	const TSharedRef<FJsonObject> BatchersJson = MakeShared<FJsonObject>();
	TArray<TSharedPtr<FJsonValue>> LinesJson;
	TArray<TSharedPtr<FJsonValue>> PointsJson;
	int32 TotalLines = 0;
	int32 TotalPoints = 0;

	for (const UWorld::ELineBatcherType BatcherType : BatcherTypes)
	{
		const FString BatcherName = UEAgentBridge::LineBatcherTypeToString(BatcherType);
		const TSharedRef<FJsonObject> BatcherSummaryJson = MakeShared<FJsonObject>();
		ULineBatchComponent* const LineBatcher = World->GetLineBatcher(BatcherType);
		const int32 BatcherLineCount = LineBatcher ? LineBatcher->BatchedLines.Num() : 0;
		const int32 BatcherPointCount = LineBatcher ? LineBatcher->BatchedPoints.Num() : 0;

		BatcherSummaryJson->SetNumberField(TEXT("lines"), BatcherLineCount);
		BatcherSummaryJson->SetNumberField(TEXT("points"), BatcherPointCount);
		BatchersJson->SetObjectField(BatcherName, BatcherSummaryJson);

		TotalLines += BatcherLineCount;
		TotalPoints += BatcherPointCount;

		if (!LineBatcher)
		{
			continue;
		}

		for (const FBatchedLine& Line : LineBatcher->BatchedLines)
		{
			if (LinesJson.Num() >= Limit)
			{
				break;
			}

			const TSharedRef<FJsonObject> LineJson = MakeShared<FJsonObject>();
			LineJson->SetStringField(TEXT("batcher"), BatcherName);
			LineJson->SetObjectField(TEXT("start"), UEAgentBridge::MakeVectorJson(Line.Start));
			LineJson->SetObjectField(TEXT("end"), UEAgentBridge::MakeVectorJson(Line.End));
			LineJson->SetObjectField(TEXT("color"), UEAgentBridge::MakeColorJson(Line.Color));
			LineJson->SetNumberField(TEXT("thickness"), Line.Thickness);
			LineJson->SetNumberField(TEXT("remainingLifeTime"), Line.RemainingLifeTime);
			LineJson->SetNumberField(TEXT("depthPriority"), Line.DepthPriority);
			LineJson->SetNumberField(TEXT("batchId"), static_cast<double>(Line.BatchID));
			LineJson->SetNumberField(TEXT("length"), FVector::Distance(Line.Start, Line.End));
			LinesJson.Add(MakeShared<FJsonValueObject>(LineJson));
		}

		if (bIncludePoints)
		{
			for (const FBatchedPoint& Point : LineBatcher->BatchedPoints)
			{
				if (PointsJson.Num() >= Limit)
				{
					break;
				}

				const TSharedRef<FJsonObject> PointJson = MakeShared<FJsonObject>();
				PointJson->SetStringField(TEXT("batcher"), BatcherName);
				PointJson->SetObjectField(TEXT("position"), UEAgentBridge::MakeVectorJson(Point.Position));
				PointJson->SetObjectField(TEXT("color"), UEAgentBridge::MakeColorJson(Point.Color));
				PointJson->SetNumberField(TEXT("pointSize"), Point.PointSize);
				PointJson->SetNumberField(TEXT("remainingLifeTime"), Point.RemainingLifeTime);
				PointJson->SetNumberField(TEXT("depthPriority"), Point.DepthPriority);
				PointJson->SetNumberField(TEXT("batchId"), static_cast<double>(Point.BatchID));
				PointsJson.Add(MakeShared<FJsonValueObject>(PointJson));
			}
		}
	}

	Payload->SetStringField(TEXT("capturedAt"), FDateTime::UtcNow().ToIso8601());
	Payload->SetStringField(TEXT("projectName"), GetProjectName());
	const FString CurrentMap = GetCurrentMapPath();
	if (CurrentMap.IsEmpty())
	{
		Payload->SetField(TEXT("currentMap"), MakeShared<FJsonValueNull>());
	}
	else
	{
		Payload->SetStringField(TEXT("currentMap"), CurrentMap);
	}
	Payload->SetArrayField(TEXT("lines"), LinesJson);
	Payload->SetArrayField(TEXT("points"), PointsJson);

	SummaryJson->SetNumberField(TEXT("totalLines"), TotalLines);
	SummaryJson->SetNumberField(TEXT("totalPoints"), TotalPoints);
	SummaryJson->SetNumberField(TEXT("sampledLines"), LinesJson.Num());
	SummaryJson->SetNumberField(TEXT("sampledPoints"), PointsJson.Num());
	SummaryJson->SetObjectField(TEXT("batchers"), BatchersJson);
	Payload->SetObjectField(TEXT("summary"), SummaryJson);
	return UEAgentBridge::FEndpointResult::Success(Payload);
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildLiveCodingBuildResult()
{
#if PLATFORM_WINDOWS
	ILiveCodingModule* LiveCoding = FModuleManager::LoadModulePtr<ILiveCodingModule>(LIVE_CODING_MODULE_NAME);
	if (!LiveCoding)
	{
		const TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
		Payload->SetBoolField(TEXT("accepted"), false);
		Payload->SetObjectField(TEXT("status"), GetLiveCodingStatusPayload());
		return UEAgentBridge::FEndpointResult::Success(Payload);
	}

	if (!LiveCoding->IsEnabledForSession() && LiveCoding->CanEnableForSession())
	{
		LiveCoding->EnableForSession(true);
	}

	ELiveCodingCompileResult CompileResult = ELiveCodingCompileResult::NotStarted;
	const bool bCompileCallSucceeded = LiveCoding->Compile(ELiveCodingCompileFlags::WaitForCompletion, &CompileResult);
	LastLiveCodingResult = LiveCodingResultToString(CompileResult);
	const bool bAccepted = bCompileCallSucceeded
		&& (CompileResult == ELiveCodingCompileResult::Success || CompileResult == ELiveCodingCompileResult::NoChanges);

	const TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
	Payload->SetBoolField(TEXT("accepted"), bAccepted);
	Payload->SetObjectField(TEXT("status"), GetLiveCodingStatusPayload());
	return UEAgentBridge::FEndpointResult::Success(Payload);
#else
	const TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
	Payload->SetBoolField(TEXT("accepted"), false);
	Payload->SetObjectField(TEXT("status"), GetLiveCodingStatusPayload());
	return UEAgentBridge::FEndpointResult::Success(Payload);
#endif
}

UEAgentBridge::FEndpointResult FUEAgentBridgeModule::BuildRunSafeConsoleCommandResult(const FString& CommandId)
{
	const FString* Command = UEAgentBridge::SafeConsoleCommands.Find(CommandId);
	if (!Command)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::Forbidden, TEXT("UNSAFE_COMMAND"), TEXT("commandId is not allowlisted."));
	}
	if (!GEditor)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Editor command execution is unavailable because GEditor is null."));
	}

	UWorld* World = GetEditorWorld();
	if (!World)
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServiceUnavail, TEXT("EDITOR_UNAVAILABLE"), TEXT("Editor world is not ready."));
	}

	if (!GEditor->Exec(World, **Command))
	{
		return UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::ServerError, TEXT("INTERNAL_ERROR"), TEXT("Unreal rejected the allowlisted console command."));
	}

	const TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
	Payload->SetBoolField(TEXT("accepted"), true);
	Payload->SetStringField(TEXT("commandId"), CommandId);
	Payload->SetStringField(TEXT("executedCommand"), *Command);
	Payload->SetStringField(TEXT("message"), TEXT("Command executed."));
	return UEAgentBridge::FEndpointResult::Success(Payload);
}

FString FUEAgentBridgeModule::LiveCodingResultToString(ELiveCodingCompileResult Result) const
{
	switch (Result)
	{
	case ELiveCodingCompileResult::Success: return TEXT("success");
	case ELiveCodingCompileResult::NoChanges: return TEXT("no_changes");
	case ELiveCodingCompileResult::InProgress: return TEXT("in_progress");
	case ELiveCodingCompileResult::CompileStillActive: return TEXT("busy");
	case ELiveCodingCompileResult::NotStarted: return TEXT("not_started");
	case ELiveCodingCompileResult::Failure: return TEXT("failure");
	case ELiveCodingCompileResult::Cancelled: return TEXT("cancelled");
	default: return TEXT("unknown");
	}
}

void FUEAgentBridgeModule::HandleLiveCodingPatchComplete()
{
	if (LastLiveCodingResult == TEXT("in_progress"))
	{
		LastLiveCodingResult = TEXT("success");
	}
}

bool FUEAgentBridgeModule::HandleHealth(const FHttpServerRequest&, const FHttpResultCallback& OnComplete)
{
	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this]() { return BuildHealthResult(); }));
}

bool FUEAgentBridgeModule::HandleSelectedActors(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
{
	FString ParseError;
	const TSharedPtr<FJsonObject> RequestObject = UEAgentBridge::ParseJsonBody(Request, ParseError);
	if (!ParseError.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), ParseError));
	}

	UEAgentBridge::FEndpointResult Validation;
	const int32 Limit = ReadLimitField(RequestObject, UEAgentBridge::MaxSliceLimit, Validation);
	if (!Validation.ErrorCode.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, MoveTemp(Validation));
	}

	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this, Limit]() { return BuildSelectedActorsResult(Limit); }));
}

bool FUEAgentBridgeModule::HandleLevelActors(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
{
	FString ParseError;
	const TSharedPtr<FJsonObject> RequestObject = UEAgentBridge::ParseJsonBody(Request, ParseError);
	if (!ParseError.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), ParseError));
	}

	UEAgentBridge::FEndpointResult Validation;
	const int32 Limit = ReadLimitField(RequestObject, UEAgentBridge::DefaultActorLimit, Validation);
	if (!Validation.ErrorCode.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, MoveTemp(Validation));
	}

	const FString ClassNameFilter = NormalizeStringField(RequestObject, TEXT("className"), Validation);
	if (!Validation.ErrorCode.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, MoveTemp(Validation));
	}
	const FString NameContainsFilter = NormalizeStringField(RequestObject, TEXT("nameContains"), Validation);
	if (!Validation.ErrorCode.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, MoveTemp(Validation));
	}

	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this, Limit, ClassNameFilter, NameContainsFilter]()
	{
		return BuildLevelActorsResult(Limit, ClassNameFilter, NameContainsFilter);
	}));
}

bool FUEAgentBridgeModule::HandleOutputLogSlice(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
{
	FString ParseError;
	const TSharedPtr<FJsonObject> RequestObject = UEAgentBridge::ParseJsonBody(Request, ParseError);
	if (!ParseError.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), ParseError));
	}

	UEAgentBridge::FEndpointResult Validation;
	const int32 Limit = ReadLimitField(RequestObject, UEAgentBridge::DefaultOutputLimit, Validation);
	if (!Validation.ErrorCode.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, MoveTemp(Validation));
	}

	FString MinLevel = TEXT("Log");
	if (RequestObject->HasField(TEXT("minLevel")) && !RequestObject->TryGetStringField(TEXT("minLevel"), MinLevel))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("minLevel must be a string.")));
	}

	return UEAgentBridge::CompleteRequest(OnComplete, BuildOutputLogResult(Limit, MinLevel));
}

bool FUEAgentBridgeModule::HandleEditorDiagnostics(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
{
	FString ParseError;
	const TSharedPtr<FJsonObject> RequestObject = UEAgentBridge::ParseJsonBody(Request, ParseError);
	if (!ParseError.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), ParseError));
	}

	UEAgentBridge::FEndpointResult Validation;
	const int32 Limit = ReadLimitField(RequestObject, UEAgentBridge::DefaultOutputLimit, Validation);
	if (!Validation.ErrorCode.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, MoveTemp(Validation));
	}

	FString MinSeverity = TEXT("Info");
	if (RequestObject->HasField(TEXT("minSeverity")) && !RequestObject->TryGetStringField(TEXT("minSeverity"), MinSeverity))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("minSeverity must be a string.")));
	}

	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this, Limit, MinSeverity]()
	{
		return BuildDiagnosticsResult(Limit, MinSeverity);
	}));
}

bool FUEAgentBridgeModule::HandleEditorState(const FHttpServerRequest&, const FHttpResultCallback& OnComplete)
{
	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this]() { return BuildEditorStateResult(); }));
}

bool FUEAgentBridgeModule::HandleGetViewportCamera(const FHttpServerRequest&, const FHttpResultCallback& OnComplete)
{
	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this]() { return BuildViewportCameraResult(); }));
}

bool FUEAgentBridgeModule::HandleSetViewportCamera(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
{
	FString ParseError;
	const TSharedPtr<FJsonObject> RequestObject = UEAgentBridge::ParseJsonBody(Request, ParseError);
	if (!ParseError.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), ParseError));
	}

	const TSharedPtr<FJsonObject>* LocationObject = nullptr;
	const TSharedPtr<FJsonObject>* RotationObject = nullptr;
	if (!RequestObject->TryGetObjectField(TEXT("location"), LocationObject) || !LocationObject || !LocationObject->IsValid())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("location must be an object.")));
	}
	if (!RequestObject->TryGetObjectField(TEXT("rotation"), RotationObject) || !RotationObject || !RotationObject->IsValid())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("rotation must be an object.")));
	}

	double X = 0.0;
	double Y = 0.0;
	double Z = 0.0;
	double Pitch = 0.0;
	double Yaw = 0.0;
	double Roll = 0.0;
	if (!(*LocationObject)->TryGetNumberField(TEXT("x"), X)
		|| !(*LocationObject)->TryGetNumberField(TEXT("y"), Y)
		|| !(*LocationObject)->TryGetNumberField(TEXT("z"), Z))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("location.x, location.y, and location.z must be numbers.")));
	}
	if (!(*RotationObject)->TryGetNumberField(TEXT("pitch"), Pitch)
		|| !(*RotationObject)->TryGetNumberField(TEXT("yaw"), Yaw)
		|| !(*RotationObject)->TryGetNumberField(TEXT("roll"), Roll))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("rotation.pitch, rotation.yaw, and rotation.roll must be numbers.")));
	}

	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this, X, Y, Z, Pitch, Yaw, Roll]()
	{
		return BuildSetViewportCameraResult(FVector(X, Y, Z), FRotator(Pitch, Yaw, Roll));
	}));
}

bool FUEAgentBridgeModule::HandleSpawnActor(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
{
	FString ParseError;
	const TSharedPtr<FJsonObject> RequestObject = UEAgentBridge::ParseJsonBody(Request, ParseError);
	if (!ParseError.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), ParseError));
	}

	FString ClassName;
	FString ClassPath;
	if (RequestObject->HasField(TEXT("className")) && !RequestObject->TryGetStringField(TEXT("className"), ClassName))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("className must be a string.")));
	}
	if (RequestObject->HasField(TEXT("classPath")) && !RequestObject->TryGetStringField(TEXT("classPath"), ClassPath))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("classPath must be a string.")));
	}
	if ((ClassName.IsEmpty() && ClassPath.IsEmpty()) || (!ClassName.IsEmpty() && !ClassPath.IsEmpty()))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("Exactly one of className or classPath is required.")));
	}

	const TSharedPtr<FJsonObject>* LocationObject = nullptr;
	const TSharedPtr<FJsonObject>* RotationObject = nullptr;
	if (!RequestObject->TryGetObjectField(TEXT("location"), LocationObject) || !LocationObject || !LocationObject->IsValid())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("location must be an object.")));
	}
	if (!RequestObject->TryGetObjectField(TEXT("rotation"), RotationObject) || !RotationObject || !RotationObject->IsValid())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("rotation must be an object.")));
	}

	double X = 0.0;
	double Y = 0.0;
	double Z = 0.0;
	double Pitch = 0.0;
	double Yaw = 0.0;
	double Roll = 0.0;
	if (!(*LocationObject)->TryGetNumberField(TEXT("x"), X)
		|| !(*LocationObject)->TryGetNumberField(TEXT("y"), Y)
		|| !(*LocationObject)->TryGetNumberField(TEXT("z"), Z))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("location.x, location.y, and location.z must be numbers.")));
	}
	if (!(*RotationObject)->TryGetNumberField(TEXT("pitch"), Pitch)
		|| !(*RotationObject)->TryGetNumberField(TEXT("yaw"), Yaw)
		|| !(*RotationObject)->TryGetNumberField(TEXT("roll"), Roll))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("rotation.pitch, rotation.yaw, and rotation.roll must be numbers.")));
	}

	bool bSelectAfterSpawn = false;
	if (RequestObject->HasField(TEXT("selectAfterSpawn")) && !RequestObject->TryGetBoolField(TEXT("selectAfterSpawn"), bSelectAfterSpawn))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("selectAfterSpawn must be a boolean.")));
	}

	FString Label;
	if (RequestObject->HasField(TEXT("label")) && !RequestObject->TryGetStringField(TEXT("label"), Label))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("label must be a string.")));
	}

	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this, ClassName, ClassPath, X, Y, Z, Pitch, Yaw, Roll, bSelectAfterSpawn, Label]()
	{
		return BuildSpawnActorResult(ClassName, ClassPath, FVector(X, Y, Z), FRotator(Pitch, Yaw, Roll), bSelectAfterSpawn, Label);
	}));
}

bool FUEAgentBridgeModule::HandleSelectActor(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
{
	FString ParseError;
	const TSharedPtr<FJsonObject> RequestObject = UEAgentBridge::ParseJsonBody(Request, ParseError);
	if (!ParseError.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), ParseError));
	}

	const TSharedPtr<FJsonObject>* TargetObject = nullptr;
	if (!RequestObject->TryGetObjectField(TEXT("target"), TargetObject) || !TargetObject || !TargetObject->IsValid())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("target must be an object.")));
	}

	FString ActorName;
	FString ObjectPath;
	if ((*TargetObject)->HasField(TEXT("actorName")) && !(*TargetObject)->TryGetStringField(TEXT("actorName"), ActorName))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("target.actorName must be a string.")));
	}
	if ((*TargetObject)->HasField(TEXT("objectPath")) && !(*TargetObject)->TryGetStringField(TEXT("objectPath"), ObjectPath))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("target.objectPath must be a string.")));
	}
	if (ActorName.IsEmpty() && ObjectPath.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("target.actorName or target.objectPath is required.")));
	}

	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this, ActorName, ObjectPath]()
	{
		return BuildSelectActorResult(ActorName, ObjectPath);
	}));
}

bool FUEAgentBridgeModule::HandleDestroyActor(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
{
	FString ParseError;
	const TSharedPtr<FJsonObject> RequestObject = UEAgentBridge::ParseJsonBody(Request, ParseError);
	if (!ParseError.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), ParseError));
	}

	const TSharedPtr<FJsonObject>* TargetObject = nullptr;
	if (!RequestObject->TryGetObjectField(TEXT("target"), TargetObject) || !TargetObject || !TargetObject->IsValid())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("target must be an object.")));
	}

	FString ActorName;
	FString ObjectPath;
	if ((*TargetObject)->HasField(TEXT("actorName")) && !(*TargetObject)->TryGetStringField(TEXT("actorName"), ActorName))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("target.actorName must be a string.")));
	}
	if ((*TargetObject)->HasField(TEXT("objectPath")) && !(*TargetObject)->TryGetStringField(TEXT("objectPath"), ObjectPath))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("target.objectPath must be a string.")));
	}
	if (ActorName.IsEmpty() && ObjectPath.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("target.actorName or target.objectPath is required.")));
	}

	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this, ActorName, ObjectPath]()
	{
		return BuildDestroyActorResult(ActorName, ObjectPath);
	}));
}

bool FUEAgentBridgeModule::HandleFrameActor(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
{
	FString ParseError;
	const TSharedPtr<FJsonObject> RequestObject = UEAgentBridge::ParseJsonBody(Request, ParseError);
	if (!ParseError.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), ParseError));
	}

	const TSharedPtr<FJsonObject>* TargetObject = nullptr;
	if (!RequestObject->TryGetObjectField(TEXT("target"), TargetObject) || !TargetObject || !TargetObject->IsValid())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("target must be an object.")));
	}

	FString ActorName;
	FString ObjectPath;
	if ((*TargetObject)->HasField(TEXT("actorName")) && !(*TargetObject)->TryGetStringField(TEXT("actorName"), ActorName))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("target.actorName must be a string.")));
	}
	if ((*TargetObject)->HasField(TEXT("objectPath")) && !(*TargetObject)->TryGetStringField(TEXT("objectPath"), ObjectPath))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("target.objectPath must be a string.")));
	}
	if (ActorName.IsEmpty() && ObjectPath.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("target.actorName or target.objectPath is required.")));
	}

	bool bActiveViewportOnly = true;
	if (RequestObject->HasField(TEXT("activeViewportOnly")) && !RequestObject->TryGetBoolField(TEXT("activeViewportOnly"), bActiveViewportOnly))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("activeViewportOnly must be a boolean.")));
	}

	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this, ActorName, ObjectPath, bActiveViewportOnly]()
	{
		return BuildFrameActorResult(ActorName, ObjectPath, bActiveViewportOnly);
	}));
}

bool FUEAgentBridgeModule::HandleViewportScreenshot(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
{
	FString ParseError;
	const TSharedPtr<FJsonObject> RequestObject = UEAgentBridge::ParseJsonBody(Request, ParseError);
	if (!ParseError.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), ParseError));
	}

	int32 MaxDimension = UEAgentBridge::DefaultViewportScreenshotMaxDimension;
	if (RequestObject->HasField(TEXT("maxDimension")))
	{
		double RawMaxDimension = 0.0;
		if (!RequestObject->TryGetNumberField(TEXT("maxDimension"), RawMaxDimension))
		{
			return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("maxDimension must be an integer.")));
		}

		MaxDimension = static_cast<int32>(RawMaxDimension);
	}

	if (MaxDimension < UEAgentBridge::MinViewportScreenshotDimension)
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), FString::Printf(TEXT("maxDimension must be at least %d."), UEAgentBridge::MinViewportScreenshotDimension)));
	}

	if (MaxDimension > UEAgentBridge::MaxViewportScreenshotDimension)
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("LIMIT_EXCEEDED"), FString::Printf(TEXT("maxDimension must be <= %d."), UEAgentBridge::MaxViewportScreenshotDimension)));
	}

	UEAgentBridge::FViewportScreenshotOptions Options;
	Options.MaxDimension = MaxDimension;

	if (RequestObject->HasField(TEXT("viewMode")))
	{
		FString ViewModeValue;
		if (!RequestObject->TryGetStringField(TEXT("viewMode"), ViewModeValue))
		{
			return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("viewMode must be a string.")));
		}

		EViewModeIndex ParsedViewMode = VMI_Lit;
		if (ViewModeValue.ToLower() != TEXT("current"))
		{
			if (!UEAgentBridge::TryParseViewMode(ViewModeValue, ParsedViewMode))
			{
				return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("viewMode is not supported.")));
			}
			Options.ViewModeOverride = ParsedViewMode;
		}
	}

	if (RequestObject->HasField(TEXT("crop")))
	{
		const TSharedPtr<FJsonObject>* CropObject = nullptr;
		if (!RequestObject->TryGetObjectField(TEXT("crop"), CropObject) || !CropObject || !CropObject->IsValid())
		{
			return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("crop must be an object.")));
		}

		double X = 0.0;
		double Y = 0.0;
		double Width = 0.0;
		double Height = 0.0;
		if (!(*CropObject)->TryGetNumberField(TEXT("x"), X)
			|| !(*CropObject)->TryGetNumberField(TEXT("y"), Y)
			|| !(*CropObject)->TryGetNumberField(TEXT("width"), Width)
			|| !(*CropObject)->TryGetNumberField(TEXT("height"), Height))
		{
			return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("crop.x, crop.y, crop.width, and crop.height must be integers.")));
		}

		Options.CropRect = FIntRect(
			static_cast<int32>(X),
			static_cast<int32>(Y),
			static_cast<int32>(X + Width),
			static_cast<int32>(Y + Height)
		);
	}

	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this, Options]()
	{
		return BuildViewportScreenshotResult(Options);
	}));
}

bool FUEAgentBridgeModule::HandleDebugDrawState(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
{
	FString ParseError;
	const TSharedPtr<FJsonObject> RequestObject = UEAgentBridge::ParseJsonBody(Request, ParseError);
	if (!ParseError.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), ParseError));
	}

	UEAgentBridge::FEndpointResult Validation;
	const int32 Limit = ReadLimitField(RequestObject, UEAgentBridge::DefaultOutputLimit, Validation);
	if (!Validation.ErrorCode.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, MoveTemp(Validation));
	}

	bool bIncludePoints = true;
	if (RequestObject->HasField(TEXT("includePoints")) && !RequestObject->TryGetBoolField(TEXT("includePoints"), bIncludePoints))
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("includePoints must be a boolean.")));
	}

	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this, Limit, bIncludePoints]()
	{
		return BuildDebugDrawStateResult(Limit, bIncludePoints);
	}));
}

bool FUEAgentBridgeModule::HandleLiveCodingStatus(const FHttpServerRequest&, const FHttpResultCallback& OnComplete)
{
	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this]()
	{
		return UEAgentBridge::FEndpointResult::Success(GetLiveCodingStatusPayload());
	}));
}

bool FUEAgentBridgeModule::HandleLiveCodingBuild(const FHttpServerRequest&, const FHttpResultCallback& OnComplete)
{
	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this]() { return BuildLiveCodingBuildResult(); }));
}

bool FUEAgentBridgeModule::HandleRunSafeConsoleCommand(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
{
	FString ParseError;
	const TSharedPtr<FJsonObject> RequestObject = UEAgentBridge::ParseJsonBody(Request, ParseError);
	if (!ParseError.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), ParseError));
	}

	FString CommandId;
	if (!RequestObject->TryGetStringField(TEXT("commandId"), CommandId) || CommandId.IsEmpty())
	{
		return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::FEndpointResult::Error(EHttpServerResponseCodes::BadRequest, TEXT("VALIDATION_ERROR"), TEXT("commandId is required.")));
	}

	return UEAgentBridge::CompleteRequest(OnComplete, UEAgentBridge::RunOnGameThreadBlocking<UEAgentBridge::FEndpointResult>([this, CommandId]() { return BuildRunSafeConsoleCommandResult(CommandId); }));
}

IMPLEMENT_MODULE(FUEAgentBridgeModule, UEAgentBridge)
