import { FILRODENSWMB } from "../config.js";
import { LAYER_SET_KINDS, NESTING_MODES, ROUTE_CLASSES, ROUTE_TRANSPORTS, VISIBILITIES } from "../mesh/Schema.js";
import { MODEL_RUN_ARRAYS } from "../generator/ModelRun.js";
import { Sanitize } from "./Sanitize.js";

/**
 * The allow-list of a saved map's data: every field each kind of object may hold, and what its
 * value must be. Anything not listed is dropped; a listed value that fails its rule is dropped too
 * (so the load path's own default applies), except where a rule names a fallback.
 *
 * One set of rules serves three callers, so the three can never disagree about what a field holds:
 * - MapImport cleans a whole imported map with `clean(data, RULES.map, context)`;
 * - every inspector and dialogue apply passes its values through `typed(kind, values, current)`,
 *   which keeps the current value wherever a typed one fails;
 * - an export checks free text against its limits with `overLimit(data)`.
 *
 * Ranges are deliberately wider than the sliders that set them: they exist to keep impossible
 * values (NaN, a negative size, a number in the billions) away from buffers and drawing, not to
 * second-guess a value an older version of the module or a hand-edited file stored.
 *
 * A rule is a plain object with a `t` (its type) and options:
 * - `text` (`kind`: name | description | label), `seed` (text, or an older map's number);
 * - `color` (`transparent`), `rgb`, `colorish` (a colour, or an older fault's packed number);
 * - `enum` (`values`), `key` (an id-like word such as an icon or a tool), `id` (an object's own id),
 *   `ref` (another object's id, with `also` for extra words such as "custom");
 * - `num` (`min`, `max`, `int`), `bool`, `null`, `font`, `image`, `base64`;
 * - `points` (`[{x, y}]`, or an older map's pairs or flat numbers), `cells` (cell ids), `legs`;
 * - `segment` (a biome rule segment, `[min, max, openMin, openMax]`);
 * - `obj` (`fields`), `list` (`of`), `record` (`keys`: id | biome, `of`);
 * - `numTree` (derived data of numbers, booleans and nesting only, kept as stored).
 * Any rule may be `nullable`. A `text` rule may carry `where`, the localisation key of the kind of
 * object it belongs to, and `field`, the key naming the field, for the over-limit report.
 */

/** The largest biome id: biome ids are kept in Uint8Arrays (see BiomePlacement). */
const MAX_BIOME_ID = 255;

const RANGE = Object.freeze({
    COORD: { min: -1e6, max: 1e6 },
    UNIT: { min: 0, max: 1 },
    ANGLE: { min: -3600, max: 3600 },
    SCALE: { min: 0, max: 1000 },
    SIZE: { min: 0, max: 1e6 },
    SIGNED: { min: -1e6, max: 1e6 },
    COUNT: { min: 0, max: 1e9, int: true },
});

// ------------------------------------------------------------------ rule builders

const text = (kind, where, field, options = {}) => ({ t: "text", kind, where, field, ...options });
const name = (where) => text("name", where, "FILRODENSWMB.UI.LimitFieldName");
const description = (where) => text("description", where, "FILRODENSWMB.UI.LimitFieldDescription");
const num = (range, options = {}) => ({ t: "num", ...range, ...options });
const int = (min = 0, max = 1e9, options = {}) => ({ t: "num", min, max, int: true, ...options });
const bool = { t: "bool" };
const color = { t: "color" };
const enumOf = (values, options = {}) => ({ t: "enum", values, ...options });
const key = { t: "key" };
const id = { t: "id" };
const ref = (options = {}) => ({ t: "ref", nullable: true, ...options });
const points = { t: "points" };
const obj = (fields, options = {}) => ({ t: "obj", fields, ...options });
const list = (of, options = {}) => ({ t: "list", of, ...options });
const numTree = { t: "numTree" };

const visibility = enumOf(VISIBILITIES);
const hidden = bool;
const lineStyle = enumOf(["solid", "dashed", "dotted", "dashdot"]);
const routeStroke = enumOf(["solid", "dashed", "dotted", "dashdot"]);
const fillStyle = enumOf(["solid", "diagonal", "crosshatch", "hatch"], { nullable: true });
const justify = enumOf(["left", "center", "right"]);
const custom = ref({ also: ["custom"] });

// ------------------------------------------------------------------ generated content

/**
 * What the generator records on everything it makes: its run, what it is (a realm, duchy or
 * county; a town or castle; a route), its tier (kingdom or independent, a pin style tier, a route
 * class), its index in the run, its people, its dominant culture and culture mix (by the map
 * culture's id; a number is an older run's index into its own cultures), and whether the user has
 * edited or locked it (which a re-run reads).
 */
const GENERATED = obj(
    {
        run: { t: "key" },
        kind: enumOf(["realm", "duchy", "county", "town", "castle", "route", "ruin", "abandonedCastle"]),
        tier: { t: "key", nullable: true },
        sourceId: int(0),
        population: num(RANGE.COUNT, { nullable: true }),
        culture: { t: "cultureRef", nullable: true },
        mix: list(obj({ culture: key, share: num(RANGE.UNIT) })),
        // With ages (see Pipeline): the tier in each age (-1 for none), the age last a realm's seat,
        // and for what the age before left: the age, its tier and people then, and an old road
        ages: list(int(-1, 10)),
        formerCapital: int(1, 100, { nullable: true }),
        formerAge: int(1, 100, { nullable: true }),
        formerTier: int(0, 10, { nullable: true }),
        formerPopulation: num(RANGE.COUNT, { nullable: true }),
        oldRoad: bool,
        edited: bool,
        locked: bool,
    },
    { nullable: true },
);

