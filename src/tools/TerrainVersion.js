import { FILRODENSWMB } from "../config.js";

/**
 * Everything that differs between revisions of the terrain generation rules, in one place.
 *
 * A map's terrain is never stored: it is regenerated from the saved settings each time the map is
 * opened. Improving the generation rules would therefore change every map already saved, so each
 * map records the revision it was made with (`terrainVersion`, see FILRODENSWMB.TERRAIN_VERSION)
 * and this class turns that number into the plain values the rest of the module works with.
 *
 * The generation engines never read the version themselves. They are handed ordinary parameters
 * (such as a number of extra noise octaves) whose legacy value reproduces the old behaviour
 * exactly, so supporting an older revision costs a default value rather than a second code path.
 * If support for an old revision is ever dropped, the change is confined to this file.
 *
 * Nothing here touches Foundry globals, so it can be exercised directly from Node.
 */
export class TerrainVersion {
    /**
     * The revision a saved map (or a map's uiState) was built with. Anything saved before the
     * revision number existed carries no value and is revision 1.
     *
     * @param {object|null} source - A saved map payload or a uiState object.
     * @returns {number} The terrain revision.
     */
    static getVersion(source) {
        return source?.terrainVersion ?? FILRODENSWMB.TERRAIN_VERSION.LEGACY;
    }

    /**
     * How many noise octaves to add to the elevation, moisture and temperature noise, on top of
     * their own octave counts, so a regional map fills in finer terrain and biome detail instead
     * of simply magnifying its parent.
     *
     * Each octave doubles the noise frequency, so a map zoomed in by a factor of Z needs log2(Z)
     * more octaves to keep the same amount of detail per pixel as its parent. The extra octaves
     * are normalised against the slider's octave count (see ProceduralEngine#fbm), so they add
     * small-scale variation without shifting the coarse shape the parent map already shows.
     *
     * Revision 1 maps always get 0, which reproduces their original terrain exactly.
     *
     * @param {object} state - The map's uiState (reads terrainVersion and world).
     * @returns {number} A whole number of extra octaves, 0 or more.
     */
    static getExtraOctaves(state) {
        if (this.getVersion(state) < FILRODENSWMB.TERRAIN_VERSION.CURRENT) return 0;

        const zoom = state.world?.zoom ?? 1;
        if (zoom <= 1) return 0;

        return Math.round(Math.log2(zoom));
    }

    /**
     * The total zoom of a revision 1 regional map relative to the map at the top of its chain of
     * crops, recovered from its saved wind distance.
     *
     * Revision 1 never saved the zoom itself, but the regional extractor multiplied the wind
     * distance by each crop's zoom, and the wind distance has no control of its own anywhere in
     * the interface. So a saved wind distance divided by the baseline is exactly the product of
     * every crop's zoom, including crops of crops. A map that was never cropped reads as 1.
     *
     * The result can be below 1: a regional map may be generated at fewer pixels than the crop
     * it was cut from (a 2000 pixel wide crop saved as a 1000 pixel wide map is x0.5), and it is
     * still a regional map whose wind distance was scaled.
     *
     * @param {object} state - A uiState object (reads windDistance).
     * @returns {number} The cumulative zoom (1 for a map that was never cropped).
     */
    static getLegacyZoom(state) {
        const baseline = FILRODENSWMB.CLIMATE.WIND_DISTANCE;
        const windDistance = state.windDistance ?? baseline;
        return windDistance > 0 ? windDistance / baseline : 1;
    }

    /**
     * Whether a map was built with the legacy terrain revision and is a regional map (a crop of
     * another map). These are the only maps the current revision changes; a legacy map that was
     * never cropped regenerates identically under either revision.
     *
     * @param {object} state - A uiState object or saved payload's equivalent fields.
     * @returns {boolean}
     */
    static isLegacyRegional(state) {
        return this.getVersion(state) < FILRODENSWMB.TERRAIN_VERSION.CURRENT && this.getLegacyZoom(state) !== 1;
    }

    /**
     * The wind distance setting that gives a map exactly the wind reach of the map at the top of
     * its chain of crops, enlarged by the map's zoom.
     *
     * ProceduralEngine.getWindDistance turns the setting into pixels using the map's width and
     * the span of latitude it covers (its height, in degrees). A crop enlarges the width and the
     * pixels-per-degree of latitude by the same zoom, so a crop with the top map's shape needs
     * the baseline setting unchanged. A crop of a different shape does not: its width grows with
     * the crop's width but its latitude span shrinks with its height, so a crop twice as wide
     * (relative to its height) as the top map would reach twice too far downwind. Scaling the
     * baseline by the top map's shape divided by this map's shape cancels that out exactly, and
     * the zoom itself cancels too, so it does not appear here.
     *
     * @param {number} rootShape - Width divided by height of the map at the top of the chain.
     * @param {number} mapShape - Width divided by height of this map (or of the crop that made it).
     * @returns {number} The wind distance setting.
     */
    static getWindDistanceFor(rootShape, mapShape) {
        return FILRODENSWMB.CLIMATE.WIND_DISTANCE * (rootShape / mapShape);
    }

