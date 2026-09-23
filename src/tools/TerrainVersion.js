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
     * @param {object} state - A uiState object (reads windDistance).
     * @returns {number} The cumulative zoom, 1 or more.
     */
    static getLegacyZoom(state) {
        const baseline = FILRODENSWMB.CLIMATE.WIND_DISTANCE;
        const windDistance = state.windDistance ?? baseline;
        return Math.max(1, windDistance / baseline);
    }

    /**
     * The wind distance setting to store on a regional map so that its wind reach, in its own
     * pixels, is exactly its parent's wind reach enlarged by the crop's zoom.
     *
     * ProceduralEngine.getWindDistance turns the setting into pixels using the map's width and
     * the span of latitude it covers (its height, in degrees). A crop enlarges the width and the
     * pixels-per-degree of latitude by the same zoom, so if the crop had the parent's shape the
     * parent's setting would carry over unchanged. A crop of a different shape breaks that: the
     * width grows with the crop's width but the latitude span shrinks with its height, so a crop
     * twice as wide (relative to its height) as its parent would reach twice too far downwind.
     * Scaling the setting by the parent's shape divided by the crop's shape cancels that out
     * exactly, and the zoom itself cancels too, so it does not appear here.
     *
     * The parent's setting is taken as it should be under the current rules. A revision 1
     * regional map stored its setting multiplied by its zoom (see getLegacyZoom), so for any
     * revision 1 map the setting is taken as the baseline instead.
     *
     * @param {object} parentState - The parent map's uiState, before any regional scaling.
     * @param {{width: number, height: number}} cropBox - The crop, in the parent's pixels.
     * @returns {number} The wind distance setting for the regional map.
     */
    static getRegionalWindDistance(parentState, cropBox) {
        const baseline = FILRODENSWMB.CLIMATE.WIND_DISTANCE;
        const isLegacy = this.getVersion(parentState) < FILRODENSWMB.TERRAIN_VERSION.CURRENT;
        const parentSetting = isLegacy ? baseline : (parentState.windDistance ?? baseline);

        const parentShape = parentState.mapWidth / parentState.mapHeight;
        const cropShape = cropBox.width / cropBox.height;

        return parentSetting * (parentShape / cropShape);
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
        const isLegacy = this.getVersion(state) < FILRODENSWMB.TERRAIN_VERSION.CURRENT;
        const legacyZoom = isLegacy ? this.getLegacyZoom(state) : 1;
        if (legacyZoom > 1) {
            return { zoom: legacyZoom, originX: null, originY: null, rootW: null, rootH: null };
        }

        return { zoom: 1, originX: 0, originY: 0, rootW: state.mapWidth, rootH: state.mapHeight };
    }

    /**
     * The world description of a regional map cropped out of a parent map.
     *
     * Zoom compounds (a x2 crop of a x4 regional map is x8 of the top map). The crop box is in
     * the parent's own pixels, so it is divided by the parent's zoom to place the child's corner
     * in the top map's pixels. Anything the parent does not know (see resolveWorld) stays null.
     *
     * @param {object} parentState - The parent map's uiState, before any regional scaling.
     * @param {{x: number, y: number}} cropBox - The crop's top-left corner, in the parent's pixels.
     * @param {number} zoomScale - How much the crop is enlarged to fill the regional map.
     * @returns {{zoom: number, originX: number|null, originY: number|null, rootW: number|null, rootH: number|null}}
     */
    static deriveChildWorld(parentState, cropBox, zoomScale) {
        const parent = this.resolveWorld(parentState);
        const offsetInRoot = (origin, cropOffset) => (origin === null ? null : origin + cropOffset / parent.zoom);

        return {
            zoom: parent.zoom * zoomScale,
            originX: offsetInRoot(parent.originX, cropBox.x),
            originY: offsetInRoot(parent.originY, cropBox.y),
            rootW: parent.rootW,
            rootH: parent.rootH,
        };
    }
}
