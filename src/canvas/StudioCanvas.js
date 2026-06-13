import { FILRODENSWMB } from "../config.js";

export class StudioCanvas {
    constructor(htmlContainer) {
        this.container = htmlContainer;

        this.app = new PIXI.Application({
            resizeTo: this.container,
            backgroundColor: 0x1a4b84,
            antialias: true,
            resolution: window.devicePixelRatio || 1,
        });

        const canvasElement = this.app.canvas ?? this.app.view;
        this.container.appendChild(canvasElement);

        this.stage = new PIXI.Container();
        this.app.stage.addChild(this.stage);

        // Initialise a strict z-index hierarchy of layers
        this.layers = {
            base: new PIXI.Container(),
            topography: new PIXI.Container(),
            biomes: new PIXI.Container(),
            contours: new PIXI.Container(),
            features: new PIXI.Container(),
        };

        this.layers.biomes.alpha = 0.65;

        // Vector Graphics Engine for non-pixel entities (Rivers, Roads, Borders)
        this.vectorGraphics = new PIXI.Graphics();
        this.layers.features.addChild(this.vectorGraphics);

        // Instantiate the grid layer
        this.gridLayer = new PIXI.Graphics();

        // Cache for persistent GPU textures to prevent memory churn
        this.layerSprites = {};

        // Add them to the zooming stage in ascending order
        this.stage.addChild(this.layers.base, this.layers.topography, this.layers.biomes, this.layers.contours, this.layers.features, this.gridLayer);

        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this.stageStart = { x: 0, y: 0 };

        // Frame State
        this.isInitialized = false;
        this.hasGeneratedMap = false;
        this.mapWidth = FILRODENSWMB.DEFAULTS.MAP_WIDTH;
        this.mapHeight = FILRODENSWMB.DEFAULTS.MAP_HEIGHT;

        this.#setupInteractions(canvasElement);

        this.resizeObserver = new ResizeObserver(() => {
            this.app.resize();
            if (!this.isInitialized && this.container.clientWidth > 0) {
                this.resetCamera();
                this.isInitialized = true;
            }
        });
        this.resizeObserver.observe(this.container);

        // Callbacks for brush tools
        this.onBrushStart = null;
        this.onBrushMove = null;
        this.onBrushEnd = null;

        // Mode flag
        this.isEditMode = false;
        this.lastBrushTime = 0;
    }

    #setupInteractions(canvasElement) {
        // SCROLL TO ZOOM
        canvasElement.addEventListener("wheel", (e) => {
            e.preventDefault();
            const zoomFactor = 1.1;
            const scaleDirection = e.deltaY < 0 ? zoomFactor : 1 / zoomFactor;

            const rect = canvasElement.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const localX = (mouseX - this.stage.x) / this.stage.scale.x;
            const localY = (mouseY - this.stage.y) / this.stage.scale.y;

            this.stage.scale.x *= scaleDirection;
            this.stage.scale.y *= scaleDirection;

            // Constrain zoom levels (0.1x to 5x)
            this.stage.scale.x = Math.max(0.1, Math.min(this.stage.scale.x, 5));
            this.stage.scale.y = Math.max(0.1, Math.min(this.stage.scale.y, 5));

            // Adjust position so it zooms towards the cursor
            this.stage.position.x = mouseX - localX * this.stage.scale.x;
            this.stage.position.y = mouseY - localY * this.stage.scale.y;
        });

        // RIGHT CLICK OR MIDDLE CLICK TO PAN
        canvasElement.addEventListener("pointerdown", (e) => {
            if (e.button !== 2 && e.button !== 1) return; // Leave left click (0) for the paintbrush

            this.isDragging = true;
            this.dragStart = { x: e.clientX, y: e.clientY };
            this.stageStart = { x: this.stage.position.x, y: this.stage.position.y };
            canvasElement.style.cursor = "grabbing";
        });

        globalThis.addEventListener("pointermove", (e) => {
            if (this.isDragging) {
                const dx = e.clientX - this.dragStart.x;
                const dy = e.clientY - this.dragStart.y;
                this.stage.position.x = this.stageStart.x + dx;
                this.stage.position.y = this.stageStart.y + dy;
                return;
            }

            // Continuous painting while dragging
            if (this.isEditMode && e.buttons === 1 && this.onBrushMove) {
                const now = performance.now();

                // Throttle the application to fire max once every 100ms
                if (now - this.lastBrushTime > 100) {
                    const coords = this.#getMapCoordinates(e, canvasElement);
                    this.onBrushMove(coords.x, coords.y);
                    this.lastBrushTime = now;
                }
            }
        });

