import { FILRODENSWMB } from "../config.js";
import { MeshBuilder } from "../mesh/MeshBuilder.js";
import { getRegionUploadResource } from "./RegionUploadResource.js";

/**
 * Draws one level's region fill on the GPU: a quad the size of the map whose shader looks up, for
 * each pixel, the cell under it (the cell-id texture), the region that owns the cell (the owners
 * texture) and the region's colour and fill style (the palette texture).
 *
 * The cost of a frame is per screen pixel, whatever the size of the map or the number of
 * regions, and a paint stroke only re-uploads the rows of the owners texture it touched. Regions
 * carry no geometry, so a region with holes, exclaves or a thousand cells costs the same as a
 * square.
 *
 * Every lookup texture holds integers packed into bytes, so it must come back from the GPU exactly
 * as written: sampled NEAREST, without mipmaps, and uploaded without premultiplying alpha (PIXI's
 * default premultiplication rewrites the RGB bytes of any texel whose alpha byte is not 255, which
 * corrupts every id above 16,777,215 and every palette entry with transparency). The shader turns
 * a texel back into an integer as r + g x 256 + b x 65536.
 *
 * Land and water come from the terrain compositor's packed texture (uAux, its G byte the water
 * depth, 0 on dry ground; see TerrainShading), sampled live, so a fill never needs refreshing when
 * the coast moves. Over water a region is drawn at the water tint share of its opacity, or not at
 * all when its layer set leaves claimed water untinted.
 */

/** Fill styles, as stored in the palette's second row. */
export const FILL_STYLE = Object.freeze({ solid: 0, diagonal: 1, crosshatch: 2 });

const BYTES_PER_TEXEL = 4;
const MAX_BYTE = 255;
/** Palette rows per row of keys: colours, then styles. */
const PALETTE_ROWS_PER_KEY_ROW = 2;

const VERTEX_SOURCE = `
precision highp float;
attribute vec2 aVertexPosition;
attribute vec2 aUvs;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUvs;
void main() {
    vUvs = aUvs;
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

const FRAGMENT_SOURCE = `
precision highp float;
varying vec2 vUvs;
uniform sampler2D uCellIds;
uniform sampler2D uOwners;
uniform vec2 uOwnerSize;
uniform sampler2D uPalette;
uniform vec2 uPaletteSize;
uniform sampler2D uAux;
uniform float uHasAux;
uniform vec2 uMapSize;
uniform float uOpacity;
uniform float uWaterTint;
uniform float uHatchPeriod;
uniform float uHatchHalfWidth;

float decodeId(vec4 texel) {
    vec4 bytes = floor(texel * 255.0 + 0.5);
    return bytes.r + bytes.g * 256.0 + bytes.b * 65536.0;
}

// 1 on a hatch line: lines run where v is a multiple of the period (offset by half a period, as
// the tiles earlier versions used were), and v = x + y or x - y measures along the diagonal, so
// the perpendicular distance to a line is the offset divided by the square root of two
float hatchLine(float v) {
    float offset = mod(v - uHatchPeriod * 0.5, uHatchPeriod);
    float distance = min(offset, uHatchPeriod - offset) * 0.70710678;
    return distance <= uHatchHalfWidth ? 1.0 : 0.0;
}

