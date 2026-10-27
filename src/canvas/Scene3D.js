import * as THREE from "../../vendor/three/three.module.js";
import { OrbitControls } from "../../vendor/three/OrbitControls.js";
import { FILRODENSWMB } from "../config.js";
import { TerrainShading } from "../tools/TerrainShading.js";
import { LightingNormals } from "./LightingNormals.js";

export class Scene3D {
    constructor(containerElement) {
        this.container = containerElement;

        // 1. Core Scene Setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a4b84);

        // 2. Camera Setup (Perspective)
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 1, 20000);

        // 3. Renderer Setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.container.appendChild(this.renderer.domElement);

        // 4. Orbit Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05;

        // 5. Lighting: a weak ambient and a low sun from the flat map's bearing, placed and sized
        // to the map in render3DMap. The sun is made just strong enough that flat ground keeps the
        // brightness it had, so the lighting normals (see LightingNormals) add contrast on slopes
        // without darkening or brightening the map.
        const config = FILRODENSWMB.DISPLAY.THREE_D;
        this.scene.add(new THREE.AmbientLight(0xffffff, config.AMBIENT));
        const altitude = (config.SUN_ALTITUDE * Math.PI) / 180;
        this.sunLight = new THREE.DirectionalLight(0xffffff, (config.FLAT_BRIGHTNESS - config.AMBIENT) / Math.sin(altitude));
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.set(2048, 2048);
        this.sunLight.shadow.bias = -0.001;
        this.scene.add(this.sunLight);

        // The terrain's grid, kept so Relief Emphasis can light it again without rebuilding it
        this.grid = null;
        this.reliefEmphasis = config.RELIEF.EMPHASIS;
        this.radiusPx = 0;
        this.reliefFrame = null;

        // State trackers
        this.animationFrameId = null;
        this.mesh = null;
        this.water = null;

        // Bind resizing
        this.resizeHandler = this.#onWindowResize.bind(this);
        window.addEventListener("resize", this.resizeHandler);