// ------------------------------------------------------------------ labels, pins, decorations

/** The look of a label, owned (a pin's, route's or region's) or standalone. */
const LABEL_LOOK = Object.freeze({
    x: num(RANGE.COORD),
    y: num(RANGE.COORD),
    rotation: num(RANGE.ANGLE),
    quickStyle: custom,
    fontFamily: { t: "font" },
    fontSize: num({ min: 0.01, max: 100 }),
    fillColor: color,
    maxChars: int(0, 100000),
    maxWidth: num(RANGE.SIZE),
    justify,
    bold: bool,
    italic: bool,
    visibility,
    hidden,
});

const OWNED_LABEL = obj({ ...LABEL_LOOK, text: text("label", "FILRODENSWMB.UI.LimitKindLabel", "FILRODENSWMB.UI.LimitFieldText") }, { nullable: true });

const PIN = obj({
    id,
    name: name("FILRODENSWMB.UI.LimitKindPin"),
    description: description("FILRODENSWMB.UI.LimitKindPin"),
    icon: key,
    x: num(RANGE.COORD),
    y: num(RANGE.COORD),
    scale: num(RANGE.SCALE),
    color,
    visibility,
    hidden,
    journalPageId: ref(),
    label: OWNED_LABEL,
    pinStyle: custom,
    cell: int(0, 1e9, { nullable: true }),
    generated: GENERATED,
    type: enumOf(["spring", "block_spring"]),
    radius: num(RANGE.SIZE),
    inflow: num(RANGE.SIGNED),
});

const LABEL = obj({
    ...LABEL_LOOK,
    id,
    name: text("label", "FILRODENSWMB.UI.LimitKindLabel", "FILRODENSWMB.UI.LimitFieldText"),
});

const DECORATION = obj({
    id,
    type: enumOf(["decoration"]),
    name: name("FILRODENSWMB.UI.LimitKindDecoration"),
    src: { t: "image" },
    x: num(RANGE.COORD),
    y: num(RANGE.COORD),
    rotation: num(RANGE.ANGLE),
    scale: num(RANGE.SCALE),
    opacity: num(RANGE.UNIT),
    visibility,
    hidden,
});

// ------------------------------------------------------------------ routes

const ROUTE = obj({
    id,
    name: name("FILRODENSWMB.UI.LimitKindRoute"),
    description: description("FILRODENSWMB.UI.LimitKindRoute"),
    visibility,
    hidden,
    label: OWNED_LABEL,
    quickStyle: custom,
    color,
    thickness: num({ min: 0, max: 1000 }),
    style: routeStroke,
    outline: bool,
    smoothing: bool,
    spanWater: bool,
    mode: enumOf(["terrain", "direct", "trace"]),
    waypoints: { t: "cells" },
    legs: { t: "legs" },
    class: enumOf(ROUTE_CLASSES, { nullable: true }),
    transport: enumOf(ROUTE_TRANSPORTS),
    journalPageId: ref(),
    generated: GENERATED,
    legacy: obj({ points }),
    // An older (polygon) map's route, before it is moved onto the mesh
    points,
});

// ------------------------------------------------------------------ regions

const REGION_LEGACY = obj({ points, fillStyle, lineColor: color, lineThickness: num(RANGE.SIZE), lineStyle, smoothing: bool });

const REGION = obj({
    id,
    key: int(0),
    name: name("FILRODENSWMB.UI.LimitKindRegion"),
    description: description("FILRODENSWMB.UI.LimitKindRegion"),
    fillColor: { t: "color", transparent: true, nullable: true },
    fillStyle,
    quickStyle: custom,
    parentKey: int(0, 1e9, { nullable: true }),
    visibility,
    hidden,
    label: OWNED_LABEL,
    journalPageId: ref(),
    generated: GENERATED,
    legacy: REGION_LEGACY,
});

const LEVEL_STYLE = obj({
    quickStyle: ref(),
    lineColor: color,
    lineThickness: num(RANGE.SIZE),
    lineStyle,
    seaLineThickness: num(RANGE.SIZE),
    seaLineStyle: lineStyle,
    scaleWithMap: bool,
});

const LEVEL = obj({
    id: { t: "id", strict: true },
    name: name("FILRODENSWMB.UI.LimitKindLayer"),
    titleTemplate: text("name", "FILRODENSWMB.UI.LimitKindLayer", "FILRODENSWMB.UI.LimitFieldTitleTemplate"),
    parentLevelId: ref(),
    nestingMode: enumOf(NESTING_MODES),
    visibility,
    opacity: num(RANGE.UNIT),
    watersPx: num(RANGE.SIZE),
    nextKey: int(0),
    // Always rebuilt from the level's id by MapImport, never taken from the file
    regions: list(REGION),
    style: LEVEL_STYLE,
});

const LAYER_SET = obj({
    id: { t: "id", strict: true },
    name: name("FILRODENSWMB.UI.LimitKindSet"),
    kind: enumOf(LAYER_SET_KINDS),
    visibility,
    waterTint: bool,
    opacity: num(RANGE.UNIT),
    levels: list(LEVEL),
});

// ------------------------------------------------------------------ the generator's settings

const generatorText = (field) => text("name", "FILRODENSWMB.UI.LimitKindGenerator", field);

