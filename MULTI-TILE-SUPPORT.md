# Advanced Layer Grouping & Multi-Tile Export

**Document Version:** 2.0
**Target Release:** 3.0.0
**Context:** This document outlines the architectural and user-experience design for transitioning the module from a binary visibility model (Player/GM) to a many-to-many tag-based grouping system, culminating in a multi-tile export pipeline and a custom in-game control HUD. It includes an initial implementation plan.

## Design

### 1. Overview and Objectives

The current architecture relies on a strict `visibility: "all" | "gm" | "none"` string property for vector entities. While functionally robust, it limits the Game Master's ability to categorise and reveal distinct contextual layers (e.g., "Political Borders", "Trade Routes", "Hidden Bandit Camps") independently during live play.

The objective of this feature is to implement a tag-based grouping system that allows users to seamlessly assign entities to custom layers. These layers will be exported as perfectly aligned, independent Foundry `Tile` documents. A companion HUD will be introduced to allow the GM to toggle these layers dynamically without opening standard document configuration dialogues.

### 2. Data Architecture

The underlying data model will be extended without mutating the existing baseline visibility mechanics.

- **Group Definitions:** A new `customGroups` array will be added to `uiState` to store user-defined layers. Each group object will contain an `id`, `name`, and local canvas `visibility` state.
- **Entity Tagging:** All vector entities (Pins, Routes, Regions, Labels) will receive a new `groups` array property storing the `id` strings of their assigned custom groups.
- **Backward Compatibility:** The existing baseline `visibility` property will remain intact to handle default rendering for entities that have not been assigned to any custom group.

### 3. Map Studio User Experience

The user interface will prioritise spatial economy and native HTML drag-and-drop interactions to prevent UI clutter and reduce click fatigue.

- **The Group Manager:** A new section at the top of the context sidebar will display the user's custom groups as compact cards. Each card will feature a visibility toggle (for local canvas previewing), a drag handle, and a deletion button.
- **The Tagging Workflow:** Instead of complex dropdowns, users will drag a Group Card and drop it onto a target Feature Card in the existing tool accordions. Foundry's native `DragDrop` API will be leveraged to intercept the payload and push the group ID into the target entity's `groups` array. In addition, if a tag is dropped on the group (rather than a feature card within it), the group ID will be pushed to all items in that feature list (after a confirmation dialogue, as this is a difficult action to undo).
- **Visual Feedback:** [To be determined - need some mechanism to show which feature is about to be tagged, ideally while the tag is hovering over the feature list or the feature card. This is likely to be a combination of DOM highlighting in the sidebar of either the feature list or the card being hovered over, plus a WebGL aspect to show the feature on the map using the existing `this.canvasEngine.showActionPreview(bounds)` method.]
- **Tag Removal:** Group badges on the Feature Cards will feature an interactive 'x' icon, allowing rapid removal of a tag with a single click.

### 4. The Export Pipeline

The `SceneExporter` utility will be refactored to iterate over dynamic user data rather than hardcoded passes, cleanly decoupling the extraction logic from the application state.

- **Dynamic Export Dialogue:** The `export-scene.hbs` template will be updated. The static "Create GM Overlay" checkbox will be replaced with an iterative list of all custom groups, allowing the user to select exactly which layers to compile into tiles.
- **Extraction Loop:** `SceneExporter` will loop through the selected group IDs. For each ID, it will instruct the `StudioCanvas` to hide all non-member entities, extract the WebGL buffer to a transparent PNG, and map it to a new `Tile` payload.
- **Dimensional Alignment:** All extracted tiles will strictly match the parent background's dimensions and anchor at coordinate `(0,0)`, guaranteeing perfect spatial alignment regardless of where the tagged entities are located on the map.

### 5. In-Game Live Play HUD

Due to regressions in Foundry V14 regarding rapid `Tile` placeable visibility toggling, relying on the core UI is insufficient for a seamless experience. A native, lightweight control layer will be introduced for the GM.

- **Custom SceneControl:** The module will inject a new control icon into the primary Foundry toolbar (tied to the Token layer or as a floating HUD element on the canvas).
- **Tri-State Management:** Clicking the control will open a minimal HUD listing the exported custom layers. Each layer will offer a tri-state toggle:
  - **Hidden:** Invisible to all.
  - **GM-Only:** Rendered locally for the Game Master via an opacity/alpha override, without broadcasting visibility to connected clients.
  - **Player Visible:** Fully revealed via standard Foundry document updates.

- **Exploration vs. Tactical Modes:** The HUD will optionally include master toggles to suppress native Scene Grid and Map Note rendering locally, allowing the GM to switch between a clean "Exploration" view and a granular "Tactical" view instantly.

## Implementation Plan

### Data Architecture

We will extend the base data model to support a many-to-many tag relationship specifically for the export pipeline.

#### [MODIFY] [MapStateManager.js](file:///d:/Google%20Drive/Programming/github/Filrodens-world-map-builder/src/applications/MapStateManager.js)

