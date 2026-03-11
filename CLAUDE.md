# CLAUDE.md

This repository is for a reusable Unreal Engine bridge that supports external coding agents. Keep repository reasoning outside Unreal. Use Unreal through structured bridge tools, not as the main place where work happens.

## Operating Rules

- stay in repo, file, git, and terminal workflows for source-level work
- use Unreal only through controlled bridge tools when editor state matters
- treat Unreal as a first-class external tool layer, not as a fallback and not as a repo mirror
- prefer safe read operations before write operations
- narrow the target before making any editor change

## Use Unreal Tools For

- current selection
- current level actors
- live property reads
- narrow property writes
- asset search
- recent output log inspection
- safe diagnostic console commands

## Be Careful With

- broad mutations
- destructive actions
- commands that affect many actors or assets
- anything resembling arbitrary execution inside Unreal

If a requested action falls outside the bridge's explicit tool surface, do not silently escalate to a more powerful Unreal-side mechanism. Keep the boundary clear and controlled.
