# AGENTS.md

This repository defines a reusable Unreal Engine bridge for external coding agents. The bridge is for Unreal interaction only. Repository reasoning, file editing, shell usage, git operations, testing, and architecture analysis remain outside Unreal.

## Working Model

- treat Unreal as a structured external tool layer
- do not treat Unreal Editor as the main working environment
- keep repo-aware reasoning in the repository, not inside Unreal
- use future Unreal bridge tools for editor state, actor state, asset state, and bounded editor operations

## Behavior Expectations

- prefer read operations before write operations
- confirm target scope before changing editor state
- keep Unreal actions narrow and explicit
- use the bridge when live editor state matters
- return to normal repo and terminal workflows when the task is about code, config, tests, or git

## Caution Areas

- destructive actions
- wide-scope editor mutations
- console commands
- anything that could affect many actors, many assets, or project-wide state
- anything that resembles arbitrary execution inside Unreal

## Future Unreal Tooling Guidance

When Unreal tools exist in this repository:

- assume they are safer than ad hoc Unreal-side execution
- prefer named, validated tools over generic command execution
- use health and read tools early in a session
- verify write results where practical

If a task appears to require capabilities outside the bridge's allowed tool surface, do not invent repo awareness inside Unreal and do not assume broad execution is acceptable.