/** A habitat band: [lo, hi] (see CultureInput), or null for no limit. */
const band = { t: "band", nullable: true };

/**
 * A culture (the Cultures section and the culture inspector; see CultureInput): its look, name
 * base, how open and how dense it is, its habitat, and its homelands as map points.
 */
const CULTURE = obj({
    id,
    name: name("FILRODENSWMB.UI.LimitKindCulture"),
    color,
    nameBase: generatorText("FILRODENSWMB.UI.LimitFieldName"),
    openness: num(RANGE.UNIT),
    density: num({ min: FILRODENSWMB.GENERATOR.CULTURES.FIELDS.density.min, max: FILRODENSWMB.GENERATOR.CULTURES.FIELDS.density.max }),
    habitat: obj({ temperature: band, moisture: band, height: band, relief: band, coast: num({ min: -1, max: 1 }), river: num({ min: -1, max: 1 }) }),
    homelands: list({ t: "xy" }),
});

/** An age's culture event (see GeneratorSettings.resolveEvent): a culture arriving or invading, or none. */
const AGE_EVENT = obj({ kind: enumOf(FILRODENSWMB.GENERATOR.AGES.EVENTS), culture: key }, { nullable: true });

/** The settings a run was made with (see GeneratorSettings.resolveSettings). */
const GENERATOR_SETTINGS = obj({
    seed: generatorText("FILRODENSWMB.UI.LimitFieldSeed"),
    nameBase: generatorText("FILRODENSWMB.UI.LimitFieldName"),
    world: obj({ density: num(RANGE.SCALE), urbanisation: num(RANGE.SCALE), realmSpacing: num(RANGE.SCALE), fragmentation: num(RANGE.SCALE) }),
    ages: list(obj({ era: key, development: num(RANGE.UNIT), plague: num(RANGE.UNIT), strifeName: key, strife: num(RANGE.UNIT), event: AGE_EVENT })),
    cultures: list(CULTURE),
});

/** An object of on and off switches, by name. */
const flags = (keys) => obj(Object.fromEntries(keys.map((field) => [field, bool])));

/** The Generate panel's settings a map keeps (see GeneratorSettings.panelSettings). */
const GENERATOR_PANEL = obj({
    seed: generatorText("FILRODENSWMB.UI.LimitFieldSeed"),
    nameBase: generatorText("FILRODENSWMB.UI.LimitFieldName"),
    world: GENERATOR_SETTINGS.fields.world,
    // The ages as the panel keeps them: each age's era and strife presets, and its event
    ages: list(obj({ era: enumOf(Object.keys(FILRODENSWMB.GENERATOR.ERAS)), strife: enumOf(Object.keys(FILRODENSWMB.GENERATOR.STRIFES)), event: AGE_EVENT })),
    output: obj({
        duchies: bool,
        counties: bool,
        places: flags(Object.keys(FILRODENSWMB.GENERATOR.OUTPUT.places)),
        routes: flags(Object.keys(FILRODENSWMB.GENERATOR.OUTPUT.routes)),
        labels: bool,
        history: bool,
        defaultStyles: bool,
    }),
});

/** An older map's region layer and its polygon regions, before they move onto the mesh. */
const LEGACY_REGION_LAYER = obj({
    id: { t: "id", strict: true },
    name: name("FILRODENSWMB.UI.LimitKindLayer"),
    opacity: num(RANGE.UNIT),
    visibility,
    hidden,
    regions: list(
        obj({
            id,
            name: name("FILRODENSWMB.UI.LimitKindRegion"),
            description: description("FILRODENSWMB.UI.LimitKindRegion"),
            points,
            fillColor: { t: "color", transparent: true, nullable: true },
            fillStyle,
            lineColor: color,
            lineThickness: num(RANGE.SIZE),
            lineStyle,
            smoothing: bool,
            label: OWNED_LABEL,
            visibility,
            hidden,
            quickStyle: custom,
            journalPageId: ref(),
        }),
    ),
});

// ------------------------------------------------------------------ terrain features

const FAULT = obj({
    id,
    name: name("FILRODENSWMB.UI.LimitKindFault"),
    description: description("FILRODENSWMB.UI.LimitKindFault"),
    points,
    type: enumOf(["convergent", "divergent", "slip", "hotspot", "range", "subduction", "rift"]),
    thickness: num(RANGE.SIZE),
    strength: num(RANGE.SIGNED),
    color: { t: "colorish" },
    visibility,
    hidden,
    revision: int(0, 1000),
    reversed: bool,
    style: enumOf(["simple", "fold", "rugged"]),
    arcDistance: num(RANGE.SIGNED),
    trenchDepth: num(RANGE.SIGNED),
    floorTexture: num(RANGE.SIGNED),
    volcanoes: num(RANGE.SIGNED),
    spacing: num(RANGE.SIGNED),
    spacingTrend: num(RANGE.SIGNED),
    scatter: num(RANGE.SIGNED),
    variation: num(RANGE.SIGNED),
    pulses: num(RANGE.SIGNED),
    vents: num(RANGE.SIGNED),
    drowned: num(RANGE.SIGNED),
});

const RIVER = obj({
    id,
    name: name("FILRODENSWMB.UI.LimitKindRiver"),
    points,
    width: num(RANGE.SIZE),
    widthScale: num(RANGE.SIZE),
    visibility,
    hidden,
});

const LAND_MASK = obj({
    id,
    name: name("FILRODENSWMB.UI.LimitKindLandMask"),
    operation: enumOf(["add", "subtract"]),
    points,
});

