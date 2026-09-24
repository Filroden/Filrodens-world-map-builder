export const FILRODENSWMB = {
    ID: "filrodens-world-map-builder",
    FLAGS: {
        IS_ACTIVE: "isActiveCanvas",
        HEX_DATA: "hexData",
        PARAMS: "generationParams",
        // Where GridDataExporter writes the per-grid-cell exploration data layer at export time
        // (see GRID_DATA below for the thresholds that classify it). Named "gridData" rather than
        // reusing HEX_DATA above because the schema covers every grid shape FWMB supports (square
        // and both hex orientations), not hexes specifically.
        GRID_DATA: "gridData",
    },
    TEMPLATES: {
        TOOLBAR: "modules/filrodens-world-map-builder/templates/toolbar.hbs",
    },
    // Foundry's own CONST.GRID_TYPES numeric values (and a human-readable label for each) for the
    // three grid shapes FWMB supports, keyed by uiState.gridType. FWMB only ever exports the
    // odd-offset hex variants (HEXODDR/HEXODDQ) - Foundry's even-offset variants are never used -
    // so this is a fixed, small map rather than the full GRID_TYPES enum. Shared by SceneExporter
    // (which writes `type` onto the Scene document's own grid config) and GridDataExporter (which
    // writes both `type` and `name` into the exported grid-data payload's `grid` object), so the
    // mapping only exists in one place.
    GRID_TYPES: {
        none: { value: 0, name: "GRIDLESS" },
        square: { value: 1, name: "SQUARE" },
        hexR: { value: 2, name: "HEXODDR" },
        hexC: { value: 4, name: "HEXODDQ" },
    },
    DEFAULTS: {
        SEED: "FILRODEN",
        SEA_LEVEL: 0.35,
        LAT_TOP: 90,
        LAT_BOTTOM: -90,
        GLOBAL_TEMP: 0.5,
        GLOBAL_MOISTURE: 0.5,
        MAP_WIDTH: 1000,
        MAP_HEIGHT: 1000,
    },
    GENERATION: {
        TECTONIC_PLATES: 10,
        COASTLINE_FRACTURE: 0.3,
        // The Coastline Fracture slider's step (tools-terrain.hbs uses the same value). Values
        // worked out in code for the slider, such as the one a map is given when it is updated
        // to the current terrain rules, are rounded to it so the slider can show them exactly.
        COASTLINE_FRACTURE_STEP: 0.05,
        CONTINENTAL_GROUPING: 0.4,
        COASTAL_BAND: 30,
        CONTINENT_SCALE: 150,
        OCEAN_SCALE: 150,
        // The Mid-Ocean Ridges setting's default (0 is none, 1 the full height in
        // COASTAL_PROFILE.OCEAN_RIDGES)
        OCEAN_RIDGES: 0.5,
        SHELF_RANGE: 0.15,
        COASTAL_PLAIN: 0.05,
        OCEAN_DEPTH_CAP: 0.9,
        MASK_BLEND_WIDTH: 0.25,
        WARP: {
            OCTAVES: 3,
            FREQUENCY_MULT: 5,
            AMPLITUDE: 200,
            OFFSETS: {
                X: { X: 5321, Y: 1234 },
                Y: { X: 8765, Y: 4321 },
            },
        },
        BLEND_WEIGHTS: {
            TECTONIC_MACRO: 0.55,
            TECTONIC_DETAIL: 0.45,
            GUIDED_MACRO: 0.5,
            GUIDED_DETAIL: 0.5,
        },
        // Tectonic terrain under the current rules (ProceduralEngine.generateTectonicV2Topography)
        TECTONICS_V2: {
            // Coastline Fracture for a new map: the land this engine makes has far more
            // coastline than a typical hand-drawn land mask, so the shared default breaks it up
            // too much
            COASTLINE_FRACTURE: 0.2,
            // Plates draw from a random stream of their own, this far from the map's seed
            PLATE_SEED_OFFSET: 3,
            // A plate's buoyancy: how far it leans towards what the continent noise says at its
            // centre (per unit of noise above or below the land threshold), and the size of the
            // random part added to that (see ProceduralEngine#buildPlateModel)
            BUOYANCY_ALIGNMENT: 1.5,
            BUOYANCY_RANDOMNESS: 0.75,
            // Multipliers mixing the seed and a plate's number into its buoyancy hash
            BUOYANCY_SEED_MULTIPLIER: 31,
            BUOYANCY_PLATE_MULTIPLIER: 7919,
            // How strongly a plate's buoyancy (-1 to 1) pushes its area towards ocean or land,
            // against the continent noise and the Continental Grouping threshold
            PLATE_WEIGHT: 0.45,
            // Added to Continental Grouping before it is used as the land threshold. The slider
            // keeps the range and default the original tectonic engine uses, but that threshold
            // turned about two thirds of a map into land here; this brings the default to
            // roughly a third, with the rest of the slider's range still running from mostly
            // land to open ocean.
            GROUPING_OFFSET: 0.35,
            // Height of the mountain ranges (and depth of the rift valleys) plate boundaries
            // raise on land, as a share of the land's full height
            RIDGE_WEIGHT: 0.6,
            // Depth of the trenches colliding plates cut at sea, as a share of the ocean depth
            TRENCH_DEPTH: 0.12,
            // The boundary relief the plate mesh gives colliding plates (see
            // ProceduralEngine#calculateTectonicBoundaries), used to scale trenches to 0-1
            CONVERGENT_RELIEF: 0.8,
        },
        TECTONIC_MESH: {
            WIDTH: 100,
            HEIGHT: 100,
            BLUR_RADIUS: 2,
        },
        CONTINENTAL_MASKING: {
            OCTAVES: 2,
            FREQUENCY_MULT: 1.5,
        },
        // Lets tapered, independent noise perturb the guided-mode coastline itself (see
        // ProceduralEngine#computeEffectiveCoastDistance), instead of noise being suppressed to
        // zero exactly at the drawn edge. BAND_RATIO/AMPLITUDE_RATIO are expressed relative to
        // CONTINENT_SCALE, calibrated against its default of 150. Legacy maps multiply them by the
        // map's own Continent Scale; from terrain revision 2 on they are multiplied by the default
        // instead, so Continent Scale shapes the relief without also changing the coastline.
        COASTAL_VARIANCE: {
            BAND_RATIO: 0.53,
            AMPLITUDE_RATIO: 1.33,
            OCTAVES: 5,
            FREQUENCY_MULT: 16.7,
            // Arbitrary large offsets, matching the pattern of WARP.OFFSETS above, so this noise
            // field samples a different region of the simplex field than the domain warp does.
            NOISE_OFFSET: { X: 4000, Y: 4000 },
        },
        // The most cells the guided-mode coastline distance field may have. The field covers the
        // map plus a margin at up to one cell per map pixel; on a zoomed-in regional map that
        // would otherwise grow with the square of the zoom, so beyond this size its cells are
        // made coarser instead (the field is smooth, so it is sampled between cells without
        // visible steps). A map that was never cropped always gets one cell per pixel.
        COAST_FIELD_MAX_CELLS: 4000000,
        // How guided terrain rises from the coast and the seabed falls away from it, from terrain
        // revision 2 on (see ProceduralEngine#shapeCoastalProfile). Continental Shelf and Coastal
        // Plains each set the width of a band along the coast: shallow shelf on the sea side, low
        // plain on the land side. Beyond them, Continent Scale sets how far it takes the land to
        // reach its full height, and Ocean Scale how far it takes the seabed to reach the
        // abyssal plain.
        COASTAL_PROFILE: {
            // Width of each band, in pixels of a BASELINE_DIMENSION map, for a slider value of 1
            // (the sliders' maximum).
            BUFFER_WIDTH: 100,
            // How much the band widths wander along the coast (0.4 is 40% either way), so the
            // bands do not trace the coastline exactly, and how long that wandering is, in
            // pixels of a BASELINE_DIMENSION map.
            BUFFER_VARIATION: 0.4,
            BUFFER_VARIATION_LENGTH: 90,
            BUFFER_VARIATION_OCTAVES: 3,
            BUFFER_VARIATION_OFFSET: { X: 9100, Y: -7300 },
            // Share of the land's full height reached at the inland edge of the coastal plain.
            PLAIN_RISE: 0.06,
            // Share of the usual land detail noise kept on the coastal plain, so it reads as low,
            // gently rolling ground rather than a flat sheet.
            PLAIN_DETAIL: 0.6,
            // Landmasses too small to rise fully over Continent Scale rise over their own size
            // instead: the distance from their coast to their middle, less any coastal plain,
            // times LANDMASS_RISE_FACTOR (above 1 so the middle stops a little short of the full
            // height). The coastal plain may take up at most PLAIN_SHARE_OF_LANDMASS of that
            // distance, so a small island is never all plain. LANDMASS_MIN_RISE, in pixels of a
            // BASELINE_DIMENSION map, stops the tiniest islets turning into spikes.
            LANDMASS_RISE_FACTOR: 1.25,
            PLAIN_SHARE_OF_LANDMASS: 0.4,
            LANDMASS_MIN_RISE: 10,
            // Shares of the full ocean depth (OCEAN_DEPTH_CAP below sea level) at the outer edge
            // of the shelf and on the abyssal plain.
            SHELF_DEPTH: 0.08,
            ABYSS_DEPTH: 0.85,
            // The continental slope: the share of Ocean Scale over which the seabed falls
            // from the shelf edge to the abyssal plain, and how sharply (a higher exponent falls
            // faster at first and levels out sooner).
            SLOPE_REACH: 0.6,
            SLOPE_EXPONENT: 4,
            // Amplitude of the detail noise on the seabed: on the shelf, and the extra it gains
            // out on the abyssal plain.
            SHELF_NOISE: 0.04,
            ABYSS_NOISE: 0.08,
            // Mid-ocean ridges, raised along the line through the ocean equally far from two
            // continents (see ProceduralEngine#buildRidgeField and #ridgeLift). Lengths are in
            // pixels of a BASELINE_DIMENSION map; heights are shares of the full ocean depth.
            OCEAN_RIDGES: {
                // Size of a cell of the grid the ridge lines are found on (the whole map at the
                // top of the chain of crops, whatever this map's own size or zoom)
                CELL_SIZE: 4,
                // Only landmasses whose middle lies at least this far from their coast divide the
                // ocean; smaller islands would each sit inside their own ring of ridges
                MIN_LANDMASS_REACH: 25,
                // Height of the crest above the abyssal plain with the setting at 1
                HEIGHT: 0.6,
                // Distance from the crest at which the flanks reach the abyssal plain
                HALF_WIDTH: 90,
                // The rift valley along the crest: its width, and its depth as a share of the
                // ridge's height
                RIFT_WIDTH: 4,
                RIFT_DEPTH: 0.2,
                // How far, and over what length, the crest wanders from side to side
                WANDER: 14,
                WANDER_LENGTH: 70,
                WANDER_OCTAVES: 3,
                // How much, and over what length, the crest's height varies along the ridge
                HEIGHT_VARIATION: 0.35,
                HEIGHT_VARIATION_LENGTH: 120,
                HEIGHT_VARIATION_OCTAVES: 2,
                NOISE_OFFSET: { X: 6200, Y: -2900 },
            },
        },
    },
    // Which revision of the terrain generation rules a saved map was built with. Generation is
    // re-run from the saved settings every time a map is opened (no terrain pixels are stored),
    // so a change to the rules that alters the output of existing settings would silently change
    // every saved map. Instead, each map records the revision it was made with, and anything that
    // differs between revisions is decided from that number (see TerrainVersion).
    //   1 - every map saved before the number existed. Regional maps store a wind distance that
    //       was scaled by the crop's zoom on top of the scaling getWindDistance already applies,
    //       and add no extra terrain detail when zoomed in.
    //   2 - regional maps store a wind distance that makes their wind reach exactly their
    //       parent's enlarged by the zoom, whatever the crop's shape, and add finer terrain,
    //       moisture and temperature detail (extra noise octaves) in proportion to how far they
    //       are zoomed in. Guided terrain is worked out in the pixels of the map at the top of
    //       its chain of crops (so a regional map matches its parent), and its pixel-sized
    //       settings are scaled to the map's size (so a slider value looks the same at any
    //       resolution; see COASTLINE_ENGINES). Its coastal profile is rebuilt: Continental Shelf
    //       and the new Coastal Plains are bands of set width along the coast, the seabed beyond
    //       the shelf falls steeply to an abyssal plain, and Continent Scale no longer changes the
    //       coastline itself (see GENERATION.COASTAL_PROFILE). Tectonic terrain is rebuilt on
    //       the same pipeline, with its land placed by tectonic plates.
    TERRAIN_VERSION: {
        LEGACY: 1,
        CURRENT: 2,
        // Engines that build their terrain outward from a coastline, and so use the coastline
        // rules of the current revision: settings measured in pixels of a map BASELINE_DIMENSION
        // pixels across and scaled to the actual map (before, they were fixed pixel counts, so
        // the same values gave smoother, straighter coastlines on bigger maps), and the coastal
        // profile described in GENERATION.COASTAL_PROFILE. For the tectonic engine ("advanced")
        // the current revision is a different engine altogether: the guided pipeline with land
        // placed by tectonic plates (ProceduralEngine.generateTectonicV2Topography), where
        // revision 1 kept the original tectonic engine (generateTectonicTopography).
        COASTLINE_ENGINES: ["guided", "advanced"],
        // Coastline engines whose legacy revision was a different engine altogether, so updating
        // one of their maps builds new terrain from the same settings rather than refining it
        // (and no setting can be converted to keep its old look)
        REPLACED_ENGINES: ["advanced"],
    },
    LIMITS: {
        HISTORY_MAX: 100,
        SNAP_THRESHOLD: 15,
        NOISE_SCALE_MIN: 100,
        NOISE_SCALE_MAX: 8000,
        NOISE_SCALE_STEP: 50,
        OVERFLOW_BUFFER: 100,
        BASELINE_DIMENSION: 1000,
        CUSTOM_BIOME_START_ID: 14,
        // The fewest nodes a polygon (region or guided-mode land mask) needs to enclose an area.
        // A shape still below this when the user finishes drawing it is discarded, since it could
        // never be selected or edited as a shape, and terrain generation ignores land masks below it.
        MIN_POLYGON_VERTICES: 3,
    },
    UI: {
        RTL_LANGUAGES: ["ar", "he", "fa", "ur"],
        VISIBILITY_STATES: ["all", "gm", "none"],
        EDITABLE_TOOLS: ["scene", "terrain", "biomes", "features", "infrastructure", "regions", "labels", "cartography"],
        VECTOR_TOOLS: ["scene", "features", "infrastructure", "regions", "labels", "cartography"],
        // How far (in screen pixels) the pointer must travel after pressing on a node, pin, label or
        // decoration before it counts as a drag. A press-and-release below this - such as either
        // half of a double-click - is a click and must not move the item, record an undo step or
        // trigger a terrain regeneration.
        NODE_DRAG_THRESHOLD_PX: 4,
        WHEEL: {
            SCALE_FACTOR: 1.05,
            ROTATION_STEP: 5,
            CAMERA_FACTOR: 1.1,
        },
        ZOOM: {
            FACTOR: 1.25,
            MIN_BOUNDS_SIZE: 400,
            PADDING_FACTOR: 1.2,
            MAX_ZOOM_SCALE: 2,
            MIN_ZOOM_FLOOR: 5,
            MAX_ZOOM_DIVISOR: 250,
            VISUAL_PADDING: 30,
        },
        REFERENCE_IMAGE: {
            SCALE_MIN: 0.1,
            SCALE_MAX: 10,
            SCALE_FACTOR: 1.01,
        },
        REGIONAL_CROP: {
            PADDING: 50,
        },
        CANVAS_BUFFER: 200,
        DEBOUNCE_MS: {
            TERRAIN: 800,
            CLIMATE: 800,
            FEATURES: 600,
            CANVAS: 2000,
            // Repainting the map after a display slider moves (contours, relief shading). Short,
            // since nothing is regenerated, but long enough that dragging a slider does not
            // repaint the whole map for every step it passes through.
            DISPLAY: 300,
            // How long after the last refresh the rebuild scratch buffer (a map-sized float raster
            // used to compare the rebuilt terrain and water with the live ones) is released.
            // It is recreated on demand, so this only trades a short allocation on the next edit
            // for not holding the memory while the map sits idle.
            SCRATCH_RELEASE: 30000,
        },
    },
    DISPLAY: {
        ALPHA: 0.8,
        GRID_ALPHA: 0.15,
        BIOME_ALPHA_ACTIVE: 0.85,
        BIOME_ALPHA_INACTIVE: 0.65,
        RIVER_WIDTH: 2,
        RIVER_ALPHA: 0.9,
        PIN_RADIUS: 6,
        PIN_ALPHA: 0.4,
        CONTOUR_INTERVAL: 0.1,
        // Relief shading of the elevation layer (see ProceduralEngine#shadeRelief): its default
        // strength (0 is off; each map sets its own) and the compass bearing the light comes from.
        // The bearing is fixed as part of the module's look rather than offered as a setting:
        // 315 (the north-west) is the usual choice for maps, and light from the south or east
        // makes hills read as sunken, so other angles gain little.
        RELIEF_SHADING: 0.5,
        LIGHT_DIRECTION: 315,
        RELIEF: {
            // How high the light stands above the horizon, in degrees
            ALTITUDE: 45,
            // How much slopes are steepened before shading, per pixel of a BASELINE_DIMENSION
            // map; elevations run from 0 to 1, so real slopes are far too gentle to shade visibly
            EXAGGERATION: 100,
            // Limits on how far shading can darken or brighten a pixel (as multiples of its colour)
            MIN_FACTOR: 0.35,
            MAX_FACTOR: 1.6,
        },
        // How far past a repaint area the colour, biome and contour painters also write: each pixel
        // there depends on its neighbours (contour lines sit between two pixels), so the ring just
        // outside the area is redrawn with it. See ProceduralEngine.getRepaintBounds.
        REPAINT_MARGIN: 1,
        FALLBACK_HIGHLIGHT_COLOR: [255, 32, 200],
        FALLBACK_HIGHLIGHT_ALPHA: 0.55,
        // Guided-mode land mask colours, shared by the canvas outline and the Land Masks list swatch
        // so the two always agree: "add" shapes mark land, "subtract" shapes mark ocean holes.
        LAND_MASK_COLORS: {
            ADD: "#4ade80",
            SUBTRACT: "#f87171",
        },
    },
    HYDROLOGY: {
        RIVER_DENSITY: 40,
        MAX_LAKE_SIZE: 8000,
        SPRING_ALTITUDE_OFFSET: 0.25,
        SPRING_MOISTURE_MIN: 0.45,
        MEANDER_JITTER: 0,
        MANUAL_RIVER_DEPTHS: {
            2: 0.015,
            4: 0.025,
            6: 0.035,
            8: 0.05,
        },
        MAX_PATH_LENGTH: 5,
        MAX_RIVER_LENGTH_MULT: 1.5,
    },
    CLIMATE: {
        WIND_DISTANCE: 40,
        ALTITUDE_COOLING: 0.4,
        FREEZING_THRESHOLD: 0.2,
        THRESHOLDS: {
            TEMPERATURE: {
                ARCTIC: 0.2,
                SUBARCTIC: 0.4,
                TEMPERATE: 0.8,
            },
            MOISTURE: {
                ARCTIC: {
                    SNOW: 0.5,
                },
                SUBARCTIC: {
                    TUNDRA: 0.3,
                    TAIGA: 0.6,
                },
                TEMPERATE: {
                    DESERT: 0.25,
                    GRASSLAND: 0.6,
                    DECIDUOUS: 0.85,
                },
                TROPICAL: {
                    DESERT: 0.2,
                    SAVANNA: 0.4,
                    DECIDUOUS: 0.7,
                },
            },
        },
    },
    // Thresholds used by GridDataExporter to classify each Scene grid cell's terrain, moisture and
    // temperature into the coarse bands documented in design/GRID-DATA-SCHEMA.md. Keeping these as
    // named constants, rather than literals inside the exporter, is what keeps that document and
    // the actual export in agreement - if a threshold changes here, the doc's tables need updating
    // to match, but there is only ever one place that defines the real cut-points.
    GRID_DATA: {
        // Bump only for a breaking change to the flag's shape (a field removed, renamed, or
        // reinterpreted). Adding a new optional field to a cell does not require a bump - existing
        // consumers reading older fields are unaffected.
        SCHEMA_VERSION: 1,
        // Land terrain bands are each defined by a lower threshold only, open-ended at the top, and
        // read against the map's effective sea level (MapStateManager.getDerivedMapParameters's
        // `params.seaLevel`, not the raw uiState.seaLevel slider - Advanced-mode maps pin their
        // effective sea level to 0.35 regardless of what that slider shows). There is deliberately
        // no upper bound: hand-edited terrain (brush, tectonic faults, carved rivers) can push
        // elevation past 1.0, and a band with a fixed ceiling would either drop that terrain from
        // every band or need constant re-clamping as the edit tools' own ceiling changes.
        TERRAIN_BAND_OFFSETS: {
            LOWLAND: 0,
            UPLAND: 0.1,
            HIGHLAND: 0.22,
            MOUNTAIN: 0.38,
        },
        // Flat cut-points against the raw [0,1] moisture value, independent of sea level. Not tied
        // to getBiomeKey's own per-band moisture cutoffs (FILRODENSWMB.CLIMATE.THRESHOLDS.MOISTURE),
        // which are deliberately differently-spaced for biome selection rather than a general-purpose
        // export classification.
        MOISTURE_CUTOFFS: {
            DRY: 0.33,
            WET: 0.66,
        },
        // Flat cut-points against the raw [0,1] temperature value, equal fifths across the full
        // range. Like MOISTURE_CUTOFFS, deliberately not tied to getBiomeKey's own (differently
        // spaced) arctic/subarctic/temperate thresholds - temperature is never hand-edited past
        // [0,1] by any tool in the module, so unlike TERRAIN_BAND_OFFSETS this needs no open-ended
        // top band.
        TEMPERATURE_CUTOFFS: {
            FRIGID: 0.2,
            COLD: 0.4,
            TEMPERATE: 0.6,
            WARM: 0.8,
        },
    },
    NOISE: {
        OFFSET_MOISTURE: 10000,
        OFFSET_TEMP: 20000,
        ELEVATION: { SCALE: 250, OCTAVES: 5, PERSISTENCE: 0.5, LACUNARITY: 2, EXPONENT: 1.2, STRETCH: 1.75 },
        MOISTURE: { SCALE: 500, OCTAVES: 3, PERSISTENCE: 0.6, LACUNARITY: 2, EXPONENT: 1, STRETCH: 1.2 },
        TEMPERATURE: { SCALE: 500, OCTAVES: 2, PERSISTENCE: 0.5, LACUNARITY: 2, EXPONENT: 1, STRETCH: 1 },
    },
    BIOMES: {
        // Oceans
        DEEP_OCEAN: [26, 75, 132],
        SHALLOW_OCEAN: [46, 117, 182],
        PACK_ICE: [225, 235, 240],

        // Cold
        SNOW: [240, 240, 240],
        TUNDRA: [149, 163, 164],
        TAIGA: [77, 107, 83],

        // Temperate
        GRASSLAND: [141, 163, 104],
        DECIDUOUS_FOREST: [58, 122, 70],
        TEMPERATE_RAINFOREST: [41, 92, 53],
        TEMPERATE_DESERT: [194, 178, 128],

        // Tropical
        TROPICAL_RAINFOREST: [23, 66, 32],
        SAVANNA: [196, 186, 114],
        SUBTROPICAL_DESERT: [214, 198, 137],
    },
    BIOME_IDS: {
        // Sentinel: "erase to the computed biome" - never a real painted colour.
        // ProceduralEngine.resolveBiomeLookup already treats any override <= 0 as "no override,
        // compute the biome normally" (its `overrideId > 0` check); this just gives that existing
        // sentinel a name instead of a bare literal 0. Deliberately excluded from
        // MapStudioApp's context.biomeList, since it's offered as its own toolbar icon rather
        // than a dropdown option.
        ERASER: 0,
        DEEP_OCEAN: 1,
        SHALLOW_OCEAN: 2,
        SNOW: 3,
        TUNDRA: 4,
        TAIGA: 5,
        GRASSLAND: 6,
        DECIDUOUS_FOREST: 7,
        TEMPERATE_RAINFOREST: 8,
        TEMPERATE_DESERT: 9,
        TROPICAL_RAINFOREST: 10,
        SAVANNA: 11,
        SUBTROPICAL_DESERT: 12,
        PACK_ICE: 13,
    },
    COMPENDIUM: {
        NAME: "fwmb-maps",
        LABEL: "Filroden's World Map Builder",
    },
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
    REGIONS: {
        PRESETS: ["#C84B31", "#E28743", "#E8B851", "#4F7942", "#8A9A5B", "#3B8388", "#2D70B3", "#4A4E69", "#7A5C9B", "#B56576", "#A0522D", "#CC7161", "#6C7A89", "#A89F91", "#E08E79"],
    },
    LABELS: {
        DEFAULT_FONT: "Signika",
        DEFAULT_SIZE: 1,
        DEFAULT_COLOR: "#DEDCD3",
        DEFAULT_TEXT: "FILRODENSWMB.LABELS.DefaultLabel",
        PRESETS: ["#FFFFFF", "#DEDCD3", "#CEBB92", "#8A734D", "#E0F0FA", "#8DB2CC", "#2A4B66", "#1A1A1A"],
    },
    PINS: {
        DEFAULT_SCALE: 1,
    },
    TECTONICS: {
        DEFAULT_THICKNESS: 40,
        DEFAULT_STRENGTH: 0.25,
        HOTSPOT_SPACING: 35,
        HOTSPOT_DECAY: 0.85,
        BOUNDING_PADDING: 1.5,
        TYPES: {
            CONVERGENT: "convergent",
            DIVERGENT: "divergent",
            SLIP: "slip",
            HOTSPOT: "hotspot",
        },
        LABELS: {
            convergent: "FILRODENSWMB.TECTONICS.Convergent",
            divergent: "FILRODENSWMB.TECTONICS.Divergent",
            slip: "FILRODENSWMB.TECTONICS.Slip",
            hotspot: "FILRODENSWMB.TECTONICS.Hotspot",
        },
        COLORS: {
            convergent: "#ef4444",
            divergent: "#06b6d4",
            slip: "#f59e0b",
            hotspot: "#d97706",
        },
    },
    ENTITY_CONFIG: {
        decoration: { stateKey: "mapDecorations", activeKey: null, triggersTerrain: false },
        // `smoothed: true` marks entities StudioCanvas always renders as a Catmull-Rom curve
        // (see #getSplinePoints), so node-insertion hit-testing must test against that curve too
        // rather than the straight chords between control points. Manual rivers render as a plain
        // straight polyline despite their name, so they are deliberately left un-smoothed here.
        fault: { stateKey: "tectonicFaults", activeKey: "activeFaultId", triggersTerrain: true, toolCategory: "features", smoothed: true },
        label: { stateKey: "mapLabels", activeKey: null, triggersTerrain: false },
        pin: { stateKey: "mapPins", activeKey: null, triggersTerrain: false },
        regionLayer: { stateKey: "regionLayers", activeKey: "activeRegionLayerId", triggersTerrain: false, isLayer: true },
        river: { stateKey: "manualRivers", activeKey: "activeRiverId", triggersTerrain: true, toolCategory: "features" },
        route: { stateKey: "mapRoutes", activeKey: "activeRouteId", triggersTerrain: false, toolCategory: "infrastructure", smoothed: true },
    },
};
