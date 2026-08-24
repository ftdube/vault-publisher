Companion to `agents.md` — removed-but-accurate content, trimmed from the main file to stay within its token budget. Never loaded automatically; read only when asked.

## Why quartz's build must run from inside `node_modules/@jackyzha0/quartz`

quartz resolves `quartz.config.yaml` and its own build scripts (e.g. `./quartz/build.ts`) relative to `process.cwd()`, not relative to where the package is installed. Confirmed by direct test: invoking the build from the app root (`/usr/src/app`) fails with `Could not resolve "./quartz/build.ts"`; invoking it with cwd set to `node_modules/@jackyzha0/quartz` itself succeeds. `quartz.config.yaml` must be copied into that same directory before each build for the same reason.

## Why quartz can't have PWA/manifest support

The old fork (`ftdube/quartz`, now retired in favor of this repo) patched `quartz/components/Head.tsx` to add a manifest link and PWA meta tags, driven by a `QUARTZ_SHORT_NAME` env var. Unpatched `@jackyzha0/quartz` has no such support — no `shortName` field in `cfg.ts`, no manifest emitter. Since C3 requires quartz stay unpatched, `QUARTZ_SHORT_NAME` was dropped entirely rather than shipping a no-op env var. Revisit only if this becomes achievable without patching quartz itself — e.g. a build-time HTML post-processing step that injects a manifest link into already-emitted pages, entirely outside quartz.

## Why node_modules is baked into the image

Two independent reasons: (1) `npm ci` at image-build time means zero network/install work at pod startup, keeping cold-start fast (NFR-BUILD-3); (2) `@jackyzha0/quartz` is `private: true` and was never published to the npm registry — it's a git-ref-pinned dependency, so a fresh `npm install` at runtime would also need git and network access the pod may not reliably have on first boot.

## Test organization

Tests live in `tests/`, not colocated with source under `src/`, so the Docker build's `COPY src/ ./src/` never sweeps up `*.test.ts` files into an image layer. Run via `tsx --test tests/*.test.ts` — not compiled by `tsc` (tests aren't part of `dist/`). Test names are prefixed with the FR/NFR or BRD section they verify (e.g. `FR-BUILD-4: ...`) so traceability back to the BRD is visible in `npm test` output, not just in source comments.

## The `Failed to install plugin` build-log errors are confirmed harmless

The image build's plugin pre-bake step logs, for `canvas-page`, `bases-page`, and `note-properties`:

```
✗ canvas-page: post-install build failed: Command failed: npm run build
Error parsing: .../src/types.ts:1:7
Error: error occurred in dts build
✗ Failed to install plugin: github:quartz-community/canvas-page
```

This looks like the plugin failed entirely, but it didn't. `tsup` (the bundler these community plugins use) runs two separate sub-steps: building the JS bundle, then generating `.d.ts` type-declaration files. Only the second sub-step fails — some type in each plugin's `types.ts` doesn't parse cleanly under whatever TypeScript version `tsup`'s DTS generator uses. The JS bundle (`dist/index.js`) still gets written successfully.

Verified two ways, not just inferred from the log:
1. `dist/index.js` exists and is non-trivially sized (330KB–664KB) for all three plugins after the failure.
2. A real build with `-v` against content that has frontmatter shows `Loaded 27 plugins` including `NoteProperties`, `BasesTransformer`, `CanvasPage`, `BasesPage` in the Transformers/PageTypes lists — and the rendered output HTML contains a fully populated `<table class="note-properties-table">` with the actual frontmatter values (`description`, `tags`). The plugin genuinely works at runtime.

Declaration files are irrelevant to quartz's own plugin loader, which just imports the compiled JS — so a DTS-only failure doesn't block functionality. This is upstream community-plugin behavior (a `tsup`/TypeScript version mismatch in those plugins' own source), not something in our control to fix, and not worth patching around. If a future quartz/plugin upgrade makes these errors disappear, that's fine; if they start actually breaking a plugin (bundle missing, not just declarations), that would show up as the plugin absent from the `Loaded N plugins` list — reverify with the same two checks above before assuming a regression is benign.