const HISTORY_ENTRY = obj({
    layer: enumOf(["terrain", "biome"]),
    tool: key,
    size: num(RANGE.SIZE),
    strength: num(RANGE.SIGNED),
    feather: num(RANGE.UNIT),
    paintValue: int(0, 255, { nullable: true }),
    paintSides: int(0, 255),
    revision: int(0, 1000),
    points,
    anchor: num(RANGE.SIGNED),
    scale: num(RANGE.SIGNED),
});

// ------------------------------------------------------------------ biomes and styles

const CUSTOM_BIOME = obj({
    id: int(FILRODENSWMB.LIMITS.CUSTOM_BIOME_START_ID, MAX_BIOME_ID),
    name: name("FILRODENSWMB.UI.LimitKindBiome"),
    code: text("name", "FILRODENSWMB.UI.LimitKindBiome", "FILRODENSWMB.UI.LimitFieldCode", { nullable: true }),
    color: { t: "rgb" },
    placement: enumOf(Object.values(FILRODENSWMB.BIOME_PLACEMENT)),
    solidOverWater: bool,
    // The built-in biome the generator treats it as (GENERATOR.BIOMES); null: the biome the climate gives
    behavesLike: enumOf(Object.keys(FILRODENSWMB.GENERATOR.BIOMES), { nullable: true }),
    rules: list(obj({ elevation: list({ t: "segment" }), moisture: list({ t: "segment" }), temperature: list({ t: "segment" }) })),
});

const styleName = name("FILRODENSWMB.UI.LimitKindStyle");

const ROUTE_STYLE = obj({
    id: { t: "id", strict: true },
    name: styleName,
    transport: enumOf(ROUTE_TRANSPORTS),
    color,
    thickness: num({ min: 0, max: 1000 }),
    style: routeStroke,
    outline: bool,
    smoothing: bool,
});

const REGION_STYLE = obj({
    id: { t: "id", strict: true },
    name: styleName,
    fillColor: { t: "color", transparent: true },
    fillStyle: enumOf(["solid", "diagonal", "crosshatch", "hatch"]),
    lineColor: color,
    lineThickness: num(RANGE.SIZE),
    lineStyle,
    smoothing: bool,
});

const LABEL_STYLE = obj({
    id: { t: "id", strict: true },
    name: styleName,
    fontFamily: { t: "font" },
    fontSize: num({ min: 0.01, max: 100 }),
    fillColor: color,
    maxChars: int(0, 100000),
    maxWidth: num(RANGE.SIZE),
    justify,
    bold: bool,
    italic: bool,
});

const PIN_STYLE = obj({
    id: { t: "id", strict: true },
    name: styleName,
    // The settlement or site tier the style stands for, which the generator finds it by
    tier: enumOf(FILRODENSWMB.PINS.DEFAULT_STYLES.map((style) => style.tier), { nullable: true }),
    icon: key,
    scale: num(RANGE.SCALE),
    color,
    detailLevel: int(0, 100),
    // The label's detailLevel is the level from which the style's pins' names are drawn
    label: obj({ fontSize: num({ min: 0.01, max: 100 }), visibility, quickStyle: custom, detailLevel: int(0, 100) }),
});

// ------------------------------------------------------------------ the map

const PARAMS = obj({
    seaLevel: num(RANGE.SIGNED),
    globalTemp: num(RANGE.SIGNED),
    seasonOffset: num(RANGE.SIGNED),
    latTop: num({ min: -90, max: 90 }),
    latBottom: num({ min: -90, max: 90 }),
    globalMoisture: num(RANGE.SIGNED),
    riverDensity: num(RANGE.SIGNED),
    tectonicPlates: num(RANGE.SIGNED),
    coastlineFracture: num(RANGE.SIGNED),
    continentalGrouping: num(RANGE.SIGNED),
    shelfRange: num(RANGE.SIGNED),
    coastalPlain: num(RANGE.SIGNED),
    flatTexture: bool,
    continentScale: num(RANGE.SIGNED),
    oceanScale: num(RANGE.SIGNED),
    oceanRidges: num(RANGE.SIGNED),
    noise: obj({
        offsetX: num(RANGE.SIGNED),
        offsetY: num(RANGE.SIGNED),
        moistureOffset: num(RANGE.SIGNED),
        tempOffset: num(RANGE.SIGNED),
        elevation: obj({ scale: num(RANGE.SIGNED), octaves: int(0, 64), stretch: num(RANGE.SIGNED) }),
        moisture: obj({ scale: num(RANGE.SIGNED), octaves: int(0, 64) }),
        temperature: obj({ scale: num(RANGE.SIGNED), octaves: int(0, 64) }),
    }),
    hydrology: obj({
        maxLakeSize: num(RANGE.SIGNED),
        springAltOffset: num(RANGE.SIGNED),
        springMoistMin: num(RANGE.SIGNED),
        meanderJitter: num(RANGE.SIGNED),
        riverMeander: num(RANGE.SIGNED),
        riverWidthScale: num(RANGE.SIGNED),
    }),
    climate: obj({ altCooling: num(RANGE.SIGNED), freezingThreshold: num(RANGE.SIGNED), windDistance: num(RANGE.SIGNED) }),
    display: obj({
        contourInterval: num(RANGE.SIGNED),
        reliefShading: num(RANGE.SIGNED),
        reliefEmphasis: num(RANGE.SIGNED),
        seabedRelief: num(RANGE.SIGNED),
        waterClarity: num(RANGE.SIGNED),
        waterHue: num(RANGE.SIGNED),
        waterSaturation: num(RANGE.SIGNED),
        biomeAlphaActive: num(RANGE.UNIT),
        biomeAlphaInactive: num(RANGE.UNIT),
        regionOpacity: num(RANGE.UNIT),
    }),
    cartography: obj({
        scaleEnable: bool,
        // The bar's units before the map had a unit of its own: read once, as such a map opens (see MapUnit)
        scaleUnits: text("name", "FILRODENSWMB.UI.LimitKindMap", "FILRODENSWMB.UI.LimitFieldScaleUnits"),
        scaleMatchWorld: bool,
        scaleInterval: num(RANGE.SIZE),
        scaleValue: num(RANGE.SIGNED),
        scaleMajorTicks: int(0, 1000),
        scaleMinorTicks: int(0, 1000),
        scaleX: num(RANGE.COORD),
        scaleY: num(RANGE.COORD),
        borderEnable: bool,
        borderStyle: enumOf(["solid", "double", "ornate"]),
        borderColor: color,
    }),
    // A built-in biome's colour, by the biome's name in BIOME_IDS
    customColors: { t: "record", keys: "biome", of: { t: "rgb" } },
    // Worked out afresh whenever the map is generated; kept as plain numbers for the journal
    terrain: numTree,
    biomePalette: numTree,
    biomeSides: numTree,
    customBiomeRules: numTree,
    solidOverWater: numTree,
});

