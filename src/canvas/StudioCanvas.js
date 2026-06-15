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
        };

        this.layers.biomes.alpha = 0.65;

        // Vector Graphics Engine for non-pixel entities (Rivers, Roads, Borders)
        this.vectorGraphics = new PIXI.Graphics();
        this.layers.features.addChild(this.vectorGraphics);

        // Infrastructure specific containers to enforce strict z-index (lines below pins)
        this.routeGraphics = new PIXI.Graphics();
        this.pinContainer = new PIXI.Container();
        this.layers.infrastructure.addChild(this.routeGraphics);
        this.layers.infrastructure.addChild(this.pinContainer);

        // Instantiate the grid layer
        this.gridLayer = new PIXI.Graphics();

        // Cache for persistent GPU textures to prevent memory churn
        this.layerSprites = {};

        // Add them to the zooming stage in ascending order
        this.stage.addChild(
            this.layers.base,
            this.layers.topography,
            this.layers.biomes,
            this.layers.contours,
            this.layers.features,
            this.layers.regions,
            this.layers.infrastructure,
            this.layers.labels,
            this.gridLayer,
        );

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

    /**
     * Extracts the current PIXI stage and converts it synchronously to a binary Blob.
     * Triggers a detached link click to bypass Electron's DOM navigation interceptors.
     */
    exportToPNG(filename = "world-map") {
        try {
            const canvas = this.app.renderer.extract.canvas(this.stage);
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
     * Renders vector routes and POI pins to the infrastructure layer.
     */
    renderInfrastructure(pins = [], routes = []) {
        this.routeGraphics.clear();

        // Safely destroy and clear all existing pin sprites from memory
        this.pinContainer.removeChildren().forEach((c) => c.destroy());

        // 1. Render Routes (Bottom Layer)
        routes.forEach((route) => {
            if (route.hidden || !route.points || route.points.length < 2) return;

            const colorHex = Number.parseInt(route.color.replace("#", ""), 16);
            const splinePoints = this.#getSplinePoints(route.points);

            // Set the PIXI stroke properties
            this.routeGraphics.lineStyle(route.thickness, colorHex, 1);

            if (route.style === "solid") {
                this.routeGraphics.moveTo(splinePoints[0].x, splinePoints[0].y);
                for (let i = 1; i < splinePoints.length; i++) {
                    this.routeGraphics.lineTo(splinePoints[i].x, splinePoints[i].y);
                }
            } else {
                // Dash and Dot Algorithm
                // Dynamically scales the spacing based on the thickness of the line
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

                        // Switch from drawing to skipping when the dash limit is reached
                        if (dashLength >= dashPattern[dashIndex]) {
                            dashLength = 0;
                            dashIndex = (dashIndex + 1) % dashPattern.length;
                            isDrawing = !isDrawing;
                        }
                    }
                }
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

            // Interactive Tooltip Logic ---
            if (pin.name || pin.description) {
                sprite.eventMode = "static";
                sprite.interactive = true;
                sprite.cursor = "help";

                sprite.on("pointerover", () => {
                    const tooltip = document.getElementById("fwmb-infra-tooltip");
                    if (!tooltip) return;

                    // Build the HTML content, replacing newlines with <br> for descriptions
                    let html = ``;
                    if (pin.name) html += `<strong>${pin.name}</strong>`;
                    if (pin.description) html += `<span>${pin.description.replaceAll("\n", "<br>")}</span>`;

                    tooltip.innerHTML = html;
                    tooltip.classList.remove("fwmb-hidden");
                });

                sprite.on("pointermove", (e) => {
                    const tooltip = document.getElementById("fwmb-infra-tooltip");
                    if (!tooltip) return;

                    // Position tooltip relative to the mouse using the native window event
                    const evt = e.data.originalEvent;
                    tooltip.style.left = `${evt.clientX}px`;
                    tooltip.style.top = `${evt.clientY - 15}px`; // Offset slightly above cursor
                });

                sprite.on("pointerout", () => {
                    const tooltip = document.getElementById("fwmb-infra-tooltip");
                    if (tooltip) tooltip.classList.add("fwmb-hidden");
                });
            }

            this.pinContainer.addChild(sprite);
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
}
