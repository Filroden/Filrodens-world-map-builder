import { TerrainShading } from "../tools/TerrainShading.js";
import { getRegionUploadResource } from "./RegionUploadResource.js";

/** The terrain images the compositor draws from, by the shader uniform each is bound to. */
const TEXTURE_UNIFORMS = Object.freeze({ surface: "uSurface", underwater: "uUnderwater", aux: "uAux", rivers: "uRivers" });

/** The shader uniform told how many map pixels one screen pixel covers (see getTerrainMeshClass). */
const FOOTPRINT_UNIFORM = "uRiverFootprint";

/** The smallest scale the footprint is worked out for, so a collapsed canvas never divides by zero. */
const MIN_SCALE = 1e-6;

/** Which shader switch each layer setting drives (1 on, 0 off). */
const LAYER_UNIFORMS = Object.freeze({
    elevation: "uElevationOn",
    relief: "uReliefOn",
    water: "uWaterOn",
    landBiomes: "uLandOn",
    seaBiomes: "uSeaOn",
});

/** Which shader value each numeric setting drives. */
const VALUE_UNIFORMS = Object.freeze({
    biomeAlpha: "uBiomeAlpha",
    reliefStrength: "uReliefStrength",
    seabedRelief: "uSeabedRelief",
    clarity: "uClarity",
    hueShift: "uHueShift",
    saturation: "uSaturation",
});

// One class per PIXI namespace, as for RegionUploadResource
const meshClasses = new WeakMap();

/**
 * Returns the mesh class the terrain is drawn with: a PIXI.Mesh that, just before each draw, tells
 * its shader how many map pixels one pixel of the screen (or of an export) covers. The shader
 * softens a river's edge over that width, so a river is sharp when zoomed in and fades smoothly,
 * rather than breaking up, where it is narrower than a pixel.
 *
 * Working it out from the mesh's own transform at draw time means it follows every way the canvas
 * is zoomed (the mouse wheel, the zoom buttons, zoom to feature, the camera reset) and the enlarged
 * stage an export is drawn at, without any of them having to report a change. The renderer's
 * resolution counts too: on a high-density display one screen pixel is several device pixels.
 *
 * Written against PIXI 7's Mesh._render(renderer), the method subclasses override to draw.
 *
 * @param {object} pixi - The PIXI namespace.
 * @returns {Function} A subclass of PIXI.Mesh.
 */
function getTerrainMeshClass(pixi) {
    if (meshClasses.has(pixi)) return meshClasses.get(pixi);

    const TerrainMesh = class extends pixi.Mesh {
        _render(renderer) {
            const transform = this.worldTransform;
            // Drawing into a render texture (an export), its own resolution applies, not the screen's
            const target = renderer.renderTexture?.current;
            const resolution = (target ? target.resolution : renderer.resolution) ?? 1;
            const devicePixelsPerMapPixel = Math.hypot(transform.a, transform.b) * resolution;
            this.shader.uniforms[FOOTPRINT_UNIFORM] = 1 / Math.max(devicePixelsPerMapPixel, MIN_SCALE);
            super._render(renderer);
        }
    };

    meshClasses.set(pixi, TerrainMesh);
    return TerrainMesh;
}

/**
 * Draws the terrain (elevation, relief shading, water, rivers and biomes) on the map canvas as one
 * mesh whose shader combines four map-sized images (see TerrainShading for the maths and the images).
 *
 * The images are uploaded through RegionUploadResource, so a repaint of a small area sends only
 * the rows it changed to the GPU. The layer switches, biome opacity, relief strength and water
 * settings are shader uniforms: changing them redraws the next frame with no repaint at all.
 *
 * The mesh is a plain quad the size of the map in map pixels, so it sits in the same space as
 * the canvas's other layers and is moved, zoomed and exported with them.
 */
export class TerrainCompositor {
    #pixi;
    #mesh = null;
    #textures = {};
    #width = 0;
    #height = 0;
    #settings;

    /**
     * @param {object} pixi - The PIXI namespace.
     */
    constructor(pixi) {
        this.#pixi = pixi;
        this.#settings = TerrainShading.defaultSettings();
    }