- Update `buildDefaultUiState` to include `customGroups: []`.
- Each custom group object will have `{ id: string, name: string }`. The original visibility property ("all" | "gm" | "none") will remain separate to govern standard studio display, ensuring backward compatibility.
- Ensure newly created entities (Pins, Routes, Regions) are initialized with a `groups: []` property for tagging.

### Map Studio User Experience

We will refactor the scene export UI from a dialog into a dedicated, adjustable-width sidebar tool. This ensures custom group management is self-contained within the export workflow.

#### [NEW] [toolbar-export.hbs](file:///d:/Google%20Drive/Programming/github/Filrodens-world-map-builder/templates/parts/toolbar-export.hbs)

- Create a new sidebar template for the Export workflow.
- **Layout (Top to Bottom):**
  1. **Group Manager:** A row of created group "badges" with small gaps, taking up minimal height. Badges can be added/deleted here.
  2. **Tagging Interface:** A CSS Grid layout of feature lists (Pins, Routes, Regions) side-by-side.
     - Group badges can be dragged onto the full list or individual items.
     - Each list container will have `overflow-y: auto` (or similar max-height scroll handling) so the sidebar does not become endlessly long.
  3. **Export Options:** Toggles for journals, overwriting, etc.
  4. **Export Button.**

#### [MODIFY] [MapStudioApp.js](file:///d:/Google%20Drive/Programming/github/Filrodens-world-map-builder/src/applications/MapStudioApp.js) & Sidebar Styling

- Integrate the new export sidebar, making it adjustable or significantly wider to accommodate the grid layout of feature lists.
- Add native HTML5 drag-and-drop listeners (`dragstart`, `dragenter`, `drop`) for tagging.
- **Visual Feedback:**
  - **DOM:** Highlight the target list item or full list container in the sidebar when dragging a group over it.
  - **Canvas:** Highlight the target object on the WebGL canvas using the existing `this.canvasEngine.showActionPreview(bounds)` method to ensure the correct feature is being tagged.
- *Note: Standard feature cards in other tools will not display group tags.*

---

### Export Pipeline

We will adapt the export process to iterate dynamically over defined groups.

#### [DELETE] [export-scene.hbs](file:///d:/Google%20Drive/Programming/github/Filrodens-world-map-builder/templates/dialogs/export-scene.hbs)

- Remove the old dialog template as it is superseded by the new export sidebar tool.

#### [MODIFY] [SceneExporter.js](file:///d:/Google%20Drive/Programming/github/Filrodens-world-map-builder/src/applications/SceneExporter.js)

- Refactor `run` to accept a list of custom groups instead of a single `gmBlob`.
- Instruct `StudioCanvas` to extract a specific group by changing visibility parameters and capturing a blob for each group.
- Loop over exported blobs and create aligned `Tile` documents on the Foundry Scene.
- **Tile Flagging:** Store the group information natively on the Tile document using `flags["filrodens-world-map-builder"].customGroupId = group.id`.

#### [MODIFY] [StudioCanvas.js](file:///d:/Google%20Drive/Programming/github/Filrodens-world-map-builder/src/canvas/StudioCanvas.js)

- Add a method to extract a specific group (`extractGroupCanvas(groupId)`).
- Update `#isVisibleInCurrentPass` to respect group assignments when extracting a specific group layer.

### In-Game Live Play HUD

We will create a floating control HUD included within this module for the GM to toggle exported layers safely.

#### [NEW] [MultiTileHUD.js](file:///d:/Google%20Drive/Programming/github/Filrodens-world-map-builder/src/applications/MultiTileHUD.js)

- Create a new Foundry `Application` subclass for the minimal GM HUD. It will be a standard floating, movable Foundry window.
- Read the active Scene's Tiles, identifying those with `flags["filrodens-world-map-builder"].customGroupId`.
- Provide **3 styled radio buttons** (Hidden, GM-Only, Player) for each layer found, styled as segmented controls to prevent inadvertently flashing a layer to players while toggling.
- Include master toggles for Scene Grid and Map Notes.

#### [MODIFY] [sidebar-injection.js](file:///d:/Google%20Drive/Programming/github/Filrodens-world-map-builder/src/hooks/sidebar-injection.js)

- Inject a new button adjacent to the "Create Map" button in the Scene Directory sidebar to launch the Multi-Tile HUD.
- Initialize the HUD and wire up the toggle logic.

## Verification Plan

### Automated Tests

- N/A - Proceeding with manual verification.

### Manual Verification

- **Group Management:** Verify creating, renaming, and deleting groups works within the new Export Sidebar badges row.
- **Tagging:** Drag and drop badges onto feature lists or individual items. Verify visual feedback (DOM & Canvas) and scroll handling.
- **Exporting:** Run the scene exporter.
- **Scene Tiles:** Verify that the generated Foundry Scene contains precisely aligned `Tile` documents for each custom group, with the correct flags applied.
- **Live Play HUD:** Launch the HUD from the Scene Directory. Toggle the radio buttons for layers and verify that players see the correct state (Hidden vs Player Visible), and the GM sees the "GM-Only" state locally (without flashing "Player" state in between). Verify the grid and notes master toggles work.
