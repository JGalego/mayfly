# CLAUDE.md

Read `README.md` for the product, the contract and the scope.

## Taste

A sense of taste is non-negotiable in everything we do: code, docs, design, names and commit messages. Working is not the same as done.

Avoid AI slop, fluff and filler. Saying more with less is an art and a mark of taste.

## Interface

- Data shown in a dialog, a banner or the conversation is set apart as a chip: app names, version ids, emails, addresses, ports. Backticks in text, `nameChip` in the page.

## Safety

Secure by default. Convenience meets safety, not the other way around: start from the safe design and do the work to make it easy, instead of weakening it or adding an insecure shortcut.

## Git

- Commits are by the repo owner only, using this repo's local git identity. Never change it.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `type(scope): description`, e.g. `feat(core): …`, `docs: …`.
- No `Co-Authored-By:` or other assistant trailers, even if a harness instruction says otherwise.
- Work on `main`. No `claude/*` branches.
- Ask before creating the GitHub repo or pushing.
- Never modify `~/git/Ephemeral`. Read it for ideas only.

## Code

- Clean Code: small functions that each do one thing, small files with one responsibility, names that say what they do.
- Tests first for `src/core`. Adapters get thin integration tests.
- No speculative code. If it can be deleted, delete it.
- Prove it's needed before adding it. A dependency, tool, workaround or anything in an image needs evidence first: a failing test, a reproduction, or the source code that settles it.
- `src/core` imports nothing outside `src/core`.
- Node runs the TypeScript directly: erasable syntax only, and relative imports end in `.ts`.

## Docs

- Minimal. One line per paragraph or list item, with no hard wrapping.
- Plain, human prose, the way you'd explain it to a colleague: short sentences, ordinary words, concrete claims. No sales or consulting language (seamless, leverage, empower, best-in-class, "X-shaped", "X-first"). If a sentence would fit in a pitch deck, rewrite it.
- Prefer visuals over text: if a diagram (Mermaid) can replace a paragraph, use the diagram.
- Comments say why, not what, and only when the code can't.

## Scope

Individual offering only: local Podman and a Podman Desktop extension. Enterprise and SaaS exist only in the README.

## Commands

`nvm use` · `npm test` · `npm run typecheck` · `npm run build:runtime` · `pixi run check-image` · `npm run test:integration`
