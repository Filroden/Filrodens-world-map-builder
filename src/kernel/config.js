// FILRODENSWMB split by layer (RF1): this file holds the kernel's settings, which every layer may read.
// src/config.js puts every layer's part back together in the shape the module has always read,
// so code importing it is unchanged.

/**
 * Settings the kernel reads that sit in another layer's group of FILRODENSWMB (labels, the
 * generator, settlement maps): each group takes its value from here, so it is defined once.
 */
export const KERNEL_PARTS = Object.freeze({
    // The size a label with none set is drawn at (LABELS.UNSET_SIZE: what size 1 was before
    // SYMBOLS.REVISION, so older maps look as they did)
    LABEL_UNSET_SIZE: 4,
    // A name's outline and shadow, in proportion to its height (pixels), within their limits,
    // so a small name keeps its letters and a large one looks as it did (see SymbolScale.labelHalo)
    LABEL_HALO: Object.freeze({ STROKE: 0.125, STROKE_MIN: 1, STROKE_MAX: 3, SHADOW: 1 / 12, SHADOW_MIN: 0.5, SHADOW_MAX: 2 }),
    // The settings a new run starts from (see GeneratorSettings): one age, high medieval and
    // troubled, the world multipliers at 1, Human Generic names.
    DEFAULT_NAME_BASE: "Human Generic",
    // Names: a name is retried this many times to avoid a duplicate before one is accepted
    NAME_RETRIES: 12,
    // The figures a reader enters on a settlement pin (see UserFigures): the largest population
    // the inspector takes
    USER_FIGURES: Object.freeze({ MAX_POPULATION: 10000000 }),
    // The most settlement maps a world file or backup may hold for one world
    MAX_SETTLEMENTS: 10000,
});

