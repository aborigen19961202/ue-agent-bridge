# Fab Release Readiness

This document captures what is ready now and what still needs to happen before `UEAgentBridge` should be treated as a real Fab listing candidate.

## Already Ready

- plugin-first architecture is implemented
- Unreal plugin package exists under [`unreal-plugin/UEAgentBridge`](./unreal-plugin/UEAgentBridge)
- external bridge and Unreal plugin have been live-tested together
- plugin mode is the normal path
- no manual Remote Control preset authoring is required for normal use
- a repeatable packaging script now exists:
  - [`scripts/package-ue-plugin.ps1`](./scripts/package-ue-plugin.ps1)
- a third-party install path is documented:
  - [`THIRD_PARTY_INSTALL.md`](./THIRD_PARTY_INSTALL.md)
- a packaged zip install has already been validated on a local Unreal test project

## Still Required Before Real Fab Submission

- final public license decision
- listing copy, screenshots, icon, and marketplace presentation assets
- validation on at least one additional Unreal project beyond the initial validation target
- confirmation of engine-version support policy
- a release artifact review of the packaged zip
- a decision on whether bridge docs and agent instructions stay in this repo or move to a companion repo/site

## Packaging Expectations

For code plugin publication, the practical target is:

- a clean distributable plugin folder
- installable as a project plugin
- installable as an engine plugin
- no development-only `Binaries` or `Intermediate` artifacts checked into the source repo
- clear install and usage docs

## Current Skills Position

Agent skills and instruction bundles should be treated as a separate deliverable from the Unreal plugin listing.

That is intentional:

- the Unreal plugin is one product artifact
- Codex/Claude operating instructions are another artifact

Do not block plugin packaging on the final skills packaging decision.

## Recommended Release Order

1. freeze the plugin package for a candidate version
2. test install from the packaged zip into a clean Unreal project
3. validate the bridge and plugin together on that clean install
4. finalize public-facing metadata and legal packaging
5. decide whether skills ship:
   - in this repo
   - in a companion repo
   - or both

## Reference Notes

Epic's current public documentation for code plugin structure and Fab publishing is relevant here:

- [Unreal Engine code plugin requirements](https://dev.epicgames.com/documentation/en-us/unreal-engine/plugins-in-unreal-engine#codeinplugins)
- [Fab documentation landing page](https://dev.epicgames.com/documentation/en-us/fab/fab-documentation)
