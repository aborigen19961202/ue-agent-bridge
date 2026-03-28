# Contributing

Thanks for contributing to `UEAgentBridge`.

## Before You Start

- read [README.md](./README.md) for the current product shape
- follow [AGENT_PLAYBOOK.md](./AGENT_PLAYBOOK.md) for the intended repo/Unreal boundary
- check open issues or start a discussion before making large workflow or tool-surface changes

## Development Expectations

- keep repository reasoning, file edits, builds, and git operations outside Unreal
- use the Unreal bridge only for bounded editor-state reads and narrow safe mutations
- prefer read operations before write operations
- update docs when the tool surface or operator workflow changes

## Validation

Run the standard checks before opening a pull request:

```bash
npm run typecheck
npm test
npm run build
```

If your change affects live Unreal behavior, include the exact validation path you used:

- backend mode
- Unreal Engine version
- whether the test was mock-only or against a real project
- which bridge tools were exercised

## Pull Requests

- keep pull requests focused and explain the operator impact clearly
- link related issues when applicable
- include screenshots only when the change is visual or viewport-dependent
- call out any unsupported scope that still remains intentionally out of bounds
