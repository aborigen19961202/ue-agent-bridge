# M1 Backlog

This file lists candidate work after M0. Nothing here is implemented as part of the M0 freeze.

## Priority 1: Plugin-First Setup

- replace manual preset-first helper setup with a lightweight Unreal plugin path
- define a plugin-owned localhost backend contract for editor-global operations
- keep the external MCP surface stable while removing manual `UE_AgentBridge_M0` authoring from the normal workflow
- support installation as a project plugin or engine plugin
- implement the plugin health endpoint and explicit readiness model from [M1_PLUGIN_CONTRACT.md](./M1_PLUGIN_CONTRACT.md)

## Priority 2: Capability Ownership Shift

- move selected actor retrieval into the plugin backend
- move level actor enumeration into the plugin backend because pure Remote Control behavior is engine-version-sensitive
- move bounded output log access into the plugin backend
- move safe console command execution into the plugin backend while keeping the command-ID allowlist model

## Readiness And Setup

- stronger helper readiness verification beyond preset string detection
- clearer Unreal-side installation and startup diagnostics
- reusable packaging for teams that want to reuse the Unreal-side layer across projects

## Safety And Policy

- project-specific write allowlists layered on top of the current generic M0 write policy
- richer safe-console policy reporting, including helper-side rejection diagnostics
- stronger property-type policy for writes beyond the current JSON-compatible baseline

## Error Normalization

- more consistent Unreal-side error envelope handling
- better differentiation between not-found, unsupported, and not-readable property cases
- clearer verification failure reporting for property writes

## Performance And Transport

- optional batching for level actor describe calls if a stable batch contract is worth the added complexity
- latency improvements for repeated direct read workflows
- optional future WebSocket or push-based capabilities only if a later product tier justifies them

## Helper Evolution

- safer richer log querying while keeping bounded snapshot rules
- stronger helper result versioning if helper contracts evolve
- optional migration of more M0 direct tools from Remote Control to the plugin backend if that improves stability materially

## Product And Release

- example MCP client usage docs
- integration smoke-test scripts for local Windows validation
- packaging guidance for using the bridge across multiple Unreal projects
- release notes and migration notes for teams moving from preset-based M0 usage to plugin-first M1
