# Contributor Workflow

This page describes how to make a change in Vela™ and how to know it is finished. Start from [setup.md](./setup.md) if you have not built the project yet.

## The quality gate is the definition of done

A change is complete when **four checks are green together**, each catching a distinct, non-overlapping class of problem:

| Gate | Command | Catches | In one phrase |
| --- | --- | --- | --- |
| **typecheck** | `npm run typecheck` | Type errors across the source | *Do the types line up?* |
| **lint** | `npm run lint` | Architecture-boundary violations + style | *Does it respect the layering?* |
| **test** | `npm test` | Behavior regressions | *Does it still do the right thing?* |
| **build** | `npm run build` | Packaging / emit problems | *Does it actually bundle?* |

Run all four before considering a change done. A change that passes three and fails the fourth is not finished.

### typecheck and build are different jobs

These two are easy to conflate, but they have separate responsibilities:

- **typecheck** runs the type checker with **no emit**. Its only job is to validate types. It never produces output.
- **build** **owns emit**. It is the only step that produces the two artifacts (see [setup.md](./setup.md#two-artifacts-from-one-source)).

So a green typecheck does not imply a working build, and a successful build does not substitute for typecheck. Run both.

### lint enforces the architecture

Lint is not just formatting here. The import rules are part of the architecture:

- The **core** depends only on the ports and the neutral model. It imports **no concrete backend**.
- Only the **composition root** (the `Vela` class plus the package entry point) imports concrete backends and wires the defaults.
- The scripting backend may be imported only in the engine layer; the renderer dependency only in its own renderer folder; the renderer never imports the scripting backend.

These rules are enforced by lint as an import ACL with named exception buckets. **Adding a new backend means deliberately extending that ACL** — that friction is intentional, so a boundary is never crossed by accident.

## The playground

`npm run playground` serves `playground/` with vite on `http://localhost:5190` (no build step;
changes hot-reload on save). The index page links the two surfaces:

- **`/widget.html`** (`playground/widget.ts`) — mounts the **Vela™ widget** straight from `src/`.
  It registers the Binance provider (public API, no key, no server) and the page's own
  `demo-engine.ts` — a tiny `ScriptingEngine` implementation, since Vela™ bundles none — with a
  starter indicator manifest and a "Code" topbar entry that runs a script on demand. Use
  `window.widget` from the browser console to poke at the live instance.
- **`/workspace.html`** (`playground/workspace.ts`) — mounts the multi-chart **VelaWorkspace**
  on the same provider and demo engine.

## Where to make a change, by layer

Vela™ is a **core** plus three swappable **layers**, each reached through a single narrow **port**: **data providers** (`MarketDataFeed`), **scripting engines** (`ScriptingEngine`), and **renderers** (`IChartRenderer`). The only thing that crosses a port is the **neutral model**; no backend-specific type ever does. For how the core and the three layers fit together, see the [architecture overview](../architecture/overview.md).

The shape of almost every change is the same: **implement a port, then register or inject the implementation.** Only the composition root wires the defaults.

- **Add a renderer** — implement `IChartRenderer` and declare honest capabilities, then pass the class as the `renderer` option (built-in or your own), or inject an already-constructed instance via `deps.renderer`. The composition root is the only place that imports a concrete renderer.
- **Add a scripting engine** — implement `ScriptingEngine` (a language id, capabilities, and prepare/execute), then register it (`registerEngine(language, engine)`) or pass a set via `deps.engines`. The engine is selected per indicator by language. There is **no default engine**: a bare chart shows candles, and running an indicator with no matching engine throws an actionable error. Re-registering a language is last-wins, and only affects future indicators.
- **Add a data source** — the common path is a `DataProvider` (just `getBars`, plus optional `listSymbols`/`getSymbolInfo`/`subscribe`), registered with `chart.data.registerProvider(name, provider)`; the default `MultiProviderFeed` routes symbols to it and caches closed bars. For full control, implement the whole `MarketDataFeed` port (`load`/`subscribe` required; `loadRange`/`symbolInfo` optional) and inject it via `deps.dataFeed` — used bare, with no registry or auto-cache.

In every case, **only the composition root wires the defaults** — your new implementation arrives through registration or dependency injection, never by the core reaching out to a concrete backend.

For the detailed contract of each layer, see the layer guides (adding a renderer, adding an engine, adding a data provider). For how to verify a change, see [testing.md](./testing.md) and [debugging.md](./debugging.md).

## The working loop

For anything beyond a trivial edit, follow this sequence:

1. **Understand before touching code.** Restate the goal, then read the _actual_ code it touches — the relevant ports, the composition root (`src/Vela.ts`), the lint/boundary config — instead of assuming. The output of this step is _where_ the change belongs and _what the real decisions are_.
2. **Settle the open decisions before implementing.** Research first, form a view, propose with a clear recommendation, and let the user confirm or redirect. Don't over-ask: pick sensible defaults for obvious choices and state them.
3. **Sequence so the risky part is isolated and proven first.** If a change needs a refactor of working code _plus_ new code on top, land and gate the refactor on its own first.
4. **Make the smallest correct change at the right seam**, matching the surrounding code's style and conventions. Don't duplicate logic that exists nearby — extend it.
5. **Gate it** (the quality gate above).
6. **Prove it in the real runtime** (see [testing.md](./testing.md)).
7. **Diagnose root causes; distrust the happy path — including your own output.** Prove a bug's cause (capture, log, reproduce) before fixing it. Re-check what you produced adversarially, as if someone else wrote it.
8. **Present, don't commit.** Implement → gate → verify → present → wait for explicit approval before committing.

## Keep the documentation in sync

Role-based documentation lives in `docs/` (user guides, architecture, contributing). When a change touches a developer-facing interface or adds a feature, check whether `docs/` still matches reality. If it has drifted, **tell the user what is stale and ask whether to update it** — a natural moment is when a change is ready to commit. Verify prose consistency yourself (terminology, cross-links); there is no compiler for docs.

## The changelog

`CHANGELOG.md` is written for the person **using** the product, not the developer reading the diff. When user-visible work lands, add its entry under the upcoming version's heading in the same change (the changelog is part of the feature, not an afterthought). Follow the house format exactly:

- **Structure.** Newest first; `## [vX.Y.Z]` sections; `### Added` / `### Changed` / `### Fixed` subsections in that order, each present only when non-empty.
- **Where a new entry goes — released sections are immutable.** Before writing, check whether the version at the top of the file has already SHIPPED: `package.json`'s current version matching a published release (a git tag `vX.Y.Z`, or the version on the npm registry) means that section is history — never append to it. New work then goes under a `## [Unreleased]` heading created above it. **When in doubt, use `[Unreleased]`** — a release can always absorb it, but an entry written into an already-published section silently rewrites release notes users have read.
- **Entry shape.** `- **Bold, feature-first lead.** ` followed by short prose that explains what the reader can now do and how it behaves — full sentences, concrete, calm. One entry per feature: merge related sub-features into one narrative entry instead of scattering micro-bullets.
- **High level only.** No internal identifiers, module paths, event names, or architecture vocabulary. If a sentence only makes sense to someone who read the source, rewrite it.
- **What goes where.** `Added` = new capabilities. `Changed` = behavior a v-1 user will notice, with breaking changes flagged inline as `_(Breaking: ...)_`. `Fixed` = bugs that existed in a **released** version only — a bug introduced and fixed within the same unreleased cycle gets no entry.
- **What stays out.** Internal refactors, tests/probes, CI, playground-only tweaks with no user-visible effect, and anything that lives in a private extension package.

## Commit discipline

- Present the change and **wait for the user's review and approval before committing**.
- Use **targeted `git add`**; never commit build artifacts, `.scratchpad/`, or unrelated changes. In SVN-managed checkouts, run `svn status` first and `svn add` only the intended new files — never dependencies (`node_modules/`, `dist/`, virtual environments).
- Keep commit messages user-readable, in English, and free of other products' names.
