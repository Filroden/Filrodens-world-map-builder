// Quality round, V3: the drawing's styles. Every colour and weight the canvas layers use comes from
// a named token here, so the atlas style, the studio theme's styles and culture colours are style
// objects over the same drawing (handoff §4). Ken (2026-11-15): both looks, the atlas style the
// default; per culture, roof and wall colours and the walls' material.

/** The atlas style: a quiet grass ground, muted fields, red-brown roofs lit from the north-west. */
export const ATLAS = Object.freeze({
    name: "atlas",
    // The ground and its slight variation, the built-up ground between buildings
    ground: "#dde2bb",
    groundVar: "#cfd7a6",
    groundVarAlpha: 0.22,
    town: "#e7dcc0",
    yard: "#e1d6b5",
    // Fields by use (V4): the three great fields: winter corn, spring corn, and the fallow, grazed
    // and greener; the headlands and balks between them are the ground showing through
    arable: ["#e8d49c", "#e6dfb2", "#dcd8ae"],
    strip: "#c7b384",
    stripFallow: "#d8cba6",
    meadow: "#d3ddae",
    meadowTuft: "#9fae74",
    pasture: "#d9dfb0",
    common: "#dde2b4",
    commonMark: "#a7a26c",
    moor: "#ddd0c4",
    heather: "#a98ea0",
    dry: "#ecdcae",
    sand: "#b89a62",
    garden: "#cfdc9e",
    bed: "#9fb36a",
    close: "#d6deae",
    hedge: "#9aa476",
    hedgerow: "#8a9a62",
    wood: "#bec897",
    contour: "#c4b791",
    contourAlpha: 0.45,
    // Trees: crown, its lit side, its edge
    tree: "#87985f",
    treeLit: "#a6b57a",
    treeEdge: "#5f6c42",
    // Water
    water: "#a8c8d6",
    waterEdge: "#6e97ab",
    sea: "#9dc1d1",
    shallows: "#b9d6e0",
    mountain: "#bdb5a6",
    mountainEdge: "#6f675b",
    // Ways: a road's casing, a road (earth, outside), a street (inside), a lane, a track
    casing: "#8b7b5e",
    // Ways by class: an approach road (earth, a strong casing), a lesser road; main streets paved,
    // with kerbs; the rest
    roadCasing: "#7a684a",
    roadEarth: "#e4d2a6",
    rut: "#cdb88a",
    mainStreet: "#f7f0de",
    kerb: "#b8a983",
    road: "#eee2c4",
    street: "#f4ecd8",
    lane: "#f1e8d2",
    track: "#e3d5ac",
    market: "#e8dcc0",
    paving: "#d8cdb0",
    // Grounds
    park: "#b8cf8e",
    cemetery: "#cdd1ad",
    grave: "#8d857a",
    estate: "#bfd394",
    parterre: "#d9e2b2",
    plot: "#ddd3b0",
    plotEdge: "#b9aa84",
    // Each house's ground: a yard (packed earth) for the poorer and for trades, a garden for the
    // better off; their fences and hedges
    yardGround: "#d3bf91",
    workYard: "#c9b998",
    fence: "#8e7752",
    gardenGround: "#bccf8a",
    gardenBed: "#a9bd78",
    gardenEdge: "#8d9a63",
    quay: "#d9d2bf",
    timber: "#a0825e",
    timberEdge: "#5c4632",
    // Roofs: the default roof (houses), and its kinds; their edge and ridge
    roof: "#b9674a",
    // ... by what it is made of (engine/town/roofs.mjs): tile is the roof above
    thatch: "#a38446",
    slate: "#7b7e84",
    roofSpread: 0.07,
    roofEdge: "#4f3427",
    ridge: "#5e3a2b",
    rangeRoof: "#a8694f",
    barn: "#b39466",
    warehouse: "#9c7f5e",
    grandRoof: "#a65a44",
    worshipRoof: "#8f8b86",
    worshipEdge: "#3e3530",
    keepRoof: "#8a837b",
    palaceRoof: "#9c6d52",
    // Walls: stone, its edge, its lit side; earth and palisade
    stone: "#8c8278",
    stoneLit: "#a59b90",
    stoneEdge: "#3b3632",
    bank: "#c2ad84",
    bankEdge: "#8e7a55",
    palisade: "#6b4f35",
    palisadeEdge: "#3a2a1c",
    // Market stalls' awnings
    stalls: ["#b5523e", "#d9b44a", "#4f7aa8", "#e6e0d0", "#6f9a58"],
    // Light: from this bearing (degrees clockwise from north), how much a roof's lit and shaded
    // pitches differ, the shadow's colour and strength, and its length (m per m of height)
    lightBearing: 315,
    facetContrast: 0.2,
    shadow: "#2f2a1f",
    shadowAlpha: 0.26,
    shadowLength: 0.55,
    // Underground (V5b), in the atlas's own colours: rock hatched grey, its edge, houses cut into
    // it; a cavern's floor; fungus beds and their rows; the land open to the sky before a gate
    rock: "#cbc4b6",
    rockHatch: "#a39b8d",
    rockEdge: "#6f675b",
    rockCut: "#b98a6c",
    caveFloor: "#e7dcc0",
    fungus: "#d9c9de",
    fungusBed: "#a68fb6",
    surface: "#dde2bb",
    // A mine: its ore, rails, worked stopes; the marks for stairs, shafts and air shafts
    ore: "#a07a4f",
    rail: "#5c4632",
    stope: "#d6c9ae",
    link: "#c9952e",
    linkEdge: "#2c2622",
    // Ink: labels and the frame's furniture
    ink: "#3b2f25",
    paper: "#efe7d0",
    font: "Georgia, 'Times New Roman', serif",
});

