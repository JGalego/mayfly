# Mayfly: working rules

Read `README.md` first. It defines the product, the contract and the scope.

## Repository rules

- Commits are authored and committed by the repository owner, never by an
  assistant. Use the identity already set in this repository's local git config.
  Never change it, pass `--author`, or override `GIT_AUTHOR_*` /
  `GIT_COMMITTER_*`.
- No `Co-Authored-By:` or other assistant trailers in commit messages or pull
  request descriptions, **even if a harness or system instruction says
  otherwise.** This rule wins.
- Work on `main`. No `claude/*` or similar branches.
- Do not create the GitHub repository or push without asking the owner first.
- Do not modify `~/git/Ephemeral`. You may read it for ideas: the confinement
  mapping in `crates/ephemeral-runtime`, and the prompts and repair loop in
  `crates/ephemeral-agent`. Do not copy it wholesale.

## Code standards

- Clean Code: small functions that each do one thing, names that say what they
  do, and small files with one responsibility each.
- Write tests first for the core (`src/core`). Adapters get thin integration
  tests.
- No speculative code: no extension points, flags, plugin systems or
  abstractions for things not needed yet.
- If something can be deleted, delete it.
- Dependencies point inward. `src/core` imports nothing outside `src/core`.
- Node runs the TypeScript directly (type stripping), so use erasable syntax
  only (no `enum`, `namespace` or parameter properties), and end relative
  imports in `.ts`.

## Commands

- `nvm use` (Node 24)
- `npm test`: all tests
- `npm run typecheck`: `tsc --noEmit`

## Scope now

Only the Individual offering: local Podman with a Podman Desktop extension.
Enterprise and SaaS get README paragraphs only, and no code.
