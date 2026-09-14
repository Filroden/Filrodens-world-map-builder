# Advanced Layer Grouping & Multi-Tile Export

**Document Version:** 4.0
**Status:** Backlogged — unscheduled, no committed release. Not driven by user feedback; this was Ken's own idea, and on reflection the cost/value case doesn't hold up well enough to commit engineering time against requested features. Kept here as a design record in case it's revisited, either as a future Foundry feature or as a standalone tool (see below) — not as an active plan.

### Why this was backlogged (2026-09-14)

- **No user demand.** Nobody asked for this; it came from Ken's own speculation about GM workflow. For a solo-maintained module, unscheduled backlog is the right home for internally-generated ideas competing against user-requested work.
- **Phase 1 doesn't actually have a cheap version.** The original Phase 2 design below already called this out under "In-Game Live Play HUD": *"Due to regressions in Foundry V14 regarding rapid Tile placeable visibility toggling, relying on the core UI is insufficient for a seamless experience."* The Phase 1 plan that was drafted after this document leaned on native Foundry tile controls (select tile → HUD → Toggle Visibility) specifically to avoid building a custom control — but that's exactly the workflow this document already flagged as too clunky for rapid use, and it only gets worse once there are six tiles to manage instead of one. There's no version of this feature that delivers real value without at least the live-play HUD, which removes the option of a genuinely minimal first slice.
- **Phase 2 is a lot of net-new surface for a speculative feature.** A many-to-many tagging data model, a drag-and-drop sidebar rewrite, and a new HUD Application are substantial investment to hang on a feature with no confirmed demand.
- **This might be a better fit as a standalone tool than a Foundry module feature.** Built outside Foundry (a web app, say), it wouldn't be constrained by Tile documents, `Application` windows, or the v14 tile-toggle regression above — it could implement whatever reveal workflow it wanted, and could target any VTT or none. That's a genuinely different product, not a module feature, so it's noted here rather than folded into this module's roadmap.

The original design below (previously "Phase 2", now the whole of the backlogged concept) is preserved as-is for reference.

---

## Advanced Layer Grouping & Multi-Tile Export (unscheduled concept)

This is the full scope Ken originally drafted, unchanged in substance. It would replace the binary `visibility` model for export purposes with user-defined, many-to-many groups, and add a live-play HUD for toggling them. A smaller "just split the existing layers into all/GM tile pairs" first slice was considered and rejected — see "Why this was backlogged" above; there's no cheap version of this that delivers value without also building the HUD, since native Foundry tile controls aren't good enough for toggling several tiles quickly during play.

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

- **Dynamic Export UI:** The static "Create GM Overlay" checkbox is replaced with an iterative list of custom groups, letting the user pick exactly which groups compile into tiles.
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

- Refactor `run` to accept a list of custom groups instead of a single `gmBlob`.
- Instruct `StudioCanvas` to extract a specific group by changing visibility parameters and capturing a blob per group.
- Loop over exported blobs and create aligned `Tile` documents; flag each with `flags["filrodens-world-map-builder"].customGroupId = group.id`.

#### [MODIFY] `src/canvas/StudioCanvas.js`

- Add `extractGroupCanvas(groupId)`.
- Update the visibility resolution (by now the shared `resolveEffectiveVisibility` helper plus a groups-aware check) to respect group assignments when extracting a specific group layer.

#### [NEW] `src/applications/MultiTileHUD.js`

- New Foundry `Application` subclass for the minimal GM HUD — a standard floating, movable Foundry window.
- Reads the active Scene's Tiles, identifying those with `flags["filrodens-world-map-builder"].customGroupId`.
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
