# Reference Repositories

This document captures architectural lessons from the following repositories:

- [erhansiraci/ue-mcp](https://github.com/erhansiraci/ue-mcp)
- [atomantic/UEMCP](https://github.com/atomantic/UEMCP)
- [ChiR24/Unreal_mcp](https://github.com/ChiR24/Unreal_mcp)
- [Natfii/unrealclaude-mcp-bridge](https://github.com/Natfii/unrealclaude-mcp-bridge)

The goal here is not to inherit their assumptions. The goal is to decide what helps the UE_AgentBridge product model and what does not.

## `erhansiraci/ue-mcp`

### Architecture Summary

Lean external MCP server in TypeScript that talks to Unreal through the Remote Control API. No bundled Unreal-side plugin is required beyond Unreal's own Remote Control support.

### Backend Type

External Node.js and TypeScript server only.

### Transport Type

- agent to bridge: MCP over stdio
- bridge to Unreal: HTTP via Remote Control
- optional WebSocket configuration is present, but the design is primarily HTTP-driven

### Coupling Level To Unreal Editor

Moderate. It depends on Unreal Editor exposing Remote Control, but it does not install a custom Unreal backend.

### Suitability For External Repo-Aware Agents

High in principle. The repo-aware agent stays outside Unreal and the Unreal surface is clearly a tool layer.

### What Is Useful For This Product Model

- thin external server shape
- Remote Control first approach
- TypeScript tool contracts and validation
- proof that useful Unreal access can exist without a custom plugin in the first iteration

### What Is Incompatible With This Product Model

- the tool set is already much broader than the narrow M0 this project wants
- destructive and broad-scope tools appear too early for this repo's first slice
- the architecture does not explicitly separate "repo-aware agent responsibilities" from "Unreal bridge responsibilities"

### What Should Influence M0

- keep the first bridge external
- keep the transport simple
- keep the implementation thin

### What Should Be Postponed Until Later

- spawning, deleting, saving, and other broad editor mutation tools
- large tool catalogs before usage patterns are proven

## `atomantic/UEMCP`

### Architecture Summary

Two-tier system: external Node.js MCP server plus a Unreal plugin with Python listener and helper operations inside the editor. The repo also includes extensive setup automation and a large tool surface.

### Backend Type

- external Node.js and TypeScript MCP server
- Unreal-side plugin
- Unreal-side Python HTTP listener

### Transport Type

- agent to bridge: MCP over stdio
- bridge to Unreal: HTTP to a Python listener running inside Unreal

### Coupling Level To Unreal Editor

High. Useful work depends on installing and running a custom Unreal-side plugin and Python listener.

### Suitability For External Repo-Aware Agents

Mixed. The external-agent model still exists, but the repo strongly pulls toward a customized Unreal automation stack rather than a minimal tool layer.

### What Is Useful For This Product Model

- clear separation between external server and Unreal-side execution
- dynamic tool manifest idea
- pragmatic handling of local developer setup
- evidence that a standalone bridge repo can still support multiple AI clients

### What Is Incompatible With This Product Model

- `python_proxy` gives unrestricted execution inside Unreal, which is directly against this M0's safety stance
- the tool surface is much broader than needed
- the product center of gravity shifts toward an Unreal automation platform instead of a narrow bridge

### What Should Influence M0

- keep the external server separate from any future Unreal-side helper
- if a helper layer appears later, keep the contract explicit and narrow

### What Should Be Postponed Until Later

- arbitrary Python execution
- rich plugin-driven automation
- deep Blueprint and material authoring workflows
- operation history, checkpointing, and other convenience layers not needed to validate the core model

## `ChiR24/Unreal_mcp`

### Architecture Summary

Large external TypeScript MCP server paired with a native C++ Unreal automation plugin. The system exposes a very broad action catalog and includes optional GraphQL and extensive automation features.

### Backend Type

- external Node.js and TypeScript MCP server
- native Unreal C++ plugin backend

### Transport Type

- agent to bridge: MCP over stdio
- bridge to Unreal plugin: custom automation bridge using WebSocket-based connection management
- optional GraphQL endpoint for additional query patterns

### Coupling Level To Unreal Editor

Very high. The plugin is central, not optional.

### Suitability For External Repo-Aware Agents

Good for teams that want deep Unreal automation, but too heavy for this product's M0. It solves a different stage of the problem.

### What Is Useful For This Product Model

- serious treatment of safety for risky commands
- explicit Unreal-side automation bridge design
- evidence that some future capabilities will likely need engine-side code
- strong reminder that non-loopback network exposure should be opt-in and explicit

### What Is Incompatible With This Product Model

- plugin-first architecture
- very large scope before validating the narrow bridge model
- attempt to cover everything from level editing to build and system workflows in one surface

### What Should Influence M0

- keep localhost as the default security posture
- treat future Unreal-side backend work as real architecture, not a hack
- name and gate risky operations explicitly

### What Should Be Postponed Until Later

- native plugin backend
- GraphQL
- large consolidated tool families
- build, compile, and other deep engine workflows

## `Natfii/unrealclaude-mcp-bridge`

### Architecture Summary

Standalone Node.js MCP server that forwards tool discovery and execution to an existing Unreal-side HTTP backend. It began as part of an Unreal plugin ecosystem and was split into its own repository.

### Backend Type

External Node.js server delegating to a separate Unreal-side HTTP service.

### Transport Type

- agent to bridge: MCP over stdio
- bridge to Unreal backend: HTTP REST on localhost

### Coupling Level To Unreal Editor

High in practice. The server is small, but it assumes another Unreal-side backend already exists and provides the real functionality.

### Suitability For External Repo-Aware Agents

Reasonable. The server itself keeps the agent external, but the repo model is closer to "adapter over an existing Unreal backend" than to "minimal bridge with a sharply chosen M0."

### What Is Useful For This Product Model

- standalone bridge repo shape
- dynamic discovery of Unreal-side tools
- clear separation between MCP layer and Unreal execution layer

### What Is Incompatible With This Product Model

- broad tool surface including script execution
- reliance on a pre-existing Unreal-side backend
- less emphasis on a minimal allowlisted first slice

### What Should Influence M0

- keep the external adapter layer simple
- keep the Unreal-facing contract explicit

### What Should Be Postponed Until Later

- script execution
- async task systems
- advanced Blueprint and animation authoring surfaces

## Chosen Stance For UE_AgentBridge

UE_AgentBridge should start as a thin external TypeScript MCP server for local use. M0 should use Unreal Remote Control API over localhost for a tightly scoped set of read-mostly and narrow-write tools. The bridge should preserve the external repo-aware agent model and avoid arbitrary execution.

At the same time, the architecture should leave room for a later lightweight Unreal-side backend or plugin when Remote Control stops being enough, especially for output log fidelity, eventing, and future C++ or Live Coding related workflows.

In short:

- external agent stays repo-aware
- Unreal becomes a first-class tool layer
- Remote Control is the M0 path
- plugin/backend work is deferred, not denied

## Why We Are Not Simply Forking An Existing Repo

- none of the reference repos match the exact product boundary we want
- the lightweight Remote Control repos are closer to the transport choice, but not to the narrow M0 discipline
- the plugin-backed repos are closer to likely long-term capability, but too heavy and too broad for the first slice
- this repository needs a clearer operating model around external repo-aware agents than the references provide
- copying an existing repo would import assumptions about scope, safety, and Unreal coupling that this product is explicitly trying to avoid

The right move is to learn from them, not inherit them wholesale.
