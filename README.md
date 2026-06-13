# Filroden's World Map Builder

![Latest Version](https://img.shields.io/badge/Version-1.0.0-alpha1-blue)
![Foundry Version](https://img.shields.io/badge/Foundry_VTT-v14-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![System Agnostic](https://img.shields.io/badge/System-Agnostic-green)
![RTL Support](https://img.shields.io/badge/RTL-Supported-green)
![Download Count](https://img.shields.io/github/downloads/Filroden/filrodens-world-map-builder/filrodens-world-map-builder.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/filrodens-world-map-builder/latest/filrodens-world-map-builder.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/filrodens-world-map-builder)
![Issues](https://img.shields.io/github/issues/Filroden/filrodens-world-map-builder)

## Welcome to Filroden's World Map Builder

> **WARNING** This is a Alpha preview release. As the module develops there is a high chance that the data structure for map saves will evolve. This could mean any maps saved will be lost. Please treat this release as a way to test the concept and provide your feedback on what you would like to see.

> **UNIMPLEMENTED FEATURES** Not all release features are implemented yet. This includes all map features relating to infrastructure, points of interest or social, political or economic regions which will be added in later builds before beta and full release.

### Filroden's World Map Builder - Alpha 1 Preview

Filroden's World Map Builder is a system-agnostic cartography tool. It generates terrain, moisture and temperatures using a procedural, deterministic model so using the same "seed" will generate the same model. It then calculates appropriate biomes taking into account the latitude and underlying models including wind patterns. You can scale and offset the result to frame a map that is close to your idea so that you can apply the final edits to the world using non-destructive brushes.

The procedural plus non-destructive brush approach means the resulting saved journal is very compact.

### Main Features

- **Advanced Procedural Generation**: The underlying engine calculates authentic topography using layered noise and geological stretch parameters. It dynamically simulates climate by mapping global temperature gradients and tracking geographical orographic lift (rain shadows) to accurately determine Whittaker biomes.
- **Dynamic Hydrology Systems**: Rivers are carved procedurally using greedy downhill algorithms, naturally pooling into lakes until they overflow their basins, and freezing intelligently based on altitude and regional climate thresholds. Additional river sources can be added, and existing sourced blocked.
- **Non-Destructive Vector Brush Engine**: Edit the terrain (raising, lowering, and smoothing) or paint custom biomes with a responsive freehand brush tool. Under the hood, edits are saved as a spatial vector history rather than static pixels, preserving your exact strokes for future map scaling and regional zooming.
- **Interactive 3D Visualisation**: View your 2D cartography in an interactive 3D web view. The biome map is draped over your custom topography, complete with topographical river vectors, ocean planes, and dynamic lighting. This feature is purely visual and included for fun. It will not update to any changes made until it is toggled again.
- **Compendium Integration**: Maps are saved directly to a dedicated compendium. Each save automatically generates a readable journal showing your parameters. The application UI contains map management tools which allow you to easily load, duplicate, rename, or export your worlds as shareable JSON files.

## Roadmap

I have designed the module so that users will eventually be able to create a world map, then zoom into an area of interest and use it as the new boundaries for a larger-scale, higher detail map containing all the same information. This will allow users to create more detailed maps of continents, countries, regions, etc.

- Improve performance
- Add infrastructure (roads, sea routes, settlements, points of interest)
- Add social, political or economic regions as individual, toggled display layers
- Add labels
- Link vector features to journals to add descriptions
- Add "export to scene" tools
