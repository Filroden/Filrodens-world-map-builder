# Design

## Workflow

0. Configure scene settings - canvas size, grid shape, grid size
1. Generate elevation, moisture and temperature profiles
2. Erode elevation
3. Manual edit elevation (raise, lower, smoothen, roughen)
4. Generate rivers
5. Manual edit rivers, add/remove cliffs, caves and other terrain features
6. Generate biome grid
7. Manual edit biome grid
8. Create/edit infrastructure and points of interest (roads, settlements, farms, etc)
9. Create/edit one or more region layers
10. Export map to scene (select map layers, save webp, inject scene settings and saved webp into new scene)

## UI

1. Three panel UI:
   - Narrow panel on inline-start to show column of tool icons with tooltips
   - Wider panel which is context specific to the chosen tool which slides in/out when tool selected
   - Remainder of UI dedicated to showing the main map with navigation tools to toggle a grid, zoom in and out, and reset the map position back to start. Right-click mouse to pan. Middle mouse wheel to zoom.


```html
<div class="main-ui">

    <div class="toolbar">
        {{! -- Scene Settings -- }}
        {{! -- Terrain (height, moisture, temperature, erosion, etc) -- }}
        {{! -- Terrain Features (rivers, cliffs, caves, etc) -- }}
        {{! -- Biomes -- }}
        {{! -- Infrastructure and points of interests -- }}
        {{! -- Regions -- }}
        {{! -- Manage Maps -- }}
    </div>

    <div class="context-panel">
        {{! -- Content will vary depending on tool chosen -- }}
    </div>

    <div class="map">

        {{!-- Map Preview --}}
        <div class="map-preview">

        </div>

        <div class="map-hint">Localised hint on panning</div>

        {{!-- Map Controls HUD --}}
        <div class="zoom-controls">
            <button type="button" data-action="toggleGrid" data-tooltip="">
                <i class="visage-icon grid-on"></i>
            </button>
            <div class="divider-vertical"></div>
            <button type="button" data-action="zoomOut" data-tooltip="">
                <i class="icon zoom-out"></i>
            </button>
            <button type="button" data-action="resetZoom" data-tooltip="">
                <i class="icon center-focus"></i>
            </button>
            <button type="button" data-action="zoomIn" data-tooltip="">
                <i class="icon zoom-in"></i>
            </button>
            <div class="divider-vertical"></div>
            {{!-- Additional buttons to toggle map layers --}}
        </div>


    </div>

</div>
```

```css
.divider-vertical {
    width:1px;
    background:rgba(255,255,255,0.1);
    margin: 0 var(--filroden-space-xs);
}

.zoom-controls {
    position: absolute;
    bottom: var(--filroden-space-m);
    inset-inline-end: var(--filroden-space-m);
    display: flex;
    gap: var(--filroden-space-xs);
    background: rgba(0, 0, 0, 0.5);
    padding: var(--filroden-space-xs);
    border-radius: var(--filroden-radius-small);
    border: 1px solid rgba(255, 255, 255, 0.1);
    z-index: 20;
    opacity: 0; /* Hidden by default, shown on hover */
    transition: opacity 0.2s ease;
}

.map-hint {
    position: absolute;
    top: var(--filroden-space-m);
    inset-inline-start: var(--filroden-space-m);
    color: var(--filroden-color-text-muted);
    font-size: var(--filroden-font-size-xs);
    background: rgba(0, 0, 0, 0.3);
    padding: 2px 6px;
    border-radius: 4px;
    pointer-events: none;
    z-index: 10;
    opacity: 0;
    transition: opacity 0.2s ease;
}

.map:hover .zoom-controls,
.map:hover .map-hint {
    opacity: 1;
}

.zoom-controls button {
    width: var(--filroden-font-size-xxl);
    height: var(--filroden-font-size-xxl);
    background: transparent;
    border: 1px solid transparent;
    color: var(--filroden-color-text-main-solid);
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
}

.zoom-controls button:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: var(--filroden-color-text-accent);
}
```