/** Heights (m) the shadows are cast from. */
export const HEIGHTS = Object.freeze({ house: 7, range: 4.5, inn: 8.5, hall: 11, workshop: 6, stable: 5, shed: 3.5, farmhouse: 6, barn: 6.5, warehouse: 8, grand: 9, worship: 13, wall: 9, tower: 12, gatehouse: 11, keep: 18, palace: 11, palisade: 4.5, timberTower: 7 });

/** A culture's own style: none set means the style's own colours and stone walls. */
export const CULTURE_DEFAULT = Object.freeze({ roof: null, wall: null, wallMaterial: "stone" });

/**
 * A style from the studio's theme (styles/fwmb-theme.css): the map drawn in the theme's own
 * surfaces and hue, light or dark. `tokens` holds the theme's custom properties by name.
 */
export function themeStyle(tokens, mode = "light") {
    const t = (k) => tokens[k];
    const dark = mode === "dark";
    const base = t("--fwmb-bg-base"), panel = t("--fwmb-bg-panel"), raised = t("--fwmb-bg-raised"), hover = t("--fwmb-bg-hover"), high = t("--fwmb-bg-highlight");
    const accent = t("--fwmb-accent-main"), fillAccent = t("--fwmb-fill-accent"), secondary = t("--fwmb-accent-secondary"), fillSecondary = t("--fwmb-fill-secondary");
    const border = t("--fwmb-border-main"), strong = t("--fwmb-border-strong"), text = t("--fwmb-text-primary"), muted = t("--fwmb-text-muted");
    const green = mix(base, "#6f8f4f", dark ? 0.32 : 0.22);
    const blue = mix(base, "#4f86a6", dark ? 0.5 : 0.35);
    return Object.freeze({
        ...ATLAS,
        name: `theme-${mode}`,
        ground: mix(base, green, 0.5), groundVar: green, groundVarAlpha: 0.18,
        town: mix(base, high, 0.6), yard: high,
        arable: [mix(base, accent, 0.24), mix(base, accent, 0.13), mix(base, green, 0.35)],
        strip: mix(base, strong, 0.5), stripFallow: mix(base, border, 0.4),
        meadow: mix(base, green, 0.7), meadowTuft: mix(green, text, 0.25), pasture: mix(base, green, 0.6),
        common: mix(base, green, 0.45), commonMark: mix(green, text, 0.3), moor: mix(base, secondary, 0.15), heather: mix(base, secondary, 0.5), dry: mix(base, accent, 0.08), sand: mix(base, accent, 0.5),
        garden: mix(base, green, 0.8), bed: mix(green, text, 0.2), close: mix(base, green, 0.55), hedge: mix(green, text, 0.25), hedgerow: mix(green, text, 0.35),
        wood: mix(base, green, 0.95), contour: border, contourAlpha: 0.35,
        tree: mix(green, dark ? "#000000" : "#2e3a1e", 0.25), treeLit: green, treeEdge: mix(green, "#000000", 0.45),
        water: blue, waterEdge: mix(blue, text, 0.3), sea: blue, shallows: mix(blue, base, 0.35),
        casing: strong, road: raised, street: panel, lane: mix(panel, raised, 0.5), track: hover, market: high, paving: mix(high, border, 0.4),
        park: mix(base, green, 0.85), cemetery: mix(base, border, 0.5), grave: strong, estate: mix(base, green, 0.8), parterre: mix(base, green, 0.4),
        plot: mix(base, high, 0.5), plotEdge: border, quay: hover,
        yardGround: mix(base, high, 0.75), workYard: mix(high, border, 0.35), fence: border, gardenGround: mix(base, green, 0.9), gardenBed: mix(green, text, 0.12), gardenEdge: mix(green, text, 0.25),
        roadCasing: mix(strong, "#000000", 0.2), roadEarth: mix(raised, accent, 0.12), rut: mix(raised, strong, 0.3), mainStreet: panel, kerb: border,
        roof: fillSecondary, thatch: mix(fillAccent, high, 0.3), slate: mix(fillSecondary, muted, 0.7), rangeRoof: mix(fillSecondary, base, 0.15), roofEdge: mix(fillSecondary, "#000000", 0.55), ridge: mix(fillSecondary, "#000000", 0.4),
        barn: mix(fillAccent, base, 0.25), warehouse: fillAccent, grandRoof: mix(fillSecondary, "#000000", 0.12),
        worshipRoof: muted, worshipEdge: mix(muted, "#000000", 0.6), keepRoof: muted, palaceRoof: mix(fillSecondary, muted, 0.4),
        stone: strong, stoneLit: mix(strong, text, 0.25), stoneEdge: mix(strong, "#000000", 0.6),
        stalls: [secondary, accent, blue, panel, green],
        shadow: "#000000", shadowAlpha: dark ? 0.42 : 0.22,
        ink: text, paper: panel,
    });
}

