import { PluginBackend } from "../dist/backend/plugin-backend.js";

const pluginHost = process.env.UE_PLUGIN_HOST ?? "127.0.0.1";
const pluginPort = process.env.UE_PLUGIN_PORT ?? "30110";
const rcHost = process.env.UE_RC_HOST ?? "127.0.0.1";
const rcPort = process.env.UE_RC_PORT ?? "30010";
const timeoutMs = Number.parseInt(process.env.UE_REQUEST_TIMEOUT_MS ?? "5000", 10);

const backend = new PluginBackend({
  baseUrl: `http://${pluginHost}:${pluginPort}`,
  remoteControlBaseUrl: `http://${rcHost}:${rcPort}`,
  timeoutMs
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const health = await backend.healthcheck();
assert(health.backend === "plugin", "Healthcheck did not resolve to plugin backend.");
assert(health.connected, "Plugin backend is not connected.");

const levelActors = await backend.getLevelActors({ limit: 5 });
assert(Array.isArray(levelActors) && levelActors.length > 0, "Level actor query returned no actors.");
let selectedActors = await backend.getSelectedActors();

const outputLog = await backend.getOutputLog({ limit: 5 });
assert(Array.isArray(outputLog), "Output log query did not return an array.");

const diagnostics = await backend.getEditorDiagnostics({ limit: 5, minSeverity: "Warning" });
assert(Array.isArray(diagnostics), "Diagnostics query did not return an array.");

const editorState = await backend.getEditorState();
assert(typeof editorState.projectName === "string" || editorState.projectName === null, "Editor state projectName was malformed.");
const viewportCamera = await backend.getViewportCamera();
assert(typeof viewportCamera.camera.location.x === "number", "Viewport camera query returned malformed camera data.");
const viewportScreenshot = await backend.getViewportScreenshot({ maxDimension: 1280 });
assert(typeof viewportScreenshot.dataBase64 === "string" && viewportScreenshot.dataBase64.length > 100, "Viewport screenshot capture returned no image data.");
const debugDrawState = await backend.getDebugDrawState({ limit: 20, includePoints: true });
assert(Array.isArray(debugDrawState.lines), "Debug draw state did not return a lines array.");
const frameTarget = levelActors.find((actor) => actor.className !== "WorldSettings") ?? levelActors[0];
const framedCamera = frameTarget
  ? await backend.frameActor({
      target: {
        objectPath: frameTarget.objectPath
      },
      activeViewportOnly: true
    })
  : null;
if (frameTarget) {
  assert(framedCamera?.target.objectPath === frameTarget.objectPath, "Frame actor result did not report the requested target.");
}

const liveCodingStatus = await backend.getLiveCodingStatus();
const liveCodingBuild = await backend.triggerLiveCodingBuild();

const consoleResult = await backend.runConsoleCommand({ commandId: "stat_fps" });
assert(consoleResult.accepted === true, "Allowlisted console command was not accepted.");

let unsafeRejected = false;
const unsafeResponse = await fetch(`http://${pluginHost}:${pluginPort}/api/v1/console/run-safe`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    commandId: "quit_now"
  })
});
if (unsafeResponse.status === 403) {
  const payload = await unsafeResponse.json();
  unsafeRejected = payload?.error?.code === "UNSAFE_COMMAND";
}
assert(unsafeRejected, "Plugin did not reject an unknown commandId with UNSAFE_COMMAND.");

let fallback = null;
if (health.readiness.remoteControlAvailable) {
  const actorToSelect = levelActors.find((actor) => actor.className !== "WorldSettings") ?? levelActors[0];
  if (actorToSelect) {
    await remoteControlCall("SelectNothing", {});
    await remoteControlCall("SetActorSelectionState", {
      Actor: actorToSelect.objectPath,
      bShouldBeSelected: true
    });
    selectedActors = await backend.getSelectedActors();
    assert(selectedActors.length > 0, "Selected actor query stayed empty after Remote Control selection setup.");
    await remoteControlCall("SelectNothing", {});
  }

  const assetSearch = await backend.assetSearch({ pathPrefix: "/Engine", limit: 3 });
  const propertyRead = await backend.getProperty({
    target: { objectPath: "/Script/EngineSettings.Default__GameMapsSettings" },
    propertyName: "EditorStartupMap"
  });
  const propertyWrite = await backend.setProperty({
    target: { objectPath: "/Script/EngineSettings.Default__GameMapsSettings" },
    propertyName: "EditorStartupMap",
    value: propertyRead.value
  });

  fallback = {
    selectedActorCountAfterSetup: selectedActors.length,
    assetSearchCount: assetSearch.length,
    propertyRead,
    propertyWrite
  };
}

console.log(JSON.stringify({
  health,
  selectedActorCount: selectedActors.length,
  levelActorCount: levelActors.length,
  outputLogCount: outputLog.length,
  diagnosticsCount: diagnostics.length,
  editorState,
  viewportCamera,
  viewportScreenshot: {
    width: viewportScreenshot.width,
    height: viewportScreenshot.height,
    viewMode: viewportScreenshot.viewport.viewMode
  },
  framedCamera,
  debugDrawState: {
    sampledLines: debugDrawState.summary.sampledLines,
    sampledPoints: debugDrawState.summary.sampledPoints
  },
  liveCodingStatus,
  liveCodingBuild,
  consoleResult,
  fallback
}, null, 2));

async function remoteControlCall(functionName, parameters) {
  const response = await fetch(`http://${rcHost}:${rcPort}/remote/object/call`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      objectPath: "/Script/UnrealEd.Default__EditorActorSubsystem",
      functionName,
      parameters
    })
  });

  if (!response.ok) {
    throw new Error(`Remote Control selection helper failed for ${functionName}: ${await response.text()}`);
  }
}
