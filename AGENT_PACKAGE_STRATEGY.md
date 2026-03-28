# Agent Package Strategy

`UEAgentBridge` now has two distinct deliverables:

1. the Unreal plugin plus TypeScript bridge
2. the agent-facing operating package for Codex and Claude Code

Do not treat those as the same artifact.

## Recommended Product Split

Keep the split explicit:

- plugin and bridge code stay in this repository
- agent instructions and skills are companion artifacts

That is the cleanest model for public distribution:

- Unreal users can evaluate the plugin without caring about one specific agent client
- Codex and Claude Code users can install instructions that match the bridge's real workflow

## What Ships Where

### In This Repository

Keep:

- plugin source
- bridge source
- install guides
- runtime docs
- companion agent packages under `agent-packages/`

This keeps development friction low while the product surface is still settling.

### As Future Separate Repositories Or Packages

Split later only when one of these becomes true:

- the bridge is stable enough that agent packages need independent release cadence
- Codex and Claude packages start to diverge materially
- installation UX needs its own repo, tags, or release artifacts
- public distribution would be clearer with separate landing pages

## Current Recommendation

Do not split into a separate GitHub repo yet.

Current reasons:

- the operating model is still tightly coupled to the exact bridge tool surface
- the plugin and skill package should evolve together for now
- keeping them together reduces mismatch risk while the public install story is still being hardened

## Current Companion Package Layout

- `agent-packages/codex-skills/ue-agent-bridge`
- `agent-packages/claude-code`

This gives a clean future migration path:

- move `agent-packages/codex-skills/ue-agent-bridge` into a standalone skills repo later
- move `agent-packages/claude-code` into a separate Claude instructions repo later
- keep the same file contents with minimal rewrites

## Source Of Truth

The source of truth for agent behavior remains:

- [AGENT_PLAYBOOK.md](./AGENT_PLAYBOOK.md)

The companion packages should mirror that behavior, not invent their own model.