// ---------------------------------------------------------------- colour arithmetic
export function rgbOf(hex) {
    const h = hex.replace("#", "");
    const v = h.length === 3 ? h.split("").map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return v;
}
export function hexOf([r, g, b]) {
    const c = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
    return `#${c(r)}${c(g)}${c(b)}`;
}
/** a towards b by t (0 to 1). */
export function mix(a, b, t) {
    const x = rgbOf(a), y = rgbOf(b);
    return hexOf(x.map((v, i) => v + (y[i] - v) * t));
}
/** Lighter (f > 0, towards white) or darker (f < 0, towards black). */
export function shade(hex, f) {
    return f >= 0 ? mix(hex, "#ffffff", f) : mix(hex, "#000000", -f);
}
export function rgba(hex, a) {
    const [r, g, b] = rgbOf(hex);
    return `rgba(${r},${g},${b},${a})`;
}

/**
 * A carved settlement in the dark: the rock near black with its grain, a lamplit floor, pale stone
 * roofs, dark still water, fungus beds in purples, stands of great fungi as brown caps (Ken,
 * 2026-10-29: the dark palette for caverns).
 */
export const CAVE = Object.freeze({
    ...ATLAS,
    name: "cave",
    ground: "#7d7363",
    groundVar: "#6f6656",
    groundVarAlpha: 0.12,
    caveFloor: "#7d7363",
    town: "#877c6a",
    yard: "#8d8271",
    arable: ["#6c5884", "#76628f", "#62517a"],
    strip: "#9580ad",
    stripFallow: "#5d4f6c",
    meadow: "#5e6b52",
    meadowTuft: "#7f9070",
    pasture: "#5a664c",
    common: "#6f6656",
    commonMark: "#8a806c",
    moor: "#5e6a52",
    heather: "#8fa37e",
    dry: "#6a6458",
    sand: "#a9c6dc",
    garden: "#5f6d52",
    bed: "#7b6a93",
    close: "#666050",
    hedge: "#4b4237",
    hedgerow: "#4b5640",
    wood: "#4a3f37",
    contour: "#6e6455",
    contourAlpha: 0.35,
    tree: "#93664a",
    treeLit: "#b4825d",
    treeEdge: "#4f3222",
    water: "#3d6a8a",
    waterEdge: "#27465e",
    sea: "#2f5670",
    shallows: "#3f6a85",
    mountain: "#8f8a80",
    mountainEdge: "#3f3a33",
    casing: "#4b4237",
    roadCasing: "#3f372e",
    roadEarth: "#c2b496",
    rut: "#a99a7c",
    mainStreet: "#d8cdb5",
    kerb: "#8f846f",
    road: "#cfc3a8",
    street: "#cfc3a8",
    lane: "#c4b89c",
    track: "#a99c80",
    market: "#a39780",
    paving: "#928771",
    park: "#5f6d52",
    cemetery: "#5a544a",
    grave: "#3f3a33",
    estate: "#617055",
    parterre: "#6c7a5e",
    plot: "#7a705f",
    plotEdge: "#5a5245",
    yardGround: "#76695a",
    workYard: "#6e675c",
    fence: "#3f372e",
    gardenGround: "#5f6d52",
    gardenBed: "#76628f",
    gardenEdge: "#4b5640",
    quay: "#9d927e",
    timber: "#8a6d4f",
    timberEdge: "#3f2f20",
    roof: "#d6c3a0",
    roofSpread: 0.06,
    roofEdge: "#3a3028",
    ridge: "#5a4a3a",
    rangeRoof: "#c8b591",
    barn: "#b9a27e",
    warehouse: "#b09a7a",
    grandRoof: "#cdb48c",
    worshipRoof: "#aea392",
    worshipEdge: "#2c2622",
    keepRoof: "#9c948a",
    palaceRoof: "#c2a982",
    stone: "#8c847a",
    stoneLit: "#a69d91",
    stoneEdge: "#2c2824",
    bank: "#8a7c62",
    bankEdge: "#5a4e3a",
    palisade: "#5a4330",
    palisadeEdge: "#2c2016",
    rock: "#1e1b19",
    rockHatch: "#2b2724",
    rockEdge: "#4c443a",
    rockCut: "#c49a72",
    fungus: "#6c5884",
    fungusBed: "#8e77a7",
    surface: "#8f9474",
    ore: "#7a5a3a",
    rail: "#3a3028",
    stope: "#8a7c66",
    link: "#e8c35a",
    linkEdge: "#2c2622",
    shadow: "#000000",
    shadowAlpha: 0.32,
});

