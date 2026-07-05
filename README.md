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

> *Note: This section will be completed and moved to the module wiki before release.*

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

1. **Scale Bar:** Set the map units, the scale interval size (in pixels), the number of map units represented by a major tick, and the number of major/minor intervals to show on the scale bar.

2. **Map Border:** At launch, three simple border types can be set, and a single colour applied.

3. **Other Decorations:** You can add any image file as a decoration, e.g., adding a windrose or compass, or adding a map cartouche you have designed outside Foundry.

When in edit mode, the scale bar and decorations can be dragged by holding `Left Click`; decorations can be rotated using the `Scroll Wheel` and resized using the `SHIFT + Scroll Wheel`.

### Module Settings

#### 3D View

1. Use the *3D View* tool to see your 2D cartography in 3D. The biome map is draped over your custom topography, complete with topographical river vectors, ocean planes, and dynamic lighting. This feature is purely visual and included for fun. It will not update to any changes made until it is toggled again.

   > While 3D View is enabled, the sidebar and map tools are hidden.

#### Reference Images

You can load a reference image to act as a guide when creating your map. Please make sure you have permission to use any map used as a reference.

1. Use the *Reference Image* tool.
2. Select the file using the file picker.
3. Use the mouse `left click` while the reference tool is enabled to quickly move the image and use `SHIFT + Scroll Wheel` to scale it.
4. Use the zoom and D-Pad buttons to fine tune its scale and position.
5. The reference image can be toggled on and off using the tools in the bottom right of the map canvas.

Reference images will be automatically excluded from any export.

#### Map Configuration

You can change some of the map configuration settings.

1. **Visuals**
   - **Contour Interval:** Change the elevation interval between contours.
   - **Active Biome Opacity:** Set the opacity of the biome layer when it is the active tool.
   - **Inactive Biome Opacity:** Set the opacity of the biome layer when it is not the active tool. This is useful if you want the terrain to be more visible through the biome colours.

2. **Hydrology**
   - **Max Lake Size:** Set how large lakes can become. The larger the value, the more likely the lake will continue to grow until it finds a new path to flow down the terrain. Smaller values will result in more inland lakes which have no links to the ocean.
   - **Spring Altitude (Min):** Set the lowest elevation where river sources can randomly spawn. This prevents rivers trying to form on flat plains.
   - **Spring Altitude (Max):** Set the highest elevation where river sources can randomly spawn. This prevents rivers trying to form on at the top of a mountain.
   - **River Meander:** Set how much a river will meander as it flows downhill. A value of 0 will mean it flows in a straight line.

3. **Climate**
   - **Altitude Cooling Mod:** Sets an altitude above which glaciers form on mountains.
   - **Freezing Threshold:** Sets the temperature threshold for when rivers and lakes freeze.

4. **Biome Colours**
   - Click the colour swatch to edit the colour of each biome.

### Map Management Tools

#### Exporting to an external PNG

This tool is to export a flat PNG image of your map which can be saved and shared anywhere.

1. Use the *Export to PNG* tool found near the bottom of the toolbar to export all *visible* layers as a PNG image. The module will automatically hide any reference image. This is a temporary feature until more export tools are added.

#### Exporting to a Scene

This tool exports the map directly into a playable Foundry scene. It will create:

- A base map containing all layers set to "Player" visibility. It will configure the grid, disable token vision, and enable global illumination.
- An overlay map tile containing any layers set to "GM" visibility.
- A journal with a page for every visible feature on the map.
- Map pins for all visible regions and infrastructure features, linked directly to their journal page.

**How to export:**

1. Open the *Export to Scene* tool to launch the dialogue.

   ![Scene Export Dialogue](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/assets/screenshots/export-to-scene.png)

2. Name the scene (defaults to the current map name).
3. Use the folder browser to select a directory in your `world` data folder to save the map images.
4. Select if you want to generate the associated journal and map pins.
5. If updating an existing scene, choose whether to overwrite the existing journal. *(Warning: Overwriting will delete any edits made manually to the journal made directly through normal Foundry tools).*

   > Note: Re-exporting a map to an existing scene is a non-destructive process for the canvas. It will safely update the background and grid without deleting any walls, lighting, or tokens already placed on the scene. It is only re-exporting the journals that is will overwrite existing content.

6. Select if you want to extract the GM-only overlay tile.

When you confirm, the interface will lock to prevent changes during the extraction process. On completion, the new scene will automatically activate.

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

## Important Note on Performance

The generator can be computationally heavy when calculating new terrain, moisture, and temperature models, particularly at larger resolutions. Maps of 1000x1000 pixels process very quickly. Maps of 4000x4000 pixels look beautiful, but may take a few seconds to calculate even on powerful PCs. Once the initial calculation is complete, the application returns to being highly responsive.

## Roadmap

The long-term vision for this module is to allow users to create a world map, zoom into an area of interest, and use those boundaries to generate a larger-scale, higher-detail regional map containing all the same geographical data.

- Plateau terrain brush to paint flat terrain (still feathering into the surroundings).
- Custom biome support for the brush tool.
- Scene tools to allow quicker toggling of the in-game map grid or map pins (which would otherwise take multiple clicks through Foundry's UI).
- Multi-tile export support, allowing the GM to toggle distinct layers (like political borders or trade routes) on and off during live play.
- A Sandbox Mode allowing the import of DEM or greyscale heightmaps to bypass the procedural generation entirely.
