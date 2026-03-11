# M1 Backlog

This file lists candidate work after M0. Nothing here is implemented as part of the M0 freeze.

## Readiness And Setup

- stronger helper readiness verification beyond preset string detection
- clearer setup packaging for Unreal presets and helper exposure
- reusable sample Unreal-side setup assets for helper-backed tools

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
- optional native UE-side backend or plugin evolution if helper complexity grows beyond clean preset exposure

## Product And Release

- example MCP client usage docs
- integration smoke-test scripts for local Windows validation
- packaging guidance for using the bridge across multiple Unreal projects