/** An open cavern floor: the cave's colours on a dim floor, the farms fungus beds and lichen
 * grazing, the unfarmed floor stands of great fungi, moss and lichen, and bare or crystal-strewn
 * rock. Each floor biome shifts it a little (`floorStyle`). */
export const FLOOR = Object.freeze({
    ...CAVE,
    name: "floor",
    ground: "#4b453c",
    groundVar: "#5a5347",
    groundVarAlpha: 0.18,
    caveFloor: "#4b453c",
    town: "#6a6152",
    yard: "#6f6555",
    meadow: "#58664f",
    pasture: "#536048",
    close: "#5c5449",
    garden: "#6a5a7c",
    bed: "#9580ad",
    common: "#514a40",
    commonMark: "#6f6656",
    moor: "#56614d",
    heather: "#89a07a",
    dry: "#47443f",
    sand: "#a9c6dc",
    wood: "#3d3631",
    hedge: "#38322b",
    hedgerow: "#3f4a36",
    contour: "#554d42",
    water: "#2c4b5e",
    sea: "#2c4b5e",
    shallows: "#3a5f73",
    waterEdge: "#7598aa",
});

/** The floor biomes' own shifts of the floor style (floor.mjs FLOOR.BIOMES). */
const FLOOR_BIOMES = Object.freeze({
    fungusForest: {},
    lichenFloor: { ground: "#4d4c3e", groundVar: "#5a5c44", common: "#55583f", commonMark: "#77805a", moor: "#5d6a4b", heather: "#a3b37e" },
    crystalCavern: { ground: "#44474c", groundVar: "#50555e", common: "#4d4f52", dry: "#4a4e57", sand: "#bfe3f2", commonMark: "#6f7680" },
    lakeShore: { ground: "#454a47", groundVar: "#4f5852", meadow: "#4f6352", common: "#4c514b" },
    seaShore: { ground: "#474a46", groundVar: "#535a53", meadow: "#4f6352", common: "#4e524c", dry: "#55554d", sand: "#c8c2a0" },
});

/** The floor style for a floor biome. */
export function floorStyle(biome) {
    return Object.freeze({ ...FLOOR, ...(FLOOR_BIOMES[biome] ?? {}), name: `floor-${biome ?? "fungusForest"}` });
}

/** The style a place is drawn in by default: the atlas on the surface, the dark cave palette for
 * carved levels, the floor style (by its biome) for an open cavern floor. */
export function defaultStyle(town) {
    if (town.shore?.cave) return CAVE;
    if (town.input?.floor) return floorStyle(town.input.floor.biome);
    return ATLAS;
}