        // Start the render loop
        this.#animate();
    }

    /**
     * Builds the 3D terrain: the map's elevation raised into a mesh, draped with the flat map's
     * colours, under a sea surface.
     *
     * The drape is made from the same images and settings as the flat map (see
     * TerrainShading.drape), so the layers, the biomes on the sea bed, the water's colour by
     * depth and the map's tint all match; only relief shading is left out, since the scene's
     * light shades the slopes. It lights them through lighting normals (see LightingNormals): each
     * vertex's own slope plus its broad slope, exaggerated by the map's Relief Emphasis, so land
     * that rises gently over large areas reads as relief while the mesh keeps its true heights. Rivers (procedural and custom alike) come with it, from the
     * same river image the flat map draws them from, so they lie on the ground like any other
     * colour.
     *
     * The mesh follows the ground, except that lakes are raised flat to their surface and
     * surface biomes over the sea (Pack Ice and the like) to just above the sea's surface, so
     * both read as lying on the water rather than showing through it.
     * @param {object} map
     * @param {Float32Array} map.elevation - The map's elevation.
     * @param {number} map.width - Map pixel width.
     * @param {number} map.height - Map pixel height.
     * @param {number} map.seaLevel
     * @param {Float32Array} map.waterMask - Each lake pixel's surface elevation, 0 elsewhere.
     * @param {{aux: Uint8Array, surface: Uint8Array, underwater: Uint8Array, rivers: Uint8Array}} map.terrain - The images the flat map is painted from.
     * @param {object} map.settings - The flat map's shading settings (see TerrainShading.defaultSettings).
     * @param {number} [map.reliefEmphasis] - How strongly the broad slope is lit (the map's Relief Emphasis).
     * @param {number} [map.pixelsPerBaseline] - The map's pixels per baseline pixel, which the
     *   broad slope's radius is scaled by, so it covers the same ground at any resolution.
     */
    render3DMap({ elevation, width, height, seaLevel, waterMask, terrain, settings, reliefEmphasis = FILRODENSWMB.DISPLAY.THREE_D.RELIEF.EMPHASIS, pixelsPerBaseline = 1 }) {
        this.#disposeTerrain();
        const config = FILRODENSWMB.DISPLAY.THREE_D;

        // 1. The drape, with the rivers painted in
        const drape = new Uint8Array(width * height * 4);
        TerrainShading.drape(terrain.aux, terrain.surface, terrain.underwater, settings, drape, terrain.rivers);

        // Mipmaps and anisotropic filtering keep thin features such as rivers from breaking up
        // into dots when the terrain is seen from afar or at a low angle.
        const texture = new THREE.DataTexture(drape, width, height, THREE.RGBAFormat);
        texture.flipY = true;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        texture.needsUpdate = true;

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 1,
            metalness: 0,
            side: THREE.DoubleSide,
        });

        // 2. The mesh, sampling the map at each vertex
        const geoWidth = Math.min(width, 400);
        const geoHeight = Math.min(height, 400);
        const geometry = new THREE.PlaneGeometry(width, height, geoWidth, geoHeight);
        geometry.rotateX(-Math.PI / 2);

        const surfaceOn = settings.landBiomes;
        const pos = geometry.attributes.position;
        const heights = new Float32Array(pos.count);
        // Vertices raised onto a lake's surface or lifted as sea ice: lit by their own slope only
        const mask = new Uint8Array(pos.count);
        for (let i = 0; i < pos.count; i++) {
            const mapX = Math.max(0, Math.min(Math.round(pos.getX(i) + width / 2), width - 1));
            const mapY = Math.max(0, Math.min(Math.round(pos.getZ(i) + height / 2), height - 1));
            const index = mapY * width + mapX;

            const lakeSurface = waterMask?.[index] > 0 ? waterMask[index] : -Infinity;
            if (lakeSurface > elevation[index]) mask[i] = 1;
            let y = (Math.max(elevation[index], lakeSurface) - seaLevel) * config.ALTITUDE_SCALE;
            const onTheSea = y < 0 && terrain.aux[index * 4 + 1] > 0;
            if (onTheSea && surfaceOn && terrain.surface[index * 4 + 3] > 0) {
                y = config.SURFACE_LIFT;
                mask[i] = 1;
            }
            pos.setY(i, y);
            heights[i] = y;
        }

        // The vertices run row by row from the map's top, geoWidth + 1 to a row
        this.grid = { heights, cols: geoWidth + 1, rows: geoHeight + 1, spacingX: width / geoWidth, spacingZ: height / geoHeight, mask };
        this.radiusPx = config.RELIEF.RADIUS * pixelsPerBaseline;
        this.reliefEmphasis = reliefEmphasis;
        geometry.setAttribute("normal", new THREE.BufferAttribute(this.#normals(), 3));
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.scene.add(this.mesh);

        // 3. The sea's surface, in the water's tinted colour. The water's colour over the bed is
        // already in the drape, so the surface is faint: fainter for clearer water.
        if (settings.water) {
            const waterGeo = new THREE.PlaneGeometry(width * 1.5, height * 1.5);
            waterGeo.rotateX(-Math.PI / 2);
            const colour = TerrainShading.waterColour(0.5, settings);
            const opacity = config.WATER_OPACITY / Math.max(settings.clarity, 0.1);
            const waterMat = new THREE.MeshStandardMaterial({
                color: new THREE.Color().setRGB(colour[0], colour[1], colour[2], THREE.SRGBColorSpace),
                transparent: true,
                opacity: Math.min(config.WATER_MAX_OPACITY, Math.max(config.WATER_MIN_OPACITY, opacity)),
                depthWrite: false,
                roughness: 0.1,
                metalness: 0.2,
            });

            this.water = new THREE.Mesh(waterGeo, waterMat);
            this.water.position.y = 0;
            this.water.receiveShadow = true;
            this.scene.add(this.water);
        }

        // 4. The sun, from the flat map's bearing (0 from the north, the map's top, -z; 90 from the
        // east, +x) and SUN_ALTITUDE above the horizon, far enough out to clear the map, with a
        // shadow camera that covers the whole map
        this.#placeSun(width, height);

        // 5. Position Camera
        this.camera.position.set(0, Math.max(width, height) * 0.8, Math.max(width, height) * 0.8);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    /**
     * Lights the terrain with a new Relief Emphasis (its slider in the 3D view). The normals are
     * worked out again in place, at most once a frame however fast the slider moves.
     * @param {number} value
     */
    setReliefEmphasis(value) {
        this.reliefEmphasis = Number(value);
        if (!this.mesh || this.reliefFrame !== null) return;
        this.reliefFrame = requestAnimationFrame(() => {
            this.reliefFrame = null;
            const normal = this.mesh?.geometry.attributes.normal;
            if (!normal) return;
            this.#normals(normal.array);
            normal.needsUpdate = true;
        });
    }

    /** The terrain's lighting normals at the current Relief Emphasis (written into `out` when given). */
    #normals(out) {
        const relief = FILRODENSWMB.DISPLAY.THREE_D.RELIEF;
        return LightingNormals.compute(this.grid, { emphasis: this.reliefEmphasis, radiusPx: this.radiusPx, tiltLimit: relief.TILT_LIMIT, fineGain: relief.FINE_GAIN, seabedShare: relief.SEABED_SHARE }, out);
    }

    #placeSun(width, height) {
        const config = FILRODENSWMB.DISPLAY.THREE_D;
        const bearing = (FILRODENSWMB.DISPLAY.LIGHT_DIRECTION * Math.PI) / 180;
        const altitude = (config.SUN_ALTITUDE * Math.PI) / 180;
        const reach = Math.hypot(width, height);
        const distance = reach * 1.5;
        this.sunLight.position.set(Math.sin(bearing) * Math.cos(altitude) * distance, Math.sin(altitude) * distance, -Math.cos(bearing) * Math.cos(altitude) * distance);
        this.sunLight.target.position.set(0, 0, 0);
        const shadow = this.sunLight.shadow.camera;
        shadow.left = -reach / 2;
        shadow.right = reach / 2;
        shadow.top = reach / 2;
        shadow.bottom = -reach / 2;
        shadow.near = 1;
        shadow.far = distance + reach;
        shadow.updateProjectionMatrix();
    }

    /** Removes the terrain and sea, freeing their GPU memory. */
    #disposeTerrain() {
        if (this.mesh) {
            this.mesh.geometry.dispose();
            this.mesh.material.map?.dispose();
            this.mesh.material.dispose();
            this.scene.remove(this.mesh);
            this.mesh = null;
        }
        if (this.water) {
            this.water.geometry.dispose();
            this.water.material.dispose();
            this.scene.remove(this.water);
            this.water = null;
        }
    }

    #onWindowResize() {
        if (!this.container || !this.camera || !this.renderer) return;
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    #animate() {
        this.animationFrameId = requestAnimationFrame(this.#animate.bind(this));
        if (this.controls) this.controls.update();
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    destroy() {
        window.removeEventListener("resize", this.resizeHandler);
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        if (this.reliefFrame !== null) cancelAnimationFrame(this.reliefFrame);

        this.#disposeTerrain();

        if (this.renderer) {
            this.renderer.dispose();
            // Gives the WebGL context back at once rather than when it is collected: a browser
            // keeps only a few, and the flat map's canvas needs its own
            this.renderer.forceContextLoss();
            this.renderer.domElement.remove();
        }
    }
}
