# GitHub Publish Checklist

## Repository Hygiene

- confirm `.gitignore` excludes `node_modules/`, `dist/`, `.env`, `coverage/`, and temporary local folders
- confirm no temporary analysis directories remain in the working tree
- confirm no local machine paths remain in public-facing docs

## Public-Facing Docs

- review [README.md](../../README.md) for accuracy against the implemented M0 surface
- confirm release docs are linked clearly from the README
- confirm helper contract docs are linked and readable
- confirm unsupported scope is stated clearly

## Package Metadata

- confirm package name matches the repo name expectation: `ue-agent-bridge`
- confirm version is correct for the initial publication
- confirm description is accurate for public readers
- keep `private: true` unless and until an npm publication path is intentional

## Validation

- run `npm run typecheck`
- run `npm test`
- run `npm run build`
- validate mock mode locally
- validate remote-control mode locally against a real Unreal setup if available

## GitHub-Side Manual Setup

- confirm the GitHub repository `ue-agent-bridge` visibility, description, and topics
- choose and add a `LICENSE` file
- add repository description and topics
- decide whether to enable Issues and Discussions
- set the initial default branch policy
- create the first release or tag after local validation
