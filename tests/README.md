# Tests

Node's built-in test runner, no test framework. From the repository root:

    npm test                                                   # everything (about 35 s; builds the P0JBVA rasters first if they are missing)
    npm run fixtures                                           # rebuild the P0JBVA rasters (about 8 s)
    node --test --test-reporter=spec tests/mesh/performance.test.mjs   # timings against the phase 1 budgets

`.github/workflows/test.yaml` runs `npm test` on every push and pull request; `release-on-tag.yaml` runs it again before a release is drafted.

## Layout

- `mesh/`: the v4 mesh engine (`src/mesh/`) and its module integration (`MeshSession`, persistence, the mesh cache, the worker protocol, regional extraction and the exporters), and the edits built on it: the layer tree, deleting, merging and nesting regions, painting with the brush and fill (with the waters that follow), and routes made by hand (placing with a preview, the transports' costs, the waypoints a traced stroke keeps, moving, inserting, removing, splitting, joining, simplifying and re-pathing waypoints), the map's area factor (what a pixel measures in km) and the content transform that carries regions and routes with the terrain when the noise is panned or rescaled, and the noise frame's own undo entry, which steps the terrain back along with everything on it. The integration tests stub the few Foundry globals they reach in `mesh/foundry-stubs.mjs`; the worker test runs the real worker module in a Node worker thread through `support/web-worker-shim.mjs`.
- `ui/`: the studio's interface without a browser: every template compiles with only the helpers both hosts provide (so a template cannot quietly rely on a Foundry-only helper the web version would lack), every statically named partial exists, and every `data-action` in the templates has a handler, and every `--fwmb-*` custom property the stylesheets, templates and scripts read is defined (in both themes); every class in the templates, and every class the scripts set, is the module's own (`fwmb-`), and the stylesheets size everything in rem apart from 1px hairlines and the 2px focus ring; the region renderer (`StudioView`), the dialogues (`Overlay` and the dialogue service), the direction list item menus open in, the studio's closing rules and its window title, in happy-dom; the vector undo history (snapshots, owner patches and composite entries) the Regions panel's commands, each one undo step, the Regions tool's pointer input (picking, painting, its keys, the docked editor), the Routes tool's (drawing routes by click and by stroke, editing them, its keys, the toolbar's fields and the docked route editor), and pin quick styles (the default set, the cascade, usage and the toolbar's choice).
- `platform/`: the host services (`src/platform`). Foundry's pass calls on to Foundry as the module always has; the web version's behave as Foundry's do where the shared code relies on it (saved maps, settings, strings, templates, asset paths, the file picker).
- `support/`: shared helpers that are not tests. `pipeline-setup.mjs` builds a stand-in for the studio app from a saved map so the generation pipeline can run outside Foundry; `web-worker-shim.mjs` gives Node a browser-style module `Worker`.

Two checks run the studio in headless Chromium (Playwright) and stay in `design/`, run by hand: `design/prototypes/thin-frame/studio-smoke-check.mjs` (the studio in a stand-in Foundry window) and `design/prototypes/web/web-smoke-check.mjs` (the web version, from the working copy or any site address). The browser render check for the region fill (`design/tests/mesh/browser/render-check.mjs`, headless Chromium through Playwright) stays in `design/` and is run by hand; it reads the fixtures from here.

## Fixtures (`mesh/fixtures/`)

- `p0jbva.json`: the P0JBVA map (2000 × 1600, seed `P0JBVA`), the saved-map JSON the other fixtures are built from.
- `p0jbva/`: the map's terrain rasters (elevation, water mask, river map), **derived data that is not committed**: `build-p0jbva.mjs` regenerates them by running the module's own generation pipeline on `p0jbva.json`, so they always match the current engine. `npm test` builds them when they are missing; `npm run fixtures` rebuilds them after an engine change. Tests that need them skip, and say so, when they are absent.
- `v3-vectors.json`: `p0jbva.json` with hand-written v3 region layers (an overlapping pair, one around a lake, a tiny one), routes (two sharing a node, one repeating a node) and pins, for the migration tests.
- `p0jbva-realms.json`: the settlement prototype's final realms carried onto P0JBVA's display mesh (vote, fill, relax, sea claims), RLE encoded, with the mesh block they belong to. Rebuilt with `make-realm-layer.mjs` from a prototype run; only needed again if `MESH.ALGORITHM_VERSION` changes.
- `expected-sites.json`: hashes of the sampled sites, the cross-engine determinism check. If it fails after a deliberate sampler change, bump `MESH.ALGORITHM_VERSION`, regenerate this file and the realm fixture.

## Conventions

- Files are `*.test.mjs`; anything else under `tests/` is a helper or fixture and is not run.
- Tests must pass on a shared CI runner: the performance budgets are skipped where `CI` is set (set `FWMB_PERF` as well to run them there).
- A harness in `design/` that becomes a repeatable check moves here; a one-off investigation stays in `design/`.
