# Project rules

## Scope and architecture

- Keep the project as a pnpm TypeScript monorepo with the directory layout in `Design And Implementation.md`.
- Implement one design phase at a time. Do not build later-phase production features early.
- Keep durable scene state separate from viewer-only UI state.
- Preserve the canonical coordinate and transform contract in `docs/asset-contract.md`.
- Update `docs/handoff.md` and the relevant phase in `Design And Implementation.md` when a phase is completed.

## Dependencies and quality

- Use current stable releases for new dependencies. Do not introduce prerelease versions without an explicit decision.
- The selected viewer dependencies are `three@0.185.1` and `@sparkjsdev/spark@2.1.0`; update them together only after compatibility verification.
- Keep shared schemas in `packages/contracts`; do not duplicate API payload types between applications.
- Run the relevant formatter, linter, type-check and tests for every implementation phase.

## Asset and security rules

- Never commit secrets, Firebase private keys, AWS credentials, asset files or `.env` files.
- Treat all binary assets as private. Browser uploads and downloads must use storage URLs issued by the API.
- Store S3 object keys, never permanent asset URLs.
- Public manifests must be separate from owner manifests and must not expose owner-only data or share tokens.
