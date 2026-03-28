# Architectural Decisions

## Chosen M0 Implementation Language: TypeScript

M0 should be implemented in TypeScript, not Python.

### Reasoning

- The bridge lives outside Unreal, so it should be optimized for external agent integration rather than Unreal's internal scripting environment.
- MCP tooling, stdio transport, schema validation, and local developer workflows are straightforward in Node.js and TypeScript.
- TypeScript gives a clean place to define tool contracts, validation, safety checks, and transport adapters.
- Windows local setup is practical with Node.js and does not require the external bridge to inherit Unreal's Python environment.
- Choosing Python for the bridge would blur the boundary between the external server and Unreal-side execution too early.

Python still matters later, but as a possible Unreal-side helper layer when Remote Control is no longer enough. It is not the right center of gravity for M0.

## Role Of The MCP Server

The MCP server is the external-facing bridge.

Its responsibilities are:

- expose a small tool surface to external agents
- translate those tool calls into Unreal-facing requests
- validate arguments and enforce safety rules
- normalize results into predictable agent-friendly responses
- keep Unreal access bounded and explicit

Its responsibilities are not:

- becoming the repo-aware agent
- re-implementing git, shell, or source-tree intelligence
- embedding broad project-specific business logic

## Role Of Unreal Remote Control API

Unreal Remote Control API is the M0 Unreal access path.

For M0 it should be treated as:

- the primary editor transport
- the fastest path to a useful vertical slice
- sufficient for bounded reads and bounded property writes

It should not be treated as:

- a permanent answer to every future bridge capability
- proof that no Unreal-side backend will ever be needed
- a credible solution for future C++ and Live Coding workflows

## Likely Need For A Lightweight UE-Side Backend Later

A lightweight Unreal-side backend or plugin is likely needed after M0.

That future layer should exist only when justified by capabilities that Remote Control cannot support cleanly, such as:

- reliable output log access if Remote Control exposure is insufficient
- richer editor introspection
- event push or subscriptions
- long-running tasks
- C++ build, compile, Live Coding, or engine-state workflows

The important architectural stance is not "never build a plugin." It is "do not start with one before the first useful slice exists."

## Safety Model

M0 should be designed as a local, controlled tool bridge.

- localhost only
- explicit allowlisted tools
- no arbitrary execution
- no broad filesystem or shell execution from Unreal
- bounded responses
- explicit target identifiers
- validation before dispatch and verification after writes where practical
- read-first workflow bias

Console commands require special caution. M0 should support only `ue_run_console_command_safe`, backed by an allowlist or strict audited patterns.

## Transport Assumptions

The default transport split should be:

- external agent to bridge: MCP over stdio
- bridge to Unreal: Remote Control HTTP on localhost

WebSocket support may matter later for subscriptions or event streams, but it is not required to prove M0.

No network exposure should be assumed for M0.

## Architectural Treatment Of Future C++ And Live Coding Workflows

Future C++ and Live Coding workflows should be treated as a separate capability tier, not as an accidental extension of M0.

That means:

- do not pretend a property-edit bridge already solves compile iteration
- do not hide build or compile behavior behind generic command tools
- design future support as explicit, named workflows with dedicated safety and state handling
- assume these workflows are the strongest candidate for a later Unreal-side backend or plugin

## Open Questions Before Implementation

- What exact object identity model should M0 use: actor name, object path, GUID-like handle, or a layered approach?
- What exact Remote Control exposure contract is required for the M0 tools to work across projects?
- Can `ue_get_output_log` be supported cleanly through Remote Control alone, or does it immediately justify a tiny Unreal-side helper?
- Which property types are safe and useful to allow in M0: scalar only, common structs, enums, object references?
- What should the safe console command allowlist contain on day one?
- How should errors be surfaced so agents can distinguish transport failure, target-not-found, validation failure, and Unreal-side rejection?
- How much Unreal-side setup is acceptable for reuse across projects before it stops feeling lightweight?

## Proposed Future Repository Structure

This is a planning-only preview, not an implementation commitment.

```text
/docs
/docs/reference
/server
/server/src
/server/src/tools
/server/src/transport
/server/src/safety
/server/src/contracts
/examples
/examples/remote-control
/tests
```

## Most Likely Next Step After Approval

The next implementation step should be a thin TypeScript MCP server skeleton with exact schemas for the eight M0 tools, a localhost-only Remote Control adapter, and a written Remote Control exposure contract for the Unreal side.
