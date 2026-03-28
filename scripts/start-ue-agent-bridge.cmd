@echo off
setlocal

for %%I in ("%~dp0..") do set "REPO_ROOT=%%~fI"

if not exist "%REPO_ROOT%\dist\server\index.js" (
  echo UE_AgentBridge build output not found. Run "npm run build" in %REPO_ROOT% first. 1>&2
  exit /b 1
)

if not defined UE_BACKEND_MODE set "UE_BACKEND_MODE=plugin"
if not defined UE_LOG_LEVEL set "UE_LOG_LEVEL=info"
if not defined UE_REQUEST_TIMEOUT_MS set "UE_REQUEST_TIMEOUT_MS=5000"
if not defined UE_RC_HOST set "UE_RC_HOST=127.0.0.1"
if not defined UE_RC_PORT set "UE_RC_PORT=30010"
if not defined UE_PLUGIN_HOST set "UE_PLUGIN_HOST=127.0.0.1"
if not defined UE_PLUGIN_PORT set "UE_PLUGIN_PORT=30110"

node "%REPO_ROOT%\dist\server\index.js"
