# Agent Package Install

This repository now includes companion agent packages in `agent-packages/`.

These are separate from the Unreal plugin package.

## Codex Skill

Skill source:

- `agent-packages/codex-skills/ue-agent-bridge`

Install by copying that folder into your Codex skills directory as:

- `$CODEX_HOME/skills/ue-agent-bridge`

After that, Codex can use the skill by name:

- `$ue-agent-bridge`

The skill is validated and includes:

- `SKILL.md`
- `agents/openai.yaml`
- focused reference files

## Claude Code Companion Instructions

Companion file:

- `agent-packages/claude-code/CLAUDE.md`

Use it as the base Claude instruction file in a repository that uses `UEAgentBridge`, or merge its rules into an existing project-level `CLAUDE.md`.

## Recommended Packaging Decision

For now:

- keep these companion packages in this repository
- treat them as a separate deliverable from the Unreal plugin zip

Later, if independent release cadence or public distribution becomes important, move them into a dedicated companion repository.
