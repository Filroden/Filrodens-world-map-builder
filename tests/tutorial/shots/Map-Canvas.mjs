// The Map Canvas page: the overlays, the map controls, the Detail and Thematic layers menus, and
// the 3D view.
import { ESCAPE, MAP, menuButton } from "./_common.mjs";

export default [
    {
        slug: "map-canvas-overlays",
        start: MAP.places,
        caption: "The map's overlays: the information bar (top left), undo and redo (top right), the hint for the Regions tool's Paint mode (bottom left) and the map controls (bottom right).",
        action: [
            { do: "tool", tool: "regions" },
            { do: "click", target: '.fwmb-set-row:has(:text-is("Lands"))' },
            { do: "click", target: '.fwmb-region-row:has(:text-is("The Red Hills"))' },
            { do: "mode", action: "setRegionMode", mode: "paint" },
            { do: "click", target: "dialog.fwmb-inspector[open] .fwmb-overlay-close" },
            { do: "camera", view: "fit" },
            { do: "hover", at: [1150, 500] },
        ],
        screenshot: { region: "map", pointer: [1150, 500] },
    },
    {
        slug: "map-canvas-controls",
        start: MAP.terrain,
        caption: "The map controls with the Terrain layers menu open and Relief shading off.",
        action: [
            { do: "click", target: menuButton("Terrain layers") },
            { do: "click", target: '[role="menuitemcheckbox"]:has-text("Relief shading")' },
        ],
        settle: false,
        screenshot: { region: { selector: ".fwmb-map-controls" }, pad: 260 },
    },
    {
        slug: "map-canvas-detail",
        start: MAP.generated,
        caption: "The Detail menu over the generated world map at Province: the five levels, Avoid overlaps and Symbol size.",
        action: [{ do: "click", target: menuButton("Detail") }],
        settle: false,
        screenshot: { region: "map" },
        after: [ESCAPE],
    },
    {
        slug: "map-canvas-thematic",
        start: MAP.generated,
        caption: "Population at 70% with the region fills off: the information bar reads the value under the pointer, and the legend marks it.",
        action: [
            { do: "click", target: menuButton("Regions") },
            { do: "click", target: '[data-action="toggleContentRow"][data-content-kind="fills"]' },
            ESCAPE,
            { do: "click", target: menuButton("Thematic layers") },
            { do: "click", target: '[data-action="setThematicFill"][data-thematic-layer="population"]' },
            { do: "hover", at: [1250, 625] },
        ],
        screenshot: { region: "map", pointer: [1250, 625] },
    },
    {
        slug: "map-canvas-3d-view",
        start: MAP.terrain,
        fresh: true,
        caption: "The 3D view of the tutorial's world, with Relief emphasis at the top and the 3D hint at the bottom.",
        action: [
            { do: "click", target: ".fwmb-rail-more > .fwmb-rail-btn" },
            { do: "click", target: '[role="menuitemcheckbox"][data-action="threeDView"]' },
            { do: "settle" },
        ],
        screenshot: { region: "studio", pointer: "keep" },
    },
];
