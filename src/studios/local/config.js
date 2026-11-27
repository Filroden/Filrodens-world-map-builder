import { KERNEL_PARTS } from "../../kernel/config.js";

// FILRODENSWMB split by layer (RF1): this file holds the Local studio's settings.
// src/config.js puts every layer's part back together in the shape the module has always read,
// so code importing it is unchanged.

/** The Local studio's own groups of FILRODENSWMB (two of LOCAL's settings are the World studio's: WORLD_PARTS). */
export const LOCAL_CONFIG = {
    // The Local studio (settlement maps; `claude/v5-l-surface-handoff.md`). The engine and renderer
    // read none of it: the studio passes what they need
    LOCAL: Object.freeze({
        // Workers building a settlement's four versions: one a core less one, between one and four,
        // so a core is always left for the window
        VERSION_WORKERS: Object.freeze({ MIN: 1, MAX: 4, RESERVED_CORES: 1 }),
        // The canvas's tiles, in pixels a side
        TILE_PX: 512,
        // A town wall's material by the people of the place (Ken, 2026-11-23): earth and palisade
        // below PALISADE_BELOW, stone from there; capitals and cities always stone (castles are
        // always drawn in stone)
        WALLS: Object.freeze({ PALISADE_BELOW: 3000, STONE_TIERS: Object.freeze(["capital", "city"]) }),
        // A version's card: its thumbnail's size in pixels (the frames' shape, 4 by 3)
        THUMBNAIL: Object.freeze({ widthPx: 640, heightPx: 480 }),
        // A version's build time as its card's progress bar guesses it (the engine reports none):
        // measured in step 1 at about 2.3 s and a further 0.09 ms a person (2,500 people 2.5 s,
        // 30,000 5 s, 325,000 32 s); the bar stops short of full until the version is ready
        BUILD_ESTIMATE: Object.freeze({ BASE_MS: 2300, MS_PER_PERSON: 0.09, MOST: 0.95 }),
        // Settlement maps built this session kept in their workers, so going back to one costs nothing
        KEEP_BUILT: 3,
        // Defined in the kernel's config (KERNEL_PARTS.MAX_SETTLEMENTS), which reads it too
        MAX_SETTLEMENTS: KERNEL_PARTS.MAX_SETTLEMENTS,
        // The canvas (SettlementCanvas): its finest detail in metres a pixel, the whole frame's
        // coarse picture's longer side, the delay before the drawing line shows, how many tiles are
        // kept and drawn at once, how far past the whole frame it zooms out, its wheel, keys and
        // zoom steps, and a tap: a press let go within TAP_PX of where it went down, within TAP_MS
        CANVAS: Object.freeze({ FINEST_M: 0.4, COARSE_PX: 2048, LINE_DELAY_MS: 500, KEEP_TILES: 160, AT_ONCE: 2, ROOM: 1.25, WHEEL: 0.0015, KEY_PAN_PX: 80, ZOOM_STEP: 1.5, TAP_PX: 5, TAP_MS: 500 }),
        // Households and supply (step 3): where a house stands, in metres from what it is named by
        // ("Cutler's house, on the market"), the nearest first; the trade groups the panel lists
        // before "n more…"; the card's gap from its house and from the canvas's edges (CSS pixels);
        // the index's cell (metres) for pointing at a house
        HOUSEHOLDS: Object.freeze({
            NEAR_M: Object.freeze({ market: 45, quay: 30, water: 25, gate: 45, worship: 35, castle: 60 }),
            TRADES_SHOWN: 5,
            CARD_GAP_PX: 12,
            INDEX_CELL_M: 40,
        }),
        // Out of date's tolerance on a settlement's supply (step 2b; see SettlementRecord.supplyOf):
        // a share of its need moved by more than SHARE, or the country's density by more than
        // DENSITY of itself. A change anywhere moves every place's supply a little
        SUPPLY_TOLERANCE: Object.freeze({ SHARE: 0.1, DENSITY: 0.25 }),
        // The views a settlement's worker draws (LocalTasks.viewFits): none coarser than the frame's
        // longer side over COARSEST a pixel, nor wider or taller than SPAN times it (a view of a far
        // larger area costs seconds and gigabytes for a picture that shows nothing)
        VIEW_LIMITS: Object.freeze({ COARSEST: 64, SPAN: 4 }),
        // A settlement map's export (step 5; Ken, 2026-11-25): 1× is M_PER_PX metres a pixel, the
        // scale it is drawn for (a house about 8 to 15 px across) and the one recommended; the
        // scale goes from the dialogue's least to Finest (the canvas's finest detail, 3.125×), its
        // stops labelled and MINOR ones a short tick; drawn by the worker in tiles of TILE_PX a
        // side and joined; the Area's presets, the first the default; the What row's kinds (Map
        // only and the report); and the settings the What, each kind's last preset and aspect and
        // the Legend checkbox are kept in (the format is the image export's)
        EXPORT: Object.freeze({
            M_PER_PX: 1.25,
            RECOMMENDED: 1,
            STOPS: Object.freeze([0.25, 1, 2]),
            MINOR: Object.freeze([0.5]),
            TILE_PX: 2048,
            PRESETS: Object.freeze(["town", "hinterland", "screen"]),
            KINDS: Object.freeze(["map", "report"]),
            SETTINGS: Object.freeze({
                WHAT: "exportWhatSettlement",
                PRESET: "exportPresetSettlement",
                ASPECT: "exportAspectSettlement",
                PRESET_REPORT: "exportPresetSettlementReport",
                ASPECT_REPORT: "exportAspectSettlementReport",
                LEGEND: "exportLegendSettlement",
            }),
            // The legend in an export (Ken, 2026-11-26): in the image's top-right corner, up to
            // ROWS keys a column in up to COLUMNS columns, then "and N others"
            LEGEND: Object.freeze({ ROWS: 8, COLUMNS: 2 }),
            // The report (board X3b; Ken, 2026-11-26): the parent map inset and the information
            // block in a column beside the map part, SIDE_PX across at least (the inset INSET_PX
            // high), GAP_PX apart and MARGIN_PX in from the paper's edge. On a larger map part the
            // column and everything in it grow together, so it takes SIDE_SHARE of the sheet's
            // width, unless that would make it taller than the map part. The block's type in px at
            // the least size.
            REPORT: Object.freeze({
                SIDE_PX: 720,
                INSET_PX: 540,
                GAP_PX: 24,
                MARGIN_PX: 24,
                SIDE_SHARE: 0.26,
                PAD_PX: 28,
                // The inset: at least INSET_FRAMES frames across round the settlement, PAD of the
                // box round what it shows, and never drawn past INSET_MAX_SCALE (the Surface map's
                // pins and names grow with the scale, as in its own exports)
                INSET_FRAMES: 4,
                INSET_PAD: 0.12,
                INSET_MAX_SCALE: 2,
                TYPE: Object.freeze({ heading: 30, sub: 17, title: 15, body: 17, foot: 14, line: 26 }),
            }),
        }),
    }),
};
