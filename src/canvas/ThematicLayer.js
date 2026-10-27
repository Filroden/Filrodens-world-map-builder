import { FILRODENSWMB } from "../config.js";
import { exactTexture } from "./RegionMeshLayer.js";
import { getRegionUploadResource } from "./RegionUploadResource.js";

/**
 * Draws one thematic layer on the GPU, as a region level's fill is drawn (see RegionMeshLayer): a
 * quad the size of the map whose shader looks up, for each pixel, the display cell under it (the
 * shared cell-id texture), that cell's ramp step (the values texture, one texel per cell, its red
 * byte the step and 0 for no value), and the step's colour (a 256 x 1 lookup). Switching layers
 * rewrites the values texture and the lookup; nothing is drawn per cell on the CPU, so a frame
 * costs the same whatever the number of cells.
 *
 * Both lookups hold exact bytes, so they follow RegionMeshLayer's rules (NEAREST, no mipmaps, no
 * premultiplied alpha; see exactTexture). Water is left undrawn by the same test of the terrain's
 * packed texture the region fills use, so the coast is pixel-exact at every zoom: the values are
 * for land (people, food, danger), and a colour over the sea would read as a value there.
 */

const BYTES_PER_TEXEL = 4;
const LOOKUP_SIZE = 256;

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
uniform sampler2D uValues;
uniform vec2 uValuesSize;
uniform sampler2D uLookup;
uniform sampler2D uAux;
uniform float uHasAux;
uniform float uOpacity;

float decodeId(vec4 texel) {
    vec4 bytes = floor(texel * 255.0 + 0.5);
    return bytes.r + bytes.g * 256.0 + bytes.b * 65536.0;
}

void main() {
    float wet = uHasAux > 0.5 ? texture2D(uAux, vUvs).g * 255.0 : 0.0;
    if (wet >= 0.5) discard;

    float cell = decodeId(texture2D(uCellIds, vUvs));
    float row = floor(cell / uValuesSize.x);
    float column = cell - row * uValuesSize.x;
    float step = floor(texture2D(uValues, vec2((column + 0.5) / uValuesSize.x, (row + 0.5) / uValuesSize.y)).r * 255.0 + 0.5);
    if (step < 0.5) discard;

    vec4 colour = texture2D(uLookup, vec2((step + 0.5) / 256.0, 0.5));
    float alpha = colour.a * uOpacity;
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(colour.rgb * alpha, alpha);
}`;

// One class per PIXI namespace, as for RegionMeshLayer
const meshClasses = new WeakMap();

/** A PIXI.Mesh that binds the terrain's packed texture just before each draw (see RegionMeshLayer). */
function getThematicMeshClass(pixi) {
    if (meshClasses.has(pixi)) return meshClasses.get(pixi);
    const ThematicMesh = class extends pixi.Mesh {
        auxProvider = null;

        _render(renderer) {
            const aux = this.auxProvider?.() ?? null;
            this.shader.uniforms.uAux = aux ?? pixi.Texture.WHITE;
            this.shader.uniforms.uHasAux = aux ? 1 : 0;
            super._render(renderer);
        }
    };
    meshClasses.set(pixi, ThematicMesh);
    return ThematicMesh;
}

export class ThematicLayer {
    #mesh;
    #valuesTexture;
    #valueBytes;
    #lookupTexture;
    #rowLength;
    #values = null;
    #lookup = null;

    /**
     * @param {object} pixi - The PIXI namespace.
     * @param {object} options
     * @param {number} options.width - Map width in pixels.
     * @param {number} options.height - Map height in pixels.
     * @param {number} options.cellCount - Display cells.
     * @param {object} options.cellIdTexture - The mesh's cell-id texture (see createCellIdTexture).
     * @param {function(): object|null} options.auxProvider - The terrain's packed texture, or null.
     */
    constructor(pixi, { width, height, cellCount, cellIdTexture, auxProvider }) {
        this.#rowLength = FILRODENSWMB.MESH.FILL.TEXTURE_ROW;
        const rows = Math.max(1, Math.ceil(cellCount / this.#rowLength));
        this.#valueBytes = new Uint8Array(this.#rowLength * rows * BYTES_PER_TEXEL);
        const Upload = getRegionUploadResource(pixi);
        this.#valuesTexture = exactTexture(pixi, new Upload(new Uint8Array(this.#valueBytes.length), { width: this.#rowLength, height: rows }));
        this.#lookupTexture = exactTexture(pixi, new Upload(new Uint8Array(LOOKUP_SIZE * BYTES_PER_TEXEL), { width: LOOKUP_SIZE, height: 1 }));

        const geometry = new pixi.Geometry()
            .addAttribute("aVertexPosition", [0, 0, width, 0, width, height, 0, height], 2)
            .addAttribute("aUvs", [0, 0, 1, 0, 1, 1, 0, 1], 2)
            .addIndex([0, 1, 2, 0, 2, 3]);
        const shader = pixi.Shader.from(VERTEX_SOURCE, FRAGMENT_SOURCE, {
            uCellIds: cellIdTexture,
            uValues: this.#valuesTexture,
            uValuesSize: new Float32Array([this.#rowLength, rows]),
            uLookup: this.#lookupTexture,
            uAux: pixi.Texture.WHITE,
            uHasAux: 0,
            uOpacity: 1,
        });
        const ThematicMesh = getThematicMeshClass(pixi);
        this.#mesh = new ThematicMesh(geometry, shader);
        this.#mesh.auxProvider = auxProvider;
    }

    /** The mesh to add to the stage. */
    get displayObject() {
        return this.#mesh;
    }

    /**
     * Shows a layer: its step per display cell and its colour lookup. Each is uploaded only when it
     * is not the array last shown (the values are worked out once per layer and kept; see
     * ThematicSource.displayBytes).
     * @param {Uint8Array} values - One step per display cell, 0 for no value.
     * @param {Uint8Array} lookup - 256 RGBA colours (see rampLookup).
     * @param {number} opacity - 0 to 1.
     */
    show(values, lookup, opacity) {
        if (values !== this.#values) {
            this.#valueBytes.fill(0);
            for (let cell = 0; cell < values.length; cell++) this.#valueBytes[cell * BYTES_PER_TEXEL] = values[cell];
            this.#valuesTexture.baseTexture.resource.write(this.#valueBytes);
            this.#valuesTexture.baseTexture.update();
            this.#values = values;
        }
        if (lookup !== this.#lookup) {
            this.#lookupTexture.baseTexture.resource.write(lookup);
            this.#lookupTexture.baseTexture.update();
            this.#lookup = lookup;
        }
        this.#mesh.shader.uniforms.uOpacity = opacity;
    }

    destroy() {
        // The cell-id texture is shared with the region fills and destroyed by its owner
        this.#mesh.destroy();
        this.#valuesTexture.destroy(true);
        this.#lookupTexture.destroy(true);
    }
}
