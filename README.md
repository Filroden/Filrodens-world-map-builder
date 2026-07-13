# Filroden's World Map Builder

![Latest Version](https://img.shields.io/badge/Version-1.0.0-blue)
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

### Main Features

- **Advanced Procedural Generation**: The underlying engine calculates authentic topography using layered noise and geological stretch parameters. It dynamically simulates climate by mapping global temperature gradients and tracking geographical orographic lift (rain shadows) to accurately determine Whittaker biomes.
- **Dynamic Hydrology Systems**: Rivers are carved procedurally using greedy downhill algorithms, naturally pooling into lakes until they overflow their basins, and freezing intelligently based on altitude and regional climate thresholds. Additional river sources can be placed manually, and procedurally generated sources can be removed.
- **Non-Destructive Vector Brush Engine**: Edit the terrain (raising, lowering, and smoothing) or paint custom biomes with a responsive freehand brush tool. Under the hood, edits are saved as a spatial vector history rather than static pixels, preserving your exact strokes for future map scaling and regional zooming.
- **Vector Information Layers**: You can add infrastructure (points of interest, routes, etc), regional polygons, labels and cartographic decorations to any map, fine-tuning their placement, size and style.
- **Easy Regional Map Creation**: Once your master world map is created you can generate regional maps that faithfully match the original but at much higher resolution. Because of procedural generation, this provides almost infinite ability to "zoom in" and create larger and larger scale maps (from World to almost street level). There are limits, so the more you increase map scale, the flatter the map will become.
- **Export to Scene**: All features (and entire layers) can be set to be visible to players, GMs or no-one. When you export the map to create a new Foundry Scene, it will export the player visible elements to the background image and place a map tile over it containing the GM-only features. A Scene Journal is also created which contains any feature names and descriptions and each feature is linked from the map to the journal using map pins.
- **Export to PNG**: If you want to save the map for external use, you can also export the current visible features to a PNG file.
- **Interactive 3D Visualisation**: View your 2D cartography in an interactive 3D web view. The biome map is draped over your custom topography, complete with topographical river vectors, ocean planes, and dynamic lighting. This feature is purely visual and included for fun. It will not update to any changes made until it is toggled again.
- **Compendium Integration**: Maps are saved directly to a dedicated compendium. Each save automatically generates a readable journal showing your parameters. The application UI contains map management tools which let you to load, duplicate, rename, or export your worlds as shareable JSON files.

---

#### World Map (generated at 4000 x 4000 pixels)

![World map](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/assets/screenshots/original-map.png)

---

#### Regional Map created from the above World Map (generated at 4000 x 2730 pixels)

![Regional Map generated from the World map](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/assets/screenshots/regional-map.png)

---

## How to Use

- [The Map Canvas](#the-map-canvas)
- [Map Making Tools](#map-making-tools)
  - [Generating a New Map](#generating-a-new-map)
  - [Generating Regional Maps](#generating-regional-maps)
  - [Terrain](#terrain)
  - [Biomes](#biomes-climate)
  - [Terrain Features](#terrain-features)
  - [Infrastructure](#infrastructure)
  - [Regions](#regions)
  - [Labels](#labels)
  - [Cartography](#cartography)
- [Module Settings](#module-settings)
  - [3D View](#3d-view)
  - [Reference Images](#reference-images)
  - [Map Configuration](#map-configuration)
- [Map Management Tools](#map-management-tools)
  - [Exporting to an external PNG](#exporting-to-an-external-png)
  - [Exporting to a Scene](#exporting-to-a-scene)
  - [Saving a Map](#saving-a-map)
  - [Loading an Existing Map](#loading-an-existing-map)

> *Note: This section will be completed and moved to the module wiki before release.*

1. Filroden's World Map Builder can be opened from the *Scenes* sidebar. A new button has been added at the top of the sidebar called *Map Builder*.

### The Map Canvas

The main window in the module shows the current map.

Hold `Left Click` to drag the map, and use the `Scroll Wheel` to zoom in and out.

As you move the mouse pointer over the map, a display of the elevation, moisture, temperature values and biome type will show in the top left corner of the map.

There are map controls in the bottom right corner of the map (only visible when the mouse is inside the map canvas).

![Map Controls](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/assets/screenshots/map-controls.png)

- The first three icons toggle different views of the map: the player-visible features, GM-visible features and hidden features.
- The next group of icons toggle different layers on or off: base map, terrain, biomes, hydrology (rivers and lakes), infrastructure, regions, labels and cartography decorations.
- The next three icons toggle specific information layers: contour lines, the map grid, a map reference image.
- The final three icons allow you to zoom in and out, and to reset the map so it fills the window.

> **Important:** The toggle states of the layers (including the contours and grid layers) determines what will be exported (either as a PNG or as a scene).

### Map Making Tools

#### General notes on edit mode

Many of the following tools offer an edit mode. This mode has certain common features:

- If you click the "Toggle Edit [Tool]" button in the sidebar a new toolbar will appear above the map containing edit tools.
- While in edit mode the tool sidebar is locked to prevent changes while you are editing.
- All edit toolbars have an "Undo" and "Redo" action.
- Either click the "Toggle Edit [Tool]" button again to exit edit mode, or switch to a different map tool.

In edit mode, some layers allow features to be added, moved or removed with mouse actions. Only the features relating to the specific tool can be edited. Not every action is available for every tool.

- **Move:** Pins, region nodes, labels and cartographic decorations can be moved by holding the `Left-click` and dragging.
- **Add:** New region nodes can be added by using `SHIFT + left-click`.
- **Remove**: Existing pins and region nodes can be removed by using `CTRL (or CMD) + left-click`.
- **Rotate:** Labels and cartographic decorations can be rotated by using the `Scroll Wheel` while holding `Left-click`.
- **Re-size:** Cartographic decorations can be re-sized using the `SHIFT + Scroll Wheel` while holding `Left-click`.

#### Generating a New Map

1. On the "Create New Map" tool, to generate a new map either enter a map seed or generate a random seed, set the map resolution and the latitude range it represets and click "Create New Map".

   > Note: If you have an unsaved changes on the existing map you will be prompted to save or discard them.

2. [Optional] Select a grid to display. By default, the grid layer is disabled in the map canvas controls. To see the grid, simply toggle the grid icon in the map controls.

Creating a new map will procedurally generate a terrain, moisture and temperature model for the world, and calculate appropriate biomes.

It is recommended that you work through each map tool in turn to edit the map.

![Map Tools](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/assets/screenshots/map-tools.png)

#### Generating Regional Maps

It is possible to create new, high-resolution maps based on a cropped area of existing maps. All terrain edits and vector features are preserved, and the new maps are nested as children under their parent map in the manager.

> **Note:** Once created, the new regional map and the original map are completely independant of each other. Changes to one will not affect the other.

1. With the existing map loaded, select the "Create Regional Map from Existing Map" button at the bottom of the "Create New Map" tool. This will open a toolbar and display a crop window.

2. In the toolbar, change the resolution of the width of the new map (height will be calculated automatically).

3. On the map canvas, drag the corners of the crop window to resize it, and drag it into position. The toolbar will update to show the calculated map resolution and the new latitude ranges of the map.

   ![Map Crop Tool](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/assets/screenshots/map-crop-tool.png)

4. Once you are happy, click the "Generate Map" button. You will be asked for a new map name. The map will then be created and saved. You can load it in the "Manage Maps" tool where it will appear as a child of the original map.

5. Fine tune river positions, points of interest pins and labels.
   - The additional terrain detail is likely to create new routes for rivers so you may need to edit the terrain slightly to allow rivers to continue their original paths.
   - Points of Interest pins (infrastructure) and labels will be positioned at the same centred position of the original map but because the font/icon size is smaller (relative to the map) they will now be slightly offset.

#### Terrain

The terrain is generated automatically. Once generated, the terrain can be edited by the user.

1. **Global Settings**
   - **Sea Level:** Set the sea level. This will update the map to show the new coastline.

2. **Elevation Model** The terrain model is infinite in size. These controls determine which part of the model you see.
   - **Map Transformation:** Use the zoom buttons and the nudge buttons to change your position in the model. Both groups have a reset button between them, to return you to the original positions.
   - **Detail:** Determine how smooth or detailed the model will be.
   - **Stretch:** Higher values result in mid-elevations being stretched and high/low elevations being compressed. This allows for larger plains to form.

3. **Edit Terrain** Use the edit tools to adjust your terrain.

   Brush tools work similar to brush tools in graphics packages.
   - **Brush Size:** The radius of the brush tool.
   - **Brush Strength:** How quickly the brush is applied.
   - **Brush Feather:** How much the brush is blended with the surrounding terrain. Feathering increases towards the edges of the brush.

   - **Raise Terrain:** This brush increases the elevation of the terrain beneath it.
   - **Lower Terrain:** This brush reduces the elevation of the terrain beneath it.
   - **Smooth Terrain**: This brush "averages" the terrain elevations under it.
   - **Slope Up**: This brush takes the starting elevation and then increases elevation as you move away from that point.
   - **Level Terrain**: This brush levels the terrain to match the exact elevation at the centre of your click, smoothly feathering into the surrounding landscape.
   - **Slope Down**: This brush takes the starting elevation and then decreases elevation as you move away from that point.

#### Biomes (Climate)

Biomes are generated automatically depending on the latitude, terrain, temperature profile and moisture profile. It also accounts for prevailing wind patterns tracking geographical orographic lift (rain shadows). Once generated, the biomes can be edited by the user.

1. **Climate Settings**
   - **Global Temperature:** Determine how warm or cold the overall global climate is. Lower the value to create ice worlds and raise it to create desert worlds.
   - **Season:** Determine the current season. Set a value of 0 for Spring/Autumn, and a value of -1 or 1 for Summer/Winter (by hemisphere).

2. **Moisture Settings**
   - **Global Moisture:** Determine how wet or dry the overall climate is.
   - **Scale:** Determine the "size" of the moisture distribution from large constistent areas to very changeable and details variations within small areas.

3. **Edit Biomes** Use the edit tools to place your own biomes.

   Brush tools work similar to brush tools in graphics packages.
   - **Brush Size:** The radius of the brush tool.
   - **Brush Strength:** How quickly the brush is applied.
   - **Brush Feather:** How much the brush is blended with the surrounding terrain. Feathering increases towards the edges of the brush.

   - **Select Biome**: Select which biome type to paint. Any custom biomes you have created in the Map Configuration tool will also appear here as selectable brushes.

#### Terrain Features

- **Rivers and Lakes:** River sources are automatically generated where the moisture levels are high enough. River sources form between certain elevations which can be changed in the Map Configuration settings. They find their way down the terrain until they reach natural depressions. Water will then pool to form lakes. If the lakes becomes large enough, they may find new paths down the terrain and potentially reach the ocean. When a map is generated, the procedural river sources are permanently baked into the map as editable pins.

1. **Edit Terrain Features**

   Brush tools work similar to brush tools in graphics packages.
   - **Brush Size:** The radius of the brush tool.

   - **Add New River Source:**: Add a pin to spawn a custom river.
   - **Erase Pin:** Delete any river source pin within the brush area (whether procedurally generated or manually placed) to remove that river.

#### Infrastructure

You can add two types of infrastructure:

- **Points of Interest**
- **Routes**

Once created, they are shown in the sidebar as cards. Each card has four buttons:

- **Visibility:** Set whether the feature will be visible to players, the GM or completely hidden.
- **Focus View:** Clicking this will pan the map and zoom to the feature.
- **Edit Details:** You can edit the feature's name, add a description and:
  - For Points of Interest, change the marker icon and its size.
  - For Routes, change its colour, its thickness and its line style (solid, dashed or dotted).
- **Delete**

Descriptions for Points of Interest will be shown as tooltips if you hover over its marker. Descriptions can be styled using `<HTML>` elements, including referencing images, etc.

Both Points of Interest and Routes will show a label. The label can be edited seperately using the label tool.

1. **Edit Infrastructure**

   The Edit Infrastructure toolbar offers the following buttons and options:

   - **Place Point of Interest**: Used to drop markers on the map.
   - **Draw Route**: Used to draw routes (roads, sea routes, etc). Routes are made up of nodes and a smooth line is drawn connected each node.

   The remainder of the toolbar depends on which of the above two options is active:

   - **Points of Interest**
     - **Select Marker Icon:** Select the icon to be used as the marker. The size of the marker can be changed inside the "Edit Details" from the sidebar (see above).

   - **Routes**
     - **Snap to Points:** If enabled, route nodes will try to snap to a nearby point of interest.
     - **Quick Styles:** Four quick styles have been pre-configured which set the colour, thickness and style of line. These can be toggled on and off.
     - **Colour** / **Thickness** / **Style** Or each property can be customised. All three can be changed from inside the "Edit Details" (see above).

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

#### Labels

The *Labels* tool allows you to edit existing labels and add/delete custom labels.

1. Labels are automatically created for any vector item created using other tools, e.g., Points of Interest, routes and regions. These labels can be renamed, their styles edited and have their visibility toggled. They cannot be deleted.

2. To edit a label click its edit button shown after its name in the sidebar. You can change its name and its style.
   > Changing the name of the label in the *Labels* tool also changes it name when inspected in the tool it belongs to if it was automatically created.

3. Individual labels can have their visibility toggled by clicking the visibility button before its name in the sidebar.
   > Hidden labels will not be exported. Use the visibility toggle to control what information you want to share, e.g., by creating a player map and a GM map.

#### Cartography

The *Cartography* tool allows you to add decorations to the map.

1. **Scale Bar:** Set the map units, the scale interval size (in pixels), the number of map units represented by a major tick, and the number of major/minor intervals to show on the scale bar.

2. **Map Border:** At launch, three simple border types can be set, and a single colour applied.

3. **Other Decorations:** You can add any image file as a decoration, e.g., adding a windrose or compass, or adding a map cartouche you have designed outside Foundry.

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
   - **Spring Moisture (Min):** Set the minimum moisture level where river sources can randomly spawn. This prevents rivers trying to form in deserts.
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

> Note: Re-exporting a map to an existing scene is a non-destructive process for the canvas. It will safely update the background and grid without deleting any walls, lighting, or tokens already placed on the scene. Re-exporting journals will overwrite existing content if that option is selected.

1. Open the *Export to Scene* tool to launch the dialogue.

   ![Scene Export Dialogue](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/assets/screenshots/export-to-scene.png)

2. Name the scene (defaults to the current map name).
3. Use the folder browser to select a directory in your `world` data folder to save the map images.
4. Select if you want to generate the associated journal and map pins.
5. If updating an existing scene, choose whether to overwrite the existing journal. *(Warning: Overwriting will delete any edits made manually to the journal made directly through normal Foundry tools).*

   ![Exported Scene showing linked journal](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/assets/screenshots/exported-scene.png)

6. Select if you want to extract the GM-only overlay tile.

When you click "Confirm", the interface will lock to prevent changes during the extraction process. When completed, your canvas will switch to view the new scene.

> Note: FoundryVTT Version 14 offers no way to completely hide map tiles from a GM's view, only from players. The module "Tile Sort" by TheRipper93 enables that feature.

#### Saving a Map

1. Use the *Quick Save* tool found near the bottom of the toolbar.

   > If the map has not been saved before it will ask for a filename. If it has been saved before it will show the map name in the tooltip. Saved maps are found in the compendium called *Filroden's World Map Builder* as Journals. If the map has been saved before, it will save any changes to the existing map inside the compendium.

2. Each map is saved as a data file inside the journal. The journal also shows the main map generation settings. **Important:** Save often!

   ![Journal Page for Exported Map](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/assets/screenshots/map-export-journal.png)

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

- Configure quick styles for routes, etc.
- Scene tools to allow quicker toggling of the in-game map grid or map pins (which would otherwise take multiple clicks through Foundry's UI).
- Multi-tile export support, allowing the GM to toggle distinct layers (like political borders or trade routes) on and off during live play.
- A Sandbox Mode allowing the import of DEM or greyscale heightmaps to bypass the procedural generation entirely.
- Simulate the effects of tectonic plate boundaries (convergent, divergent and lateral) and simulate the effects of hot spots and continental drift.
