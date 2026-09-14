# Advanced Layer Grouping & Multi-Tile Export

**Document Version:** 3.0
**Phase 1 Target Release:** 2.2.0
**Phase 2 Target Release:** 3.0.0 (unchanged from v2.0 of this document)
**Context:** This feature is being delivered in two phases. Phase 1 ships a small, non-breaking multi-tile export using the existing binary `all`/`gm`/`none` visibility model. Phase 2 is the full tag-based custom-grouping system and live-play HUD originally scoped below. Phase 1 is designed so nothing it builds needs to be reworked to reach Phase 2 — see "How Phase 1 sets up Phase 2" at the end of this document.

---

## Phase 1 (v2.2.0) — Per-Layer Binary Tile Export

### Scope

Today, exporting a scene produces one flattened player-visible background image, plus (optionally) a single flattened "GM overlay" tile containing every GM-only secret across the whole map. Phase 1 replaces that single overlay with **one tile per exportable layer, per visibility state** — so a GM can toggle Infrastructure, Regions, and Labels independently, and keep some of them secret, using Foundry's native tile visibility toggle. No new module UI is added for this phase.

- **Layers split into independent tiles:** Infrastructure (pins + routes), Regions, Labels. Each is exported as up to two tiles — one containing only entities visible to everyone, one containing only entities visible to the GM.
- **A tile is only created if it has content.** If a layer has no GM-only entities, no empty GM tile is created for it (and likewise for the "all" tile).
- **Everything else stays in the single background image**, exactly as today: base terrain, topography, biomes, contours, land masks, features (river sources, manual rivers, tectonic faults), and cartography (scale bar, border). Features carry a `visibility` field, but it only ever governed the Studio's own edit-mode highlighting — it never affected exported pixels — so pulling it into a separate tile would change nothing for players or the GM. The same reasoning keeps cartography and land masks in the background.
- **No new UI.** The export dialogue loses the "Create GM Overlay" checkbox (its job becomes automatic and per-layer); everything else about the export workflow is unchanged. GMs continue to show/hide layers with Foundry's existing tile eye-icon toggle.
- **The old single flat GM-overlay tile is retired, not kept alongside** the new per-layer tiles — one export path going forward.
- **No data model changes.** `visibility: "all" | "gm" | "none"` per entity remains the only source of truth; `customGroups` and per-entity `groups` arrays are deliberately deferred to Phase 2.

### Design

The current export pipeline (`StudioCanvas.extractCanvasBlob`) renders the whole PIXI stage twice: once with `renderPassMode = "player"` (background, minus grid/reference) and once with `renderPassMode = "gm"` (only `landMasks`/`regions`/`infrastructure`/`labels`, filtered to GM-only entities via `#isVisibleInCurrentPass`). `SceneExporter.run` takes the resulting `playerBlob` and optional `gmBlob` and creates the scene background plus, at most, one hidden GM-overlay `Tile`.

Phase 1 changes this in three ways:

1. The background ("player") pass additionally hides the `infrastructure`, `regions`, and `labels` layer containers — they're becoming their own tiles, so they must no longer be baked into the background.
2. A new per-layer extraction method captures each of those three layers on its own, against each visibility target that actually has content.
3. `SceneExporter` creates one `Tile` per non-empty layer/visibility pair instead of a single conditional overlay tile.

### Implementation Plan

#### [MODIFY] `src/canvas/StudioCanvas.js`

- Extend `extractCanvasBlob("player")`'s hide-list to also hide `this.layers.infrastructure`, `this.layers.regions`, and `this.layers.labels`. The whole-stage `"gm"` branch of `extractCanvasBlob` is no longer used for export (it's superseded by the method below) but its `renderPassMode` handling in `#isVisibleInCurrentPass` is exactly what that new method reuses, so it stays as-is.
- Add `async extractLayerBlob(layerKey, visibilityTarget)`:
  - Hides every layer container except `this.layers[layerKey]` (and always hides `reference`, as today).
  - Sets `this.renderPassMode` to `"player"` when `visibilityTarget === "all"`, or `"gm"` when `visibilityTarget === "gm"` — this reuses the existing leaf-level resolution in `#isVisibleInCurrentPass` rather than inventing a third pass mode.
  - Renders at the same oversampled resolution as the background capture (so the tile lines up pixel-for-pixel at `(0,0)` against the background, per the dimensional-alignment rule below), then restores layer visibility and `renderPassMode` afterwards, mirroring the existing restore block.
