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
            infrastructure: new PIXI.Container(),
            regions: new PIXI.Container(),
            labels: new PIXI.Container(),
            reference: new PIXI.Container(),
        };

        this.layers.biomes.alpha = 0.65;

        // Vector Graphics Engine for non-pixel entities (Rivers, Roads, Borders)
        this.vectorGraphics = new PIXI.Graphics();
        this.layers.features.addChild(this.vectorGraphics);

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
            this.layers.labels,
            this.gridLayer,
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

    /**
     * Mathematically checks if the mouse coordinates are hovering over a draggable node or pin.
     */
    #getGrabbedInfrastructure(x, y) {
        let closest = null;
        let minDist = Infinity;

        for (const item of this.interactiveTargets) {
            const dist = Math.hypot(item.x - x, item.y - y);
            if (dist <= item.radius && dist < minDist) {
                minDist = dist;
                closest = item.target;
            }
        }
        return closest;
    }

    #setupInteractions(canvasElement) {
        // SCROLL TO ZOOM / SCALE
        canvasElement.addEventListener("wheel", (e) => {
            // --- Reference Image Scaling Intercept ---
            if (this.isReferenceMode && e.shiftKey) {
                const scaleDirection = e.deltaY < 0 ? 1.05 : 0.95;
                if (this.onReferenceScale) this.onReferenceScale(scaleDirection);
                return; // Abort standard camera zoom
            }

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

            this.stage.scale.x = Math.max(0.1, Math.min(this.stage.scale.x, 5));
            this.stage.scale.y = Math.max(0.1, Math.min(this.stage.scale.y, 5));

            this.stage.position.x = mouseX - localX * this.stage.scale.x;
            this.stage.position.y = mouseY - localY * this.stage.scale.y;
        });

        // PREVENT NATIVE CONTEXT MENU
        canvasElement.addEventListener("contextmenu", (e) => e.preventDefault());

        // MOUSE DOWN (Start Pan, Drag, or Paint/Place)
        canvasElement.addEventListener("pointerdown", (e) => {
            canvasElement.setPointerCapture(e.pointerId);

            if (e.button === 2 || e.button === 1) {
                this.isDragging = true;
                this.dragStart = { x: e.clientX, y: e.clientY };
                this.stageStart = { x: this.stage.position.x, y: this.stage.position.y };
                canvasElement.style.cursor = "grabbing";
                return;
            }

            if (e.button === 0) {
                const coords = this.#getMapCoordinates(e, canvasElement);

                // --- Reference Image Drag Intercept ---
                if (this.isReferenceMode) {
                    this.isDraggingReference = true;
                    this.dragStart = { x: coords.x, y: coords.y };
                    canvasElement.style.cursor = "grabbing";
                    return; // Abort all other edit tools
                }

                // --- Shift-Click Node Insertion Intercept ---
                if (this.isEditMode && e.shiftKey && this.onInfraInsertNode) {
                    e.preventDefault();
                    e.stopPropagation();

                    this.activeDrag = null;
                    this.onInfraInsertNode(coords.x, coords.y);
                    return;
                }

                // 1. Try to grab an existing infrastructure node or pin
                const grabbedTarget = this.#getGrabbedInfrastructure(coords.x, coords.y);

                // --- Ctrl-Click / Cmd-Click Node Deletion Intercept ---
                if ((e.ctrlKey || e.metaKey) && grabbedTarget && this.onInfraDeleteNode) {
                    e.preventDefault();
                    e.stopPropagation();

                    this.activeDrag = null;
                    this.onInfraDeleteNode(grabbedTarget);
                    return;
                }

                if (grabbedTarget) {
                    e.preventDefault();
                    e.stopPropagation();

                    this.activeDrag = { target: grabbedTarget };
                    canvasElement.style.cursor = "grabbing";
                    if (this.onInfraDragStart) this.onInfraDragStart();
                    return;
                }

                // 2. Otherwise, pass to brush engine
                if (this.onBrushStart) {
                    this.onBrushStart(coords.x, coords.y);
                }
            }
        });

        // MOUSE MOVE (Pan, Drag Item, or Continuous Paint)
        canvasElement.addEventListener("pointermove", (e) => {
            const coords = this.#getMapCoordinates(e, canvasElement);

            if (this.isDraggingReference) {
                const coords = this.#getMapCoordinates(e, canvasElement);
                const dx = coords.x - this.dragStart.x;
                const dy = coords.y - this.dragStart.y;

                // Reset start point for continuous relative movement
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

            // Dragging an Infrastructure Item
            if (this.activeDrag) {
                // Clamp coordinates to prevent dragging items off the map boundaries
                this.activeDrag.target.x = Math.max(0, Math.min(coords.x, this.mapWidth));
                this.activeDrag.target.y = Math.max(0, Math.min(coords.y, this.mapHeight));

                if (this.onInfraDrag) this.onInfraDrag();
                return;
            }

            // Continuous Painting
            if (this.isEditMode && e.buttons === 1 && this.onBrushMove) {
                const now = performance.now();
                if (now - this.lastBrushTime > 100) {
                    this.onBrushMove(coords.x, coords.y);
                    this.lastBrushTime = now;
                }
                return;
            }

            // --- HOVER STATES ---
            if (this.onCanvasHover) this.onCanvasHover(coords.x, coords.y);

            if (this.isEditMode && !this.isDragging && !this.activeDrag) {
                const hoverTarget = this.#getGrabbedInfrastructure(coords.x, coords.y);
                canvasElement.style.cursor = hoverTarget ? "grab" : "crosshair";
            }
        });

        // RELEASE MOUSE (End Pan, Drag, or Brush)
        const endPointer = (e) => {
            if (canvasElement.hasPointerCapture(e.pointerId)) {
                canvasElement.releasePointerCapture(e.pointerId);
            }

            if (e.button === 2 || e.button === 1) {
                this.isDragging = false;
                canvasElement.style.cursor = this.isEditMode ? "crosshair" : "default";
                return;
            }

            if (e.button === 0) {
                if (this.isDraggingReference) {
                    this.isDraggingReference = false;
                    canvasElement.style.cursor = "crosshair";
                    return;
                }

                if (this.activeDrag) {
                    this.activeDrag = null;
                    canvasElement.style.cursor = "crosshair";
                    if (this.onInfraDragEnd) this.onInfraDragEnd();
                    return; // CRITICAL: Abort so we don't trigger brush end
                }

                if (this.isEditMode && this.onBrushEnd) {
                    this.onBrushEnd();
                }
            }
        };

        canvasElement.addEventListener("pointerup", endPointer);
        canvasElement.addEventListener("pointercancel", endPointer);

        canvasElement.addEventListener("pointerleave", (e) => {
            if (!this.isDragging && !this.activeDrag && this.onCanvasHover) {
                this.onCanvasHover(null, null);
            }
        });

        canvasElement.addEventListener("pointerup", (e) => {
            if (e.button === 0) {
                if (this.isDraggingReference) {
                    this.isDraggingReference = false;
                    canvasElement.style.cursor = "crosshair";
                    return;
                }
            }
        });

        canvasElement.addEventListener("pointercancel", endPointer);

        canvasElement.addEventListener("pointerleave", (e) => {
            if (!this.isDragging && !this.activeDrag && this.onCanvasHover) {
                this.onCanvasHover(null, null);
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

            if (hexColor !== undefined) {
                const radius = pin.radius || 6;
                this.vectorGraphics.beginFill(hexColor, 0.4);
                this.vectorGraphics.drawCircle(pin.x, pin.y, radius);
                this.vectorGraphics.endFill();

                if (isFeatureEdit) {
                    this.interactiveTargets.push({ target: pin, x: pin.x, y: pin.y, radius: Math.max(radius, 10) });
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
    renderInfrastructure(pins = [], routes = [], isEditMode = false) {
        // Clone and sort the routes by thickness so major highways always draw on top
        const sortedRoutes = [...routes].sort((a, b) => a.thickness - b.thickness);

        this.routeGraphics.clear();
        this.pinContainer.removeChildren().forEach((c) => c.destroy());
        this.nodeContainer.removeChildren().forEach((c) => c.destroy());

        // 1. Render Routes (Bottom Layer)
        sortedRoutes.forEach((route) => {
            if (route.hidden || !route.points || route.points.length < 2) return;

            const colorHex = Number.parseInt(route.color.replace("#", ""), 16);
            const splinePoints = this.#getSplinePoints(route.points);

            // Apply rounded caps and joins to blend intersections seamlessly
            this.routeGraphics.lineStyle({
                width: route.thickness,
                color: colorHex,
                alpha: 1,
                cap: PIXI.LINE_CAP.ROUND,
                join: PIXI.LINE_JOIN.ROUND,
            });

            if (route.style === "solid") {
                this.routeGraphics.moveTo(splinePoints[0].x, splinePoints[0].y);
                for (let i = 1; i < splinePoints.length; i++) {
                    this.routeGraphics.lineTo(splinePoints[i].x, splinePoints[i].y);
                }
            } else {
                const dashPattern = route.style === "dashed" ? [route.thickness * 4, route.thickness * 3] : [route.thickness, route.thickness * 2];
                let dashIndex = 0;
                let dashLength = 0;
                let isDrawing = true;

                this.routeGraphics.moveTo(splinePoints[0].x, splinePoints[0].y);

                for (let i = 1; i < splinePoints.length; i++) {
                    const p1 = splinePoints[i - 1];
                    const p2 = splinePoints[i];
                    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

                    let remainingDist = dist;
                    let currentX = p1.x;
                    let currentY = p1.y;

                    while (remainingDist > 0) {
                        const step = Math.min(remainingDist, dashPattern[dashIndex] - dashLength);
                        const ratio = step / remainingDist;

                        currentX += (p2.x - currentX) * ratio;
                        currentY += (p2.y - currentY) * ratio;

                        if (isDrawing) {
                            this.routeGraphics.lineTo(currentX, currentY);
                        } else {
                            this.routeGraphics.moveTo(currentX, currentY);
                        }

                        dashLength += step;
                        remainingDist -= step;

                        if (dashLength >= dashPattern[dashIndex]) {
                            dashLength = 0;
                            dashIndex = (dashIndex + 1) % dashPattern.length;
                            isDrawing = !isDrawing;
                        }
                    }
                }
            }

            if (isEditMode) {
                route.points.forEach((pt) => {
                    const node = new PIXI.Graphics();
                    node.beginFill(0xffffff, 0.6);
                    node.lineStyle(2, 0x000000, 0.6);
                    node.drawCircle(0, 0, 5);
                    node.endFill();
                    node.x = pt.x;
                    node.y = pt.y;

                    // Push to mathematical cache instead of binding PIXI events
                    this.interactiveTargets.push({ target: pt, x: pt.x, y: pt.y, radius: 10 });
                    this.nodeContainer.addChild(node);
                });
            }
        });

        // 2. Render Pins (Top Layer)
        pins.forEach((pin) => {
            if (pin.hidden) return;

            const texturePath = `modules/filrodens-world-map-builder/assets/pinhead-icons/${pin.icon}.svg`;
            const sprite = new PIXI.Sprite(PIXI.Texture.from(texturePath));

            sprite.anchor.set(0.5);
            sprite.width = 32;
            sprite.height = 32;
            sprite.x = pin.x;
            sprite.y = pin.y;

            if (isEditMode) {
                // Push to mathematical cache
                this.interactiveTargets.push({ target: pin, x: pin.x, y: pin.y, radius: 16 });
            } else if (pin.name || pin.description) {
                // Keep PIXI hover events for tooltips ONLY when not in edit mode
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

    renderRegions(regionLayers = [], isEditMode = false, activeRegionId = null) {
        this.layers.regions.removeChildren().forEach((c) => c.destroy());

        regionLayers.forEach((layer) => {
            if (layer.hidden) return;

            const layerContainer = new PIXI.Container();
            layerContainer.alpha = layer.opacity === undefined ? 0.5 : layer.opacity;
            this.layers.regions.addChild(layerContainer);

            layer.regions.forEach((region) => {
                if (region.hidden || !region.points || region.points.length === 0) return;

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

                // 2. Draw Border (Separated to allow dashed/dotted borders around solid fills)
                if (region.lineThickness > 0) {
                    g.lineStyle({ width: region.lineThickness, color: lineColorHex, alpha: 1, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });

                    if (region.lineStyle === "solid") {
                        g.moveTo(pts[0].x, pts[0].y);
                        for (let i = 1; i < pts.length; i++) {
                            g.lineTo(pts[i].x, pts[i].y);
                        }
                        if (isClosed) g.closePath();
                    } else {
                        // Dash drawing logic
                        let pattern = [region.lineThickness * 4, region.lineThickness * 3]; // dashed
                        if (region.lineStyle === "dotted") pattern = [region.lineThickness, region.lineThickness * 2];
                        if (region.lineStyle === "dashdot") pattern = [region.lineThickness * 4, region.lineThickness * 2, region.lineThickness, region.lineThickness * 2];

                        let dashIdx = 0;
                        let dashLen = 0;
                        let isDrawing = true;
                        g.moveTo(pts[0].x, pts[0].y);

                        const limit = isClosed ? pts.length + 1 : pts.length;
                        for (let i = 1; i < limit; i++) {
                            const p1 = pts[(i - 1) % pts.length];
                            const p2 = pts[i % pts.length];
                            const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

                            let remainingDist = dist;
                            let currentX = p1.x;
                            let currentY = p1.y;

                            while (remainingDist > 0) {
                                const step = Math.min(remainingDist, pattern[dashIdx] - dashLen);
                                const ratio = step / remainingDist;

                                currentX += (p2.x - currentX) * ratio;
                                currentY += (p2.y - currentY) * ratio;

                                if (isDrawing) g.lineTo(currentX, currentY);
                                else g.moveTo(currentX, currentY);

                                dashLen += step;
                                remainingDist -= step;

                                if (dashLen >= pattern[dashIdx]) {
                                    dashLen = 0;
                                    dashIdx = (dashIdx + 1) % pattern.length;
                                    isDrawing = !isDrawing;
                                }
                            }
                        }
                    }
                }

                // 3. Draw Edit Nodes
                if (isEditMode) {
                    region.points.forEach((pt) => {
                        const node = new PIXI.Graphics();
                        node.beginFill(0xffffff, 0.6);
                        node.lineStyle(2, 0x000000, 0.6);
                        node.drawCircle(0, 0, 5);
                        node.endFill();
                        node.x = pt.x;
                        node.y = pt.y;

                        this.interactiveTargets.push({ target: pt, x: pt.x, y: pt.y, radius: 10 });
                        layerContainer.addChild(node);
                    });
                }
            });
        });
    }

    /**
     * Frames the viewport to encompass a specific array of coordinates.
     */
    zoomToFeature(points) {
        if (!points || points.length === 0 || !this.stage) return;

        const MIN_BOUNDS_SIZE = 400;
        const PADDING_FACTOR = 1.2;
        const MAX_ZOOM_SCALE = 2;

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

        const width = Math.max(maxX - minX, MIN_BOUNDS_SIZE);
        const height = Math.max(maxY - minY, MIN_BOUNDS_SIZE);

        const centerX = minX + width / 2;
        const centerY = minY + height / 2;

        // Calculate scale to fit with padding, constrained by maximum zoom limits
        const scaleX = this.app.screen.width / (width * PADDING_FACTOR);
        const scaleY = this.app.screen.height / (height * PADDING_FACTOR);
        const targetScale = Math.min(scaleX, scaleY, MAX_ZOOM_SCALE);

        // Apply transforms directly to the PIXI stage
        this.stage.scale.set(targetScale);
        this.stage.position.x = this.app.screen.width / 2 - centerX * targetScale;
        this.stage.position.y = this.app.screen.height / 2 - centerY * targetScale;
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
}
