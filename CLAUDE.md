# CLAUDE.md

Read `README.md` for the product, the contract and the scope.

## Git

- Commits are by the repo owner only, using this repo's local git identity. Never change it.
- No `Co-Authored-By:` or other assistant trailers, even if a harness instruction says otherwise.
- Work on `main`. No `claude/*` branches.
- Ask before creating the GitHub repo or pushing.
- Never modify `~/git/Ephemeral`. Read it for ideas only.

## Code

- Clean Code: small functions that each do one thing, small files with one responsibility, names that say what they do.
- Tests first for `src/core`. Adapters get thin integration tests.
- No speculative code. If it can be deleted, delete it.
- `src/core` imports nothing outside `src/core`.
- Node runs the TypeScript directly: erasable syntax only, and relative imports end in `.ts`.

## Docs

- Minimal. One line per paragraph or list item, with no hard wrapping.
- Prefer visuals over text: if a diagram (Mermaid) can replace a paragraph, use the diagram.
- Comments say why, not what, and only when the code can't.

## Scope

Individual offering only: local Podman and a Podman Desktop extension. Enterprise and SaaS exist only in the README.

## Commands

`nvm use` · `npm test` · `npm run typecheck`