        globalThis.addEventListener("pointerup", (e) => {
            if (e.button !== 2 && e.button !== 1) return;
            this.isDragging = false;
            canvasElement.style.cursor = "default";
        });

        // Prevent browser context menus from ruining the right-click drag
        canvasElement.addEventListener("contextmenu", (e) => e.preventDefault());

        // HOVER READOUT
        canvasElement.addEventListener("pointermove", (e) => {
            if (this.onCanvasHover && !this.isDragging) {
                const coords = this.#getMapCoordinates(e, canvasElement);
                this.onCanvasHover(coords.x, coords.y);
            }
        });

        canvasElement.addEventListener("pointerleave", (e) => {
            if (this.onCanvasHover) this.onCanvasHover(null, null);
        });

        // PIXI listeners
        canvasElement.addEventListener("pointerdown", (e) => {
            // Right/Middle click for panning
            if (e.button === 2 || e.button === 1) {
                this.isDragging = true;
                this.dragStart = { x: e.clientX, y: e.clientY };
                this.stageStart = { x: this.stage.position.x, y: this.stage.position.y };
                canvasElement.style.cursor = "grabbing";
                return;
            }

            // Left click for painting
            if (e.button === 0 && this.isEditMode && this.onBrushStart) {
                const coords = this.#getMapCoordinates(e, canvasElement);
                this.onBrushStart(coords.x, coords.y);
            }
        });

        globalThis.addEventListener("pointermove", (e) => {
            if (this.isDragging) {
                // ... existing panning logic ...
                return;
            }

            // Continuous painting while dragging
            if (this.isEditMode && e.buttons === 1 && this.onBrushMove) {
                const coords = this.#getMapCoordinates(e, canvasElement);
                this.onBrushMove(coords.x, coords.y);
            }
        });

