import { FILRODENSWMB } from "../config.js";

export class StudioCanvas {
    constructor(htmlContainer) {
        this.container = htmlContainer;

        this.app = new PIXI.Application({
            resizeTo: this.container,
            backgroundColor: FILRODENSWMB.BIOMES.ocean.color,
            antialias: true,
            resolution: window.devicePixelRatio || 1,
        });

        const canvasElement = this.app.canvas ?? this.app.view;
        this.container.appendChild(canvasElement);

        this.stage = new PIXI.Container();
        this.app.stage.addChild(this.stage);

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
            if (!this.isDragging) return;

            const dx = e.clientX - this.dragStart.x;
            const dy = e.clientY - this.dragStart.y;

            this.stage.position.x = this.stageStart.x + dx;
            this.stage.position.y = this.stageStart.y + dy;
        });

        globalThis.addEventListener("pointerup", (e) => {
            if (e.button !== 2 && e.button !== 1) return;
            this.isDragging = false;
            canvasElement.style.cursor = "default";
        });

        // Prevent browser context menus from ruining the right-click drag
        canvasElement.addEventListener("contextmenu", (e) => e.preventDefault());
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
     * Takes a raw RGBA pixel buffer and paints it directly to the WebGL canvas.
     */
    renderPixelBuffer(pixelBuffer, width, height) {
        this.mapWidth = width;
        this.mapHeight = height;

        for (const child of this.stage.children) {
            if (child.isMapTexture) child.destroy(true);
        }

        const buffer = new PIXI.BufferResource(pixelBuffer, { width, height });
        const baseTexture = new PIXI.BaseTexture(buffer);
        const texture = new PIXI.Texture(baseTexture);

        const sprite = new PIXI.Sprite(texture);
        sprite.isMapTexture = true;

        this.stage.addChildAt(sprite, 0);

        // If this is the first terrain generation, auto-frame the map.
        // Otherwise, leave the camera exactly where the GM was looking.
        if (!this.hasGeneratedMap) {
            this.resetCamera();
            this.hasGeneratedMap = true;
        }
    }
}
