# Advanced Layer Grouping & Multi-Tile Export

**Document Version:** 1.0
**Target Release:** 3.0.0
**Context:** This document outlines the architectural and user-experience design for transitioning the module from a binary visibility model (Player/GM) to a many-to-many tag-based grouping system, culminating in a multi-tile export pipeline and a custom in-game control HUD.

## 1. Overview and Objectives

The current architecture relies on a strict `visibility: "all" | "gm" | "none"` string property for vector entities. While functionally robust, it limits the Game Master's ability to categorise and reveal distinct contextual layers (e.g., "Political Borders", "Trade Routes", "Hidden Bandit Camps") independently during live play.

The objective of this feature is to implement a tag-based grouping system that allows users to seamlessly assign entities to custom layers. These layers will be exported as perfectly aligned, independent Foundry `Tile` documents. A companion HUD will be introduced to allow the GM to toggle these layers dynamically without opening standard document configuration dialogues.

## 2. Data Architecture

The underlying data model will be extended without mutating the existing baseline visibility mechanics.

- **Group Definitions:** A new `customGroups` array will be added to `uiState` to store user-defined layers. Each group object will contain an `id`, `name`, and local canvas `visibility` state.
- **Entity Tagging:** All vector entities (Pins, Routes, Regions, Labels) will receive a new `groups` array property storing the `id` strings of their assigned custom groups.
- **Backward Compatibility:** The existing baseline `visibility` property will remain intact to handle default rendering for entities that have not been assigned to any custom group.

## 3. Map Studio User Experience

The user interface will prioritise spatial economy and native HTML drag-and-drop interactions to prevent UI clutter and reduce click fatigue.

- **The Group Manager:** A new section at the top of the context sidebar will display the user's custom groups as compact cards. Each card will feature a visibility toggle (for local canvas previewing), a drag handle, and a deletion button.
- **The Tagging Workflow:** Instead of complex dropdowns, users will drag a Group Card and drop it onto a target Feature Card in the existing tool accordions. Foundry's native `DragDrop` API will be leveraged to intercept the payload and push the group ID into the target entity's `groups` array. In addition, if a tag is dropped on the group (rather than a feature card within it), the group ID will be pushed to all items in that feature list (after a confirmation dialogue, as this is a difficult action to undo).
- **Visual Feedback:** [To be determined - need some mechanism to show which feature is about to be tagged, ideally while the tag is hovering over the feature list or the feature card. This is likely to be a combination of DOM highlighting in the sidebar of either the feature list or the card being hovered over, plus a WebGL aspect to show the feature on the map using the existing `this.canvasEngine.showActionPreview(bounds)` method.]
- **Tag Removal:** Group badges on the Feature Cards will feature an interactive 'x' icon, allowing rapid removal of a tag with a single click.

## 4. The Export Pipeline

The `SceneExporter` utility will be refactored to iterate over dynamic user data rather than hardcoded passes, cleanly decoupling the extraction logic from the application state.

- **Dynamic Export Dialogue:** The `export-scene.hbs` template will be updated. The static "Create GM Overlay" checkbox will be replaced with an iterative list of all custom groups, allowing the user to select exactly which layers to compile into tiles.
- **Extraction Loop:** `SceneExporter` will loop through the selected group IDs. For each ID, it will instruct the `StudioCanvas` to hide all non-member entities, extract the WebGL buffer to a transparent PNG, and map it to a new `Tile` payload.
- **Dimensional Alignment:** All extracted tiles will strictly match the parent background's dimensions and anchor at coordinate `(0,0)`, guaranteeing perfect spatial alignment regardless of where the tagged entities are located on the map.

## 5. In-Game Live Play HUD

Due to regressions in Foundry V14 regarding rapid `Tile` placeable visibility toggling, relying on the core UI is insufficient for a seamless experience. A native, lightweight control layer will be introduced for the GM.

- **Custom SceneControl:** The module will inject a new control icon into the primary Foundry toolbar (tied to the Token layer or as a floating HUD element on the canvas).
- **Tri-State Management:** Clicking the control will open a minimal HUD listing the exported custom layers. Each layer will offer a tri-state toggle:
  - **Hidden:** Invisible to all.
  - **GM-Only:** Rendered locally for the Game Master via an opacity/alpha override, without broadcasting visibility to connected clients.
  - **Player Visible:** Fully revealed via standard Foundry document updates.

- **Exploration vs. Tactical Modes:** The HUD will optionally include master toggles to suppress native Scene Grid and Map Note rendering locally, allowing the GM to switch between a clean "Exploration" view and a granular "Tactical" view instantly.