const UPWIND_STRIP = obj({ start: num(RANGE.SIGNED), min: num(RANGE.SIGNED), max: num(RANGE.SIGNED), data: { t: "base64" } });

const MAP = obj({
    // The saved map's name, which an export carries beside the map data (see MapJson.toExport)
    name: name("FILRODENSWMB.UI.LimitKindMap"),
    seed: { t: "seed", kind: "name", where: "FILRODENSWMB.UI.LimitKindMap", field: "FILRODENSWMB.UI.LimitFieldSeed" },
    generationEngine: enumOf(["standard", "flat", "advanced", "guided"]),
    terrainVersion: int(0, 1000),
    sizeRevision: int(0, 1000),
    // Whether generated names hidden by older runs have been shown again (see NameLevels)
    nameLevels: bool,
    world: obj(
        {
            zoom: num(RANGE.SIGNED),
            originX: num(RANGE.SIGNED, { nullable: true }),
            originY: num(RANGE.SIGNED, { nullable: true }),
            rootW: num(RANGE.SIZE, { nullable: true }),
            rootH: num(RANGE.SIZE, { nullable: true }),
            areaFactor: num(RANGE.SIGNED),
        },
        { nullable: true },
    ),
    // The name every distance shown is labelled with (see MapUnit)
    mapUnit: text("name", "FILRODENSWMB.UI.LimitKindMap", "FILRODENSWMB.UI.LimitFieldMapUnit"),
    generatorStale: bool,
    generatorSettings: GENERATOR_PANEL,
    cultures: list(CULTURE),
    upwindMargin: obj(
        {
            format: int(0, 1000),
            scale: num(RANGE.SIGNED),
            cropX: num(RANGE.SIGNED),
            cropY: num(RANGE.SIGNED),
            rowStart: num(RANGE.SIGNED),
            rows: int(0, 1e6),
            cols: int(0, 1e6),
            left: UPWIND_STRIP,
            right: UPWIND_STRIP,
        },
        { nullable: true },
    ),
    terrainUpgradeDismissed: bool,
    springsBaked: bool,
    mapWidth: num(RANGE.SIZE),
    mapHeight: num(RANGE.SIZE),
    gridType: enumOf(Object.keys(FILRODENSWMB.GRID_TYPES)),
    gridSize: num(RANGE.SIZE),
    gridVisible: bool,
    detailLevel: int(0, FILRODENSWMB.DETAIL.EVERYTHING),
    avoidLabelOverlaps: bool,
    // The map's symbol size (see SymbolScale), or null for Auto
    symbolSize: num({ min: FILRODENSWMB.SYMBOLS.RANGE[0], max: FILRODENSWMB.SYMBOLS.RANGE[1] }, { nullable: true }),
    hiddenLabelStyles: list(key),
    hiddenLevels: list(key),
    hideRegionFills: bool,
    // The Travel tool's way of travel, the map's speeds (km a day), its band width in days (null
    // for automatic) and its start (see TravelView)
    travel: obj({
        mode: enumOf(FILRODENSWMB.TRAVEL_TIME.MODES),
        speeds: obj(Object.fromEntries(Object.keys(FILRODENSWMB.TRAVEL_TIME.SPEEDS).map((key) => [key, num({ min: FILRODENSWMB.TRAVEL_TIME.SPEED_RANGE.MIN, max: FILRODENSWMB.TRAVEL_TIME.SPEED_RANGE.MAX })]))),
        interval: enumOf(FILRODENSWMB.TRAVEL_TIME.INTERVALS, { nullable: true }),
        start: { t: "xy", nullable: true },
    }),
    // The age the History tool shows (see HistoryView), from 1; null until one is chosen
    historyAge: int(1, 100, { nullable: true }),
    // The thematic layer shown over the map and its opacity (see ThematicView)
    thematic: obj({
        fill: enumOf(FILRODENSWMB.THEMATIC.LAYERS.map((layer) => layer.id), { nullable: true }),
        lines: list(enumOf(FILRODENSWMB.THEMATIC.LINES)),
        opacity: num({ min: FILRODENSWMB.THEMATIC.OPACITY_RANGE.MIN, max: FILRODENSWMB.THEMATIC.OPACITY_RANGE.MAX }),
    }),
    params: PARAMS,
    customBiomes: list(CUSTOM_BIOME),
    nextCustomBiomeId: int(0, MAX_BIOME_ID + 1),
    customRouteStyles: list(ROUTE_STYLE),
    customLabelStyles: list(LABEL_STYLE),
    customRegionStyles: list(REGION_STYLE),
    customPinStyles: list(PIN_STYLE, { nullable: true }),
    history: list(HISTORY_ENTRY),
    tectonicFaults: list(FAULT),
    manualRivers: list(RIVER),
    mapPins: list(PIN),
    mapRoutes: list(ROUTE),
    landMasks: list(LAND_MASK),
    mapLabels: list(LABEL),
    mapDecorations: list(DECORATION),
    reference: obj({ src: { t: "image" }, alpha: num(RANGE.UNIT), scale: num(RANGE.SCALE), x: num(RANGE.COORD), y: num(RANGE.COORD) }, { nullable: true }),
    // The custom pin icons the map's pins and pin styles use, which a file carries beside the map
    // (see MapPackage); an import registers them and keeps them apart from the map data
    pinIcons: list(obj({ id: { t: "id", strict: true }, name: name("FILRODENSWMB.UI.LimitKindIcon"), src: { t: "image" } })),
    parentId: ref(),
    vectorSchemaVersion: int(0, 1000),
    mesh: obj({
        seed: int(0, 0xffffffff),
        spacing: num(RANGE.SIZE),
        cells: int(0),
        modelSpacingKm: num(RANGE.SIZE),
        modelSpacingPx: num(RANGE.SIZE),
        width: num(RANGE.SIZE),
        height: num(RANGE.SIZE),
        version: int(0, 1000),
    }),
    layerSets: list(LAYER_SET),
    regionLayers: list(LEGACY_REGION_LAYER),
});

