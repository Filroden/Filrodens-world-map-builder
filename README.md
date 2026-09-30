# Filroden's World Map Builder

![Latest Version](https://img.shields.io/badge/Version-3.0.0-blue)
![Foundry Version](https://img.shields.io/badge/Foundry_VTT-v14-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![System Agnostic](https://img.shields.io/badge/System-Agnostic-green)
![RTL Support](https://img.shields.io/badge/RTL-Supported-green)
![Download Count](https://img.shields.io/github/downloads/Filroden/filrodens-world-map-builder/filrodens-world-map-builder.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/filrodens-world-map-builder/latest/filrodens-world-map-builder.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/filrodens-world-map-builder)
![Issues](https://img.shields.io/github/issues/Filroden/filrodens-world-map-builder)

## Welcome to Filroden's World Map Builder

Filroden's World Map Builder is a system-agnostic cartography tool. It generates terrain, moisture and temperatures using a procedural, deterministic model so using the same "seed" will generate the same model. It then calculates appropriate biomes taking into account the latitude and underlying models including wind patterns. You can scale and offset the result to frame a map that is close to your idea so that you can apply the final edits to the world using non-destructive vector brushes, then place terrain features, infrastructure, regions, etc.

Maps are saved in Journals and stored in a Journal Compendium. The procedural plus non-destructive brush approach means the resulting saved journal is very compact in size.

![Module Interface](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/assets/screenshots/interface.png)

### Main Features

- **Advanced Procedural Generation**: The underlying engine calculates authentic topography using layered noise and geological stretch parameters. It dynamically simulates climate by mapping global temperature gradients and tracking geographical orographic lift (rain shadows) to accurately determine Whittaker biomes. Relief shading brings out the shape of hills, valleys and the seabed, and the sea and lakes are drawn as water you can see into, with their own biomes on the bed. The heaviest calculations are shared across all of your computer's processor cores, so even large maps generate and load quickly.
- **Custom Biome Auto-Generation**: Define your own biomes and give them auto-generation rules - ranges of elevation, moisture and temperature - so they appear automatically wherever the procedural generator produces a matching climate, with the built-in defaults always available as a guaranteed fallback. A hover preview shows exactly where a map is still relying on those defaults, so gaps in your rule coverage are easy to spot.
- **Four terrain engines**: Choose from Standard, Flat, Advanced (Tectonics) or Guided. Advanced (Tectonics) lets tectonic plates decide where the continents lie, raising mountain ranges, trenches and mid-ocean ridges where they meet or part, while Guided builds the land inside shapes you draw. Both create natural coastlines, continental shelves and deep oceans, and look the same at any map size. Each engine has different strengths (see the wiki).
- **Dynamic Hydrology Systems**: Rivers are traced procedurally downhill, widening as they flow and as tributaries join them, meandering across flat plains and splitting into deltas where they reach the sea. They pool into lakes until they overflow their basins, and freeze based on altitude and regional climate thresholds. Additional river sources can be placed manually, and procedurally generated sources can be removed.
- **Non-Destructive Vector Brush Engine**: Edit the terrain (raising, lowering, levelling, smoothing and roughening) or paint custom biomes with a responsive freehand brush tool. Under the hood, edits are saved as a spatial vector history rather than static pixels, preserving your exact strokes for future map scaling and regional zooming.
- **Tectonic Features**: Draw mountain ranges (in three styles), subduction zones with their trenches and volcanic arcs, rift valleys, and hotspot chains of volcanic islands that age from active volcanoes to eroded islands, atolls and seamounts. Each feature is shaped by the terrain it crosses, so it blends into your map.
- **Vector Information Layers**: You can add infrastructure (points of interest, routes, etc), regional polygons, labels and cartographic decorations to any map, fine-tuning their placement, size and style.
- **Easy Regional Map Creation**: Once your master world map is created you can generate regional maps that faithfully match the original but at much higher resolution, with finer detail in the coastlines, terrain and biome borders. Because of procedural generation, this provides almost infinite ability to "zoom in" and create larger and larger scale maps (from World to almost street level). There are limits, so the more you increase map scale, the flatter the map will become.
- **Export to Scene**: All features (and entire layers) can be set to be visible to players, GMs or no-one. When you export the map to create a new Foundry Scene, it will export the player visible elements to the background image and place a map tile over it containing the GM-only features. A Scene Journal is also created which contains any feature names and descriptions and each feature is linked from the map to the journal using map pins.
- **Export to PNG**: If you want to save the map for external use, you can also export the current visible features to a PNG file.
- **Interactive 3D Visualisation**: View your 2D cartography in an interactive 3D web view. The map's biomes, water and rivers are draped over your custom topography, with the sea's surface and dynamic lighting. This feature is purely visual and included for fun. It will not update to any changes made until it is toggled again.
- **Compendium Integration**: Maps are saved directly to a dedicated compendium. Each save automatically generates a readable journal showing your parameters. The application UI contains map management tools which let you to load, duplicate, rename, or export your worlds as shareable JSON files.

---

### Example Maps

The following are two examples of maps I created in the module together with links to their JSON files which can be imported into the module.

#### World Map (generated at 4000 x 4000 pixels)

![World map](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/assets/screenshots/original-map.png)

Link to map JSON file: [https://github.com/Filroden/Filrodens-world-map-builder/samples/fwmb_aethoria.json](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/samples/fwmb_aethoria.json) (36 KB)

#### Regional Map created from the above World Map (generated at 4000 x 2730 pixels)

![Regional Map generated from the World map](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/assets/screenshots/regional-map.png)

Link to map JSON file: [<https://github.com/Filroden/Filrodens-world-map-builder/samples/fwmb_eldoria.json>](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/samples/fwmb_eldoria.json) (32 KB)

---

## How to Open the Module

Filroden's World Map Builder can be opened from the *Scenes* sidebar. A new button has been added at the top of the sidebar called *Map Builder*.

Please see the [Wiki](https://github.com/Filroden/Filrodens-world-map-builder/wiki) for more details on how to use the module.

## Third-Party Licences

Filroden's World Map Builder is released under the [MIT Licence](LICENSE.md). It also includes the following third-party code and icons. Each is kept in its own folder together with its licence, and that licence covers every file in the folder.

| Dependency | Folder | Licence file | Licence |
| :--- | :--- | :--- | :--- |
| [d3-delaunay](https://github.com/d3/d3-delaunay) 6.0.4 (bundled into a single file with the two dependencies below) | [`vendor/d3-delaunay/`](vendor/d3-delaunay/) | [`licence-d3-delaunay.md`](vendor/d3-delaunay/licence-d3-delaunay.md) | ISC |
| [delaunator](https://github.com/mapbox/delaunator) 5.1.0 (bundled with d3-delaunay) | [`vendor/d3-delaunay/`](vendor/d3-delaunay/) | [`licence-delaunator.md`](vendor/d3-delaunay/licence-delaunator.md) | ISC |
| [robust-predicates](https://github.com/mourner/robust-predicates) 3.0.3 (bundled with d3-delaunay) | [`vendor/d3-delaunay/`](vendor/d3-delaunay/) | [`licence-robust-predicates.md`](vendor/d3-delaunay/licence-robust-predicates.md) | Unlicense (public domain) |
| Simplex noise by Jonas Wagner (modified for speed, giving exactly the same values) | [`vendor/simplex-noise/`](vendor/simplex-noise/) | [`licence-simplex-noise.md`](vendor/simplex-noise/licence-simplex-noise.md) | MIT |
| [three.js](https://threejs.org/) r185 (development build) and its OrbitControls add-on, used by the 3D view | [`vendor/three/`](vendor/three/) | [`licence-three.md`](vendor/three/licence-three.md) | MIT |
| [Google Material Design icons](https://fonts.google.com/icons) (the interface icons) | [`assets/icons/`](assets/icons/) | [`icons-licence.md`](assets/icons/icons-licence.md) | Apache 2.0 |
| [Pinhead icons](https://pinhead.ink/) (the point of interest icons) | [`assets/pinhead-icons/`](assets/pinhead-icons/) | [`licence-pinhead-icons.md`](assets/pinhead-icons/licence-pinhead-icons.md) | CC0 1.0 (public domain dedication) |
