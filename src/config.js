export const FILRODENSWMB = {
    ID: "filrodens-world-map-builder",
    FLAGS: {
        IS_ACTIVE: "isActiveCanvas",
        HEX_DATA: "hexData",
        PARAMS: "generationParams",
    },
    TEMPLATES: {
        TOOLBAR: "modules/filrodens-world-map-builder/templates/toolbar.hbs",
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
        CONTINENTAL_GROUPING: 0.4,
        COASTAL_BAND: 30,
        CONTINENT_SCALE: 150,
        SHELF_RANGE: 0.15,
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
        // CONTINENT_SCALE rather than fixed pixel values, so the effect scales sensibly if that
        // slider is retuned - calibrated against CONTINENT_SCALE's default of 150.
        COASTAL_VARIANCE: {
            BAND_RATIO: 0.53,
            AMPLITUDE_RATIO: 1.33,
            OCTAVES: 5,
            FREQUENCY_MULT: 16.7,
            // Arbitrary large offsets, matching the pattern of WARP.OFFSETS above, so this noise
            // field samples a different region of the simplex field than the domain warp does.
            NOISE_OFFSET: { X: 4000, Y: 4000 },
        },
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
