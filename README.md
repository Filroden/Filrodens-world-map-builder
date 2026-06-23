# Filroden's World Map Builder

![Latest Version](https://img.shields.io/badge/Version-1.0.0-beta1-blue)
![Foundry Version](https://img.shields.io/badge/Foundry_VTT-v14-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![System Agnostic](https://img.shields.io/badge/System-Agnostic-green)
![RTL Support](https://img.shields.io/badge/RTL-Supported-green)
![Download Count](https://img.shields.io/github/downloads/Filroden/filrodens-world-map-builder/filrodens-world-map-builder.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/filrodens-world-map-builder/latest/filrodens-world-map-builder.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/filrodens-world-map-builder)
![Issues](https://img.shields.io/github/issues/Filroden/filrodens-world-map-builder)

## Welcome to Filroden's World Map Builder

> **WARNING** This is an Alpha release. As the module develops there is a chance that the data structure for map saves will evolve. This could mean any maps saved will be lost. Please treat this release as a way to test the module and provide your feedback on what you would like to see.

Filroden's World Map Builder is a system-agnostic cartography tool. It generates terrain, moisture and temperatures using a procedural, deterministic model so using the same "seed" will generate the same model. It then calculates appropriate biomes taking into account the latitude and underlying models including wind patterns. You can scale and offset the result to frame a map that is close to your idea so that you can apply the final edits to the world using non-destructive brushes.

The procedural plus non-destructive brush approach means the resulting saved journal is very compact.

### Main Features

- **Advanced Procedural Generation**: The underlying engine calculates authentic topography using layered noise and geological stretch parameters. It dynamically simulates climate by mapping global temperature gradients and tracking geographical orographic lift (rain shadows) to accurately determine Whittaker biomes.
- **Dynamic Hydrology Systems**: Rivers are carved procedurally using greedy downhill algorithms, naturally pooling into lakes until they overflow their basins, and freezing intelligently based on altitude and regional climate thresholds. Additional river sources can be added, and existing sources blocked.
- **Non-Destructive Vector Brush Engine**: Edit the terrain (raising, lowering, and smoothing) or paint custom biomes with a responsive freehand brush tool. Under the hood, edits are saved as a spatial vector history rather than static pixels, preserving your exact strokes for future map scaling and regional zooming.
- **Interactive 3D Visualisation**: View your 2D cartography in an interactive 3D web view. The biome map is draped over your custom topography, complete with topographical river vectors, ocean planes, and dynamic lighting. This feature is purely visual and included for fun. It will not update to any changes made until it is toggled again.
- **Compendium Integration**: Maps are saved directly to a dedicated compendium. Each save automatically generates a readable journal showing your parameters. The application UI contains map management tools which allow you to easily load, duplicate, rename, or export your worlds as shareable JSON files.

## How to Use

1. Filroden's World Map Builder can be opened from the *Scenes* sidebar. A new button has been added at the top of the sidebar called *Map Builder*.

### Map Making Tools

#### Generating a New Map

1. ...

#### Terrain

1. ...

#### Climate

1. ...

#### Hydrology

1. ...

#### Infrastructure

- Points of Interest pins and Route nodes can be dragged using `Left-click`.
- New nodes can be added by using `SHIFT + left-click`.
- Existing nodes can be removed by using `CTRL (or CMD) + left-click`.

#### Regions

The *Regions* tool allows you to draw custom polygons to show political, economic, or other areas. Regions are organised into customisable layers. Entire layers, or individual regions within those layers, can have their visibility toggled on or off.

1. Add a new *Region Layer* from the main sidebar.
   > Each *Region Layer* can be edited to add a name.

2. Enable Edit mode to add or edit regions within each layer.
   > If more than one layer exists, select the region layer that is being edited. The region layer name will change colour to show it is selected.

3. The edit toolbar allows you to:
   - Add a new region within the selected layer (which will automatically close any existing region being drawn).
   - Set the style of the polygon fill (including a no fill option) and border.
   - Toggle polygon smoothing.

4. Click the canvas to create a node. To close a region, either add a node close to the starting node, click the "Add New Region" button, or exit Edit mode.

5. To edit existing nodes:
   - Nodes can be dragged holding `Left-click`.
   - New nodes can be added to a border using `SHIFT + left-click`.
   - Existing nodes can be deleted using `CTRL (or CMD) + left-click`.

#### Labels

The *Labels* tool allows you to edit existing labels and add/delete custom labels.

1. Labels are automatically created for any vector item created using other tools, e.g., Points of Interest, routes and regions. These labels can be renamed, their styles edited and have their visibility toggled. They cannot be deleted.

2. To edit a label click its edit button shown after its name in the sidebar. You can change its name and its style.
   > Changing the name of the label in the *Labels* tool also changes it name when inspected in the tool it belongs to if it was automatically created.

3. Enable Edit mode to move and rotate existing labels and to create new custom labels.
   - New labels can be created by using `Left-click`.
   - Existing labels can be dragged holding `Left-click`.
   - Labels can be rotated by using the `Scroll Wheel` while holding `Left-click`.

4. Individual labels can have their visibility toggled by clicking the visibility button before its name in the sidebar.
   > Hidden labels will not be exported. Use the visibility toggle to control what information you want to share, e.g., by creating a player map and a GM map.

#### Cartography

The *Cartography* tool allows you to add decorations to the map.

1. **Scale Bar:**

2. **Map Border:**

3. **Other Decorations:**

When in edit mode, the scale bar and decorations can be dragged by holding `Left Click`; decorations can be rotated using the `Scroll Wheel` and resized using the `SHIFT + Scroll Wheel`.

### Settings

1. ...

### Map Management Tools

#### 3D View

1. Use the *3D View* tool to see your 2D cartography in 3D. The biome map is draped over your custom topography, complete with topographical river vectors, ocean planes, and dynamic lighting. This feature is purely visual and included for fun. It will not update to any changes made until it is toggled again.

> While 3D View is enabled, the sidebar and map tools are hidden.

#### Exporting a Map

1. Use the *Export to PNG* tool found near the bottom of the toolbar to export all *visible* layers as a PNG image. The module will automatically hide any reference image. This is a temporary feature until more export tools are added.

#### Saving a Map

1. Use the *Quick Save* tool found near the bottom of the toolbar.

   > If the map has not been saved before it will ask for a filename. If it has been saved before it will show the map name in the tooltip. Saved maps are found in the compendium called *Filroden's World Map Builder* as Journals. If the map has been saved before, it will save any changes to the existing map inside the compendium.

2. Each map is saved as a data file inside the journal. The journal also shows the main map generation settings.

   > **Important:** Save often!

#### Loading an Existing Map

1. Use the *Manage Maps* tool to see all saved maps (this is the same list of maps found in the compendium).
2. Click the *Load* button on the map.
3. Alternatively, if you have an exported JSON file, use the button at the bottom of the sidebar to import it.

**Other Tools**: The second button on each map (the "kebab" icon) opens a menu which has the following additional tools:

- **Rename:** Rename the map.
- **Duplicate:** Create a copy of the map. This is useful if you want to create versions of the map for winter and summer.
- **Export JSON:** Export the map data into a JSON file. This allows you to share maps with others.
- **Delete:** Delete the map. This can also be done inside the normal Foundry compendium.

#### Reference Images

You can load a reference image to act as a guide when creating your map. Please make sure you have permission to use any map used as a reference.

1. Use the *Reference Image* tool.
2. Select the file using the file picker.
3. Use the mouse `left click` while the reference tool is enabled to quickly move the image and use `SHIFT + Scroll Wheel` to scale it.
4. Use the zoom and D-Pad buttons to fine tune its scale and position.
5. The reference image can be toggled on and off using the tools in the bottom right of the map canvas.

Reference images will be automatically excluded from any export.

## Important Note on Performance

Filroden's World Map Builder can be computationally heavy when generating new or loading existing terrain, moisture and temperature models, particularly as you increase the size of the map. Maps of 1,000 x 1,000 pixels should be created or loaded very quickly. Maps of 4,000 x 4,000 look beautiful but even on powerful PCs they might take a few seconds to calculate.

Once calculated, the application will be much more responsive.

I will continue to look for ways to improve performance as the module develops.

## Roadmap

I have designed the module so that users will eventually be able to create a world map, then zoom into an area of interest and use it as the new boundaries for a larger-scale, higher detail map containing all the same information. This will allow users to create more detailed maps of continents, countries, regions, etc.

- Improve performance.
- Add labels with predefined styles and custom styles. Pre-generate labels from existing infrastructure and region names.
- Add cartography tools: scale, cartouche, compass roses, etc.
- Add "export to scene" tools to supplement or replace the current "export to PNG" tool. Link vector features and their meta data to journal pages.
- Sandbox mode, import DEM, import greyscale map and calculate elevations, etc.