void main() {
    float cell = decodeId(texture2D(uCellIds, vUvs));
    float ownerRow = floor(cell / uOwnerSize.x);
    float ownerColumn = cell - ownerRow * uOwnerSize.x;
    float owner = decodeId(texture2D(uOwners, vec2((ownerColumn + 0.5) / uOwnerSize.x, (ownerRow + 0.5) / uOwnerSize.y))) - 1.0;
    if (owner < 0.0) discard;

    float keyRow = floor(owner / uPaletteSize.x);
    float keyColumn = owner - keyRow * uPaletteSize.x;
    if (keyRow * 2.0 + 1.0 >= uPaletteSize.y) discard;
    float u = (keyColumn + 0.5) / uPaletteSize.x;
    vec4 colour = texture2D(uPalette, vec2(u, (keyRow * 2.0 + 0.5) / uPaletteSize.y));
    float style = floor(texture2D(uPalette, vec2(u, (keyRow * 2.0 + 1.5) / uPaletteSize.y)).r * 255.0 + 0.5);

    vec2 position = vUvs * uMapSize;
    float pattern = 1.0;
    if (style > 0.5) pattern = hatchLine(position.x + position.y);
    if (style > 1.5) pattern = max(pattern, hatchLine(position.x - position.y));

    float wet = uHasAux > 0.5 ? clamp(texture2D(uAux, vUvs).g * 255.0, 0.0, 1.0) : 0.0;
    float alpha = colour.a * uOpacity * pattern * mix(1.0, uWaterTint, wet);
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(colour.rgb * alpha, alpha);
}`;

// One class per PIXI namespace, as for RegionUploadResource
const meshClasses = new WeakMap();

/**
 * The mesh class a fill is drawn with: a PIXI.Mesh that binds the terrain's packed texture just
 * before each draw. The compositor replaces its textures when the map changes size, so asking for
 * the current one at draw time keeps the land mask right without anyone having to report it.
 */
function getRegionMeshClass(pixi) {
    if (meshClasses.has(pixi)) return meshClasses.get(pixi);

    const RegionMesh = class extends pixi.Mesh {
        auxProvider = null;

        _render(renderer) {
            const aux = this.auxProvider?.() ?? null;
            this.shader.uniforms.uAux = aux ?? pixi.Texture.WHITE;
            this.shader.uniforms.uHasAux = aux ? 1 : 0;
            super._render(renderer);
        }
    };

    meshClasses.set(pixi, RegionMesh);
    return RegionMesh;
}

/**
 * A texture whose texels come back exactly as written (see the module comment). Shared with the
 * thematic layer (see ThematicLayer), whose lookups have the same need.
 * @param {object} pixi
 * @param {object} resource - A BufferResource (or subclass).
 */
export function exactTexture(pixi, resource) {
    const base = new pixi.BaseTexture(resource, {
        format: pixi.FORMATS.RGBA,
        type: pixi.TYPES.UNSIGNED_BYTE,
        scaleMode: pixi.SCALE_MODES.NEAREST,
        mipmap: pixi.MIPMAP_MODES.OFF,
        alphaMode: pixi.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA,
    });
    return new pixi.Texture(base);
}

/**
 * The cell under every pixel, as a texture: the mesh's cell raster viewed as RGBA bytes (no copy;
 * see MeshBuilder.packCellRaster). One per mesh, shared by every level's fill.
 * @param {object} pixi
 * @param {import("../mesh/MeshBuilder.js").Mesh} mesh
 */
export function createCellIdTexture(pixi, mesh) {
    const bytes = MeshBuilder.packCellRaster(mesh.cellRaster);
    return exactTexture(pixi, new pixi.BufferResource(bytes, { width: mesh.width, height: mesh.height }));
}

/**
 * One level's fill (see the module comment).
 */
export class RegionMeshLayer {
    #pixi;
    #mesh;
    #ownersTexture;
    #ownerBytes;
    #ownerValues;
    #paletteTexture = null;
    #paletteBytes = null;
    #rowLength;

    /**
     * @param {object} pixi - The PIXI namespace.
     * @param {object} options
     * @param {number} options.width - Map width in pixels.
     * @param {number} options.height - Map height in pixels.
     * @param {number} options.cellCount
     * @param {object} options.cellIdTexture - From createCellIdTexture.
     * @param {function(): object|null} options.auxProvider - The terrain's packed texture, or null.
     */
    constructor(pixi, { width, height, cellCount, cellIdTexture, auxProvider }) {
        this.#pixi = pixi;
        this.#rowLength = FILRODENSWMB.MESH.FILL.TEXTURE_ROW;
        const ownerRows = Math.max(1, Math.ceil(cellCount / this.#rowLength));
        this.#ownerBytes = new Uint8Array(this.#rowLength * ownerRows * BYTES_PER_TEXEL);
        this.#ownerValues = new Int32Array(this.#ownerBytes.buffer);
        const RegionUploadResource = getRegionUploadResource(pixi);
        this.#ownersTexture = exactTexture(pixi, new RegionUploadResource(new Uint8Array(this.#ownerBytes.length), { width: this.#rowLength, height: ownerRows }));

        const geometry = new pixi.Geometry()
            .addAttribute("aVertexPosition", [0, 0, width, 0, width, height, 0, height], 2)
            .addAttribute("aUvs", [0, 0, 1, 0, 1, 1, 0, 1], 2)
            .addIndex([0, 1, 2, 0, 2, 3]);
        const { HATCH_PERIOD, HATCH_LINE_WIDTH } = FILRODENSWMB.MESH.FILL;
        const shader = pixi.Shader.from(VERTEX_SOURCE, FRAGMENT_SOURCE, {
            uCellIds: cellIdTexture,
            uOwners: this.#ownersTexture,
            uOwnerSize: new Float32Array([this.#rowLength, ownerRows]),
            uPalette: pixi.Texture.EMPTY,
            uPaletteSize: new Float32Array([this.#rowLength, PALETTE_ROWS_PER_KEY_ROW]),
            uAux: pixi.Texture.WHITE,
            uHasAux: 0,
            uMapSize: new Float32Array([width, height]),
            uOpacity: 1,
            uWaterTint: 0,
            uHatchPeriod: HATCH_PERIOD,
            uHatchHalfWidth: HATCH_LINE_WIDTH / 2,
        });
        const RegionMesh = getRegionMeshClass(pixi);
        this.#mesh = new RegionMesh(geometry, shader);
        this.#mesh.auxProvider = auxProvider;
    }

    /** The mesh to add to the stage. */
    get displayObject() {
        return this.#mesh;
    }

    /**
     * Copies a level's owners into the owners texture (key + 1, 0 for unclaimed) and uploads the
     * rows that changed.
     * @param {Int32Array} owners
     * @param {{minCell: number, maxCell: number}|"all"} changes
     */
    setOwners(owners, changes = "all") {
        const all = changes === "all" || !changes;
        const first = all ? 0 : changes.minCell;
        const last = all ? owners.length - 1 : changes.maxCell;
        for (let cell = first; cell <= last; cell++) this.#ownerValues[cell] = owners[cell] + 1;

        const resource = this.#ownersTexture.baseTexture.resource;
        resource.write(this.#ownerBytes, all ? null : { minY: Math.floor(first / this.#rowLength), maxY: Math.floor(last / this.#rowLength) });
        this.#ownersTexture.baseTexture.update();
    }

    /**
     * Sets every region's colour, opacity and fill style. Keys without an entry are not drawn.
     * @param {Map<number, {color: number, alpha: number, style: number}>} entries - By region key.
     */
    setPalette(entries) {
        let highest = -1;
        for (const key of entries.keys()) highest = Math.max(highest, key);
        const keyRows = Math.max(1, Math.ceil((highest + 1) / this.#rowLength));
        const height = keyRows * PALETTE_ROWS_PER_KEY_ROW;
        const size = this.#rowLength * height * BYTES_PER_TEXEL;
        if (this.#paletteBytes?.length !== size) this.#createPalette(height, size);
        else this.#paletteBytes.fill(0);

        for (const [key, { color, alpha, style }] of entries) {
            const row = Math.floor(key / this.#rowLength);
            const column = key - row * this.#rowLength;
            const colourAt = ((row * PALETTE_ROWS_PER_KEY_ROW) * this.#rowLength + column) * BYTES_PER_TEXEL;
            const styleAt = colourAt + this.#rowLength * BYTES_PER_TEXEL;
            this.#paletteBytes[colourAt] = (color >> 16) & MAX_BYTE;
            this.#paletteBytes[colourAt + 1] = (color >> 8) & MAX_BYTE;
            this.#paletteBytes[colourAt + 2] = color & MAX_BYTE;
            this.#paletteBytes[colourAt + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * MAX_BYTE);
            this.#paletteBytes[styleAt] = style;
            this.#paletteBytes[styleAt + 3] = MAX_BYTE;
        }
        this.#paletteTexture.baseTexture.resource.write(this.#paletteBytes);
        this.#paletteTexture.baseTexture.update();
    }

    #createPalette(height, size) {
        this.#paletteTexture?.destroy(true);
        this.#paletteBytes = new Uint8Array(size);
        const RegionUploadResource = getRegionUploadResource(this.#pixi);
        this.#paletteTexture = exactTexture(this.#pixi, new RegionUploadResource(new Uint8Array(size), { width: this.#rowLength, height }));
        this.#mesh.shader.uniforms.uPalette = this.#paletteTexture;
        this.#mesh.shader.uniforms.uPaletteSize = new Float32Array([this.#rowLength, height]);
    }

    /**
     * @param {number} opacity - 0 to 1, for the whole fill.
     * @param {number} waterTint - Share of the opacity kept over water (0 hides the fill there).
     */
    setOpacity(opacity, waterTint) {
        this.#mesh.shader.uniforms.uOpacity = opacity;
        this.#mesh.shader.uniforms.uWaterTint = waterTint;
    }

    destroy() {
        // The cell-id texture is shared between levels and destroyed by its owner
        this.#mesh.destroy();
        this.#ownersTexture.destroy(true);
        this.#paletteTexture?.destroy(true);
    }
}