- Extract the visibility-override rule currently inline in `#isVisibleInCurrentPass` ("if a parent is GM-only, a child can't be player-visible") into a small, pure, exported helper — e.g. `resolveEffectiveVisibility(visibility, parentVisibility)` in `config.js` or a new `VisibilityRules.js`. `#isVisibleInCurrentPass` calls it for rendering; the new emptiness check below calls the same function for its non-rendering scan. Keeping one function means the two can't silently drift apart as this feature grows in Phase 2.

#### [MODIFY] `src/applications/SceneExporter.js`

- Add a static `getExportableLayers(app)` — pure, no PIXI — that scans `app.mapRoutes`, `app.mapPins`, `app.regionLayers` (including each region's own visibility under its parent layer's), and `app.mapLabels` plus the nested `.label.visibility` on pins/routes/regions, using `resolveEffectiveVisibility`. It returns, for `infrastructure`, `regions`, and `labels`, whether each has any `"all"`-visible or `"gm"`-visible content. This is the "only generate a tile if there's something to export" check.
- Refactor `run(app, config, playerBlob, layerBlobs)` — replace the single `gmBlob` parameter with a `layerBlobs` map, e.g. `{ infrastructure: { all: Blob|null, gm: Blob|null }, regions: {...}, labels: {...} }`, populated only for non-empty entries.
- `#createScene` creates one `Tile` per present entry instead of the single conditional GM-overlay tile. Each tile is flagged `flags["filrodens-world-map-builder"].exportLayer = layerKey` and `.visibility = "all" | "gm"` — this naming deliberately echoes the `customGroupId` flag Phase 2 will introduce, so Phase 2's HUD can be extended to also recognise Phase 1 tiles rather than needing an incompatible second flag scheme.
- Every tile anchors at `(0,0)`, sized to `mapWidth × mapHeight`, matching the existing background exactly. `"gm"` tiles are created `hidden: true, locked: true` (as today's single overlay tile is); `"all"` tiles are created `hidden: false, locked: true`, since that content is meant to be visible immediately rather than requiring the GM to remember to reveal it.
- The re-export cleanup logic currently matches old tiles by `texture.src.includes("_gm.png")` — generalise this to match by the presence of `flags["filrodens-world-map-builder"].exportLayer`, so re-exporting a scene replaces every Phase 1 tile cleanly instead of leaving orphans (the filename-substring match would miss the new per-layer files entirely).

#### [MODIFY] `src/applications/MapStudioApp.js`

- `_onExportScene`: drop `createGmOverlay` from the config object read off the dialogue form.
- `#executeSceneExportPipeline`: after the existing player-pass capture, call `SceneExporter.getExportableLayers(app)`. Capture every non-empty `"all"` layer blob under the *same* `"player"` render pass already active for the background — no extra repaint needed, since `renderPassMode` hasn't changed. Only if at least one layer has GM-only content, switch to `renderPassMode = "gm"`, call `_repaintVectors()` once, yield for the GPU upload (as today), and capture every non-empty `"gm"` layer blob. This keeps the pipeline to at most two repaints total, regardless of how many of the six possible blobs actually get generated.

#### [MODIFY] `templates/dialogs/export-scene.hbs`

- Remove the "Create GM Overlay" checkbox and its associated label/hint. Everything else in the dialogue (scene name, export folder, generate/overwrite journals) is unchanged. (HBS/CSS — over to you.)

### Verification Plan

**Automated Tests:** N/A — proceeding with manual verification, consistent with this module's existing convention.

**Manual Verification:**

- A map with only "all"-visibility infrastructure/regions/labels and no GM-only content exports the background plus one tile per non-empty layer, all visible immediately, and creates no GM tiles at all.
- A map mixing `all`/`gm`/`none` across pins, routes, and region layers — including a GM-only parent region layer with an "all" child region, to exercise the hierarchy-override rule — plus independently-toggled labels on a pin, a route, and a region, exports exactly the tiles that rule implies, GM tiles hidden, matching what the Studio's own player/GM view filters already show.
- A layer with zero GM-only content produces no empty transparent GM tile for that layer (and the same check for an empty "all" pass).
- Re-exporting the same scene replaces the previous Phase 1 tiles (matched by flag) rather than duplicating them.
- The background tile contains no infrastructure/regions/labels pixels at all — nothing doubles up between the background and the new tiles.
- Land masks, features (rivers/faults), and cartography still render in the background exactly as before this change.

---

## Phase 2 (Future, targeting v3.0.0) — Advanced Layer Grouping & Live-Play HUD

This is the full scope Ken originally drafted, unchanged in substance. It replaces the binary `visibility` model for export purposes with user-defined, many-to-many groups, and adds a live-play HUD for toggling them.

### How Phase 1 sets up Phase 2

- `resolveEffectiveVisibility` becomes the one place visibility resolution lives; Phase 2's group-aware equivalent (checking `groups` membership instead of the `all`/`gm`/`none` enum) sits alongside it rather than replacing tangled inline logic.
- `SceneExporter.getExportableLayers` becomes `SceneExporter.getExportableGroups` — the same "don't export what's empty" shape, just iterating `customGroups` instead of a fixed three-layer list.
- The `exportLayer`/`visibility` Tile flags Phase 1 introduces are a subset of the `customGroupId` scheme Phase 2 needs; `MultiTileHUD` can treat a Phase-1-only scene (no custom groups defined) as each layer being its own implicit group, so scenes exported under Phase 1 don't need re-exporting once Phase 2 ships.
- Nothing in Phase 1 needs to be undone or reworked — Phase 2 is additive on top of it.

### Design

#### 1. Overview and Objectives

The objective is to implement a tag-based grouping system that allows users to seamlessly assign entities to custom layers. These layers will be exported as perfectly aligned, independent Foundry `Tile` documents. A companion HUD will be introduced to allow the GM to toggle these layers dynamically without opening standard document configuration dialogues.

#### 2. Data Architecture

- **Group Definitions:** A new `customGroups` array will be added to `uiState` to store user-defined layers. Each group object will contain an `id`, `name`, and local canvas `visibility` state.
- **Entity Tagging:** All vector entities (Pins, Routes, Regions, Labels) will receive a new `groups` array property storing the `id` strings of their assigned custom groups.
- **Backward Compatibility:** The existing baseline `visibility` property remains intact to handle default rendering for entities not assigned to any custom group.

#### 3. Map Studio User Experience

- **The Group Manager:** A new section at the top of the context sidebar will display the user's custom groups as compact cards, each with a visibility toggle, a drag handle, and a deletion button.
- **The Tagging Workflow:** Users will drag a Group Card and drop it onto a target Feature Card. Foundry's native `DragDrop` API intercepts the payload and pushes the group ID into the target entity's `groups` array. Dropping onto a full list (rather than a single card) pushes the group ID to every item in that list, after a confirmation dialogue.
- **Visual Feedback:** DOM highlighting of the target feature list/card, plus a WebGL highlight on the canvas via `this.canvasEngine.showActionPreview(bounds)`.
- **Tag Removal:** Group badges on Feature Cards get an 'x' icon for one-click removal.

#### 4. The Export Pipeline

- **Dynamic Export UI:** The static "Create GM Overlay" checkbox (already removed in Phase 1) is replaced with an iterative list of custom groups, letting the user pick exactly which groups compile into tiles.
- **Extraction Loop:** `SceneExporter` loops through selected group IDs, instructing `StudioCanvas` to hide non-member entities and extract a transparent PNG per group.
- **Dimensional Alignment:** All extracted tiles strictly match the background's dimensions and anchor at `(0,0)`.

#### 5. In-Game Live Play HUD

- **Custom SceneControl:** A new control icon in the primary Foundry toolbar (or a floating HUD element).
- **Tri-State Management:** Each exported layer offers Hidden / GM-Only / Player-Visible, styled as a segmented control to avoid inadvertently flashing a layer to players while toggling.
- **Exploration vs. Tactical Modes:** Master toggles to suppress native Scene Grid and Map Note rendering locally.

### Implementation Plan

#### [MODIFY] `src/applications/MapStateManager.js`

- Update `buildDefaultUiState` to include `customGroups: []`.
- Each custom group object: `{ id: string, name: string }`. The baseline `visibility` property stays separate, governing standard Studio display for backward compatibility.
- Ensure newly created entities (Pins, Routes, Regions) initialise with a `groups: []` property.

#### [NEW] `templates/parts/toolbar-export.hbs`

- New sidebar template for the Export workflow, top to bottom: Group Manager (badge row), Tagging Interface (CSS Grid of feature lists, each `overflow-y: auto`), Export Options, Export Button.

#### [MODIFY] `src/applications/MapStudioApp.js` & Sidebar Styling

- Integrate the new export sidebar, adjustable/wider to fit the grid of feature lists.
- Native HTML5 drag-and-drop listeners (`dragstart`, `dragenter`, `drop`) for tagging.
- DOM + canvas visual feedback as described above.
- Standard feature cards in other tools will not display group tags.

#### [DELETE] `templates/dialogs/export-scene.hbs`

- Removed — superseded by the new export sidebar tool.

#### [MODIFY] `src/applications/SceneExporter.js`

- Refactor `run` to accept a list of custom groups instead of the Phase 1 fixed-layer map.
- Instruct `StudioCanvas` to extract a specific group by changing visibility parameters and capturing a blob per group.
- Loop over exported blobs and create aligned `Tile` documents; flag each with `flags["filrodens-world-map-builder"].customGroupId = group.id`.

#### [MODIFY] `src/canvas/StudioCanvas.js`

- Add `extractGroupCanvas(groupId)`.
- Update the visibility resolution (by now the shared `resolveEffectiveVisibility` helper plus a groups-aware check) to respect group assignments when extracting a specific group layer.

#### [NEW] `src/applications/MultiTileHUD.js`

- New Foundry `Application` subclass for the minimal GM HUD — a standard floating, movable Foundry window.
- Reads the active Scene's Tiles, identifying those with `flags["filrodens-world-map-builder"].customGroupId` (and Phase 1's `exportLayer`/`visibility` flags, treated as implicit single-entity groups).
- 3 styled radio buttons (Hidden, GM-Only, Player) per layer found, styled as segmented controls.
- Master toggles for Scene Grid and Map Notes.

#### [MODIFY] `src/hooks/sidebar-injection.js`

- Inject a new button adjacent to the "Create Map" button in the Scene Directory sidebar to launch the Multi-Tile HUD.
- Initialise the HUD and wire up the toggle logic.

### Verification Plan

**Automated Tests:** N/A — proceeding with manual verification.

**Manual Verification:**

- **Group Management:** Creating, renaming, and deleting groups within the Export Sidebar badges row.
- **Tagging:** Drag-and-drop of badges onto feature lists or individual items; DOM/canvas feedback and scroll handling.
- **Exporting:** Run the scene exporter.
- **Scene Tiles:** The generated Scene contains precisely aligned `Tile` documents per custom group, correctly flagged.
- **Live Play HUD:** Launch from the Scene Directory. Toggle radio buttons per layer and confirm players see the correct state (Hidden vs Player Visible), the GM sees "GM-Only" locally without flashing "Player" state in between, and the grid/notes master toggles work.
