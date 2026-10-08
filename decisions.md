# Decisions

Rationale behind the rules and gotchas in [`AGENTS.md`](AGENTS.md). Newest first.

---

### Pre-built plugins' `Failed to install plugin` errors are harmless

The image build logs `✗ Failed to install plugin` for `canvas-page`, `bases-page` and `note-properties`, after `Error: error occurred in dts build`. `tsup`, the bundler these community plugins use, builds the JS bundle and then generates `.d.ts` declarations; only the second step fails, on a type in each plugin's `types.ts`. The JS bundle is still written, and Quartz's loader imports only the JS.

Verified two ways: `dist/index.js` exists at 330–664 KB for all three, and a verbose build against content with frontmatter lists `NoteProperties`, `BasesTransformer`, `CanvasPage` and `BasesPage` among the loaded plugins, with a populated `note-properties-table` in the output HTML.

The failure is upstream and not worth patching around. One side effect: Quartz skips pruning those plugins' devDependencies when the DTS step fails, so the `Dockerfile` prunes the vulnerable ones itself (issue #9).

**Revisit:** a plugin missing from the `Loaded N plugins` list, which would mean the bundle itself failed. Re-run both checks before calling it benign.

### Tests live in `tests/`, not beside the source

So the Docker build's `COPY src/ ./src/` never puts `*.test.ts` into an image layer. Tests run through `tsx --test tests/*.test.ts` and are not compiled by `tsc`. Test names carry the FR/NFR or BRD section they verify, so traceability shows in `npm test` output.

### Quartz's `node_modules` is baked into the image

Two independent reasons. `npm ci` at image build means no install work at pod start, which keeps cold start fast (NFR-BUILD-3). And `@jackyzha0/quartz` is `private: true`, a git-ref-pinned dependency never published to npm, so a runtime install would also need git and network access the pod may not have on first boot.

### No PWA/manifest support

The retired Quartz fork patched `quartz/components/Head.tsx` to add a manifest link and PWA meta tags from a `QUARTZ_SHORT_NAME` env var. Unpatched Quartz has no such support, and C3 forbids patching it, so `QUARTZ_SHORT_NAME` was dropped rather than shipped as a no-op.

**Revisit:** if it becomes possible without patching Quartz, e.g. a post-build step that injects a manifest link into the emitted pages.

### Quartz's build runs from inside its package directory

Quartz resolves `quartz.config.yaml` and its build scripts (`./quartz/build.ts`) against `process.cwd()`, not its install path. Run from the app root, the build fails with `Could not resolve "./quartz/build.ts"`; run with cwd `node_modules/@jackyzha0/quartz`, it succeeds. `quartz.config.yaml` is copied into that directory before each build for the same reason.

### `/site` itself is never renamed (RISK-6, issue #4)

`/site` is the hostPath mount point, and `rename(2)` refuses to rename an active mount root with `EBUSY`, even when it is empty. Not the `EXDEV` first guessed in issue #4: against a real bind mount in a running container, a plain directory rename succeeded and `renameSync('/site', …)` failed `EBUSY`. Until this was found, every build succeeded and every promotion failed, so the site never published and the daemon retried forever.

`current`, `next` and `old` are therefore subdirectories of `/site`, so the two-step rename touches only the mount's contents, and Caddy's root is `/site/current` (FR-BUILD-2).