// ------------------------------------------------------------------ the generator's outputs

/** A name an earlier age gave a place, castle or realm, or a kind of keep (empty for none). */
const HISTORY_NAME = generatorText("FILRODENSWMB.UI.LimitFieldName");

/** One packed array of a run's model-cell outputs (see ModelRun.packArray). */
const PACKED_ARRAY = obj({ type: enumOf(["u8", "u16", "u32"]), scale: num({ min: 1e-9, max: 1e9 }), offset: num(RANGE.SIGNED), data: { t: "base64" } });

/**
 * A run's saved model-cell outputs (see ModelRun), kept beside the map data. MapImport also checks
 * that every array holds as many values as the run has cells.
 */
const MODEL_RUN = obj({
    version: int(0, 1000),
    run: key,
    revision: int(0, 1000),
    seed: generatorText("FILRODENSWMB.UI.LimitFieldSeed"),
    settings: GENERATOR_SETTINGS,
    cellCount: int(0, FILRODENSWMB.MESH.MAX_CELLS),
    // Each culture as the run used it (see ModelRun); `homeland`, a single cell, is an older run's
    cultures: list(obj({ id: { ...key, nullable: true }, name: generatorText("FILRODENSWMB.UI.LimitFieldName"), color: { ...color, nullable: true }, nameBase: generatorText("FILRODENSWMB.UI.LimitFieldName"), homelands: { t: "cells" }, homelandsAuto: bool, homelandsLeftOut: int(0, 1e6), homeland: int(0, 1e9, { nullable: true }) })),
    stats: numTree,
    cells: obj(Object.fromEntries(MODEL_RUN_ARRAYS.map((name) => [name, PACKED_ARRAY]))),
    ages: obj({ asked: int(1, 100), run: int(1, 100) }),
    // Each age before the last, in brief (see ModelRun); MapImport checks that its names run with
    // its places, castles and seats, and its arrays with the run's cells
    history: list(obj({
        development: num(RANGE.UNIT),
        plague: num(RANGE.UNIT),
        strife: num(RANGE.UNIT),
        places: { t: "cells" },
        placeNames: list(HISTORY_NAME),
        castles: { t: "cells" },
        castleNames: list(HISTORY_NAME),
        castleKeeps: list(HISTORY_NAME),
        seats: { t: "cellSlots" },
        realmNames: list(HISTORY_NAME),
        realmPeople: list(int(0, 1e12)),
        realm: PACKED_ARRAY,
        culture: PACKED_ARRAY,
        roadFrom: PACKED_ARRAY,
        roadTo: PACKED_ARRAY,
    })),
});

/** The rules, by kind. `map` is a whole saved map; the rest are the objects inside it. */
export const RULES = Object.freeze({
    map: MAP,
    pin: PIN,
    label: LABEL,
    ownedLabel: OWNED_LABEL,
    decoration: DECORATION,
    route: ROUTE,
    region: REGION,
    level: LEVEL,
    levelStyle: LEVEL_STYLE,
    layerSet: LAYER_SET,
    fault: FAULT,
    river: RIVER,
    landMask: LAND_MASK,
    customBiome: CUSTOM_BIOME,
    culture: CULTURE,
    routeStyle: ROUTE_STYLE,
    regionStyle: REGION_STYLE,
    labelStyle: LABEL_STYLE,
    pinStyle: PIN_STYLE,
    params: PARAMS,
    modelRun: MODEL_RUN,
});

