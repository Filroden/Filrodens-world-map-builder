/**
 * What the World studio registers with the shell (see StudioRegistry.defineStudio): its map
 * types, the rail's stages and the tools in them, the occasional tools at the rail's foot, each
 * tool's Next footer and what its editing does (its state word).
 *
 * In S0 a world has its Surface map only. History and Travel are registered in Explore mode; until
 * the mode switch arrives (S0 step 3) the rail draws every mode's stages, so they keep their v4.3
 * place as the Explore stage. Reference image, Styles and icons and Maps are occasional tools (no
 * stage); Maps sits with the file actions at the rail's foot (see templates/shell/toolbar.hbs).
 */
import { defineStudio } from "../../shell/StudioRegistry.js";

const SURFACE = ["surface"];

/** A tool on the Surface map, in Create unless said. */
const tool = (id, stage, icon, label, { mode = "create", next = null, stateWord = null } = {}) => ({ id, stage, mode, icon, label, mapTypes: SURFACE, next, stateWord });
const next = (toolId, reason) => ({ tool: toolId, reason });

export const WORLD_DEFINITION = defineStudio({
    id: "world",
    label: "FILRODENSWMB.UI.StudioWorld",
    mapTypes: ["surface"],
    // The panel's header numbers each stage's tools in order ("Shape · 2 of 4") except Populate's,
    // which are worked in any order; Explore's tools are outside the order of work (no Next leads
    // to them)
    stages: [
        { id: "shape", label: "FILRODENSWMB.UI.StageShape" },
        { id: "populate", label: "FILRODENSWMB.UI.StagePopulate", numbered: false },
        { id: "finish", label: "FILRODENSWMB.UI.StageFinish" },
        { id: "explore", label: "FILRODENSWMB.UI.StageExplore", numbered: false, optional: true },
    ],
    // What the pointer does while a tool is editing, named in the state block and on the bar: a
    // word per tool, or per mode where the tool's modes do different things (STATE_WORDS gives each
    // word's strings). Cartography has no edit toggle (its decorations can always be moved), so its
    // word stands for the tool. Tools with none have no editing at all.
    tools: [
        tool("scene", "shape", "grid-on", "FILRODENSWMB.UI.ToolCreateMap", { next: next("terrain", "FILRODENSWMB.UI.NextReasonScene"), stateWord: { addMask: "drawing", subtractMask: "drawing", coastMask: "drawing", crop: "cropping" } }),
        tool("terrain", "shape", "landscape", "FILRODENSWMB.UI.ToolTerrain", { next: next("biomes", "FILRODENSWMB.UI.NextReasonTerrain"), stateWord: "terraforming" }),
        tool("biomes", "shape", "forest", "FILRODENSWMB.UI.ToolBiomes", { next: next("features", "FILRODENSWMB.UI.NextReasonBiomes"), stateWord: "painting" }),
        // Select starts editing in River (see PickTool.settleForEditing)
        tool("features", "shape", "ssid-chart", "FILRODENSWMB.UI.ToolFeatures", { next: next("influences", "FILRODENSWMB.UI.NextReasonFeatures"), stateWord: { select: "drawing", spring: "placing", river: "drawing", fault: "drawing" } }),
        tool("influences", "populate", "tune", "FILRODENSWMB.UI.ToolInfluences", { next: next("generate", "FILRODENSWMB.UI.NextReasonInfluences"), stateWord: "painting" }),
        tool("generate", "populate", "generate", "FILRODENSWMB.UI.ToolGenerate", { next: next("regions", "FILRODENSWMB.UI.NextReasonGenerate") }),
        tool("regions", "populate", "pentagon", "FILRODENSWMB.UI.ToolRegions", { next: next("infrastructure", "FILRODENSWMB.UI.NextReasonRegions"), stateWord: "painting" }),
        tool("infrastructure", "populate", "location-city", "FILRODENSWMB.UI.ToolInfrastructure", { next: next("labels", "FILRODENSWMB.UI.NextReasonInfrastructure"), stateWord: { pin: "placing", route: "drawing" } }),
        tool("labels", "populate", "insert-text", "FILRODENSWMB.UI.ToolLabels", { next: next("cartography", "FILRODENSWMB.UI.NextReasonLabels"), stateWord: "placing" }),
        tool("cartography", "finish", "explore", "FILRODENSWMB.UI.ToolCartography", { next: next("export", "FILRODENSWMB.UI.NextReasonCartography"), stateWord: "placing" }),
        tool("export", "finish", "png", "FILRODENSWMB.UI.ToolExport"),
        tool("history", "explore", "history", "FILRODENSWMB.UI.ToolHistory", { mode: "explore" }),
        tool("travel", "explore", "travel-explore", "FILRODENSWMB.UI.ToolTravel", { mode: "explore" }),
        tool("reference", null, "image", "FILRODENSWMB.UI.ToolReference"),
        tool("library", null, "palette", "FILRODENSWMB.UI.ToolLibrary"),
        tool("manage", null, "folder-open", "FILRODENSWMB.UI.ToolManage"),
    ],
    // The occasional tools: the Appearance menu (the reader's colour theme, see AppearanceMenu)
    // sits among them, and on the web the full-screen toggle (shown only where the host can go
    // full screen)
    occasional: [
        { tool: "reference" },
        { tool: "library" },
        { menu: "appearance", icon: "contrast", label: "FILRODENSWMB.UI.Appearance" },
        { action: "threeDView", icon: "three-d", label: "FILRODENSWMB.UI.ThreeDView" },
        { action: "toggleFullscreen", icon: "fullscreen", label: "FILRODENSWMB.UI.FullScreen", host: "fullscreen" },
    ],
    // The engine is named in the header of the tools it shapes
    engineInHeader: ["scene", "terrain"],
});
