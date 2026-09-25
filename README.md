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

- **Advanced Procedural Generation**: The underlying engine calculates authentic topography using layered noise and geological stretch parameters. It dynamically simulates climate by mapping global temperature gradients and tracking geographical orographic lift (rain shadows) to accurately determine Whittaker biomes. Relief shading brings out the shape of hills, valleys and the seabed.
- **Custom Biome Auto-Generation**: Define your own biomes and give them auto-generation rules - ranges of elevation, moisture and temperature - so they appear automatically wherever the procedural generator produces a matching climate, with the built-in defaults always available as a guaranteed fallback. A hover preview shows exactly where a map is still relying on those defaults, so gaps in your rule coverage are easy to spot.
- **Four terrain engines**: Choose from Standard, Flat, Advanced (Tectonics) or Guided. Advanced (Tectonics) lets tectonic plates decide where the continents lie, raising mountain ranges, trenches and mid-ocean ridges where they meet or part, while Guided builds the land inside shapes you draw. Both create natural coastlines, continental shelves and deep oceans, and look the same at any map size. Each engine has different strengths (see the wiki).
- **Dynamic Hydrology Systems**: Rivers are carved procedurally using greedy downhill algorithms, naturally pooling into lakes until they overflow their basins, and freezing intelligently based on altitude and regional climate thresholds. Additional river sources can be placed manually, and procedurally generated sources can be removed.
- **Non-Destructive Vector Brush Engine**: Edit the terrain (raising, lowering, levelling, smoothing and roughening) or paint custom biomes with a responsive freehand brush tool. Under the hood, edits are saved as a spatial vector history rather than static pixels, preserving your exact strokes for future map scaling and regional zooming.
- **Vector Information Layers**: You can add infrastructure (points of interest, routes, etc), regional polygons, labels and cartographic decorations to any map, fine-tuning their placement, size and style.
- **Easy Regional Map Creation**: Once your master world map is created you can generate regional maps that faithfully match the original but at much higher resolution, with finer detail in the coastlines, terrain and biome borders. Because of procedural generation, this provides almost infinite ability to "zoom in" and create larger and larger scale maps (from World to almost street level). There are limits, so the more you increase map scale, the flatter the map will become.
- **Export to Scene**: All features (and entire layers) can be set to be visible to players, GMs or no-one. When you export the map to create a new Foundry Scene, it will export the player visible elements to the background image and place a map tile over it containing the GM-only features. A Scene Journal is also created which contains any feature names and descriptions and each feature is linked from the map to the journal using map pins.
- **Export to PNG**: If you want to save the map for external use, you can also export the current visible features to a PNG file.
- **Interactive 3D Visualisation**: View your 2D cartography in an interactive 3D web view. The biome map is draped over your custom topography, complete with topographical river vectors, ocean planes, and dynamic lighting. This feature is purely visual and included for fun. It will not update to any changes made until it is toggled again.
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

## Roadmap

- Export map meta-data through scene flags linked grid coordinates which could be used by game systems and other modules.
