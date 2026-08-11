import { FILRODENSWMB } from "../config.js";

export class StudioCanvas {
    constructor(htmlContainer) {
        this.container = htmlContainer;

        this.app = new PIXI.Application({
            autoDensity: true,
            backgroundColor: 0x1a4b84,
            antialias: true,
            resolution: window.devicePixelRatio || 1,
            sharedTicker: false,
            autoStart: false,
        });

        const canvasElement = this.app.canvas ?? this.app.view;
        canvasElement.style.display = "block";

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
            infrastructure: new PIXI.Container(),
            regions: new PIXI.Container(),
            labels: new PIXI.Container(),
            reference: new PIXI.Container(),
            cartography: new PIXI.Container(),
        };

        this.layers.biomes.alpha = FILRODENSWMB.DISPLAY.BIOME_ALPHA_INACTIVE;

        // Vector Graphics Engine for non-pixel entities (Rivers, Roads, Borders)
        this.haloGraphics = new PIXI.Graphics();
        this.haloGraphics.filters = [new PIXI.filters.AlphaFilter(0.15)];
        this.layers.features.addChild(this.haloGraphics);

        this.manualRiverGraphics = new PIXI.Graphics();
        this.layers.features.addChild(this.manualRiverGraphics);

        this.faultGraphics = new PIXI.Graphics();
        this.layers.features.addChild(this.faultGraphics);

        this.proceduralRiverGraphics = new PIXI.Graphics();
        this.layers.features.addChild(this.proceduralRiverGraphics);

        this.featurePinGraphics = new PIXI.Graphics();
        this.layers.features.addChild(this.featurePinGraphics);

        // Setup Infrastructure Sub-containers
        this.routeGraphics = new PIXI.Graphics();
        this.nodeContainer = new PIXI.Container();
        this.pinContainer = new PIXI.Container();

        this.layers.infrastructure.addChild(this.routeGraphics);
        this.layers.infrastructure.addChild(this.nodeContainer); // Render nodes above lines
        this.layers.infrastructure.addChild(this.pinContainer); // Render pins above nodes

        // Reference Image Sprite Setup
        this.referenceSprite = new PIXI.Sprite();
        this.referenceSprite.anchor.set(0.5); // Centered anchor ensures scaling expands outward equally
        this.layers.reference.addChild(this.referenceSprite);

        // --- Global Drag Handling ---
        this.activeDrag = null;
        this.interactiveTargets = [];

        // Instantiate the grid layer
        this.gridLayer = new PIXI.Graphics();

        // Cache for persistent GPU textures to prevent memory churn
        this.layerSprites = {};

        // Setup the Brush Cursor overlay
        this.brushCursor = new PIXI.Graphics();
        this.brushCursor.visible = false;

        // Setup the Crop Tool overlay
        this.cropGraphics = new PIXI.Graphics();
        this.cropBox = null;
        this.activeCropAction = null;
        this.cropStart = { x: 0, y: 0 };
        this.cropOriginalBox = null;
        this.onCropUpdate = null;

        // Add them to the zooming stage in ascending order
        this.stage.addChild(
            this.layers.base,
            this.layers.topography,
            this.layers.biomes,
            this.layers.contours,
            this.layers.features,
            this.layers.regions,
            this.layers.infrastructure,
            this.layers.reference,
            this.gridLayer,
            this.layers.labels,
            this.layers.cartography,
            this.cropGraphics,
            this.brushCursor,
        );

        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this.stageStart = { x: 0, y: 0 };

        this.isReferenceMode = false;
        this.isDraggingReference = false;

        // Frame State
        this.isInitialized = false;
        this.hasGeneratedMap = false;
        this.mapWidth = FILRODENSWMB.DEFAULTS.MAP_WIDTH;
        this.mapHeight = FILRODENSWMB.DEFAULTS.MAP_HEIGHT;

        this.#updateGlobalMask();

        this.#setupInteractions(canvasElement);

        let lastW = 0;
        let lastH = 0;
        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const w = Math.floor(entry.contentRect.width);
                const h = Math.floor(entry.contentRect.height);

