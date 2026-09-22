# Grid Exploration Data — Proposed Schema (Draft for Feedback)

**Status:** Implemented for v2.6.0 (2026-09-22), pending a manual in-Foundry check of a real exported Scene (grid-cell offset math against Foundry's live Grid API isn't verifiable outside Foundry itself — see the implementation plan's own verification section). Both features this schema depended on have shipped — Custom Biomes (v2.3.0, adding the `code` field used below) and unclamped terrain edits (v2.6.0, which changes how the land terrain bands are defined — see "Resolved by Ken" #5). **Format confirmed by Ken (2026-09-22): a dictionary object keyed by `"i,j"`, as originally drafted** — no longer an open question, see "Coordinate system" below. **`temperatureBand` added (2026-09-22)** — a gap Ken caught: temperature was missing entirely alongside biome/terrain/moisture. See "Resolved by Ken" #7. **`rivers` added (2026-09-22)** — `hasRiver` alone couldn't distinguish a procedural river from a named custom one; a cell now also lists the id/name of any custom river passing through it, alongside the existing boolean.

Implemented in `src/applications/GridDataExporter.js` (per-cell field computation, called from `SceneExporter`) and `src/generation/GridAggregator.js` (the generic point-in-polygon/majority-vote/segment-intersection primitives it's built on). The band thresholds and `schemaVersion` below live in `src/config.js`'s `FILRODENSWMB.GRID_DATA` block, so this document and the actual export trace back to the same numbers.

**Target release:** v2.6.0

## What this is

When Filroden's World Map Builder exports a map to a Foundry VTT Scene, it can additionally write a structured summary of every grid cell on that map — dominant biome, terrain character, and a few other properties — onto the Scene itself, so other Foundry modules and game systems can read it programmatically. The motivating use case: a system that generates a random encounter when a party token enters a cell, using that cell's properties (biome, terrain, whether it's near a settlement or road, etc.) to pick something appropriate.

This data is written once, at export time, from the map's own generated terrain and GM-authored content. It doesn't track anything live — no token position, no "has this cell been visited," no encounter logic. All of that is left entirely to whatever consumes this data.

## Coordinate system

Cells are addressed the same way Foundry VTT itself addresses a grid cell: an offset pair `{ i, j }`, where `i` is the row and `j` is the column. This is the same structure Foundry uses for square grids and both hexagonal orientations — it isn't a Filroden's-specific format, and it's the same coordinate you'd get back from Foundry's own grid API (`grid.getOffset(point)`) for a token's position on that Scene.

In JSON, a cell's offset is written as the object key `"i,j"` (e.g. `"3,7"` for row 3, column 7) — a dictionary object, not an array of cell objects, confirmed by Ken (2026-09-22).

## Top-level structure

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-22T12:00:00Z",
  "grid": {
    "type": 2,
    "typeName": "HEXODDR",
    "size": 100
  },
  "bounds": { "iMin": 0, "iMax": 19, "jMin": 0, "jMax": 24 },
  "cells": {
    "3,7": { "...": "see below" }
  }
}
```

- **`schemaVersion`** — increments only on a breaking change to this shape. Check this before parsing.
- **`generatedAt`** — when this data was last computed (i.e. when the map was last exported to this Scene).
- **`grid.type`** — Foundry's own `CONST.GRID_TYPES` numeric value, identical to `scene.grid.type` on the Scene this data lives on. Authoritative — use this, not `typeName`, if your code branches on grid shape.
- **`grid.typeName`** — the same value as a human-readable label, for convenience only (`"SQUARE"`, `"HEXODDR"`, or `"HEXODDQ"` — Filroden's only ever generates odd-offset hex grids, never even).
- **`grid.size`** — pixels per cell, matching `scene.grid.size`.
- **`bounds`** — the offset range covered by `cells`, inclusive. Useful for iterating the whole map without guessing extents.
- **`cells`** — see below. Every offset within `bounds` is always present (see "Resolved by Ken" #4) unless the Scene is gridless (see "Gridless maps" below).

## Cell data shape

```json
"3,7": {
  "biome": { "id": "GRASSLAND", "name": "Grassland", "code": null },
  "terrainBand": "lowland",
  "moistureBand": "moderate",
  "temperatureBand": "temperate",
  "hasRiver": false,
  "rivers": [ { "id": "Qw7Nf2Rt8Lc5Xp1V", "name": "The Silverrun" } ],
  "isCoastal": true,
  "regions": [
    { "id": "TR8k2mFq9xLp3Zc7", "name": "The Whispering Woods", "layer": { "id": "aWn4Vb1sQd6Yh0Ku", "name": "Forests" }, "visibility": "all", "coverage": 0.82 }
  ],
  "infrastructure": {
    "pins": [ { "id": "Mh5Nx8Rt2Jf0Wc4P", "name": "Millbrook", "icon": "castle", "visibility": "all" } ],
    "routes": [ { "id": "Bq3Ls7Vg1Kn9Zy6D", "name": "King's Road", "visibility": "gm" } ]
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `biome.id` | string | Stable identifier for the dominant biome in this cell (majority of the cell's area). Built-in biomes use a fixed set of keys (e.g. `GRASSLAND`, `DECIDUOUS_FOREST`, `DEEP_OCEAN`); a GM-defined custom biome gets its own id. Always present. |
| `biome.name` | string | Human-readable display name — always present, even for custom biomes. |
| `biome.code` | string \| null | The GM's own optional short code for a custom biome (e.g. an RMU-style terrain code) — `null` for a built-in biome or a custom biome with no code set. New in this release, alongside Custom Biomes' own `code` field. |
| `terrainBand` | string | One of `deepOcean`, `shallowOcean`, `lowland`, `upland`, `highland`, `mountain`. Always present — no raw elevation value is exposed (see "Resolved by Ken" #1). The ocean bands always agree with `biome.id` (a `DEEP_OCEAN`-biome cell is always `deepOcean`, `SHALLOW_OCEAN` always `shallowOcean`), rather than using an independently-computed elevation cutoff that could disagree with the biome. The land bands are open-ended elevation thresholds above this map's own sea level — see "Resolved by Ken" #5 below. A band can still be absent from a given map (zero cells), but only because nothing on that particular map happens to reach it, never because it's mathematically unreachable — elevation itself has no ceiling. |
| `moistureBand` | string | One of `dry`, `moderate`, `wet`. Always present — no raw moisture value is exposed. |
| `temperatureBand` | string | One of `frigid`, `cold`, `temperate`, `warm`, `scorching` — five bands: two for the climate extremes, three covering the more ordinary range between them. Always present — no raw temperature value is exposed. See "Resolved by Ken" #7. |
| `hasRiver` | boolean | A river segment — procedural or custom — passes through this cell, or a lake formed by one does. |
| `rivers` | array | Every **custom** (hand-drawn) river whose line passes through this cell, by id and name. Procedural rivers — the ones traced automatically from a spring pin at generation time — never appear here: they're never named, so there's nothing to report beyond `hasRiver` already being true. Empty array if no custom river passes through, even when `hasRiver` is true (a procedural river, or a lake overflow channel, with no custom river drawn there). No `visibility` field — unlike regions, pins and routes, a river has no visibility setting of its own; it's carved into the terrain itself, not a toggleable annotation. |
| `rivers[].id` / `.name` | string | Stable id and the GM-given name (e.g. "The Silverrun") — the same name shown in the Terrain Features tool's river list. |
| `isCoastal` | boolean | This cell borders ocean. |
| `regions` | array | Every GM-authored Region (drawn with the Regions tool) that covers any part of this cell, **regardless of visibility** — see "Resolved by Ken" #3 and #6 (region membership). Sorted by `coverage` descending, so `regions[0]` is always the region that covers the most of the cell. Empty array if none. A region with `visibility: "none"` (a draft/WIP region, never shown to anyone in-game) is excluded, and so is every region belonging to a region *layer* set to `visibility: "none"` — consistent with neither ever appearing in the exported Scene either. |
| `regions[].id` / `.name` | string | Stable id and the GM-given name (e.g. "The Whispering Woods"). |
| `regions[].layer` | object | `{ id, name }` of the Region *layer* this region belongs to (Filroden's supports several named region layers per map, e.g. "Forests" vs. "Political Borders") — lets a consumer tell a political state from a forest instead of only seeing individual named regions with no grouping. See "Resolved by Ken" #6. |
| `regions[].visibility` | string | `all` or `gm` — whether this region is meant to be player-visible or secret. This is the region's *effective* visibility, not only its own setting: a region marked `all` under a `gm`-visibility layer is written out as `gm`, matching what actually happens when the layer itself is toggled to GM-only in the Studio (the layer overrides every region under it, never the other way round). Exposed rather than filtered — see "Resolved by Ken" #3. |
| `regions[].coverage` | number | Fraction (0–1, exclusive of 0) of this cell's area that falls inside this region's polygon. Exists because a cell can sit inside more than one region at once — this is what lets a consumer decide which one "counts" for a given purpose, rather than guessing. See "Resolved by Ken" #6. |
| `infrastructure.pins` | array | Every infrastructure pin (settlement, landmark, etc.) located in this cell, regardless of visibility (same `none`-exclusion rule as regions). A pin with no icon assigned — the internal marker a procedural river's source gets, not a GM-placed point of interest — is excluded, the same way it's already excluded from the journal/Note generation the rest of the export does. Empty array if none. |
| `infrastructure.pins[].id` / `.name` / `.icon` / `.visibility` | string | Pin identity, its icon key (useful for classification — e.g. distinguishing a settlement from a ruin), and its `all`/`gm` visibility. |
| `infrastructure.routes` | array | Every route (road, river-adjacent path, etc.) passing through this cell, regardless of visibility. Empty array if none. |
| `infrastructure.routes[].id` / `.name` / `.visibility` | string | Route identity and its `all`/`gm` visibility. |

**A note on the id format above:** every `id` in this schema (regions, pins, routes, custom rivers, region layers) is Filroden's own internal id for that object — a 16-character alphanumeric string (`foundry.utils.randomID()`), with no prefix. The `reg-`/`pin-`/`route-` style shown in earlier drafts of this document was illustrative only and doesn't match the real format; fixed in this revision so a consumer doesn't code against a prefix that will never actually appear. `biome.id`, separately, is either one of the fixed built-in biome keys (`GRASSLAND`, etc.) or a small integer for a custom biome, always as a string.

## Resolved by Ken (2026-09-15, #5–#7 added/rewritten 2026-09-22)

1. **No raw `elevation`/`moisture` values — bands only.** A raw value averaged across a cell is too variable to mean much even for a single cell, let alone comparably across cells. The bands themselves become the defined, stable part of the schema rather than a derived convenience alongside raw numbers.
2. **`terrainBand` gets two ocean bands, not one**, matching the existing `DEEP_OCEAN`/`SHALLOW_OCEAN` biome distinction: `deepOcean` and `shallowOcean`, alongside the land bands `lowland`/`upland`/`highland`/`mountain`. Renamed from `elevationBand` to `terrainBand` to match, since it's no longer purely an elevation-derived value once it has to agree with biome at the ocean end.
3. **Visibility is exposed everywhere it exists, not just on regions** — pins and routes both get a `visibility` field too, and GM-only (`gm`-visibility) content is included rather than filtered out. Ken's position: he has no concerns exposing GM-secret information in Scene flags — a player determined to read flag data to cheat would find another way regardless, and that's a table-trust problem, not something the module should try to engineer around.
4. **Cell coverage is always complete, never sparse.** Every cell always has biome, terrain, and moisture information — every offset within `bounds` is present in `cells`, none omitted as an implicit default.
5. **Land terrain bands, rewritten for v2.6.0's unclamped terrain edits — open-ended, not clamped.** The original design clamped each band's range to `[seaLevel, 1.0]` and treated a band as absent whenever its start would exceed elevation 1.0, since 1.0 used to be a hard ceiling no stored elevation could ever cross. That ceiling no longer exists: v2.6.0 lets hand-edited terrain (brush strokes, tectonic faults, carved rivers) genuinely exceed `[0,1]` and stay that way in storage. A "clamped to 1.0" band definition stops making sense once elevation itself is unbounded above — so each land band is now defined by its **lower threshold only**, open-ended at the top:

   | Band | Elevation range |
   |---|---|
   | `lowland` | `seaLevel` and above |
   | `upland` | `seaLevel + 0.10` and above |
   | `highland` | `seaLevel + 0.22` and above |
   | `mountain` | `seaLevel + 0.38` and above, with no upper bound |

   A cell's band is whichever of these it qualifies for highest — e.g. an elevation of `seaLevel + 0.5` is `mountain`, not `highland`, even though it also technically clears the `highland`/`upland`/`lowland` thresholds. A band can still have zero cells on a given map (e.g. no `mountain` on a very-high-sea-level "island world" map where nothing happens to reach `seaLevel + 0.38`), but that's now a fact about what that map's terrain actually contains, never a mathematical impossibility the way "elevation 1.1" used to be. **Sea level itself must be read as the map's *effective* sea level** (`MapStateManager.getDerivedMapParameters().seaLevel`), not the raw `uiState.seaLevel` slider value — Advanced-mode maps pin their effective sea level to 0.35 regardless of what the UI shows, and banding against the wrong value would silently mis-band every Advanced map.
6. **Region membership: an explicit "coverage" rule, not just "contains."** The original draft said a region "contains" a cell without saying what that means once two regions can overlap the same cell — already possible today, and certain to be far more common once a future version's generated content (political states, biome-driven regions, etc.) tiles the whole map, at which point every border cell would sit in two or more regions with no way for a consumer to tell which one dominates. Settled now, while nothing yet depends on the old ambiguous meaning, rather than left to become a silent breaking change later: each `regions[]` entry carries a `coverage` fraction (0–1) of the cell's area inside that region's polygon, and the array is sorted by `coverage` descending — a consumer that only wants "the" region for a cell can always take `regions[0]`.
7. **`temperatureBand` added.** The schema exposed biome, terrain, and moisture but had no temperature field at all — a real gap, caught by Ken directly. Added as `temperatureBand`, five bands rather than moisture's three, "like moisture" in kind (a flat classification of a `[0,1]` value, not relative to a per-map setting the way terrain bands are relative to sea level) but finer-grained per Ken's specific request: two bands for the climate extremes plus three bands covering the more ordinary range between them, rather than moisture's simpler extremes-plus-one-middle-band split. See the band table below.

**Land terrain-band threshold numbers** (0.10 / 0.22 / 0.38 above sea level) are unchanged from the previous draft — only the *open-ended* framing is new, not the numbers themselves — and remain a first proposal worth the system developer's sanity check on whether the resulting terrain mix feels right for picking an encounter table.

`moistureBand`: `dry` below 0.33 · `moderate` 0.33–0.66 · `wet` above 0.66 — unchanged, and already effectively open-ended at both outer bands (there's no upper bound on `wet` or lower bound on `dry`), so this needed no rewrite for the unclamped-elevation change.

`temperatureBand`: five equal-width bands across the full `[0,1]` temperature range, the same flat (not sea-level-style relative) treatment as moisture, since temperature — unlike elevation — is never hand-edited past `[0,1]` by any tool:

| Band | Temperature range |
|---|---|
| `frigid` | 0.0 – 0.2 |
| `cold` | 0.2 – 0.4 |
| `temperate` | 0.4 – 0.6 |
| `warm` | 0.6 – 0.8 |
| `scorching` | 0.8 – 1.0 |

A strawman like the other band sets — equal fifths is the simplest defensible default, not tuned against the module's own internal biome-generation temperature cutoffs (`getBiomeKey`'s arctic/subarctic/temperate/tropical bands use their own, differently-spaced thresholds, the same way `moistureBand`'s flat thirds were never tied to `getBiomeKey`'s own per-band moisture cutoffs). Worth the system developer's opinion alongside the other band sets on whether five bands, spaced this way, are the right granularity for picking an encounter table.

## Gridless maps

A map exported with no grid (`gridType: "none"`) has no cell geometry to summarise, so the `cells` object — and this feature entirely — is simply absent for that Scene. Nothing to parse, nothing to fall back to.

## Stability

Once in use, this becomes a small public contract other modules build against. `schemaVersion` exists so a future breaking change is detectable rather than silently breaking a consumer; additive changes (a new optional field) won't bump it. A future version's generated content (settlements, roads, political regions) is expected to travel through the existing `regions`/`infrastructure` fields with no shape change, since it's planned to be authored as ordinary regions/pins/routes rather than a new kind of object.

## Still open — for the system developer

1. **Anything missing, now that the shape has settled further:** any other per-cell property your system — or one you can imagine another system wanting — would need that isn't listed here (e.g. a distance-to-nearest-settlement value, a GM-settable custom tag per cell)? Also worth his opinion on whether three moisture bands (`dry`/`moderate`/`wet`) and five temperature bands (`frigid`/`cold`/`temperate`/`warm`/`scorching`) are the right granularity, and whether the land `terrainBand` cut-points feel right for picking an encounter table.

The format question (object keyed by `"i,j"` vs. an array of cell objects) is no longer open — Ken has confirmed the dictionary-object format above.
