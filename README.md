# Filroden's World Map Builder

![Latest Version](https://img.shields.io/badge/Version-4.0.0-blue)
![Foundry Version](https://img.shields.io/badge/Foundry_VTT-v14-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![System Agnostic](https://img.shields.io/badge/System-Agnostic-green)
![RTL Support](https://img.shields.io/badge/RTL-Supported-green)
![Download Count](https://img.shields.io/github/downloads/Filroden/filrodens-world-map-builder/filrodens-world-map-builder.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/filrodens-world-map-builder/latest/filrodens-world-map-builder.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/filrodens-world-map-builder)
![Issues](https://img.shields.io/github/issues/Filroden/filrodens-world-map-builder)

## Welcome to Filroden's World Map Builder

Filroden's World Map Builder is a system-agnostic cartography tool. It runs as a module in Foundry VTT, and in any browser at [fwmb.filroden.com](https://fwmb.filroden.com), with the same tools in both.

It builds a world from a seed: the land, its climate, rivers and biomes, and then the people who live on it, with their towns, roads, realms, cultures and history. You can edit all of it by hand, and cut regional maps from the world at finer and finer detail.

In Foundry, maps are saved as journals in a compendium. On the web, they are saved in your browser, and a map can be exported as a JSON file and imported into either version. Because the terrain is procedural and your edits are kept as a history of strokes, a saved map stays very small.

![Module Interface](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/assets/screenshots/interface.png)

### Main features

The map builder makes a world in two parts: the land, worked out from a procedural model of terrain and climate, and the people who live on it, worked out by a generator that reads that land. You can edit both by hand, and both carry on into the regional maps you cut from the world, closer and closer in.

#### The land

- **Procedural terrain:** layered noise and geological stretch parameters shape the land from a seed, so the same seed always gives the same world. Relief shading brings out the hills, valleys and seabed, and the sea and lakes are drawn as water you can see into, with their own biomes on the bed.
- **Four terrain engines:** Standard, Flat, Advanced (tectonics) and Guided. Advanced (tectonics) lets tectonic plates decide where the continents lie, raising mountain ranges, trenches and mid-ocean ridges where they meet or part, while Guided builds the land inside shapes you draw (or random shapes it draws for you). Both give natural coastlines, continental shelves and deep oceans, and look the same at any map size.
- **Climate and biomes:** temperature follows the latitude and the height of the land, and moisture is carried by the wind, with rain shadows behind the mountains. Together they decide the biomes. Define biomes of your own with rules (ranges of height, moisture and temperature) and they appear wherever the climate matches, with the built-in biomes as a fallback and a preview of where your rules leave gaps.
- **Rivers and lakes:** rivers run downhill from sources placed by the climate, widening as tributaries join them, meandering across the plains and splitting into deltas at the sea. They pool into lakes until they overflow, and freeze with altitude and climate. Add sources of your own, move or remove the ones placed for you, and draw rivers that run exactly where you want.
- **Tectonic features:** draw mountain ranges in three styles, subduction zones with their trenches and volcanic arcs, rift valleys, and hotspot chains of volcanic islands that age from active volcanoes to eroded islands, atolls and seamounts. Each is shaped by the terrain it crosses, so it blends into the map.
- **Non-destructive brushes:** raise, lower, level, slope, smooth and roughen the terrain, or paint biomes, with a freehand brush. Strokes are saved as a history rather than as pixels, so they follow the map when it is rescaled or cut into regional maps, and a saved map stays very small.

#### The people

- **A generator for the world's people:** **Generate** reads the land (how many people it can feed, how hard it is to cross, how easy it is to defend) and in one run places capitals, cities, large towns, towns, castles, fortified towns and ports, traces the trade between them as roads, river trade routes and sea lanes, and divides the land into realms, duchies and counties. Everything is named, in 43 name styles.
- **Cultures:** give the map peoples of its own, each with a habitat, homelands and a language. They spread over the land that suits them, mix where they meet, and name their own places. A culture can arrive, or invade, in a later age.
- **Ages and history:** a generate run can pass through up to eight ages of different eras and strife, each starting from the one before, and leave ruins, abandoned castles, old roads and former capitals behind. The **History** tool shows the map as it was in each age, what changed between them, and exports any age as an image.
- **Villages and market towns:** on a regional map, **Fill in** adds the villages and market towns between the places it inherited, joined to the roads by lanes. They share out the people of the world's run, so a fill-in never adds people the world did not have, and each closer regional map can be filled in again, more finely.
- **Thematic layers:** colour the map by population, the land's capacity, cleared land, danger or culture, and draw the trade along its roads, rivers and sea lanes, to see why the run put things where it did.
- **Travel times:** the **Travel** tool shows how long journeys take from any place, on foot, by wagon or by fast mount, with boats and ships on the rivers and sea routes, as bands of days across the map and the quickest way to the pointer.
- **Yours to change:** everything the generator makes is ordinary map content. Anything you edit or lock is kept when you generate again, and the inspector shows each place's population, cultures and history.

#### Making the map

- **Regions painted on the map:** paint regions onto the map's cells with a brush, fill and eraser, in layers (a kingdom's duchies inside the kingdom, and their counties inside them) grouped into layer sets. Each region claims the sea along its own coast, and each layer has its own borders, opacity and territorial waters.
- **Routes that find their way:** a route is a chain of waypoints, and the module finds the way between them over the terrain, so a road winds round the mountains and joins the roads already there, and a sea lane keeps to the water.
- **Pins, labels and styles:** pins, routes, labels and region fills each have named styles that set the look of everything using them, and **Save as…** makes a style from anything you have tuned. 29 fonts come with the module, and names are placed so they don't cover each other, the pins or the map's border.
- **Detail level:** a world map can hold thousands of places, so the **Detail** menu shows as much as the map's scale suits, from capitals, cities and realms alone to every village and county, with a symbol size that grows on closer maps.
- **Regional maps:** cut any part of a map into a new map at a higher resolution, with finer coastlines, terrain and biome borders, and the parent's rivers, features, regions, places and routes carried in. Because the land is procedural, you can keep cutting closer, from a world towards a single valley.
- **The inspector and mass edit:** choose anything on the map, or its row in a list, and it opens beside the map. Changes apply at once, each is one step of undo, and mass edit changes many pins, routes, labels or regions together.
- **Cartography:** a scale bar true to the world's scale, a border, the grid, and decorations of your own such as a compass rose.

#### Sharing the map

- **Export to a Foundry scene (Foundry module version only):** every object and layer can be shown to everyone, to the GM only or to no one. The players' map becomes the scene's background, a tile over it holds what only the GM sees, and a journal with a page for each named place, route and region (with the generator's figures) is made so you can add your own detail about key locations. Each grid cell's biome, terrain, regions, places and routes are written onto the scene for other modules and game systems to read.
- **Export to PNG:** export the map as you see it, at a scale chosen so its smallest names can be read.
- **The 3D view:** see the map draped over its own terrain, with its water, rivers and light.

#### In Foundry and on the web

- **One map builder, two homes:** it runs as a module in Foundry VTT, and in any browser at [fwmb.filroden.com](https://fwmb.filroden.com), with the same tools in both. In Foundry, maps are saved as journals in a compendium; on the web, they are saved in your browser, with a backup of every map in one file. A map's JSON file moves it between the two, in either direction.
- **Made to be read:** four colour themes (light and dark, gold and teal) that meet the WCAG AA contrast levels, supports right-to-left languages, keyboard throughout the studio with a **Help** tool showing every shortcut, the version and links to the wiki.

---

### Example maps

The following are two examples of maps I created in the module together with links to their JSON files which can be imported into the module.

#### World map (generated at 4000 × 4000 pixels)

![World map](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/assets/screenshots/original-map.png)

Link to map JSON file: [https://github.com/Filroden/Filrodens-world-map-builder/samples/fwmb_aethoria.json](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/samples/fwmb_aethoria.json) (36 KB)

#### A regional map of the world map above (generated at 4000 × 2730 pixels)

![Regional Map generated from the World map](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/assets/screenshots/regional-map.png)

Link to map JSON file: [<https://github.com/Filroden/Filrodens-world-map-builder/samples/fwmb_eldoria.json>](https://github.com/Filroden/Filrodens-world-map-builder/blob/main/samples/fwmb_eldoria.json) (32 KB)

---

## How to open the map builder

In Foundry, open the **Scenes** sidebar and click **Map builder** at its top (only a GM sees it). On the web, go to [fwmb.filroden.com](https://fwmb.filroden.com): nothing needs installing.

The map builder works with a mouse and keyboard or with a touch screen. On a tablet, tap and drag with one finger, pan and pinch with two, and press and hold to finish a line. A few actions (Shift, Ctrl or Alt with a click) still need a keyboard. The wiki's Map Canvas page has the details.

Please see the [Wiki](https://github.com/Filroden/Filrodens-world-map-builder/wiki) for more details on how to use the module.

## Third-party licences

Filroden's World Map Builder is released under the [MIT Licence](LICENSE.md). It also includes the following third-party code, icons and fonts. Each is kept in its own folder together with its licence, and that licence covers every file in the folder.

<!-- credits:start (written by scripts/credits-readme.mjs from src/data/credits.js) -->
| Dependency | Folder | Licence file | Licence |
| :--- | :--- | :--- | :--- |
| [d3-delaunay](https://github.com/d3/d3-delaunay) 6.0.4 (Delaunay triangulation for the map's cells, bundled into one file with delaunator and robust-predicates) | [`vendor/d3-delaunay/`](vendor/d3-delaunay/) | [`licence-d3-delaunay.md`](vendor/d3-delaunay/licence-d3-delaunay.md) | ISC |
| [delaunator](https://github.com/mapbox/delaunator) 5.1.0 (bundled with d3-delaunay) | [`vendor/d3-delaunay/`](vendor/d3-delaunay/) | [`licence-delaunator.md`](vendor/d3-delaunay/licence-delaunator.md) | ISC |
| [robust-predicates](https://github.com/mourner/robust-predicates) 3.0.3 (bundled with d3-delaunay) | [`vendor/d3-delaunay/`](vendor/d3-delaunay/) | [`licence-robust-predicates.md`](vendor/d3-delaunay/licence-robust-predicates.md) | Unlicense (public domain) |
| Simplex noise by Jonas Wagner (the terrain's noise, modified for speed, giving exactly the same values) | [`vendor/simplex-noise/`](vendor/simplex-noise/) | [`licence-simplex-noise.md`](vendor/simplex-noise/licence-simplex-noise.md) | MIT |
| [idiomorph](https://github.com/bigskysoftware/idiomorph) 0.7.4 (updates the studio's panels in place when they are redrawn) | [`vendor/idiomorph/`](vendor/idiomorph/) | [`licence-idiomorph.md`](vendor/idiomorph/licence-idiomorph.md) | 0BSD |
| [PixiJS](https://pixijs.com/) 7.4.2 (the map canvas in the web version; in Foundry the module uses Foundry's own) | [`vendor/pixi/`](vendor/pixi/) | [`licence-pixi.md`](vendor/pixi/licence-pixi.md) | MIT |
| [Handlebars](https://handlebarsjs.com/) 4.7.10 (the interface templates in the web version; in Foundry the module uses Foundry's own) | [`vendor/handlebars/`](vendor/handlebars/) | [`licence-handlebars.md`](vendor/handlebars/licence-handlebars.md) | MIT |
| [fflate](https://github.com/101arrowz/fflate) 0.8.3 (writes and reads the zip files of Back up all maps and Restore from backup) | [`vendor/fflate/`](vendor/fflate/) | [`licence-fflate.md`](vendor/fflate/licence-fflate.md) | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) 3.4.16 (cleans SVG images picked or imported, so they can carry no script or outside links) | [`vendor/dompurify/`](vendor/dompurify/) | [`licence-dompurify.md`](vendor/dompurify/licence-dompurify.md) | Apache 2.0 |
| [three.js](https://threejs.org/) r185 (development build, with its OrbitControls add-on, used by the 3D view) | [`vendor/three/`](vendor/three/) | [`licence-three.md`](vendor/three/licence-three.md) | MIT |
| [Azgaar's Fantasy Map Generator (name generator and name bases)](https://github.com/Azgaar/Fantasy-Map-Generator) 619d37c7 (names the generated places and realms, ported to JavaScript with its own seeded randomness) | [`vendor/azgaar-names/`](vendor/azgaar-names/) | [`licence-azgaar-fmg.md`](vendor/azgaar-names/licence-azgaar-fmg.md) | MIT |
| [Google Material Design icons](https://fonts.google.com/icons) (the interface icons) | [`assets/icons/`](assets/icons/) | [`icons-licence.md`](assets/icons/icons-licence.md) | Apache 2.0 |
| [Pinhead icons](https://pinhead.ink/) (the pin icons) | [`assets/pinhead-icons/`](assets/pinhead-icons/) | [`licence-pinhead-icons.md`](assets/pinhead-icons/licence-pinhead-icons.md) | CC0 1.0 (public domain dedication) |
| [Atkinson Hyperlegible](https://github.com/googlefonts/atkinson-hyperlegible) (the interface font, and a label font; Latin and Latin Extended, weights 400 and 700, upright and italic) | [`assets/fonts/atkinson-hyperlegible/`](assets/fonts/atkinson-hyperlegible/) | [`OFL.txt`](assets/fonts/atkinson-hyperlegible/OFL.txt) | SIL Open Font License 1.1 |
| [Sora](https://github.com/sora-xor/sora-font) (titles, and a label font; Latin and Latin Extended, weights 400, 600 and 700) | [`assets/fonts/sora/`](assets/fonts/sora/) | [`OFL.txt`](assets/fonts/sora/OFL.txt) | SIL Open Font License 1.1 |
| [Barlow Semi Condensed](https://github.com/jpt/barlow) (values and readouts, and a label font; Latin and Latin Extended, weights 400, 500, 600 and 700, italic in 400 and 700) | [`assets/fonts/barlow-semi-condensed/`](assets/fonts/barlow-semi-condensed/) | [`OFL.txt`](assets/fonts/barlow-semi-condensed/OFL.txt) | SIL Open Font License 1.1 |
| [Alegreya](https://github.com/huertatipografica/Alegreya) (a label font; Latin and Latin Extended, weights 400 and 700, upright and italic) | [`assets/fonts/alegreya/`](assets/fonts/alegreya/) | [`OFL.txt`](assets/fonts/alegreya/OFL.txt) | SIL Open Font License 1.1 |
| [Alegreya SC](https://github.com/huertatipografica/Alegreya) (a label font; Latin and Latin Extended, weights 400 and 700, upright and italic) | [`assets/fonts/alegreya-sc/`](assets/fonts/alegreya-sc/) | [`OFL.txt`](assets/fonts/alegreya-sc/OFL.txt) | SIL Open Font License 1.1 |
| [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) (a label font; Latin and Latin Extended, weights 400 and 700, upright and italic) | [`assets/fonts/cormorant-garamond/`](assets/fonts/cormorant-garamond/) | [`OFL.txt`](assets/fonts/cormorant-garamond/OFL.txt) | SIL Open Font License 1.1 |
| [EB Garamond](https://github.com/octaviopardo/EBGaramond12) (a label font; Latin and Latin Extended, weights 400 and 700, upright and italic) | [`assets/fonts/eb-garamond/`](assets/fonts/eb-garamond/) | [`OFL.txt`](assets/fonts/eb-garamond/OFL.txt) | SIL Open Font License 1.1 |
| [Spectral](https://github.com/productiontype/Spectral) (a label font; Latin and Latin Extended, weights 400 and 700, upright and italic) | [`assets/fonts/spectral/`](assets/fonts/spectral/) | [`OFL.txt`](assets/fonts/spectral/OFL.txt) | SIL Open Font License 1.1 |
| [IM Fell DW Pica](https://fonts.google.com/specimen/IM+Fell+DW+Pica) (a label font; Latin, weight 400, upright and italic) | [`assets/fonts/im-fell-dw-pica/`](assets/fonts/im-fell-dw-pica/) | [`OFL.txt`](assets/fonts/im-fell-dw-pica/OFL.txt) | SIL Open Font License 1.1 |
| [IM Fell DW Pica SC](https://fonts.google.com/specimen/IM+Fell+DW+Pica+SC) (a label font; Latin, weight 400) | [`assets/fonts/im-fell-dw-pica-sc/`](assets/fonts/im-fell-dw-pica-sc/) | [`OFL.txt`](assets/fonts/im-fell-dw-pica-sc/OFL.txt) | SIL Open Font License 1.1 |
| [IM Fell English](https://fonts.google.com/specimen/IM+Fell+English) (a label font; Latin, weight 400, upright and italic) | [`assets/fonts/im-fell-english/`](assets/fonts/im-fell-english/) | [`OFL.txt`](assets/fonts/im-fell-english/OFL.txt) | SIL Open Font License 1.1 |
| [Cinzel](https://github.com/NDISCOVER/Cinzel) (a label font; Latin and Latin Extended, weights 400 and 700) | [`assets/fonts/cinzel/`](assets/fonts/cinzel/) | [`OFL.txt`](assets/fonts/cinzel/OFL.txt) | SIL Open Font License 1.1 |
| [Cinzel Decorative](https://fonts.google.com/specimen/Cinzel+Decorative) (a label font; Latin and Latin Extended, weights 400 and 700) | [`assets/fonts/cinzel-decorative/`](assets/fonts/cinzel-decorative/) | [`OFL.txt`](assets/fonts/cinzel-decorative/OFL.txt) | SIL Open Font License 1.1 |
| [Marcellus SC](https://fonts.google.com/specimen/Marcellus+SC) (a label font; Latin and Latin Extended, weight 400) | [`assets/fonts/marcellus-sc/`](assets/fonts/marcellus-sc/) | [`OFL.txt`](assets/fonts/marcellus-sc/OFL.txt) | SIL Open Font License 1.1 |
| [Almendra](https://fonts.google.com/specimen/Almendra) (a label font; Latin and Latin Extended, weights 400 and 700, upright and italic) | [`assets/fonts/almendra/`](assets/fonts/almendra/) | [`OFL.txt`](assets/fonts/almendra/OFL.txt) | SIL Open Font License 1.1 |
| [Almendra SC](https://fonts.google.com/specimen/Almendra+SC) (a label font; Latin, weight 400) | [`assets/fonts/almendra-sc/`](assets/fonts/almendra-sc/) | [`OFL.txt`](assets/fonts/almendra-sc/OFL.txt) | SIL Open Font License 1.1 |
| [MedievalSharp](https://fonts.google.com/specimen/MedievalSharp) (a label font; Latin and Latin Extended, weight 400) | [`assets/fonts/medievalsharp/`](assets/fonts/medievalsharp/) | [`OFL.txt`](assets/fonts/medievalsharp/OFL.txt) | SIL Open Font License 1.1 |
| [Uncial Antiqua](https://fonts.google.com/specimen/Uncial+Antiqua) (a label font; Latin and Latin Extended, weight 400) | [`assets/fonts/uncial-antiqua/`](assets/fonts/uncial-antiqua/) | [`OFL.txt`](assets/fonts/uncial-antiqua/OFL.txt) | SIL Open Font License 1.1 |
| [Grenze Gotisch](https://github.com/Omnibus-Type/Grenze-Gotisch) (a label font; Latin and Latin Extended, weights 400 and 700) | [`assets/fonts/grenze-gotisch/`](assets/fonts/grenze-gotisch/) | [`OFL.txt`](assets/fonts/grenze-gotisch/OFL.txt) | SIL Open Font License 1.1 |
| [Pirata One](https://fonts.google.com/specimen/Pirata+One) (a label font; Latin and Latin Extended, weight 400) | [`assets/fonts/pirata-one/`](assets/fonts/pirata-one/) | [`OFL.txt`](assets/fonts/pirata-one/OFL.txt) | SIL Open Font License 1.1 |
| [UnifrakturMaguntia](https://fonts.google.com/specimen/UnifrakturMaguntia) (a label font; Latin, weight 400) | [`assets/fonts/unifrakturmaguntia/`](assets/fonts/unifrakturmaguntia/) | [`OFL.txt`](assets/fonts/unifrakturmaguntia/OFL.txt) | SIL Open Font License 1.1 |
| [Kalam](https://fonts.google.com/specimen/Kalam) (a label font; Latin, Latin Extended and Devanagari, weights 400 and 700) | [`assets/fonts/kalam/`](assets/fonts/kalam/) | [`OFL.txt`](assets/fonts/kalam/OFL.txt) | SIL Open Font License 1.1 |
| [Tangerine](https://fonts.google.com/specimen/Tangerine) (a label font; Latin, weights 400 and 700) | [`assets/fonts/tangerine/`](assets/fonts/tangerine/) | [`OFL.txt`](assets/fonts/tangerine/OFL.txt) | SIL Open Font License 1.1 |
| [Alegreya Sans](https://github.com/huertatipografica/Alegreya-Sans) (a label font; Latin and Latin Extended, weights 400 and 700, upright and italic) | [`assets/fonts/alegreya-sans/`](assets/fonts/alegreya-sans/) | [`OFL.txt`](assets/fonts/alegreya-sans/OFL.txt) | SIL Open Font License 1.1 |
| [Alegreya Sans SC](https://github.com/huertatipografica/Alegreya-Sans) (a label font; Latin and Latin Extended, weights 400 and 700, upright and italic) | [`assets/fonts/alegreya-sans-sc/`](assets/fonts/alegreya-sans-sc/) | [`OFL.txt`](assets/fonts/alegreya-sans-sc/OFL.txt) | SIL Open Font License 1.1 |
| [Josefin Sans](https://github.com/ThomasJockin/JosefinSansFont-master) (a label font; Latin and Latin Extended, weights 400 and 700, upright and italic) | [`assets/fonts/josefin-sans/`](assets/fonts/josefin-sans/) | [`OFL.txt`](assets/fonts/josefin-sans/OFL.txt) | SIL Open Font License 1.1 |
| [Noto Naskh Arabic](https://github.com/notofonts/arabic) (a label font; Latin, Latin Extended and Arabic, weights 400 and 700) | [`assets/fonts/noto-naskh-arabic/`](assets/fonts/noto-naskh-arabic/) | [`OFL.txt`](assets/fonts/noto-naskh-arabic/OFL.txt) | SIL Open Font License 1.1 |
| [Noto Serif](https://github.com/notofonts/latin-greek-cyrillic) (a label font; Latin, Latin Extended, Greek, Greek Extended, Cyrillic and Cyrillic Extended, weights 400 and 700, upright and italic) | [`assets/fonts/noto-serif/`](assets/fonts/noto-serif/) | [`OFL.txt`](assets/fonts/noto-serif/OFL.txt) | SIL Open Font License 1.1 |
| [Noto Serif Hebrew](https://github.com/notofonts/hebrew) (a label font; Latin, Latin Extended and Hebrew, weights 400 and 700) | [`assets/fonts/noto-serif-hebrew/`](assets/fonts/noto-serif-hebrew/) | [`OFL.txt`](assets/fonts/noto-serif-hebrew/OFL.txt) | SIL Open Font License 1.1 |
<!-- credits:end -->
