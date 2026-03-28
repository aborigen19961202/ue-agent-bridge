# UE_AgentBridge Project Framing

## Purpose

UE_AgentBridge is a reusable Unreal Engine interaction layer for external coding agents such as Codex app and Claude Code. Its job is to let an external, repo-aware agent use Unreal Editor as a structured tool surface while continuing to work directly against the local project repository, shell, git history, and source tree.

This repository is intentionally about the Unreal bridge layer only. It is not the agent, not the Unreal project, and not an in-editor assistant product.

## Problem Statement

External coding agents are already good at repository work: reading code, editing files, running terminal commands, reasoning about architecture, and using git. Unreal Editor, meanwhile, contains important project state that cannot be reconstructed safely from files alone: current selection, loaded level state, asset metadata, output log context, and editor-only operations.

Without a bridge, the agent is repo-aware but editor-blind.
Without architectural discipline, teams drift into the wrong product shape: an in-editor chat tool, a project-specific plugin assistant, or a backend that recreates fake repository awareness inside Unreal.

UE_AgentBridge exists to solve that boundary correctly.

## Target Users

- Developers using Codex app, Claude Code, or similar external agents on a local Unreal project
- Technical artists and tools engineers who want safe editor automation without moving the agent into Unreal
- Teams that want a reusable bridge across multiple Unreal projects, not a one-off integration tied to a single game

## Primary Use Case

An external agent is already working in a local Unreal project repository. It edits code and config in the repo, reasons about project structure outside Unreal, and then uses Unreal tools to inspect editor state, search assets, read logs, inspect actor properties, and make narrow editor changes when appropriate.

That mixed workflow is the core product model.

## Architectural Boundaries

- The agent lives outside Unreal Editor.
- Repository awareness stays outside Unreal.
- File editing, git operations, terminal use, architectural reasoning, and source analysis remain external-agent responsibilities.
- Unreal Editor is exposed as a structured tool layer.
- M0 stays localhost-only and allowlist-driven.
- M0 avoids arbitrary execution and wide-scope mutation.
- The bridge must remain reusable across projects.
- The bridge must not assume any single project's naming, folder layout, or gameplay architecture.

## What This Product Is

- A local bridge that exposes bounded Unreal Editor capabilities to external agents
- A clean separation layer between repo-aware agent behavior and Unreal-specific editor operations
- A reusable foundation for future instruction and behavior policies that tell agents when to use repo tools versus Unreal tools
- A practical Windows-first local developer tool

## What This Product Is Not

- Not an in-editor chat assistant
- Not a replacement for Codex, Claude Code, or other external coding agents
- Not a fake repository mirror inside Unreal
- Not a broad remote administration surface for Unreal Editor
- Not an attempt to solve all Unreal automation, compilation, Blueprint authoring, or Live Coding workflows in M0

## Why The Intended Model Is "External Repo-Aware Agent + Unreal Tool Layer"

This model matches reality instead of fighting it.

- External agents already have the right primitives for repository work.
- Unreal Editor exposes state and operations that are only meaningful from inside the editor process.
- Trying to move the agent into Unreal weakens repo awareness and makes git, shell, and source-tree work worse.
- Trying to recreate repository awareness inside Unreal produces a second-rate imitation of the real workspace.
- Treating Unreal as a first-class tool layer gives the agent direct editor access without collapsing the product boundary.

The result is a sharper operating model: the agent reasons about the repo from the repo, and it reasons about the editor through explicit tools.

## Non-Goals

- General-purpose remote control of Unreal over a network
- Arbitrary Python or C++ execution in M0
- Full Blueprint graph authoring in M0
- Full asset pipeline automation in M0
- Live Coding orchestration in M0
- Project-specific gameplay automation
- Any architecture that requires the agent to "live" in Unreal