        globalThis.addEventListener("pointerup", (e) => {
            if (e.button === 2 || e.button === 1) {
                this.isDragging = false;
                canvasElement.style.cursor = this.isEditMode ? "crosshair" : "default";
                return;
            }

            if (e.button === 0 && this.isEditMode && this.onBrushEnd) {
                this.onBrushEnd();
            }
        });
    }

    // --- Public API for the UI Buttons ---

    zoomCamera(factor) {
        const center = { x: this.container.clientWidth / 2, y: this.container.clientHeight / 2 };
        const localX = (center.x - this.stage.x) / this.stage.scale.x;
        const localY = (center.y - this.stage.y) / this.stage.scale.y;

        this.stage.scale.x = Math.max(0.1, Math.min(this.stage.scale.x * factor, 5));
        this.stage.scale.y = Math.max(0.1, Math.min(this.stage.scale.y * factor, 5));

        this.stage.position.x = center.x - localX * this.stage.scale.x;
        this.stage.position.y = center.y - localY * this.stage.scale.y;
    }

    resetCamera() {
        // 1. Calculate the required bounding box (Map size + 10%)
        const paddedWidth = this.mapWidth * 1.1;
        const paddedHeight = this.mapHeight * 1.1;

        // 2. Find the optimal scale to fit either the width or height of the screen
        const scaleX = this.app.screen.width / paddedWidth;
        const scaleY = this.app.screen.height / paddedHeight;
        const optimalScale = Math.min(scaleX, scaleY);

        // 3. Constrain it to our zoom limits so it doesn't break limits on tiny maps
        const finalScale = Math.max(0.1, Math.min(optimalScale, 5));
        this.stage.scale.set(finalScale);

        // 4. Center the scaled map in the exact middle of the screen
        this.stage.position.set((this.app.screen.width - this.mapWidth * finalScale) / 2, (this.app.screen.height - this.mapHeight * finalScale) / 2);
    }

    destroy() {
        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (this.app) this.app.destroy(true, { children: true, texture: true, baseTexture: true });
    }

    /**
     * Takes a raw RGBA pixel buffer and paints it directly to a specific layer in the stack.
     * Utilises persistent sprite caching to eliminate VRAM reallocation spikes during live editing.
     */
    renderPixelBuffer(layerId, pixelBuffer, width, height) {
        const targetLayer = this.layers[layerId];
        if (!targetLayer) return;

        this.mapWidth = width;
        this.mapHeight = height;

        let sprite = this.layerSprites[layerId];

        // Setup the persistent sprite if it does not exist or resolution has changed
        if (!sprite || sprite.width !== width || sprite.height !== height) {
            if (sprite) sprite.destroy(true);

            // Create a brand new typed array to decouple from the engine's reference
            const buffer = new PIXI.BufferResource(new Uint8Array(pixelBuffer), { width, height });
            const baseTexture = new PIXI.BaseTexture(buffer);
            const texture = new PIXI.Texture(baseTexture);

            sprite = new PIXI.Sprite(texture);
            this.layerSprites[layerId] = sprite;

            targetLayer.removeChildren();
            targetLayer.addChild(sprite);
        } else {
            // Strictly mutate the underlying buffer and notify the GPU
            const resource = sprite.texture.baseTexture.resource;
            resource.data.set(pixelBuffer);
            sprite.texture.baseTexture.update();
        }

        if (!this.hasGeneratedMap) {
            this.resetCamera();
            this.hasGeneratedMap = true;
        }
    }

    /**
     * Renders an array of vector paths and POI pins.
     */
    renderRiverVectors(rivers, mapPins, isFeatureEdit, waterMask) {
        this.vectorGraphics.clear();

        if (rivers && rivers.length > 0) {
            this.#drawRivers(rivers, waterMask);
        }

        if (mapPins && mapPins.length > 0) {
            this.#drawMapPins(mapPins, isFeatureEdit);
        }
    }

    #drawRivers(rivers, waterMask) {
        const waterColor = 0x78aad2;
        const frozenColor = 0xe1ebf0;

        for (const river of rivers) {
            if (!river.path || river.path.length < 2) continue;
            this.#drawSingleRiver(river.path, waterColor, frozenColor, waterMask);
        }
    }

    #drawSingleRiver(path, waterColor, frozenColor, waterMask) {
        let isFlowing = false;
        let currentIsFrozen = null;

        for (const point of path) {
            // THE FIX: Intercept coordinates and evaluate against the submerged mask
            const safeX = Math.max(0, Math.min(Math.round(point.x), this.mapWidth - 1));
            const safeY = Math.max(0, Math.min(Math.round(point.y), this.mapHeight - 1));
            const index = safeY * this.mapWidth + safeX;
            const isWater = waterMask && waterMask[index] > 0;

            if (point.isLake || isWater) {
                isFlowing = false;
                continue;
            }

            if (!isFlowing) {
                currentIsFrozen = point.isFrozen;
                this.vectorGraphics.lineStyle(2, currentIsFrozen ? frozenColor : waterColor, 0.9);
                this.vectorGraphics.moveTo(point.x, point.y);
                isFlowing = true;
            } else if (point.isFrozen === currentIsFrozen) {
                this.vectorGraphics.lineTo(point.x, point.y);
            } else {
                this.vectorGraphics.lineTo(point.x, point.y);
                currentIsFrozen = point.isFrozen;
                this.vectorGraphics.lineStyle(2, currentIsFrozen ? frozenColor : waterColor, 0.9);
                this.vectorGraphics.moveTo(point.x, point.y);
            }
        }
    }

    /**
     * Renders Vector Pins directly from the POI array using a flattened color map.
     */
    #drawMapPins(mapPins, isFeatureEdit) {
        this.vectorGraphics.lineStyle(0);

        // Dictionary to completely eliminate if/else cognitive complexity
        const pinColors = {
            spring: 0xff0000, // Semi-transparent Red
            block_spring: 0x000000, // Semi-transparent Black
        };

        for (const pin of mapPins) {
            // Rule: Springs and Blockers only render when editing Hydrology
            if (!isFeatureEdit && (pin.type === "spring" || pin.type === "block_spring")) {
                continue;
            }

            const hexColor = pinColors[pin.type];

            // Future-proofing: Cities might not have a color in this specific dictionary,
            // so we only draw the circle if it maps to a known vector pin type.
            if (hexColor !== undefined) {
                this.vectorGraphics.beginFill(hexColor, 0.4);
                this.vectorGraphics.drawCircle(pin.x, pin.y, 6);
                this.vectorGraphics.endFill();
            }
        }
    }

    /**
     * Toggles the visibility of a specific layer in the WebGL scene graph.
     */
    toggleLayer(layerId, isVisible) {
        const targetLayer = this.layers[layerId];
        if (targetLayer) {
            targetLayer.visible = isVisible;
        }
    }

    /**
     * Extracts precise X/Y integer array coordinates from a screen click.
     */
    #getMapCoordinates(event, canvasElement) {
        const rect = canvasElement.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        // Reverse the WebGL scale and translation offsets
        const localX = (mouseX - this.stage.x) / this.stage.scale.x;
        const localY = (mouseY - this.stage.y) / this.stage.scale.y;

        return {
            x: Math.floor(localX),
            y: Math.floor(localY),
        };
    }

    setEditMode(isActive) {
        this.isEditMode = isActive;
        const canvasElement = this.app.canvas ?? this.app.view;
        canvasElement.style.cursor = isActive ? "crosshair" : "default";
    }

    /**
     * Dynamically adjusts the alpha transparency of the Biome layer.
     */
    setBiomeOpacity(alphaValue) {
        if (this.layers.biomes) {
            this.layers.biomes.alpha = alphaValue;
        }
    }

    /**
     * Draws a crisp, low-opacity PIXI overlay of standard VTT grid patterns.
     * Utilises a geometric boundary mask to allow edge-hex completion without bleed.
     */
    drawGrid(type, size, isVisible) {
        this.gridLayer.clear();

        // Clean up the mask layout if the grid is hidden or disabled
        if (this.gridMask) {
            this.gridMask.clear();
            this.gridLayer.mask = null;
        }

        if (!isVisible || type === "none") return;

        // 1. Initialise the masking container if it does not exist
        if (!this.gridMask) {
            this.gridMask = new PIXI.Graphics();
            this.stage.addChild(this.gridMask);
        }

        // 2. Build the bounding-box clipping mask to capture edge overflows
        this.gridMask.beginFill(0xffffff);
        this.gridMask.drawRect(0, 0, this.mapWidth, this.mapHeight);
        this.gridMask.endFill();
        this.gridLayer.mask = this.gridMask;

        // 3. Configure the drawing line styles
        this.gridLayer.lineStyle(1, 0xffffff, 0.25);

        const width = this.mapWidth;
        const height = this.mapHeight;
        const s = Math.max(10, Number(size));

        if (type === "square") {
            for (let x = 0; x <= width; x += s) {
                this.gridLayer.moveTo(x, 0).lineTo(x, height);
            }
            for (let y = 0; y <= height; y += s) {
                this.gridLayer.moveTo(0, y).lineTo(width, y);
            }
        } else if (type === "hexR" || type === "hexC") {
            const isRow = type === "hexR";
            const r = s / Math.sqrt(3);
            const widthDist = isRow ? s : r * 1.5;
            const heightDist = isRow ? r * 1.5 : s;

            // Intentionally sampling from column -1 to guarantee edge completion
            for (let col = -1; col * widthDist < width + s; col++) {
                for (let row = -1; row * heightDist < height + s; row++) {
                    let cx, cy;

                    if (isRow) {
                        const offset = row % 2 === 0 ? 0 : s / 2;
                        cx = col * widthDist + offset;
                        cy = row * heightDist;
                    } else {
                        const offset = col % 2 === 0 ? 0 : s / 2;
                        cx = col * widthDist;
                        cy = row * heightDist + offset;
                    }

                    // Draw the 6 structural vertices of the Hexagon
                    for (let i = 0; i < 6; i++) {
                        const angle_deg = 60 * i - (isRow ? 30 : 0);
                        const angle_rad = (Math.PI / 180) * angle_deg;
                        const px = cx + r * Math.cos(angle_rad);
                        const py = cy + r * Math.sin(angle_rad);

                        if (i === 0) this.gridLayer.moveTo(px, py);
                        else this.gridLayer.lineTo(px, py);
                    }
                    this.gridLayer.closePath();
                }
            }
        }
    }
}