    /**
     * The width divided by height of the map at the top of a map's chain of crops, if known.
     *
     * A map's own world description carries the top map's size (revision 2 regional maps), and a
     * map that was never cropped is its own top map. A revision 1 regional map knows neither, so
     * the caller may supply the size found by walking its chain of parent maps (see
     * TerrainUpgrade.resolveLegacyRootSize).
     *
     * @param {object} state - A uiState object.
     * @param {{width: number, height: number}|null} [rootSize] - The top map's size, if found elsewhere.
     * @returns {number|null} The top map's shape, or null if it cannot be known.
     */
    static getRootShape(state, rootSize = null) {
        const world = this.resolveWorld(state);
        const width = world.rootW ?? rootSize?.width ?? null;
        const height = world.rootH ?? rootSize?.height ?? null;
        return width && height ? width / height : null;
    }

    /**
     * The wind distance setting to store on a regional map cropped out of a parent map (see
     * getWindDistanceFor for why it depends on shape rather than zoom).
     *
     * If the shape of the map at the top of the chain cannot be known (a crop of a revision 1
     * regional map whose chain of parents could not be followed), the parent's own shape stands
     * in for it, which is exact whenever the parent was cropped to the top map's proportions.
     *
     * @param {object} parentState - The parent map's uiState, before any regional scaling.
     * @param {{width: number, height: number}} cropBox - The crop, in the parent's pixels.
     * @param {{width: number, height: number}|null} [rootSize] - The top map's size, if known.
     * @returns {number} The wind distance setting for the regional map.
     */
    static getRegionalWindDistance(parentState, cropBox, rootSize = null) {
        const parentShape = parentState.mapWidth / parentState.mapHeight;
        const rootShape = this.getRootShape(parentState, rootSize) ?? parentShape;
        return this.getWindDistanceFor(rootShape, cropBox.width / cropBox.height);
    }

    /**
     * What a legacy regional map's settings become when it is updated to the current terrain
     * revision: the current revision number, the corrected wind distance, and a world
     * description carrying its zoom (so it gains the extra detail octaves) and, if known, the size
     * of the map at the top of its chain.
     *
     * Its position within that top map cannot be recovered and is left unknown; nothing in the
     * current revision needs it for a map of this kind.
     *
     * @param {object} state - The legacy regional map's uiState.
     * @param {{width: number, height: number}|null} [rootSize] - The top map's size, if found.
     * @returns {{terrainVersion: number, windDistance: number, world: object}} The settings to apply.
     */
    static planUpgrade(state, rootSize = null) {
        const mapShape = state.mapWidth / state.mapHeight;
        const rootShape = this.getRootShape(state, rootSize) ?? mapShape;

        return {
            terrainVersion: FILRODENSWMB.TERRAIN_VERSION.CURRENT,
            windDistance: this.getWindDistanceFor(rootShape, mapShape),
            world: {
                zoom: this.getLegacyZoom(state),
                originX: null,
                originY: null,
                rootW: rootSize?.width ?? null,
                rootH: rootSize?.height ?? null,
            },
        };
    }

    /**
     * Describes where a map sits in the world of the map at the top of its chain of crops, in
     * that top map's pixels: how far it is zoomed in (`zoom`), where its top-left corner is
     * (`originX`, `originY`) and how large the top map is (`rootW`, `rootH`).
     *
     * A map that has never been cropped has no stored world; it is its own top map, so this
     * returns zoom 1 at the origin with its own size. A revision 1 regional map has no stored
     * world either. Only its zoom can be recovered (see getLegacyZoom), so its position and the
     * top map's size are reported as null rather than guessed.
     *
     * @param {object} state - A uiState object (reads world, terrainVersion, windDistance,
     *   mapWidth and mapHeight).
     * @returns {{zoom: number, originX: number|null, originY: number|null, rootW: number|null, rootH: number|null}}
     */
    static resolveWorld(state) {
        if (state.world) return { ...state.world };

        // Only a revision 1 map encodes its zoom in the wind distance; from revision 2 on the
        // wind distance also depends on the crop's shape, so it must not be read as a zoom.
        if (this.isLegacyRegional(state)) {
            return { zoom: this.getLegacyZoom(state), originX: null, originY: null, rootW: null, rootH: null };
        }

        return { zoom: 1, originX: 0, originY: 0, rootW: state.mapWidth, rootH: state.mapHeight };
    }

    /**
     * The world description of a regional map cropped out of a parent map.
     *
     * Zoom compounds (a x2 crop of a x4 regional map is x8 of the top map). The crop box is in
     * the parent's own pixels, so it is divided by the parent's zoom to place the child's corner
     * in the top map's pixels. Anything the parent does not know (see resolveWorld) stays null,
     * except the top map's size, which the caller may supply if it found it another way.
     *
     * @param {object} parentState - The parent map's uiState, before any regional scaling.
     * @param {{x: number, y: number}} cropBox - The crop's top-left corner, in the parent's pixels.
     * @param {number} zoomScale - How much the crop is enlarged to fill the regional map.
     * @param {{width: number, height: number}|null} [rootSize] - The top map's size, if known.
     * @returns {{zoom: number, originX: number|null, originY: number|null, rootW: number|null, rootH: number|null}}
     */
    static deriveChildWorld(parentState, cropBox, zoomScale, rootSize = null) {
        const parent = this.resolveWorld(parentState);
        const offsetInRoot = (origin, cropOffset) => (origin === null ? null : origin + cropOffset / parent.zoom);

        return {
            zoom: parent.zoom * zoomScale,
            originX: offsetInRoot(parent.originX, cropBox.x),
            originY: offsetInRoot(parent.originY, cropBox.y),
            rootW: parent.rootW ?? rootSize?.width ?? null,
            rootH: parent.rootH ?? rootSize?.height ?? null,
        };
    }
}