/** The style lists of a map, each with the rule of its entries. */
export const STYLE_LIST_RULES = Object.freeze({
    customRouteStyles: ROUTE_STYLE,
    customRegionStyles: REGION_STYLE,
    customLabelStyles: LABEL_STYLE,
    customPinStyles: PIN_STYLE,
    customBiomes: CUSTOM_BIOME,
});

// ------------------------------------------------------------------ the engine

/** Returned by a rule for a value that fails it: the field is left out. */
const DROP = Symbol("drop");

/**
 * The state of one cleaning pass: what it found, and how to make a new id.
 * @typedef {object} CleanContext
 * @property {{where: string, item: string, field: string, length: number, limit: number}[]} overLimit
 *     Free text longer than its limit, with where it is (filled in as the pass goes).
 * @property {number} corrected - How many values failed their rule and were dropped or replaced.
 * @property {Function} newId - Makes an id for an object whose own id failed its rule.
 * @property {boolean} strictIds - Set when an object that others refer to (a layer, a set, a
 *     style) had an id that failed its rule; MapImport refuses such a file.
 * @property {string} item - The name of the object being cleaned, for the over-limit report.
 */

/**
 * A fresh context for a cleaning pass.
 * @param {Function} newId
 * @returns {CleanContext}
 */
export function cleanContext(newId) {
    return { overLimit: [], corrected: 0, newId, strictIds: false, item: "" };
}

/**
 * The value cleaned by its rule, or `undefined` when it fails and has no fallback.
 * @param {*} value
 * @param {object} rule
 * @param {CleanContext} context
 * @returns {*}
 */
export function clean(value, rule, context) {
    const result = cleanValue(value, rule, context);
    return result === DROP ? undefined : result;
}

function cleanValue(value, rule, context) {
    if (value === null && rule.nullable) return null;
    if (value === undefined) return DROP;
    const cleaner = CLEANERS[rule.t];
    const result = cleaner ? cleaner(value, rule, context) : DROP;
    if (result === DROP) context.corrected += 1;
    return result;
}

/** Each rule type's check. Each returns the cleaned value or DROP. */
const CLEANERS = {
    text: (value, rule, context) => checkText(Sanitize.text(value), rule, context),
    seed: (value, rule, context) => checkText(Sanitize.text(value), rule, context),
    color: (value, rule) => orDrop(Sanitize.color(value, { transparent: rule.transparent === true })),
    colorish: (value) => (typeof value === "number" && Number.isFinite(value) ? value : orDrop(Sanitize.color(value))),
    rgb: (value) => orDrop(Sanitize.rgb(value)),
    enum: (value, rule) => orDrop(Sanitize.oneOf(value, rule.values)),
    key: (value) => orDrop(Sanitize.id(value)),
    id: (value, rule, context) => cleanOwnId(value, rule, context),
    ref: (value, rule) => (rule.also?.includes(value) ? value : orDrop(Sanitize.id(value))),
    num: (value, rule) => orDrop(Sanitize.number(value, rule)),
    bool: (value) => orDrop(Sanitize.bool(value)),
    null: () => null,
    font: (value) => orDrop(Sanitize.fontFamily(value)),
    image: (value) => orDrop(Sanitize.imageSource(value, { packaged: true })),
    base64: (value) => (typeof value === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(value) ? value : DROP),
    points: (value) => (Array.isArray(value) ? value.filter(isPoint) : DROP),
    cells: (value) => (Array.isArray(value) ? value.filter(isCell) : DROP),
    // Cells that stand at fixed places in a list (an age's realm seats), so one moved off the map
    // is -1 rather than dropped
    cellSlots: (value) => (Array.isArray(value) && value.every((cell) => cell === -1 || isCell(cell)) ? value : DROP),
    legs: (value) => (Array.isArray(value) ? value.map((leg) => (Array.isArray(leg) ? leg.filter(isCell) : [])) : DROP),
    segment: (value) => cleanSegment(value),
    // A map point: finite x and y within the coordinate range, and nothing else
    xy: (value) => (value && typeof value === "object" && !Array.isArray(value) && [value.x, value.y].every((n) => Number.isFinite(n) && Math.abs(n) <= RANGE.COORD.max) ? { x: value.x, y: value.y } : DROP),
    cultureRef: (value) => (Number.isInteger(value) && value >= 0 && value < 1e6 ? value : orDrop(Sanitize.id(value))),
    band: (value) => (Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && value[0] <= value[1] ? [value[0], value[1]] : DROP),
    numTree: (value) => cleanNumTree(value, 0),
    obj: (value, rule, context) => cleanObject(value, rule.fields, context),
    list: (value, rule, context) => (Array.isArray(value) ? cleanList(value, rule.of, context) : DROP),
    record: (value, rule, context) => cleanRecord(value, rule, context),
};

const orDrop = (value) => (value === null ? DROP : value);

function checkText(value, rule, context) {
    if (value === null) return DROP;
    if (Sanitize.textTooLong(value, rule.kind)) {
        context.overLimit.push({ where: rule.where ?? "", item: context.item, field: rule.field ?? "", length: value.length, limit: Sanitize.textLimit(rule.kind) });
    }
    return value;
}

function cleanOwnId(value, rule, context) {
    if (Sanitize.isId(value)) return value;
    if (rule.strict) {
        context.strictIds = true;
        return DROP;
    }
    return context.newId();
}

/** A point as an older or newer map stores it: `{x, y}`, an `[x, y]` pair, or one number of a flat list. */
function isPoint(point) {
    if (typeof point === "number") return Number.isFinite(point);
    if (Array.isArray(point)) return point.length === 2 && point.every(Number.isFinite);
    return !!point && typeof point === "object" && Number.isFinite(point.x) && Number.isFinite(point.y);
}