/** The kernel's own groups of FILRODENSWMB. */
export const KERNEL_CONFIG = {
    ID: "filrodens-world-map-builder",
    LIMITS: {
        HISTORY_MAX: 100,
        SNAP_THRESHOLD: 15,
        NOISE_SCALE_MIN: 100,
        NOISE_SCALE_MAX: 8000,
        NOISE_SCALE_STEP: 50,
        OVERFLOW_BUFFER: 100,
        BASELINE_DIMENSION: 1000,
        // The smallest grid size, in pixels. Foundry will not make a scene with a smaller grid
        // (its CONST.GRID_MIN_SIZE): a smaller size is raised to this when the scene is created,
        // so the map's own grid, and the grid data exported with the scene, must never go below it.
        MIN_GRID_SIZE: 20,
        CUSTOM_BIOME_START_ID: 14,
        // The fewest nodes a polygon (region or guided-mode land mask) needs to enclose an area.
        // A shape still below this when the user finishes drawing it is discarded, since it could
        // never be selected or edited as a shape, and terrain generation ignores land masks below it.
        MIN_POLYGON_VERTICES: 3,
        // The longest free text, in characters: what a field accepts (its maxlength), what an
        // export writes and what an import accepts. An export or import holding longer text is
        // refused rather than cut short, so nothing a user wrote is lost without them knowing.
        // Raise these to test with longer text; every check reads them from here.
        TEXT: {
            // Names of maps, pins, routes, regions, layers, sets, styles, biomes and the like,
            // and other one-line text (a seed, a title template, the scale bar's units)
            NAME: 200,
            // Descriptions of pins, routes, regions and faults (written into journal pages)
            DESCRIPTION: 20000,
            // The text of a standalone label
            LABEL: 500,
        },
        // What a file opened for import may hold. Anything past these is refused before it reaches
        // the map, so a damaged or hostile file cannot exhaust memory or stall the studio.
        IMPORT: {
            // The largest file read, in bytes
            FILE_BYTES: 268435456,
            // How deeply objects and arrays may nest
            DEPTH: 32,
            // How many values (objects, arrays, strings, numbers…) the file may hold in all
            VALUES: 10000000,
            // The longest array
            ARRAY_LENGTH: 2000000,
            // The longest string that is not free text (an embedded image, an encoded owner array)
            STRING_LENGTH: 67108864,
            // The smallest and largest map width or height, in pixels
            MAP_DIMENSION_MIN: 16,
            MAP_DIMENSION_MAX: 16384,
            // The longest id or key
            ID_LENGTH: 64,
        },
        // A backup of every saved map (a zip: manifest.json, maps/<id>.json, assets/<hash>.<ext>)
        BACKUP: {
            // A backup larger than this is offered without its images ("Maps only") as well
            WARN_BYTES: 209715200,
            // The largest backup file read, in bytes
            BYTES: 1073741824,
            // The most entries a backup may hold
            ENTRIES: 10000,
            // The most its entries may hold once unpacked, in bytes
            UNPACKED_BYTES: 2147483648,
            // An entry that unpacks to more than RATIO times its packed size is refused (a zip
            // bomb); entries unpacking to less than RATIO_FLOOR bytes are too small to matter
            RATIO: 100,
            RATIO_FLOOR: 1048576,
        },
        // Images a user picks or a file brings in (reference images, decorations, custom pin icons)
        IMAGE: {
            // The largest image file, in bytes
            BYTES: 33554432,
            // The widest or tallest image, in pixels
            DIMENSION: 8192,
        },
    },
    // The map's unit (see MapUnit): the name every distance the studio shows is labelled with. The
    // model measures in kilometres, and a figure is shown as that number of kilometres under the
    // map's own name for the unit, so the default is the name that makes the figure literally true.
    // The scale bar's Match world scale rounds the distance per major tick to one of NICE_STEPS
    // times a power of ten.
    MAP_UNIT: Object.freeze({
        DEFAULT: "km",
        NICE_STEPS: Object.freeze([1, 2, 5]),
    }),
    INFRASTRUCTURE_ICONS: {
        anchor: "FILRODENSWMB.ICONS.Anchor",
        bridge: "FILRODENSWMB.ICONS.Bridge",
        broadleaved_tree: "FILRODENSWMB.ICONS.BroadleavedTree",
        campsite: "FILRODENSWMB.ICONS.Campsite",
        cannon: "FILRODENSWMB.ICONS.Cannon",
        castle_keep: "FILRODENSWMB.ICONS.CastleKeep",
        castle: "FILRODENSWMB.ICONS.Castle",
        cave: "FILRODENSWMB.ICONS.Cave",
        cindercone_volcano_erupting: "FILRODENSWMB.ICONS.Volcano",
        circle: "FILRODENSWMB.ICONS.Circle",
        circle_outline: "FILRODENSWMB.ICONS.CircleOutline",
        circle_outline_with_dot: "FILRODENSWMB.ICONS.CircleDotOutline",
        circle_outline_with_dot_outline: "FILRODENSWMB.ICONS.CircleOutlineDotOutline",
        circle_outline_with_star: "FILRODENSWMB.ICONS.CircleOutlineStar",
        circle_with_dot: "FILRODENSWMB.ICONS.CircleDot",
        circle_with_dot_outline: "FILRODENSWMB.ICONS.CircleDotOutlineHollow",
        city_gate: "FILRODENSWMB.ICONS.CityGate",
        classical_building: "FILRODENSWMB.ICONS.ClassicalBuilding",
        column_shrine: "FILRODENSWMB.ICONS.Shrine",
        conifer_tree: "FILRODENSWMB.ICONS.ConiferTree",
        dagger: "FILRODENSWMB.ICONS.Dagger",
        domed_tower: "FILRODENSWMB.ICONS.DomedTower",
        dot: "FILRODENSWMB.ICONS.Dot",
        dot_outline: "FILRODENSWMB.ICONS.DotOutline",
        dot_with_rays_down: "FILRODENSWMB.ICONS.DotRaysDown",
        dot_with_rays_left: "FILRODENSWMB.ICONS.DotRaysLeft",
        dot_with_rays_right: "FILRODENSWMB.ICONS.DotRaysRight",
        dot_with_rays_up: "FILRODENSWMB.ICONS.DotRaysUp",
        exclamation_point: "FILRODENSWMB.ICONS.ExclamationPoint",
        fence: "FILRODENSWMB.ICONS.Fence",
        flagstick_with_pennant: "FILRODENSWMB.ICONS.FlagstickPennant",
        fortress: "FILRODENSWMB.ICONS.Fortress",
        gable_roofed_shelter: "FILRODENSWMB.ICONS.GableRoofedShelter",
        geyser_from_ground: "FILRODENSWMB.ICONS.Geyser",
        gravestone: "FILRODENSWMB.ICONS.Gravestone",
        jp_landmark: "FILRODENSWMB.ICONS.JPLandmark",
        lighthouse: "FILRODENSWMB.ICONS.Lighthouse",
        map_pin: "FILRODENSWMB.ICONS.MapPin",
        map_pin_outline: "FILRODENSWMB.ICONS.MapPinOutline",
        map_pin_outline_with_dot: "FILRODENSWMB.ICONS.MapPinDotOutline",
        map_pin_with_dot: "FILRODENSWMB.ICONS.MapPinDot",
        megalith: "FILRODENSWMB.ICONS.Megalith",
        memorial_stone: "FILRODENSWMB.ICONS.MemorialStone",
        mesoamerican_pyramid: "FILRODENSWMB.ICONS.MesoamericanPyramid",
        mineshaft_profile: "FILRODENSWMB.ICONS.Mineshaft",
        obelisk: "FILRODENSWMB.ICONS.Obelisk",
        obelisk_on_plinth: "FILRODENSWMB.ICONS.ObeliskPlinth",
        observatory_dome: "FILRODENSWMB.ICONS.ObservatoryDome",
        palace: "FILRODENSWMB.ICONS.Palace",
        place_of_worship_building: "FILRODENSWMB.ICONS.Temple",
        question_mark: "FILRODENSWMB.ICONS.QuestionMark",
        shipwreck_in_water: "FILRODENSWMB.ICONS.Shipwreck",
        skull: "FILRODENSWMB.ICONS.Skull",
        star: "FILRODENSWMB.ICONS.Star",
        wall_tent: "FILRODENSWMB.ICONS.WallTent",
    },
    PIN_ICONS: {
        // The one icon that can never be disabled or removed - pins reverted away from a
        // removed custom icon fall back to this, and it's the default icon for new pins
        // (see MapStateManager.buildDefaultUiState's `activeIcon`).
        DEFAULT: "map_pin",
        SETTINGS: {
            DISABLED: "disabledPinIcons",
            CUSTOM: "customPinIcons",
        },
    },
    // Pins and labels are sized in UNIT steps of what size 1 meant before size revision REVISION:
    // a pin of size 1 is PIN_PX x UNIT pixels across on a LIMITS.BASELINE_DIMENSION map, and a
    // label of size 1 the page's root font size x UNIT, both growing with the map. Older maps and
    // styles files are scaled up as they are read (see SymbolSizes), so they look as they did.
    //
    // Symbol size (see SymbolScale) multiplies every pin and label on a map: Auto grows them with
    // the square root of how much the map is magnified against its whole world, from 1 (a top map)
    // up to AUTO_MAX; or one of SIZES, chosen in the Detail menu.
    SYMBOLS: Object.freeze({ REVISION: 2, UNIT: 0.25, PIN_PX: 24, AUTO_MAX: 2.5, SIZES: Object.freeze([0.75, 1, 1.25, 1.5, 2, 2.5]), RANGE: Object.freeze([0.5, 3]) }),
    // The PNG export (see ExportScale): the scales offered, the height the smallest name shown
    // should reach for a scale to be recommended, the largest image (a side, and in all) a scale
    // may make, and the largest tile drawn at once
    EXPORT_PNG: Object.freeze({
        SCALES: Object.freeze([1, 2, 3, 4]),
        MIN_LABEL_PX: 12,
        MAX_SIDE: 16384,
        MAX_PIXELS: 150_000_000,
        TILE_PX: 4096,
        // The export dialogue's Scale (S0 step 7): one slider from MIN in steps of STEP to the map
        // type's ceiling (CEILING on a map with raster terrain, whose terrain would only look softer
        // above it), its stops marked, MINOR ones with a short tick and no label
        SCALE: Object.freeze({ MIN: 0.25, STEP: 0.05, CEILING: 4, STOPS: Object.freeze([0.25, 1, 2, 3, 4]), MINOR: Object.freeze([0.5]) }),
        // The Area's presets and aspects, the first of each the default; remembered per kind of export
        PRESETS: Object.freeze(["whole", "screen"]),
        ASPECTS: Object.freeze([
            Object.freeze({ id: "free", ratio: null }),
            Object.freeze({ id: "map", ratio: "map" }),
            Object.freeze({ id: "4:3", ratio: 4 / 3 }),
            Object.freeze({ id: "16:9", ratio: 16 / 9 }),
            Object.freeze({ id: "square", ratio: 1 }),
        ]),
        SETTINGS: Object.freeze({ PRESET_PNG: "exportPresetPng", ASPECT_PNG: "exportAspectPng", PRESET_SCENE: "exportPresetScene", ASPECT_SCENE: "exportAspectScene" }),
    }),
    // The image formats an export can be saved in (see ImageFormat), in the order offered: PNG,
    // WebP at quality 1 (lossless in the browsers that encode WebP) and WebP at 0.9 (lossy, about
    // a fifth of a PNG with the line work intact). Their sizes are estimated from a few sample
    // tiles drawn at the export's scale, which comes within about 15% of a full encode. The last
    // choice is remembered per kind of export.
    EXPORT_FORMATS: Object.freeze({
        CHOICES: Object.freeze([
            Object.freeze({ id: "png", type: "image/png", extension: "png", label: "FILRODENSWMB.UI.ExportFormatPng" }),
            Object.freeze({ id: "webp", type: "image/webp", quality: 1, extension: "webp", label: "FILRODENSWMB.UI.ExportFormatWebpLossless" }),
            Object.freeze({ id: "webp90", type: "image/webp", quality: 0.9, extension: "webp", label: "FILRODENSWMB.UI.ExportFormatWebp90" }),
        ]),
        DEFAULT: "png",
        ESTIMATE: Object.freeze({ TILES: 4, TILE_PX: 512 }),
        SETTINGS: Object.freeze({ PNG: "exportFormatPng", SCENE: "exportFormatScene" }),
    }),
    // Decorations drawn by the module (see DrawnDecoration): a compass rose or a cartouche, each
    // a `kind` on a map decoration (a decoration with no kind is an image the user supplied).
    DECORATIONS: Object.freeze({
        KINDS: Object.freeze(["compass", "cartouche"]),
        // Shapes are built this many times larger and scaled back, so curves keep enough
        // segments when an export enlarges them
        OVERSAMPLE: 2,
        COMPASS: Object.freeze({
            DESIGNS: Object.freeze(["classic", "mariner", "arrow"]),
            POINTS: Object.freeze([4, 8, 16, 32]),
            NORTH: Object.freeze(["letter", "fleur"]),
            LETTERS: Object.freeze(["none", "cardinal", "all"]),
            // A new rose's radius, as a share of the map's shorter side (at scale 1), so it looks
            // the same on a small map and a large one
            RADIUS_SHARE: 0.09,
            LETTER_SIZE: Object.freeze({ MIN: 0.1, MAX: 0.5, DEFAULT: 0.22 }),
            // A new rose sits near the map's bottom right corner, this many radii in from the
            // border's inset
            CORNER_RADII: 1.35,
            DEFAULTS: Object.freeze({
                classic: Object.freeze({ points: 8, rings: 2, degreeRing: false, north: "letter", letters: "cardinal", fontFamily: "Cinzel", bold: true }),
                mariner: Object.freeze({ points: 32, rings: 2, degreeRing: true, north: "fleur", letters: "cardinal", fontFamily: "IM Fell English", bold: false }),
                arrow: Object.freeze({ points: 4, rings: 1, degreeRing: false, north: "letter", letters: "cardinal", fontFamily: "Josefin Sans", bold: true }),
            }),
            BACKING_OPACITY: 0.85,
        }),
        CARTOUCHE: Object.freeze({
            DESIGNS: Object.freeze(["plaque", "ribbon", "frame"]),
            TITLE_SOURCES: Object.freeze(["map", "custom"]),
            // A new cartouche's title size, as a share of the map's shorter side, and its widest,
            // as a share of the map's width
            TITLE_SHARE: 0.035,
            MAX_WIDTH: Object.freeze({ MIN: 0.1, MAX: 1, DEFAULT: 0.4 }),
            SUBTITLE_SIZE: Object.freeze({ MIN: 0.2, MAX: 1, DEFAULT: 0.45 }),
            // A new cartouche sits at the top centre, this many title sizes in from the border's
            // inset
            TOP_TITLES: 1.6,
            // Each design's title face; the subtitle is in a book face, in italic (an engraved
            // face has no lower case or italic, so a subtitle in it would read as capitals)
            DEFAULTS: Object.freeze({
                plaque: Object.freeze({ fontFamily: "Cinzel", bold: true }),
                ribbon: Object.freeze({ fontFamily: "IM Fell English", bold: false }),
                frame: Object.freeze({ fontFamily: "Cinzel Decorative", bold: false }),
            }),
            SUBTITLE_FONT: "EB Garamond",
        }),
        // Colour schemes: every colour of a decoration at once (a one-off choice, not a link)
        SCHEMES: Object.freeze({
            parchment: Object.freeze({ light: "#f3e9cf", dark: "#5b4630", line: "#3b2c1c", accent: "#b8892e", letter: "#3b2c1c", backing: "#f3e9cf", fill: "#f3e9cf", shade: "#d8c69c", text: "#3b2c1c" }),
            seaChart: Object.freeze({ light: "#eef4f7", dark: "#2e5f8a", line: "#1e3a52", accent: "#c9a227", letter: "#1e3a52", backing: "#eef4f7", fill: "#eef4f7", shade: "#b9cfdd", text: "#1e3a52" }),
            ink: Object.freeze({ light: "#fbfaf6", dark: "#1a1a1a", line: "#1a1a1a", accent: "#7a7a7a", letter: "#1a1a1a", backing: "#fbfaf6", fill: "#fbfaf6", shade: "#d6d4cc", text: "#1a1a1a" }),
            slate: Object.freeze({ light: "#d9dde3", dark: "#3f4a5a", line: "#20262f", accent: "#8a96a8", letter: "#eef1f5", backing: "#2b323d", fill: "#2b323d", shade: "#4a5566", text: "#eef1f5" }),
            crimson: Object.freeze({ light: "#f4e6d4", dark: "#8c1c1c", line: "#3a1010", accent: "#c9a227", letter: "#3a1010", backing: "#f4e6d4", fill: "#f4e6d4", shade: "#c99a8a", text: "#3a1010" }),
        }),
        DEFAULT_SCHEME: "parchment",
    }),
    // Random names for regions, pins and routes (see PlaceNames and RandomNames). A suggestion is
    // drawn from a stream seeded by the map's seed, the item's id and its reroll count, so it stays
    // the same until rerolled. Some suggestions add a word that fits the item (FORMS).
    PLACE_NAMES: Object.freeze({
        // Where an item's name came from (its saved `nameSource`)
        SOURCES: Object.freeze(["default", "random", "typed", "generated"]),
        // The share of suggestions that add a word fitting the item, when one fits
        FORM_SHARE: 1 / 3,
        // How a name is written for each kind of land, place or route ({name} is the proper name).
        // A kind with several forms takes one by the item's stream; a kind with none is the name alone
        FORMS: Object.freeze({
            island: Object.freeze(["FILRODENSWMB.UI.NameFormIsle"]),
            mountains: Object.freeze(["FILRODENSWMB.UI.NameFormMountains", "FILRODENSWMB.UI.NameFormHighlands"]),
            hills: Object.freeze(["FILRODENSWMB.UI.NameFormHills", "FILRODENSWMB.UI.NameFormDowns"]),
            coast: Object.freeze(["FILRODENSWMB.UI.NameFormCoast"]),
            forest: Object.freeze(["FILRODENSWMB.UI.NameFormForest", "FILRODENSWMB.UI.NameFormWeald"]),
            plains: Object.freeze(["FILRODENSWMB.UI.NameFormVale", "FILRODENSWMB.UI.NameFormPlains"]),
            desert: Object.freeze(["FILRODENSWMB.UI.NameFormWastes"]),
            tundra: Object.freeze(["FILRODENSWMB.UI.NameFormBarrens"]),
            castle: Object.freeze(["FILRODENSWMB.UI.GeneratedCastleName", "FILRODENSWMB.UI.GeneratedKeepName", "FILRODENSWMB.UI.GeneratedHoldName", "FILRODENSWMB.UI.GeneratedTowerName"]),
            port: Object.freeze(["FILRODENSWMB.UI.NameFormPort", "FILRODENSWMB.UI.NameFormHaven"]),
            market: Object.freeze(["FILRODENSWMB.UI.NameFormMarketBefore", "FILRODENSWMB.UI.NameFormMarketAfter"]),
            ruin: Object.freeze(["FILRODENSWMB.UI.NameFormOld"]),
            road: Object.freeze(["FILRODENSWMB.UI.NameFormRoad", "FILRODENSWMB.UI.NameFormWay"]),
            river: Object.freeze(["FILRODENSWMB.UI.NameFormReach"]),
            sea: Object.freeze(["FILRODENSWMB.UI.NameFormCrossing", "FILRODENSWMB.UI.NameFormPassage"]),
        }),
        // A pin's kind of place, by its style's tier (or its generated tier); tiers not listed
        // (capital, city, town, village...) are the name alone
        SETTLEMENT_TIERS: Object.freeze({
            castle: "castle",
            abandonedCastle: "castle",
            port: "port",
            marketTown: "market",
            ruin: "ruin",
            ruinedCapital: "ruin",
            ruinedCity: "ruin",
            ruinedLargeTown: "ruin",
            ruinedTown: "ruin",
        }),
        // The same for a pin with no style, by its icon
        SETTLEMENT_ICONS: Object.freeze({ castle: "castle", fortress: "castle", anchor: "port", classical_building: "ruin" }),
        // How a region's land is read for Geographic: shares of its land cells. An island region
        // (land with no land beside it outside the region) comes first, then mountains, hills,
        // a mostly coastal region, and last the land's commonest kind of biome
        GEOGRAPHIC: Object.freeze({ MOUNTAINS: 0.25, HILLS: 0.4, COAST: 0.5, BIOME: 0.4, MIN_ISLAND_CELLS: 1 }),
        // The biomes each land kind counts (see BIOME_IDS)
        BIOME_KINDS: Object.freeze({
            DECIDUOUS_FOREST: "forest",
            TEMPERATE_RAINFOREST: "forest",
            TAIGA: "forest",
            TROPICAL_RAINFOREST: "forest",
            GRASSLAND: "plains",
            SAVANNA: "plains",
            TEMPERATE_DESERT: "desert",
            SUBTROPICAL_DESERT: "desert",
            TUNDRA: "tundra",
            SNOW: "tundra",
        }),
        // Tries for a name not already used (Name all), as the generator does
        RETRIES: 12,
        // What Name all can name, and which names it can replace (a typed name never)
        NAME_ALL_KINDS: Object.freeze({ region: "FILRODENSWMB.UI.NameAllRegions", pin: "FILRODENSWMB.UI.NameAllPins", route: "FILRODENSWMB.UI.NameAllRoutes" }),
        NAME_ALL_SOURCES: Object.freeze({ unnamed: "FILRODENSWMB.UI.NameAllUnnamed", random: "FILRODENSWMB.UI.NameAllRandom", default: "FILRODENSWMB.UI.NameAllDefault", generated: "FILRODENSWMB.UI.NameAllGenerated" }),
    }),
    // Personal names for the Local studio's households (personal names N2, `PersonNames`): the
    // namer's own defaults, not a culture's
    // The name filter (roadmap decision 45; kernel/names/NameFilter): a word goes on its list only
    // where it takes out no more than CAP of any name base's generated names (scripts/name-probe.mjs)
    NAME_FILTER: Object.freeze({ CAP: 0.01 }),
    PERSON_NAMES: Object.freeze({
        REAL_SHARE: 0.8, // mix: the share of given names taken from the list as they are
        RETRIES: 8, // a generated name that fails the checks is drawn again this many times
        PLACE_RETRIES: 6,
        // How a household's family name is drawn, by convention (renormalised over what the base has)
        INHERITED: Object.freeze({ list: 0.6, trade: 0.12, place: 0.12, feature: 0.08, father: 0.08 }),
        BYNAME: Object.freeze({ trade: 0.35, place: 0.25, feature: 0.2, father: 0.2 }),
        OWN_TRADE: 0.25, // inherited: the chance an occupational name is the household's own trade
        KIN_OWN: 0.5, // kin with a name of their own (married in, or cousins)
        SINGLE_BYNAME: 0.3, // single names: the share of heads with a byname
        IBERIAN_PLACE: 0.25, // patronymic Iberian: the share of households adding "de {place}"
        ALSO_FAMILY: Object.freeze({ Ruthenian: 0.5 }), // patronymic bases where some households also carry a family name
        ARABIC_LAQAB: 0.4, // patronymic Arabic: the share of households with a trade name or nisba
        NEARBY: 0.5, // toponymic names: the share from places on the map near the household's place
        LIST_MAX: 2000, // a culture's own lists (N3, later): most names kept, and longest name
        NAME_MAX: 40,
    }),
};