                if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) {
                    lastW = w;
                    lastH = h;

                    this.app.renderer.resize(w, h);
                    this.resetCamera();
                    this.isInitialized = true;
                }
            }
        });
        this.resizeObserver.observe(this.container);
        const renderLoop = (time) => {
            const activeWindow = this.container.ownerDocument.defaultView || window;
            this.app.ticker.update(time);
            this.app.renderer.render(this.stage);
            this.animationFrameId = activeWindow.requestAnimationFrame(renderLoop);
        };
        renderLoop();

        // Callbacks for brush tools
        this.onBrushStart = null;
        this.onBrushMove = null;
        this.onBrushEnd = null;

        // Mode flag
        this.isEditMode = false;
        this.renderPassMode = "normal"; // "normal" | "player" | "gm"
        this.viewFilters = { all: true, gm: true, none: false };
        this.lastBrushTime = 0;
    }

    /**
     * Mathematically checks if the mouse coordinates are hovering over an interactive target.
     * Returns the full target data packet (including entityType and entityId).
     */
    #getHitTarget(x, y) {
        let closest = null;
        let minDist = Infinity;

        for (const item of this.interactiveTargets) {
            const dist = Math.hypot(item.x - x, item.y - y);
            if (dist <= item.radius && dist < minDist) {
                minDist = dist;
                closest = item;
            }
        }
        return closest;
    }

    #setupInteractions(canvasElement) {
        canvasElement.addEventListener("wheel", (e) => this.#handleWheel(e, canvasElement));
        canvasElement.addEventListener("contextmenu", (e) => e.preventDefault());
        canvasElement.addEventListener("pointerdown", (e) => this.#handlePointerDown(e, canvasElement));
        canvasElement.addEventListener("pointermove", (e) => this.#handlePointerMove(e, canvasElement));
        canvasElement.addEventListener("dblclick", (e) => this.#handleDoubleClick(e, canvasElement));

        // Unified completion events prevent duplicate listener binds
        const endInteraction = (e) => this.#handlePointerUp(e, canvasElement);
        canvasElement.addEventListener("pointerup", endInteraction);
        canvasElement.addEventListener("pointercancel", endInteraction);
        canvasElement.addEventListener("pointerleave", (e) => this.#handlePointerLeave(e, canvasElement));
    }

    #handleWheel(e, canvasElement) {
        const isZoomIn = e.deltaY < 0;
        const config = FILRODENSWMB.UI.WHEEL;

        // --- Reference Image Scaling Intercept ---
        if (this.isReferenceMode && e.shiftKey) {
            const scale = isZoomIn ? FILRODENSWMB.UI.REFERENCE_IMAGE.SCALE_FACTOR : 1 / FILRODENSWMB.UI.REFERENCE_IMAGE.SCALE_FACTOR;
            if (this.onReferenceScale) this.onReferenceScale(scale);
            return;
        }

        // --- Label & Decoration Transformation Intercept ---
        const dragWrapper = this.activeDrag ? this.interactiveTargets.find((t) => t.target === this.activeDrag.target) : null;
        const isTransformable = dragWrapper?.isLabel || dragWrapper?.isDecoration;

        if (isTransformable) {
            e.preventDefault();
            const target = this.activeDrag.target;

            if (e.shiftKey && dragWrapper.isDecoration) {
                const scale = isZoomIn ? config.SCALE_FACTOR : 1 / config.SCALE_FACTOR;
                target.scale = (target.scale || 1) * scale;
            } else if (!e.shiftKey) {
                const rotation = isZoomIn ? -config.ROTATION_STEP : config.ROTATION_STEP;
                target.rotation = (target.rotation || 0) + rotation;
            }

            if (this.onInfraDrag) this.onInfraDrag();
            return;
        }

        // --- Standard Camera Zoom ---
        e.preventDefault();

        const scaleDirection = isZoomIn ? config.CAMERA_FACTOR : 1 / config.CAMERA_FACTOR;
        const maxZoom = Math.max(FILRODENSWMB.UI.ZOOM.MIN_ZOOM_FLOOR, this.mapWidth / FILRODENSWMB.UI.ZOOM.MAX_ZOOM_DIVISOR);

        const rect = canvasElement.getBoundingClientRect();
        const localX = (e.clientX - rect.left - this.stage.x) / this.stage.scale.x;
        const localY = (e.clientY - rect.top - this.stage.y) / this.stage.scale.y;

        this.stage.scale.x = Math.max(0.1, Math.min(this.stage.scale.x * scaleDirection, maxZoom));
        this.stage.scale.y = Math.max(0.1, Math.min(this.stage.scale.y * scaleDirection, maxZoom));

        this.stage.position.x = e.clientX - rect.left - localX * this.stage.scale.x;
        this.stage.position.y = e.clientY - rect.top - localY * this.stage.scale.y;

        this.#updateNodeScales();
        if (this.isCropMode) this.#drawCropOverlay();
    }

    #handlePointerDown(e, canvasElement) {
        canvasElement.setPointerCapture(e.pointerId);

        // Right/Middle Click Drag Pan
        if (e.button === 2 || e.button === 1) {
            this.isDragging = true;
            this.dragStart = { x: e.clientX, y: e.clientY };
            this.stageStart = { x: this.stage.position.x, y: this.stage.position.y };
            canvasElement.style.cursor = "grabbing";
            return;
        }

        if (e.button !== 0) return;

        const coords = this.#getMapCoordinates(e, canvasElement);

        if (this.isCropMode) return this.#handleCropPointerDown(e, coords, canvasElement);

        if (this.isReferenceMode) {
            this.isDraggingReference = true;
            this.dragStart = { x: coords.x, y: coords.y };
            canvasElement.style.cursor = "grabbing";
            return;
        }

        if (this.isEditMode && e.shiftKey && this.onInfraInsertNode) {
            e.preventDefault();
            e.stopPropagation();
            this.activeDrag = null;
            this.onInfraInsertNode(coords.x, coords.y);
            return;
        }

        const hit = this.#getHitTarget(coords.x, coords.y);
        const grabbedTarget = hit ? hit.target : null;

        if ((e.ctrlKey || e.metaKey) && grabbedTarget && this.onInfraDeleteNode) {
            e.preventDefault();
            e.stopPropagation();
            this.activeDrag = null;
            this.onInfraDeleteNode(grabbedTarget);
            return;
        }

        const rootApp = this.container.closest(".fwmb-layout") || document;
        const isEraserActive = !!rootApp.querySelector('.fwmb-brush-tools button.active[data-tool="erasePin"]');

        if (grabbedTarget && !isEraserActive) {
            e.preventDefault();
            e.stopPropagation();
            this.activeDrag = { target: grabbedTarget };
            canvasElement.style.cursor = "grabbing";
            if (this.onInfraDragStart) this.onInfraDragStart();
            return;
        }

        if (this.isEditMode && this.onBrushStart) {
            this.onBrushStart(coords.x, coords.y);
        }
    }

    #handleCropPointerDown(e, coords, canvasElement) {
        const zone = this.#getCropHitZone(coords.x, coords.y);
        this.cropStart = { x: coords.x, y: coords.y };

        if (zone) {
            this.activeCropAction = zone;
            this.cropOriginalBox = { ...this.cropBox };
        } else {
            this.activeCropAction = "draw";
            this.cropBox = { x: coords.x, y: coords.y, width: 0, height: 0 };
        }

        canvasElement.style.cursor = "grabbing";
        e.preventDefault();
        e.stopPropagation();
    }

    #handlePointerMove(e, canvasElement) {
        const coords = this.#getMapCoordinates(e, canvasElement);

        if (this.activeCropAction) return this.#processCropDrag(coords);

        if (this.isCropMode && !this.activeCropAction) {
            const zone = this.#getCropHitZone(coords.x, coords.y);
            if (zone === "center") canvasElement.style.cursor = "move";
            else if (zone === "tl" || zone === "br") canvasElement.style.cursor = "nwse-resize";
            else if (zone === "tr" || zone === "bl") canvasElement.style.cursor = "nesw-resize";
            else canvasElement.style.cursor = "crosshair";
            return;
        }

        if (this.isDraggingReference) {
            const dx = coords.x - this.dragStart.x;
            const dy = coords.y - this.dragStart.y;
            this.dragStart = { x: coords.x, y: coords.y };
            if (this.onReferencePan) this.onReferencePan(dx, dy);
            return;
        }

        if (this.isDragging) {
            const dx = e.clientX - this.dragStart.x;
            const dy = e.clientY - this.dragStart.y;
            this.stage.position.x = this.stageStart.x + dx;
            this.stage.position.y = this.stageStart.y + dy;
            return;
        }

        if (this.activeDrag) {
            this.activeDrag.target.x = Math.max(0, Math.min(coords.x, this.mapWidth));
            this.activeDrag.target.y = Math.max(0, Math.min(coords.y, this.mapHeight));
            if (this.onInfraDrag) this.onInfraDrag();
            return;
        }

        if (this.isEditMode && e.buttons === 1 && this.onBrushMove) {
            const now = performance.now();
            if (now - this.lastBrushTime > 100) {
                this.onBrushMove(coords.x, coords.y);
                this.lastBrushTime = now;
            }
            return;
        }

        if (this.onCanvasHover) this.onCanvasHover(coords.x, coords.y);

        if (this.isEditMode && !this.isDragging && !this.activeDrag) {
            const hit = this.#getHitTarget(coords.x, coords.y);
            canvasElement.style.cursor = hit ? "grab" : "crosshair";
        }
    }

    #processCropDrag(coords) {
        const dx = coords.x - this.cropStart.x;
        const dy = coords.y - this.cropStart.y;

        if (this.activeCropAction === "draw") {
            this.cropBox.x = Math.min(this.cropStart.x, coords.x);
            this.cropBox.y = Math.min(this.cropStart.y, coords.y);
            this.cropBox.width = Math.abs(coords.x - this.cropStart.x);
            this.cropBox.height = Math.abs(coords.y - this.cropStart.y);
        } else if (this.activeCropAction === "center") {
            this.cropBox.x = this.cropOriginalBox.x + dx;
            this.cropBox.y = this.cropOriginalBox.y + dy;
        } else {
            const MIN_SIZE = 10;
            if (this.activeCropAction.includes("l")) {
                this.cropBox.x = Math.min(this.cropOriginalBox.x + dx, this.cropOriginalBox.x + this.cropOriginalBox.width - MIN_SIZE);
                this.cropBox.width = this.cropOriginalBox.x + this.cropOriginalBox.width - this.cropBox.x;
            }
            if (this.activeCropAction.includes("r")) {
                this.cropBox.width = Math.max(MIN_SIZE, this.cropOriginalBox.width + dx);
            }
            if (this.activeCropAction.includes("t")) {
                this.cropBox.y = Math.min(this.cropOriginalBox.y + dy, this.cropOriginalBox.y + this.cropOriginalBox.height - MIN_SIZE);
                this.cropBox.height = this.cropOriginalBox.y + this.cropOriginalBox.height - this.cropBox.y;
            }
            if (this.activeCropAction.includes("b")) {
                this.cropBox.height = Math.max(MIN_SIZE, this.cropOriginalBox.height + dy);
            }
        }

        this.cropBox.x = Math.max(0, Math.min(this.cropBox.x, this.mapWidth - this.cropBox.width));
        this.cropBox.y = Math.max(0, Math.min(this.cropBox.y, this.mapHeight - this.cropBox.height));

        this.#drawCropOverlay();
        if (this.onCropUpdate) this.onCropUpdate(this.cropBox);
    }

    #handleDoubleClick(e, canvasElement) {
        if (!this.isEditMode) return;

        const coords = this.#getMapCoordinates(e, canvasElement);
        const hit = this.#getHitTarget(coords.x, coords.y);

        if (hit && this.onDoubleClick) {
            e.preventDefault();
            e.stopPropagation();
            this.onDoubleClick(hit);
        }
    }

    #handlePointerUp(e, canvasElement) {
        if (canvasElement.hasPointerCapture(e.pointerId)) {
            canvasElement.releasePointerCapture(e.pointerId);
        }

        if (e.button === 2 || e.button === 1) {
            this.isDragging = false;
            if (e.button === 2 && this.dragStart) {
                const dist = Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y);
                if (dist < 5 && this.onRightClick) this.onRightClick();
            }
            canvasElement.style.cursor = this.isEditMode ? "crosshair" : "default";
            return;
        }

        if (e.button === 0) {
            if (this.activeCropAction) {
                this.activeCropAction = null;
                canvasElement.style.cursor = "crosshair";
                return;
            }
            if (this.isDraggingReference) {
                this.isDraggingReference = false;
                canvasElement.style.cursor = "crosshair";
                return;
            }
            if (this.activeDrag) {
                this.activeDrag = null;
                canvasElement.style.cursor = "crosshair";
                if (this.onInfraDragEnd) this.onInfraDragEnd();
                return;
            }
            if (this.isEditMode && this.onBrushEnd) {
                this.onBrushEnd();
            }
        }
    }

    #handlePointerLeave(e, canvasElement) {
        if (!this.isDragging && !this.activeDrag && this.onCanvasHover) {
            this.onCanvasHover(null, null);
        }
    }

    // --- Public API for the UI Buttons ---

    zoomCamera(factor) {
        const center = { x: this.container.clientWidth / 2, y: this.container.clientHeight / 2 };
        const localX = (center.x - this.stage.x) / this.stage.scale.x;
        const localY = (center.y - this.stage.y) / this.stage.scale.y;

        const maxZoom = Math.max(FILRODENSWMB.UI.ZOOM.MIN_ZOOM_FLOOR, this.mapWidth / FILRODENSWMB.UI.ZOOM.MAX_ZOOM_DIVISOR);

        this.stage.scale.x = Math.max(0.1, Math.min(this.stage.scale.x * factor, maxZoom));
        this.stage.scale.y = Math.max(0.1, Math.min(this.stage.scale.y * factor, maxZoom));

        this.stage.position.x = center.x - localX * this.stage.scale.x;
        this.stage.position.y = center.y - localY * this.stage.scale.y;

        this.#updateNodeScales(); // Trigger inverse scaling
    }

    resetCamera() {
        const paddedWidth = this.mapWidth * 1.1;
        const paddedHeight = this.mapHeight * 1.1;

        const scaleX = this.app.screen.width / paddedWidth;
        const scaleY = this.app.screen.height / paddedHeight;
        const optimalScale = Math.min(scaleX, scaleY);

        const maxZoom = Math.max(FILRODENSWMB.UI.ZOOM.MIN_ZOOM_FLOOR, this.mapWidth / FILRODENSWMB.UI.ZOOM.MAX_ZOOM_DIVISOR);
        const finalScale = Math.max(0.1, Math.min(optimalScale, maxZoom));

        this.stage.scale.set(finalScale);
        this.stage.position.set((this.app.screen.width - this.mapWidth * finalScale) / 2, (this.app.screen.height - this.mapHeight * finalScale) / 2);

        this.#updateNodeScales(); // Trigger inverse scaling
    }

    destroy() {
        if (this.animationFrameId) {
            const activeWindow = this.container?.ownerDocument?.defaultView || window;
            activeWindow.cancelAnimationFrame(this.animationFrameId);
        }
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

        this.#updateGlobalMask();

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
     * Renders procedural, non-interactive water vectors.
     */
    renderProceduralRivers(rivers, waterMask) {
        if (!this.proceduralRiverGraphics) return;

        this.proceduralRiverGraphics.clear();
        this.proceduralRiverGraphics.removeChildren().forEach((c) => c.destroy({ children: true }));

        if (rivers && rivers.length > 0) {
            this.#drawRivers(rivers, waterMask);
        }
    }

    /**
     * Renders interactive feature pins (like Springs and Blockers).
     */
    renderFeaturePins(mapPins, isFeatureEdit) {
        if (!this.featurePinGraphics) return;

        this.featurePinGraphics.clear();
        this.featurePinGraphics.removeChildren().forEach((c) => c.destroy({ children: true }));

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
        if (!path || path.length === 0) return;

        let currentIsFrozen = path[0].isFrozen;
        this.proceduralRiverGraphics.lineStyle(2, currentIsFrozen ? frozenColor : waterColor, 0.9);
        this.proceduralRiverGraphics.moveTo(path[0].x, path[0].y);

        for (let i = 1; i < path.length; i++) {
            const point = path[i];

            // If the climate crosses the freezing threshold, snap the line and change colors
            if (point.isFrozen !== currentIsFrozen) {
                currentIsFrozen = point.isFrozen;
                this.proceduralRiverGraphics.lineStyle(2, currentIsFrozen ? frozenColor : waterColor, 0.9);
                this.proceduralRiverGraphics.moveTo(point.x, point.y);
            } else {
                this.proceduralRiverGraphics.lineTo(point.x, point.y);
            }
        }
    }

    /**
     * Renders Vector Pins directly from the POI array using a flattened color map.
     */
    #drawMapPins(mapPins, isFeatureEdit) {
        this.featurePinGraphics.lineStyle(0);

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

            if (hexColor !== undefined) {
                const radius = pin.radius || FILRODENSWMB.DISPLAY.PIN_RADIUS;
                this.featurePinGraphics.beginFill(hexColor, FILRODENSWMB.DISPLAY.PIN_ALPHA);
                this.featurePinGraphics.drawCircle(pin.x, pin.y, radius);
                this.featurePinGraphics.endFill();

                if (isFeatureEdit) {
                    this.interactiveTargets.push({ target: pin, x: pin.x, y: pin.y, radius: Math.max(radius, 10), entityType: "pin", entityId: pin.id });
                }
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
        this.gridLayer.lineStyle(1, 0xffffff, FILRODENSWMB.DISPLAY.GRID_ALPHA);

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

    /**
     * Extracts the current PIXI stage and converts it synchronously to a binary Blob.
     * Triggers a detached link click to bypass Electron's DOM navigation interceptors.
     */
    exportToPNG(filename = "world-map") {
        try {
            this.layers.reference.visible = false;
            const canvas = this.app.renderer.extract.canvas(this.stage);
            this.layers.reference.visible = true;

            const dataUrl = canvas.toDataURL("image/png");
            const byteString = atob(dataUrl.split(",")[1]);
            const arrayBuffer = new ArrayBuffer(byteString.length);
            const uintArray = new Uint8Array(arrayBuffer);

            for (let i = 0; i < byteString.length; i++) {
                uintArray[i] = byteString.codePointAt(i);
            }

            const blob = new Blob([arrayBuffer], { type: "image/png" });
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;

            const safeName = filename.replace(/[^a-z0-9]/gi, "_").toLowerCase();
            a.download = `fwmb_${safeName}.png`;

            a.click();

            URL.revokeObjectURL(blobUrl);
        } catch (err) {
            console.error("FWMB | Failed to export PNG:", err);
            ui.notifications.error("Failed to generate PNG. The map resolution may exceed GPU extraction limits.");
        }
    }

    /**
     * Generates a smooth array of coordinates through the provided points using a Catmull-Rom spline.
     */
    #getSplinePoints(points, resolution = 20) {
        if (!points || points.length < 2) return points;
        if (points.length === 2) return points;

        const curve = [];

        // To make the spline pass exactly through the first and last points without snapping,
        // we duplicate the start and end nodes to act as invisible control anchors.
        const p = [points[0], ...points, points[points.length - 1]];

        for (let i = 1; i < p.length - 2; i++) {
            const p0 = p[i - 1];
            const p1 = p[i];
            const p2 = p[i + 1];
            const p3 = p[i + 2];

            for (let t = 0; t <= 1; t += 1 / resolution) {
                const t2 = t * t;
                const t3 = t2 * t;

                const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);

                const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

                // Prevent pushing microscopic overlapping coordinates
                if (curve.length > 0) {
                    const last = curve.at(-1);
                    if (Math.abs(last.x - x) < 0.1 && Math.abs(last.y - y) < 0.1) continue;
                }

                curve.push({ x, y });
            }
        }
        return curve;
    }

    /**
     * Programmatically generates seamless diagonal and crosshatch textures for polygon fills.
     */
    #getHatchTexture(colorHex, style) {
        const key = `${colorHex}_${style}`;
        if (this.layerSprites[key]) return this.layerSprites[key];

        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext("2d");

        // Convert strict hex integer back to #RRGGBB string for the canvas context
        ctx.strokeStyle = "#" + colorHex.toString(16).padStart(6, "0");
        ctx.lineWidth = 2;

        if (style === "diagonal" || style === "crosshatch") {
            ctx.beginPath();
            ctx.moveTo(-4, 12);
            ctx.lineTo(12, -4);
            ctx.moveTo(4, 20);
            ctx.lineTo(20, 4);
            ctx.stroke();
        }
        if (style === "crosshatch") {
            ctx.beginPath();
            ctx.moveTo(20, 12);
            ctx.lineTo(4, -4);
            ctx.moveTo(12, 20);
            ctx.lineTo(-4, 4);
            ctx.stroke();
        }

        const texture = PIXI.Texture.from(canvas);
        this.layerSprites[key] = texture;
        return texture;
    }

    /**
     * A variation of the spline generator that wraps the array to create a perfectly closed, seamless loop.
     */
    #getClosedSplinePoints(points, resolution = 20) {
        if (!points || points.length < 3) return points;
        const curve = [];

        // Wrap the array: [Last, First, Second, ..., Last, First, Second]
        const p = [points[points.length - 1], ...points, points[0], points[1]];

        for (let i = 1; i < p.length - 2; i++) {
            const p0 = p[i - 1];
            const p1 = p[i];
            const p2 = p[i + 1];
            const p3 = p[i + 2];

            for (let t = 0; t <= 1; t += 1 / resolution) {
                const t2 = t * t;
                const t3 = t2 * t;

                const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
                const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

                if (curve.length > 0) {
                    const last = curve.at(-1);
                    if (Math.abs(last.x - x) < 0.1 && Math.abs(last.y - y) < 0.1) continue;
                }
                curve.push({ x, y });
            }
        }
        return curve;
    }

    /**
     * Safety router to clear the spatial node cache before a render pass.
     */
    clearInteractiveTargets() {
        this.interactiveTargets = [];
    }

    /**
     * Renders vector routes and POI pins to the infrastructure layer.
     */
    renderInfrastructure(pins = [], routes = [], isEditMode = false, activeRouteId = null) {
        // Clone and sort the routes by thickness so major highways always draw on top
        const sortedRoutes = [...routes].sort((a, b) => a.thickness - b.thickness);

        this.routeGraphics.clear();
        this.pinContainer.removeChildren().forEach((c) => c.destroy(true));
        this.nodeContainer.removeChildren().forEach((c) => c.destroy(true));

        // 1. Render Routes (Bottom Layer)
        sortedRoutes.forEach((route) => {
            if (!this.#isVisibleInCurrentPass(route.visibility, "all", false) || !route.points || route.points.length === 0) return;

            // 1a. Draw Edit Nodes FIRST (Guarantees the initial single click is visible)
            if (isEditMode) {
                const isActive = route.id === activeRouteId;
                this.#renderEditNodes(route.points, this.nodeContainer, isActive, route, "route");
            }

            // 1b. Abort line geometry if there is no second point to connect to
            if (route.points.length < 2) return;

            const colorHex = Number.parseInt(route.color.replace("#", ""), 16);
            const splinePoints = this.#getSplinePoints(route.points);

            // Pass 1: Draw the 1px black outline shadow
            this.routeGraphics.lineStyle({
                width: route.thickness + 1,
                color: 0x000000,
                alpha: 1,
                cap: PIXI.LINE_CAP.ROUND,
                join: PIXI.LINE_JOIN.ROUND,
            });
            this.#drawVectorPath(this.routeGraphics, splinePoints, route.style, route.thickness);

            // Pass 2: Draw the colored foreground line
            this.routeGraphics.lineStyle({
                width: route.thickness,
                color: colorHex,
                alpha: 1,
                cap: PIXI.LINE_CAP.ROUND,
                join: PIXI.LINE_JOIN.ROUND,
            });
            this.#drawVectorPath(this.routeGraphics, splinePoints, route.style, route.thickness);
        });

        // 2. Render Pins (Top Layer)
        const resScale = Math.max(this.mapWidth, this.mapHeight) / FILRODENSWMB.LIMITS.BASELINE_DIMENSION;

        pins.forEach((pin) => {
            if (!this.#isVisibleInCurrentPass(pin.visibility, "all", false)) return;

            const texturePath = `modules/filrodens-world-map-builder/assets/pinhead-icons/${pin.icon}.svg`;
            const sprite = new PIXI.Sprite(PIXI.Texture.from(texturePath));

            // Apply multiplicative tinting (defaults to white if missing)
            if (pin.color) {
                sprite.tint = Number(pin.color.replace("#", "0x"));
            }

            // Apply resolution scaling * user override scale
            const baseSize = 24 * resScale;
            sprite.width = baseSize * (pin.scale || 1);
            sprite.height = baseSize * (pin.scale || 1);

            sprite.anchor.set(0.5);
            sprite.x = pin.x;
            sprite.y = pin.y;

            if (isEditMode) {
                // The hit radius must expand to match the new size
                this.interactiveTargets.push({ target: pin, x: pin.x, y: pin.y, radius: sprite.width / 2, entityType: "pin", entityId: pin.id });
            } else if (!this.isEditMode && (pin.name || pin.description)) {
                // Keep PIXI hover events for tooltips ONLY when the global canvas is not in ANY edit mode
                sprite.eventMode = "static";
                sprite.interactive = true;
                sprite.cursor = "help";

                sprite.on("pointerover", () => {
                    const tooltip = document.getElementById("fwmb-infra-tooltip");
                    if (!tooltip) return;

                    let html = ``;
                    if (pin.name) html += `<strong>${pin.name}</strong>`;
                    if (pin.description) html += `<span>${pin.description.replaceAll("\n", "<br>")}</span>`;

                    tooltip.innerHTML = html;
                    tooltip.classList.remove("fwmb-hidden");
                });

                sprite.on("pointermove", (e) => {
                    const tooltip = document.getElementById("fwmb-infra-tooltip");
                    if (!tooltip) return;

                    const evt = e.data.originalEvent;
                    tooltip.style.left = `${evt.clientX}px`;
                    tooltip.style.top = `${evt.clientY - 15}px`;
                });

                sprite.on("pointerout", () => {
                    const tooltip = document.getElementById("fwmb-infra-tooltip");
                    if (tooltip) tooltip.classList.add("fwmb-hidden");
                });
            }

            this.pinContainer.addChild(sprite);
        });
    }

    renderRegions(regionLayers = [], isEditMode = false, activeRegionId = null, globalOpacity = 0.5) {
        this.layers.regions.removeChildren().forEach((c) => c.destroy({ children: true }));

        regionLayers.forEach((layer) => {
            if (!this.#isVisibleInCurrentPass(layer.visibility, "all", true)) return;

            const layerContainer = new PIXI.Container();
            layerContainer.alpha = globalOpacity;
            this.layers.regions.addChild(layerContainer);

            layer.regions.forEach((region) => {
                if (!this.#isVisibleInCurrentPass(region.visibility, layer.visibility, false) || !region.points || region.points.length === 0) return;

                const g = new PIXI.Graphics();
                layerContainer.addChild(g);

                const fillColorHex = region.fillColor === "transparent" ? null : Number.parseInt(region.fillColor.replace("#", ""), 16);
                const lineColorHex = Number.parseInt(region.lineColor.replace("#", ""), 16);

                // A polygon is "closed" if it has 3+ points and the user isn't actively currently drawing it
                const isClosed = region.points.length >= 3 && region.id !== activeRegionId;
                const pts = region.smoothing && isClosed ? this.#getClosedSplinePoints(region.points) : region.points;

                // 1. Draw Fill
                if (fillColorHex !== null) {
                    if (region.fillStyle === "solid") {
                        g.beginFill(fillColorHex, 1);
                    } else {
                        const tex = this.#getHatchTexture(fillColorHex, region.fillStyle);

                        // Shift the texture origin to the region's first node.
                        // This creates a clean, deterministic phase offset between different regions.
                        const matrix = new PIXI.Matrix();
                        matrix.translate(pts[0].x, pts[0].y);

                        g.beginTextureFill({ texture: tex, matrix: matrix });
                    }

                    g.lineStyle(0); // Fills don't have lines
                    g.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) {
                        g.lineTo(pts[i].x, pts[i].y);
                    }
                    if (isClosed) g.closePath();
                    g.endFill();
                }

                // 2. Draw Border
                if (region.lineThickness > 0) {
                    g.lineStyle({ width: region.lineThickness, color: lineColorHex, alpha: 1, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
                    this.#drawVectorPath(g, pts, region.lineStyle, region.lineThickness, isClosed);
                }

                // 3. Draw Edit Nodes
                if (isEditMode) {
                    const isActive = region.id === activeRegionId;
                    this.#renderEditNodes(region.points, layerContainer, isActive, region, "region", layer.id);
                }
            });
        });
    }

    /**
     * Frames the viewport to encompass a specific array of coordinates
     * and fires a temporary animated highlight box around the true bounds.
     */
    zoomToFeature(points) {
        if (!points || points.length === 0 || !this.stage) return;

        let minX = points[0].x;
        let maxX = points[0].x;
        let minY = points[0].y;
        let maxY = points[0].y;

        // Flatten the boundaries
        for (let i = 1; i < points.length; i++) {
            if (points[i].x < minX) minX = points[i].x;
            if (points[i].x > maxX) maxX = points[i].x;
            if (points[i].y < minY) minY = points[i].y;
            if (points[i].y > maxY) maxY = points[i].y;
        }

        // Separate the true visual dimensions from the padded camera bounding box
        const trueWidth = maxX - minX;
        const trueHeight = maxY - minY;
        const centerX = minX + trueWidth / 2;
        const centerY = minY + trueHeight / 2;

        const zoomWidth = Math.max(trueWidth, FILRODENSWMB.UI.ZOOM.MIN_BOUNDS_SIZE);
        const zoomHeight = Math.max(trueHeight, FILRODENSWMB.UI.ZOOM.MIN_BOUNDS_SIZE);

        // Calculate scale to fit with padding, constrained by maximum zoom limits
        const scaleX = this.app.screen.width / (zoomWidth * FILRODENSWMB.UI.ZOOM.PADDING_FACTOR);
        const scaleY = this.app.screen.height / (zoomHeight * FILRODENSWMB.UI.ZOOM.PADDING_FACTOR);
        const targetScale = Math.min(scaleX, scaleY, FILRODENSWMB.UI.ZOOM.MAX_ZOOM_SCALE);

        // Apply transforms directly to the PIXI stage
        this.stage.scale.set(targetScale);
        this.stage.position.x = this.app.screen.width / 2 - centerX * targetScale;
        this.stage.position.y = this.app.screen.height / 2 - centerY * targetScale;

        // Ensure interactive edit nodes shrink to match the new zoom level
        this.#updateNodeScales();

        // --- Animated Target Highlight ---
        const invScale = 1 / targetScale;
        const pad = FILRODENSWMB.UI.ZOOM.VISUAL_PADDING * invScale; // Maintain constant visual padding at any zoom

        const highlight = new PIXI.Graphics();
        highlight.lineStyle(4 * invScale, 0x00e5ff, 1);
        highlight.beginFill(0x00e5ff, 0.15);
        highlight.drawRoundedRect(-trueWidth / 2 - pad, -trueHeight / 2 - pad, trueWidth + pad * 2, trueHeight + pad * 2, 12 * invScale);
        highlight.endFill();

        highlight.x = centerX;
        highlight.y = centerY;
        this.stage.addChild(highlight);

        // Fire a self-cleaning animation loop directly into the PIXI ticker
        let elapsed = 0;
        const duration = 90; // Approx 1.5 seconds at 60fps

        const tick = () => {
            // Safety escape if the user closes the app mid-animation
            if (highlight.destroyed) {
                this.app.ticker.remove(tick);
                return;
            }

            elapsed++;
            const progress = elapsed / duration;

            // Ease-out fade combined with a gentle outward expansion
            highlight.alpha = 1 - Math.pow(progress, 2);
            highlight.scale.set(1 + progress * 0.15);

            if (elapsed >= duration) {
                highlight.destroy();
                this.app.ticker.remove(tick);
            }
        };

        this.app.ticker.add(tick);
    }

    async updateReferenceImage(url, x, y, scale, alpha) {
        if (!url) {
            this.referenceSprite.texture = PIXI.Texture.EMPTY;
            return;
        }

        try {
            if (!this.referenceSprite.texture.textureCacheIds.includes(url)) {
                const texture = await PIXI.Assets.load(url);
                this.referenceSprite.texture = texture;
            }
        } catch (err) {
            console.error("FWMB | Failed to load reference image:", err);
        }

        this.referenceSprite.x = x;
        this.referenceSprite.y = y;
        this.referenceSprite.scale.set(scale);
        this.referenceSprite.alpha = alpha;
    }

    setReferenceMode(isActive) {
        this.isReferenceMode = isActive;
        const canvasElement = this.app.canvas ?? this.app.view;
        if (isActive) canvasElement.style.cursor = "crosshair";
    }

    updateBrushCursor(x, y, radius, isVisible) {
        if (!isVisible || x === null || y === null) {
            this.brushCursor.visible = false;
            return;
        }

        this.brushCursor.visible = true;
        this.brushCursor.clear();

        // Ensure the line stays exactly 1 screen-pixel thick regardless of map zoom
        const thickness = 1 / this.stage.scale.x;

        // Draw a white circle with a slight drop-shadow effect for visibility on light terrain
        this.brushCursor.lineStyle({ width: thickness * 3, color: 0x000000, alpha: 0.3 });
        this.brushCursor.drawCircle(x, y, radius);

        this.brushCursor.lineStyle({ width: thickness, color: 0xffffff, alpha: 0.9 });
        this.brushCursor.drawCircle(x, y, radius);
    }

    /**
     * Calculates relative luminance to guarantee text readability against any biome.
     */
    #getAdaptiveStrokeColor(hexColor) {
        const cleanHex = String(hexColor).replace("#", "");
        if (cleanHex.length !== 6) return "#000000";

        const r = Number.parseInt(cleanHex.substring(0, 2), 16);
        const g = Number.parseInt(cleanHex.substring(2, 4), 16);
        const b = Number.parseInt(cleanHex.substring(4, 6), 16);

        // Standard perceived luminance calculation
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        return luma < 128 ? "#ffffff" : "#000000";
    }

    renderLabels(mapLabels = [], mapPins = [], mapRoutes = [], regionLayers = [], isEditMode = false) {
        this.layers.labels.removeChildren().forEach((c) => c.destroy({ children: true, texture: true, baseTexture: true }));

        // Extract native OS root font size to mimic CSS 'rem' behaviour
        const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

        // Dynamically scale vectors based on the canvas dimensions
        const resScale = Math.max(this.mapWidth, this.mapHeight) / FILRODENSWMB.LIMITS.BASELINE_DIMENSION;

        const ensureLabelData = (obj) => {
            if (!obj.label) obj.label = {};
            return obj.label;
        };

        const drawLabel = (name, labelData, defaultX, defaultY, parentVis = "all", parentId = null, parentType = "custom", layerId = null) => {
            if (!this.#isVisibleInCurrentPass(labelData?.visibility, parentVis, false) || !name) return;

            const x = labelData.x ?? defaultX;
            const y = labelData.y ?? defaultY;
            const rotation = labelData.rotation ?? 0;

            const font = labelData.fontFamily || "Signika";
            const size = (labelData.fontSize || 1) * rootFontSize * resScale;
            const fill = labelData.fillColor || "#ffffff";
            const stroke = this.#getAdaptiveStrokeColor(fill);

            // 1. Setup Base Style
            const styleConfig = {
                fontFamily: font,
                fontSize: size,
                fill: fill,
                fontWeight: "bold",
                stroke: stroke,
                strokeThickness: 3,
                dropShadow: true,
                dropShadowColor: stroke,
                dropShadowBlur: 2,
                dropShadowDistance: 2,
            };

            // 2. Apply Word Wrapping & Justification
            const rawMaxWidth = labelData.maxWidth || 0;
            if (rawMaxWidth > 0) {
                styleConfig.wordWrap = true;
                styleConfig.wordWrapWidth = rawMaxWidth * resScale;
                styleConfig.align = labelData.justify || "left";
            }

            const style = new PIXI.TextStyle(styleConfig);

            const text = new PIXI.Text(name, style);
            text.anchor.set(0.5);
            text.x = x;
            text.y = y;
            text.rotation = rotation * (Math.PI / 180);

            this.layers.labels.addChild(text);

            if (isEditMode) {
                labelData.x = x;
                labelData.y = y;

                const hitRadius = Math.max(text.width, text.height) / 2;
                this.interactiveTargets.push({
                    target: labelData,
                    x: x,
                    y: y,
                    radius: hitRadius,
                    isLabel: true,
                    entityType: "label",
                    entityId: parentId || labelData.id,
                    parentType: parentType,
                    layerId: layerId,
                });
            }
        };

        // Custom Labels
        mapLabels.forEach((label) => drawLabel(label.name, label, label.x, label.y, "all", label.id, "custom"));

        // Auto-Labels: Pins (Offset Top Right)
        mapPins.forEach((pin) => {
            if (!pin.icon) return;
            drawLabel(pin.name, ensureLabelData(pin), pin.x + 20, pin.y - 20, pin.visibility, pin.id, "pin");
        });

        // Auto-Labels: Routes (Spline Midpoint)
        mapRoutes.forEach((route) => {
            if (route.visibility === "none" || !route.points || route.points.length < 2) return;
            if (!this.#isVisibleInCurrentPass(route.visibility, "all", true)) return; // Check container rules

            const spline = this.#getSplinePoints(route.points);
            const mid = spline[Math.floor(spline.length / 2)];
            drawLabel(route.name, ensureLabelData(route), mid.x, mid.y - 15, route.visibility, route.id, "route");
        });

        // Auto-Labels: Regions (Polygon Centroid)
        regionLayers.forEach((layer) => {
            if (!this.#isVisibleInCurrentPass(layer.visibility, "all", true)) return;

            layer.regions.forEach((region) => {
                let regionVis = region.visibility || "all";
                if (regionVis !== "none" && layer.visibility === "gm") regionVis = "gm";

                if (!this.#isVisibleInCurrentPass(regionVis, layer.visibility, true) || !region.points || region.points.length < 3) return;

                let minX = Infinity,
                    maxX = -Infinity,
                    minY = Infinity,
                    maxY = -Infinity;
                region.points.forEach((p) => {
                    if (p.x < minX) minX = p.x;
                    if (p.x > maxX) maxX = p.x;
                    if (p.y < minY) minY = p.y;
                    if (p.y > maxY) maxY = p.y;
                });

                drawLabel(region.name, ensureLabelData(region), minX + (maxX - minX) / 2, minY + (maxY - minY) / 2, regionVis, region.id, "region", layer.id);
            });
        });
    }

    renderCartography(uiState, mapWidth, mapHeight, isEditMode = false, decorations = []) {
        if (!this.layers.cartography) return;
        this.layers.cartography.removeChildren().forEach((c) => c.destroy({ children: true }));

        // Delegate to isolated drawing pipelines
        this.#drawCartographyBorder(uiState, mapWidth, mapHeight);
        this.#drawScaleBar(uiState, mapHeight, isEditMode);
        this.#drawCartographyDecorations(decorations, isEditMode);
    }

    #drawCartographyBorder(uiState, mapWidth, mapHeight) {
        if (!uiState.cartographyBorderEnable) return;

        const vectorLayer = new PIXI.Graphics();
        this.layers.cartography.addChild(vectorLayer);

        const borderColorHex = Number.parseInt((uiState.cartographyBorderColor || "#000000").replace("#", ""), 16);
        const style = uiState.cartographyBorderStyle;
        const margin = 20;

        if (style === "solid") {
            vectorLayer.lineStyle(10, borderColorHex, 1, 0);
            vectorLayer.drawRect(0, 0, mapWidth, mapHeight);
        } else if (style === "double") {
            vectorLayer.lineStyle(10, borderColorHex, 1, 0);
            vectorLayer.drawRect(0, 0, mapWidth, mapHeight);
            vectorLayer.lineStyle(3, borderColorHex, 1, 0);
            vectorLayer.drawRect(margin, margin, mapWidth - margin * 2, mapHeight - margin * 2);
        } else if (style === "ornate") {
            vectorLayer.lineStyle(12, borderColorHex, 1, 0);
            vectorLayer.drawRect(0, 0, mapWidth, mapHeight);
            vectorLayer.lineStyle(4, borderColorHex, 1, 0);
            vectorLayer.drawRect(margin, margin, mapWidth - margin * 2, mapHeight - margin * 2);

            const boxSize = 40;
            vectorLayer.beginFill(borderColorHex);
            vectorLayer.drawRect(0, 0, boxSize, boxSize);
            vectorLayer.drawRect(mapWidth - boxSize, 0, boxSize, boxSize);
            vectorLayer.drawRect(0, mapHeight - boxSize, boxSize, boxSize);
            vectorLayer.drawRect(mapWidth - boxSize, mapHeight - boxSize, boxSize, boxSize);
            vectorLayer.endFill();
        }
    }

    #drawScaleBar(uiState, mapHeight, isEditMode) {
        if (!uiState.cartographyScaleEnable) return;

        const scaleContainer = new PIXI.Container();

        // Set position based on UI State
        scaleContainer.x = uiState.cartographyScaleX ?? 50;
        scaleContainer.y = uiState.cartographyScaleY ?? mapHeight - 50;

        const interval = uiState.cartographyScaleInterval || 100;
        const majorTicks = uiState.cartographyScaleMajorTicks || 4;
        const minorTicks = uiState.cartographyScaleMinorTicks || 4;
        const scaleValue = uiState.cartographyScaleValue || 1;
        const units = uiState.cartographyScaleUnits || "Miles";

        const height = 10;
        const totalWidth = interval * majorTicks;

        const scaleGraphics = new PIXI.Graphics();

        // Base graphics are drawn relative to 0,0 inside the container
        scaleGraphics.lineStyle(2, 0x000000, 1);
        scaleGraphics.beginFill(0xffffff, 0.9);
        scaleGraphics.drawRect(0, 0, totalWidth, height);
        scaleGraphics.endFill();

        scaleGraphics.beginFill(0x000000, 0.9);
        for (let i = 0; i < majorTicks; i++) {
            if (i % 2 !== 0) scaleGraphics.drawRect(i * interval, 0, interval, height);
        }
        scaleGraphics.endFill();

        if (minorTicks > 0) {
            const minorInterval = interval / minorTicks;
            scaleGraphics.beginFill(0x000000, 0.9);
            for (let i = 0; i < minorTicks; i++) {
                if (i % 2 === 0) {
                    scaleGraphics.drawRect(i * minorInterval, height / 2, minorInterval, height / 2);
                } else {
                    scaleGraphics.drawRect(i * minorInterval, 0, minorInterval, height / 2);
                }
            }
            scaleGraphics.endFill();
        }
        scaleContainer.addChild(scaleGraphics);

        const textStyle = new PIXI.TextStyle({ fontFamily: "Signika", fontSize: 16, fill: "#000000", stroke: "#ffffff", strokeThickness: 4, fontWeight: "bold" });
        const text0 = new PIXI.Text("0", textStyle);
        text0.anchor.set(0.5, 1);
        text0.x = 0;
        text0.y = -5;
        scaleContainer.addChild(text0);

        // Apply the multiplier mathematically
        const textMax = new PIXI.Text(`${majorTicks * scaleValue} ${units}`, textStyle);
        textMax.anchor.set(0.5, 1);
        textMax.x = totalWidth;
        textMax.y = -5;
        scaleContainer.addChild(textMax);

        this.layers.cartography.addChild(scaleContainer);

        if (isEditMode) {
            const scaleDataObj = {
                get x() {
                    return uiState.cartographyScaleX;
                },
                set x(val) {
                    uiState.cartographyScaleX = val;
                },
                get y() {
                    return uiState.cartographyScaleY;
                },
                set y(val) {
                    uiState.cartographyScaleY = val;
                },
            };

            this.interactiveTargets.push({
                target: scaleDataObj,
                x: scaleContainer.x + totalWidth / 2,
                y: scaleContainer.y,
                radius: totalWidth / 2,
                isDecoration: false,
            });
        }
    }

    #drawCartographyDecorations(decorations, isEditMode) {
        decorations.forEach((dec) => {
            if (!this.#isVisibleInCurrentPass(dec.visibility, "all", false) || !dec.src) return;

            const sprite = new PIXI.Sprite(PIXI.Texture.from(dec.src));
            sprite.anchor.set(0.5);
            sprite.x = dec.x;
            sprite.y = dec.y;
            sprite.rotation = dec.rotation * (Math.PI / 180);
            sprite.scale.set(dec.scale || 1);
            sprite.alpha = dec.opacity ?? 1; // Allow opacity fading

            this.layers.cartography.addChild(sprite);

            if (isEditMode) {
                const hitRadius = Math.max(sprite.width, sprite.height, 32) / 2;
                this.interactiveTargets.push({
                    target: dec,
                    x: dec.x,
                    y: dec.y,
                    radius: hitRadius,
                    isDecoration: true,
                    entityType: "decoration",
                    entityId: dec.id,
                });
            }
        });
    }

    /**
     * Extracts the canvas to a binary Blob, manipulating heavy background layers based on the pass type.
     */
    async extractCanvasBlob(passType = "player") {
        const originalVisibility = {
            grid: this.gridLayer.visible,
            reference: this.layers.reference.visible,
            cartography: this.layers.cartography.visible,
        };

        this.layers.reference.visible = false;

        if (passType === "player") {
            this.gridLayer.visible = false;
        } else if (passType === "gm") {
            this.layers.base.visible = false;
            this.layers.topography.visible = false;
            this.layers.biomes.visible = false;
            this.layers.contours.visible = false;
            this.layers.features.visible = false;
            this.gridLayer.visible = false;
            this.layers.cartography.visible = false;
        }

        const renderTexture = PIXI.RenderTexture.create({
            width: this.mapWidth,
            height: this.mapHeight,
            resolution: 1,
        });

        this.app.renderer.render(this.stage, { renderTexture: renderTexture });

        const canvas = this.app.renderer.extract.canvas(renderTexture);

        this.gridLayer.visible = originalVisibility.grid;
        this.layers.reference.visible = originalVisibility.reference;
        this.layers.cartography.visible = originalVisibility.cartography;
        this.layers.base.visible = true;
        this.layers.topography.visible = true;
        this.layers.biomes.visible = true;
        this.layers.contours.visible = true;
        this.layers.features.visible = true;

        return new Promise((resolve) => {
            canvas.toBlob((blob) => {
                renderTexture.destroy(true);
                resolve(blob);
            }, "image/png");
        });
    }

    setRenderPass(mode) {
        this.renderPassMode = mode;
    }

    setViewFilters(filters) {
        this.viewFilters = { ...this.viewFilters, ...filters };
    }

    /**
     * Evaluates whether a JSON element should be drawn during the current pass.
     * @param {string} visibility - The visibility of the current element ("all", "gm", "none")
     * @param {string} parentVisibility - The visibility of the parent container ("all", "gm", "none")
     * @param {boolean} isContainer - Whether this element contains children that need evaluation
     */
    #isVisibleInCurrentPass(visibility, parentVisibility = "all", isContainer = false) {
        let vis = visibility || "all";

        // Hierarchical override: If a parent is strictly GM only, children cannot be Player visible.
        if (vis !== "none" && parentVisibility === "gm") {
            vis = "gm";
        }

        if (vis === "none") return false;

        // Strict Export Overrides
        if (this.renderPassMode === "player") {
            return vis === "all";
        } else if (this.renderPassMode === "gm") {
            if (isContainer && vis === "all") return true; // Enter generic layers to check for GM secrets
            return vis === "gm";
        }

        // Standard Interactive Mode Filters
        if (isContainer && vis === "all") return true; // Always enter generic layers in interactive mode

        if (vis === "gm") return this.viewFilters.gm;
        return this.viewFilters.all;
    }

    #getCropHitZone(x, y) {
        if (!this.cropBox) return null;

        // Maintain a constant grab radius regardless of zoom level
        const handleR = 10 / this.stage.scale.x;
        const { x: cx, y: cy, width: cw, height: ch } = this.cropBox;

        if (Math.hypot(x - cx, y - cy) < handleR) return "tl";
        if (Math.hypot(x - (cx + cw), y - cy) < handleR) return "tr";
        if (Math.hypot(x - cx, y - (cy + ch)) < handleR) return "bl";
        if (Math.hypot(x - (cx + cw), y - (cy + ch)) < handleR) return "br";

        if (x > cx && x < cx + cw && y > cy && y < cy + ch) return "center";

        return null;
    }

    setCropMode(isActive) {
        this.isCropMode = isActive;
        if (!isActive) {
            this.cropGraphics.clear();
            this.cropBox = null;
        } else if (!this.cropBox) {
            // Initialise default bounding box to 50% of the screen center
            const w = this.mapWidth * 0.5;
            const h = this.mapHeight * 0.5;
            this.cropBox = { x: (this.mapWidth - w) / 2, y: (this.mapHeight - h) / 2, width: w, height: h };

            this.#drawCropOverlay();
            if (this.onCropUpdate) this.onCropUpdate(this.cropBox);
        }
    }

    getCropData() {
        return this.cropBox;
    }

    #drawCropOverlay() {
        this.cropGraphics.clear();
        if (!this.cropBox || this.cropBox.width <= 0) return;

        // 1. Darkened negative space mask
        this.cropGraphics.beginFill(0x000000, 0.6);
        this.cropGraphics.drawRect(0, 0, this.mapWidth, this.mapHeight);
        this.cropGraphics.beginHole();
        this.cropGraphics.drawRect(this.cropBox.x, this.cropBox.y, this.cropBox.width, this.cropBox.height);
        this.cropGraphics.endHole();
        this.cropGraphics.endFill();

        // 2. Scale-invariant outline
        const lineW = 2 / this.stage.scale.x;
        this.cropGraphics.lineStyle(lineW, 0xffffff, 1);
        this.cropGraphics.drawRect(this.cropBox.x, this.cropBox.y, this.cropBox.width, this.cropBox.height);

        // 3. Corner handles
        const handleR = 6 / this.stage.scale.x;
        this.cropGraphics.beginFill(0xffffff, 1);
        this.cropGraphics.lineStyle(lineW / 2, 0x000000, 1);

        const corners = [
            { x: this.cropBox.x, y: this.cropBox.y },
            { x: this.cropBox.x + this.cropBox.width, y: this.cropBox.y },
            { x: this.cropBox.x, y: this.cropBox.y + this.cropBox.height },
            { x: this.cropBox.x + this.cropBox.width, y: this.cropBox.y + this.cropBox.height },
        ];

        corners.forEach((c) => this.cropGraphics.drawCircle(c.x, c.y, handleR));
        this.cropGraphics.endFill();
    }

    #updateGlobalMask() {
        if (!this.mapMask) {
            this.mapMask = new PIXI.Graphics();
            // Add the mask to the stage, then assign it as the stage's official clipping mask
            this.stage.addChild(this.mapMask);
            this.stage.mask = this.mapMask;
        }

        this.mapMask.clear();
        this.mapMask.beginFill(0xffffff); // Color doesn't matter for masks
        this.mapMask.drawRect(0, 0, this.mapWidth, this.mapHeight);
        this.mapMask.endFill();

        this.stage.hitArea = new PIXI.Rectangle(0, 0, this.mapWidth, this.mapHeight);
    }

    renderFaultLines(faults = [], isEditMode = false, activeFaultId = null) {
        if (this.haloGraphics) this.haloGraphics.clear();

        if (this.faultGraphics) {
            this.faultGraphics.clear();
            this.faultGraphics.removeChildren().forEach((c) => c.destroy({ children: true }));
        }

        if (!this.layers.features || !isEditMode) return;

        faults.forEach((fault) => {
            if (!this.#isVisibleInCurrentPass(fault.visibility, "all", false) || !fault.points || fault.points.length === 0) return;

            // 1. Draw Halo and Line ONLY if there are enough points to form a path
            if (fault.points.length >= 2) {
                const rawSpline = this.#getSplinePoints(fault.points);

                const spline = [rawSpline[0]];
                for (let i = 1; i < rawSpline.length; i++) {
                    const pt = rawSpline[i];
                    const lastPt = spline.at(-1);
                    if (Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y) > 2 || i === rawSpline.length - 1) {
                        spline.push(pt);
                    }
                }

                const colorHex = typeof fault.color === "string" ? Number.parseInt(fault.color.replace("#", ""), 16) : fault.color || 0xffffff;
                const thickness = fault.thickness || FILRODENSWMB.TECTONICS.DEFAULT_THICKNESS;

                // Draw the Area of Effect Halo via circle stamping
                this.haloGraphics.beginFill(colorHex, 1);
                this.haloGraphics.lineStyle(0);

                let lastX = -9999;
                let lastY = -9999;
                const stepThreshold = Math.max(2, thickness * 0.25);

                for (let i = 0; i < spline.length; i++) {
                    const pt = spline[i];
                    if (Math.hypot(pt.x - lastX, pt.y - lastY) > stepThreshold || i === spline.length - 1) {
                        this.haloGraphics.drawCircle(pt.x, pt.y, thickness);
                        lastX = pt.x;
                        lastY = pt.y;
                    }
                }
                this.haloGraphics.endFill();

                // Draw the Core Vector Line
                this.faultGraphics.lineStyle({
                    width: 3,
                    color: colorHex,
                    alpha: 0.85,
                    alignment: 0.5,
                    join: PIXI.LINE_JOIN.ROUND,
                    cap: PIXI.LINE_CAP.ROUND,
                });
                this.#drawVectorPath(this.faultGraphics, spline, "solid", 3);
            }

            // 2. Draw Edit Nodes LAST so they always render on top of the geometry
            if (isEditMode) {
                const isActive = fault.id === activeFaultId;
                this.#renderEditNodes(fault.points, this.faultGraphics, isActive, fault, "fault");
            }
        });
    }

    renderManualRivers(rivers = [], isEditMode = false, activeRiverId = null) {
        if (!this.manualRiverGraphics) return;

        // Aggressively purge memory and nested nodes to prevent WebGL leaks
        this.manualRiverGraphics.clear();
        this.manualRiverGraphics.removeChildren().forEach((c) => c.destroy({ children: true }));

        if (!this.layers.features || !isEditMode) return;

        for (const river of rivers) {
            if (!this.#isVisibleInCurrentPass(river.visibility, "all", false) || !river.points || river.points.length === 0) continue;

            const isActive = river.id === activeRiverId;
            const lineColor = isActive ? 0x00e5ff : 0x78aad2;

            this.manualRiverGraphics.lineStyle(FILRODENSWMB.DISPLAY.RIVER_WIDTH, lineColor, 0.8);

            // Draw Catmull-Rom spline
            const points = river.points;
            if (points.length === 1) {
                this.manualRiverGraphics.drawCircle(points[0].x, points[0].y, 2);
            } else {
                this.#drawVectorPath(this.manualRiverGraphics, points, "solid", 2);
            }

            // Draw edit nodes
            if (isEditMode) {
                const isActive = river.id === activeRiverId;
                this.#renderEditNodes(points, this.manualRiverGraphics, isActive, river, "river");
            }
        }
    }

    /**
     * Centralised factory to spawn interactive vector nodes, automatically applying inverse scale.
     */
    #createEditNode(parentContainer, x, y, isLast, isActive) {
        const nodeColor = isActive ? 0x00e5ff : 0xffffff;
        const node = new PIXI.Graphics();

        node.beginFill(nodeColor, 0.6);
        node.lineStyle(2, 0x000000, 0.6);
        node.drawCircle(0, 0, isLast ? 8 : 5);
        node.endFill();

        node.x = x;
        node.y = y;
        node.isEditNode = true; // Tag for the scale sweeper

        // Immediately apply inverse scaling so it spawns at the correct visual size
        node.scale.set(1 / (this.stage.scale.x || 1));
        parentContainer.addChild(node);
    }

    /**
     * Centralised helper to generate edit nodes and interactive hit targets for any vector array.
     */
    #renderEditNodes(points, parentContainer, isActive, parentEntity, entityType, layerId = null) {
        if (!points || points.length === 0) return;

        const hitRadius = 10 / (this.stage.scale.x || 1);

        points.forEach((pt, index) => {
            const isLast = isActive && index === points.length - 1;
            this.#createEditNode(parentContainer, pt.x, pt.y, isLast, isActive);
            this.interactiveTargets.push({
                target: pt,
                x: pt.x,
                y: pt.y,
                radius: hitRadius,
                entityType: entityType,
                entityId: parentEntity.id,
                layerId: layerId,
            });
        });
    }

    /**
     * Acts as a dictionary for dash geometries.
     */
    #getLinePattern(style, thickness) {
        if (style === "dotted") return [thickness, thickness * 2];
        if (style === "dashdot") return [thickness * 4, thickness * 2, thickness, thickness * 2];
        return [thickness * 4, thickness * 3]; // Default to dashed
    }

    /**
     * Dedicated inner loop processor. Mutates the 'state' object reference
     * to persist pattern progress across multiple line segments.
     */
    #drawDashSegment(graphics, p1, p2, pattern, state) {
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (dist === 0) return;

        let remainingDist = dist;
        let currentX = p1.x;
        let currentY = p1.y;

        while (remainingDist > 0) {
            const step = Math.min(remainingDist, pattern[state.dashIdx] - state.dashLen);
            const ratio = step / remainingDist;

            currentX += (p2.x - currentX) * ratio;
            currentY += (p2.y - currentY) * ratio;

            if (state.isDrawing) graphics.lineTo(currentX, currentY);
            else graphics.moveTo(currentX, currentY);

            state.dashLen += step;
            remainingDist -= step;

            if (state.dashLen >= pattern[state.dashIdx]) {
                state.dashLen = 0;
                state.dashIdx = (state.dashIdx + 1) % pattern.length;
                state.isDrawing = !state.isDrawing;
            }
        }
    }

    /**
     * Unified vector path generator.
     */
    #drawVectorPath(graphics, points, style, thickness, isClosed = false) {
        if (!points || points.length < 2) return;

        graphics.moveTo(points[0].x, points[0].y);

        if (style === "solid") {
            for (let i = 1; i < points.length; i++) {
                graphics.lineTo(points[i].x, points[i].y);
            }
            if (isClosed) graphics.closePath();
            return;
        }

        const pattern = this.#getLinePattern(style, thickness);

        // Pass this state object by reference into the segment helper so the dash sequence remains continuous across sharp corners.
        const state = { dashIdx: 0, dashLen: 0, isDrawing: true };
        const limit = isClosed ? points.length + 1 : points.length;

        for (let i = 1; i < limit; i++) {
            const p1 = points[(i - 1) % points.length];
            const p2 = points[i % points.length];
            this.#drawDashSegment(graphics, p1, p2, pattern, state);
        }
    }

    /**
     * Sweeps the stage and forcefully inverts the scale of all edit nodes.
     */
    #updateNodeScales() {
        const invScale = 1 / (this.stage.scale.x || 1);

        const scaleNodes = (container) => {
            if (!container?.children) return;
            for (const child of container.children) {
                if (child.isEditNode) {
                    child.scale.set(invScale);
                } else if (child instanceof PIXI.Container) {
                    scaleNodes(child);
                }
            }
        };

        scaleNodes(this.stage);
    }

    /**
     * Draws a persistently pulsing cyan bounding box and text label to preview an upcoming action.
     */
    showActionPreview(bounds, actionLabel = "") {
        this.clearActionPreview();
        if (!bounds || !this.stage) return;

        const trueWidth = bounds.maxX - bounds.minX;
        const trueHeight = bounds.maxY - bounds.minY;
        const centerX = bounds.minX + trueWidth / 2;
        const centerY = bounds.minY + trueHeight / 2;

        this.actionPreview = new PIXI.Container();

        const invScale = 1 / (this.stage.scale.x || 1);
        const pad = FILRODENSWMB.UI.ZOOM.VISUAL_PADDING * invScale;

        const boxWidth = trueWidth + pad * 2;
        const boxHeight = trueHeight + pad * 2;
        const boxX = -trueWidth / 2 - pad;
        const boxY = -trueHeight / 2 - pad;

        // 1. Draw the bounding box
        const graphics = new PIXI.Graphics();
        graphics.lineStyle(4 * invScale, 0x00e5ff, 1);
        graphics.beginFill(0x00e5ff, 0.15);
        graphics.drawRoundedRect(boxX, boxY, boxWidth, boxHeight, 12 * invScale);
        graphics.endFill();
        this.actionPreview.addChild(graphics);

        // 2. Add the dynamic text label
        if (actionLabel) {
            const textStyle = new PIXI.TextStyle({
                fontFamily: "Signika",
                fontSize: 16 * invScale,
                fill: "#00e5ff",
                fontWeight: "bold",
                stroke: "#000000",
                strokeThickness: 4 * invScale,
                dropShadow: true,
                dropShadowColor: "#000000",
                dropShadowBlur: 2,
                dropShadowDistance: 2 * invScale,
            });

            const text = new PIXI.Text(actionLabel, textStyle);
            // Position slightly inside the top-left corner
            text.x = boxX + 8 * invScale;
            text.y = boxY - text.height - 4 * invScale;

            // Safety fallback: if the box is hard against the top of the map, push the text inside the box
            if (centerY + text.y < 0) {
                text.y = boxY + 8 * invScale;
            }

            this.actionPreview.addChild(text);
        }

        this.actionPreview.x = centerX;
        this.actionPreview.y = centerY;
        this.stage.addChild(this.actionPreview);

        // --- ACCESSIBILITY CHECK ---
        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        if (!prefersReducedMotion) {
            // Standard smooth pulse for users who haven't opted out of motion
            let elapsed = 0;
            this.previewTick = () => {
                if (this.actionPreview.destroyed) return;
                elapsed += 0.05;
                this.actionPreview.alpha = 0.55 + Math.sin(elapsed) * 0.25;
            };
            this.app.ticker.add(this.previewTick);
        } else {
            // Static, fixed state for users with accessibility preferences
            this.actionPreview.alpha = 0.75;
        }
    }

    /**
     * Clears the action preview and halts its animation ticker.
     */
    clearActionPreview() {
        if (this.previewTick) {
            this.app.ticker.remove(this.previewTick);
            this.previewTick = null;
        }
        if (this.actionPreview) {
            // Must pass { children: true } so the text and graphics nodes are purged from VRAM
            this.actionPreview.destroy({ children: true });
            this.actionPreview = null;
        }
    }
}