const isCell = (cell) => Number.isInteger(cell) && cell >= 0;

function cleanSegment(value) {
    if (!Array.isArray(value) || value.length !== 4) return DROP;
    const [min, max, openMin, openMax] = value;
    if (!Number.isFinite(min) || !Number.isFinite(max) || typeof openMin !== "boolean" || typeof openMax !== "boolean") return DROP;
    return [min, max, openMin, openMax];
}

/** Derived data of numbers and booleans, nested a few levels at most; strings are not kept. */
const NUM_TREE_DEPTH = 6;
function cleanNumTree(value, depth) {
    if (typeof value === "number") return Number.isFinite(value) ? value : DROP;
    if (typeof value === "boolean" || value === null) return value;
    if (typeof value !== "object" || depth >= NUM_TREE_DEPTH) return DROP;
    if (Array.isArray(value)) return value.map((item) => cleanNumTree(item, depth + 1)).filter((item) => item !== DROP);
    const copy = {};
    for (const [field, entry] of Object.entries(value)) {
        if (!Sanitize.isSafeKey(field) || !/^[A-Za-z0-9_]+$/.test(field)) continue;
        const cleaned = cleanNumTree(entry, depth + 1);
        if (cleaned !== DROP) copy[field] = cleaned;
    }
    return copy;
}

function cleanObject(value, fields, context) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return DROP;
    const copy = {};
    for (const [field, rule] of Object.entries(fields)) {
        if (!Object.hasOwn(value, field)) continue;
        const cleaned = cleanValue(value[field], rule, context);
        if (cleaned !== DROP) copy[field] = cleaned;
    }
    return copy;
}

function cleanList(value, of, context) {
    const outer = context.item;
    const copy = [];
    for (const entry of value) {
        context.item = itemName(entry, outer);
        const cleaned = cleanValue(entry, of, context);
        if (cleaned !== DROP) copy.push(cleaned);
    }
    context.item = outer;
    return copy;
}

/** How an object is named in the over-limit report: its name (shortened), else the enclosing object's. */
const ITEM_NAME_LENGTH = 40;
function itemName(entry, fallback) {
    const own = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (!own) return fallback;
    return own.length > ITEM_NAME_LENGTH ? `${own.slice(0, ITEM_NAME_LENGTH)}…` : own;
}

function cleanRecord(value, rule, context) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return DROP;
    const allowed = rule.keys === "biome" ? (field) => Object.hasOwn(FILRODENSWMB.BIOME_IDS, field) : (field) => Sanitize.isId(field);
    const copy = {};
    for (const [field, entry] of Object.entries(value)) {
        if (!allowed(field)) {
            context.corrected += 1;
            continue;
        }
        const cleaned = cleanValue(entry, rule.of, context);
        if (cleaned !== DROP) copy[field] = cleaned;
    }
    return copy;
}

// ------------------------------------------------------------------ inspector and dialogue applies

/**
 * The values an inspector or dialogue is about to apply, each checked by its kind's rule: free
 * text cut to its limit, and any colour, enum, number or name that fails its rule replaced by the
 * object's current value (or left out when the object has none). Fields the rules do not know are
 * passed on as they are: they are the editor's own (a label object's merged fields, a style id the
 * editor resolved).
 *
 * @param {keyof RULES} kind
 * @param {object} values - What the editor read from its form.
 * @param {object} [current] - The object as it is now.
 * @returns {object} A new object with the checked values.
 */
export function typed(kind, values, current = {}) {
    const rule = RULES[kind];
    if (!rule || !values || typeof values !== "object") return values;
    return typedObject(values, rule.fields, current ?? {});
}

function typedObject(values, fields, current) {
    const context = cleanContext(() => null);
    const result = {};
    for (const [field, value] of Object.entries(values)) {
        if (!Sanitize.isSafeKey(field)) continue;
        const rule = fields[field];
        if (!rule) {
            result[field] = value;
            continue;
        }
        result[field] = typedValue(value, rule, current[field], context);
    }
    return result;
}

function typedValue(value, rule, current, context) {
    if (rule.t === "text" || rule.t === "seed") {
        const typedText = Sanitize.text(value);
        return typedText === null ? current : typedText.slice(0, Sanitize.textLimit(rule.kind));
    }
    if (rule.t === "obj" && value && typeof value === "object") return typedObject(value, rule.fields, current ?? {});
    if (rule.t === "id") return Sanitize.isId(value) ? value : current;
    const cleaned = clean(value, rule, context);
    return cleaned === undefined ? current : cleaned;
}

// ------------------------------------------------------------------ export check

/**
 * Every piece of free text in a map that is longer than its limit, with where it is: what an
 * export refuses on.
 * @param {object} mapData
 * @param {Object<string, *>} [extras] - Further one-line text checked as the map's (its name), by
 *     the localisation key naming the field.
 * @returns {{where: string, item: string, field: string, length: number, limit: number}[]}
 */
export function overLimit(mapData, extras = {}) {
    const context = cleanContext(() => "x");
    for (const [field, value] of Object.entries(extras)) {
        if (Sanitize.textTooLong(value, "name")) context.overLimit.push({ where: "FILRODENSWMB.UI.LimitKindMap", item: "", field, length: value.length, limit: Sanitize.textLimit("name") });
    }
    clean(mapData, MAP, context);
    return context.overLimit;
}