    /** The mesh to add to the stage (null until the first update). */
    get displayObject() {
        return this.#mesh;
    }

    /**
     * Sends the terrain images to the GPU. The first call, and any call at a new map size,
     * builds the textures and the mesh (see displayObject: the caller adds a new mesh to its
     * layer); later calls copy only the rows inside `bounds`.
     *
     * @param {{surface: Uint8Array, underwater: Uint8Array, aux: Uint8Array, rivers: Uint8Array}} buffers - RGBA images of the whole map.
     * @param {number} width - Map width in pixels.
     * @param {number} height - Map height in pixels.
     * @param {object|null} bounds - The pixels that changed since the last call, or null for all of them.
     * @returns {boolean} True when a new mesh was built.
     */
    update(buffers, width, height, bounds = null) {
        const rebuilt = !this.#mesh || width !== this.#width || height !== this.#height;
        if (rebuilt) this.#build(buffers, width, height);

        for (const key of Object.keys(TEXTURE_UNIFORMS)) {
            const baseTexture = this.#textures[key].baseTexture;
            baseTexture.resource.write(buffers[key], rebuilt ? null : bounds);
            baseTexture.update();
        }
        return rebuilt;
    }

    /**
     * Changes how the terrain is drawn: any of the settings TerrainShading.defaultSettings lists
     * (the five layer switches as booleans, and the numeric values). Takes effect on the next
     * frame; nothing is repainted.
     * @param {object} changes
     */
    setSettings(changes) {
        this.#settings = { ...this.#settings, ...changes };
        this.#applySettings();
    }

    /** The current settings (a copy). */
    get settings() {
        return { ...this.#settings };
    }

    destroy() {
        this.#mesh?.destroy();
        for (const texture of Object.values(this.#textures)) texture.destroy(true);
        this.#mesh = null;
        this.#textures = {};
    }

    /** Builds the four textures and the mesh that draws them, for a map of this size. */
    #build(buffers, width, height) {
        this.destroy();
        const PIXI = this.#pixi;
        const RegionUploadResource = getRegionUploadResource(PIXI);

        for (const key of Object.keys(TEXTURE_UNIFORMS)) {
            // Each texture keeps its own copy of the pixels, decoupled from the painters' buffer.
            // Colour with transparency is premultiplied on upload (PIXI's default), which keeps
            // the linear filtering used when zoomed in from darkening biome edges; the shader
            // divides it back out. The packed image is always opaque, so premultiplying leaves it as it is.
            const resource = new RegionUploadResource(new Uint8Array(buffers[key].length), { width, height });
            const baseTexture = new PIXI.BaseTexture(resource, { alphaMode: PIXI.ALPHA_MODES.PREMULTIPLY_ON_UPLOAD, scaleMode: PIXI.SCALE_MODES.LINEAR });
            this.#textures[key] = new PIXI.Texture(baseTexture);
        }

        const geometry = new PIXI.Geometry()
            .addAttribute("aVertexPosition", [0, 0, width, 0, width, height, 0, height], 2)
            .addAttribute("aUvs", [0, 0, 1, 0, 1, 1, 0, 1], 2)
            .addIndex([0, 1, 2, 0, 2, 3]);

        const uniforms = {};
        for (const [key, uniform] of Object.entries(TEXTURE_UNIFORMS)) uniforms[uniform] = this.#textures[key];

        uniforms[FOOTPRINT_UNIFORM] = 1;

        const shader = PIXI.Shader.from(TerrainShading.vertexSource(), TerrainShading.fragmentSource(), uniforms);
        const TerrainMesh = getTerrainMeshClass(PIXI);
        this.#mesh = new TerrainMesh(geometry, shader);
        this.#width = width;
        this.#height = height;
        this.#applySettings();
    }

    /** Copies the settings into the shader's uniforms. */
    #applySettings() {
        const uniforms = this.#mesh?.shader.uniforms;
        if (!uniforms) return;

        for (const [key, uniform] of Object.entries(LAYER_UNIFORMS)) uniforms[uniform] = this.#settings[key] ? 1 : 0;
        for (const [key, uniform] of Object.entries(VALUE_UNIFORMS)) uniforms[uniform] = this.#settings[key];
    }
}
