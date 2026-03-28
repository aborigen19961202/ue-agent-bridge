# Client Integration

This is the last-mile setup that makes Codex and Claude Code actually see `UEAgentBridge` as an MCP tool source.

## Bridge Launcher

Shared launcher script:

- [`scripts/start-ue-agent-bridge.cmd`](./scripts/start-ue-agent-bridge.cmd)

It:

- sets the default `UE_*` environment variables
- starts the built MCP server from `dist/server/index.js`
- defaults to `UE_BACKEND_MODE=plugin`

## Codex

Codex uses user-level MCP config in:

- `%USERPROFILE%\.codex\config.toml`

Installed entry on this machine:

```toml
[mcp_servers.ue-agent-bridge]
args = ["/c", "<RepoRoot>\\scripts\\start-ue-agent-bridge.cmd"]
command = "cmd"
```

That makes `ue-agent-bridge` available globally to Codex.

## Claude Code

Claude supports project-level MCP config through `.mcp.json`.

Repository-level file created in this repo:

- [`.mcp.json`](./.mcp.json)

Active project-level file installed for a live Unreal target:

- `<ProjectRoot>\.mcp.json`

Installed config:

```json
{
  "ue-agent-bridge": {
    "command": "cmd",
    "args": [
      "/c",
      "<RepoRoot>\\scripts\\start-ue-agent-bridge.cmd"
    ]
  }
}
```

Claude project state should be updated so `ue-agent-bridge` is enabled for the Unreal project repo:

- `<ProjectRoot>`

## Practical Rule

- Codex: global MCP server entry is fine
- Claude Code: prefer project-level `.mcp.json` in the Unreal project repo

That keeps Unreal tools attached to the repositories that actually use them.
