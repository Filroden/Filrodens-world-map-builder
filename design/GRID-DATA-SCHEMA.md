# Grid Exploration Data — Proposed Schema (Draft for Feedback)

**Status:** Draft. Four of the original open questions have been settled by Ken (see "Resolved by Ken" below), with two rounds of correction to the land terrain-band math along the way; two questions remain open for the system developer — see "Still open" at the end.

**Target release:** v2.3.0 (after the in-progress v2.2.0)

## What this is

When Filroden's World Map Builder exports a map to a Foundry VTT Scene, it can additionally write a structured summary of every grid cell on that map — dominant biome, terrain character, and a few other properties — onto the Scene itself, so other Foundry modules and game systems can read it programmatically. The motivating use case: a system that generates a random encounter when a party token enters a cell, using that cell's properties (biome, terrain, whether it's near a settlement or road, etc.) to pick something appropriate.

This data is written once, at export time, from the map's own generated terrain and GM-authored content. It doesn't track anything live — no token position, no "has this cell been visited," no encounter logic. All of that is left entirely to whatever consumes this data.

## Coordinate system

Cells are addressed the same way Foundry VTT itself addresses a grid cell: an offset pair `{ i, j }`, where `i` is the row and `j` is the column. This is the same structure Foundry uses for square grids and both hexagonal orientations — it isn't a Filroden's-specific format, and it's the same coordinate you'd get back from Foundry's own grid API (`grid.getOffset(point)`) for a token's position on that Scene.

In JSON, a cell's offset is written as the object key `"i,j"` (e.g. `"3,7"` for row 3, column 7).

## Top-level structure

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-15T12:00:00Z",
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
  "biome": { "id": "GRASSLAND", "name": "Grassland" },
  "terrainBand": "lowland",
  "moistureBand": "moderate",
  "hasRiver": false,
  "isCoastal": true,
  "regions": [
    { "id": "reg-8f3a", "name": "The Whispering Woods", "visibility": "all" }
  ],
  "infrastructure": {
    "pins": [ { "id": "pin-11c2", "name": "Millbrook", "icon": "castle", "visibility": "all" } ],
    "routes": [ { "id": "route-04d1", "name": "King's Road", "visibility": "gm" } ]
  }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `biome.id` | string | Stable identifier for the dominant biome in this cell (majority of the cell's area). Built-in biomes use a fixed set of keys (e.g. `GRASSLAND`, `DECIDUOUS_FOREST`, `DEEP_OCEAN`); a GM-defined custom biome gets its own id. Always present. |
| `biome.name` | string | Human-readable display name — always present, even for custom biomes. |
| `terrainBand` | string | One of `deepOcean`, `shallowOcean`, `lowland`, `upland`, `highland`, `mountain`. Always present — no raw elevation value is exposed (see "Resolved by Ken" #1). The ocean bands are intended to always agree with `biome.id` (a `DEEP_OCEAN`-biome cell is always `deepOcean`, `SHALLOW_OCEAN` always `shallowOcean`), rather than using an independently-computed elevation cutoff that could disagree with the biome. The land bands are fixed elevation distances above this map's own sea level, clamped — see "Resolved by Ken" #5 and the formula below. On some maps, one or more of the higher land bands may simply have zero cells (e.g. no `mountain` on a very-high-sea-level map); that's expected, not an error. |
| `moistureBand` | string | One of `dry`, `moderate`, `wet`. Always present — no raw moisture value is exposed. |
| `hasRiver` | boolean | A river segment passes through this cell. |
| `isCoastal` | boolean | This cell borders ocean. |
| `regions` | array | Every GM-authored Region (drawn with the Regions tool) that contains this cell, **regardless of visibility** — see "Resolved by Ken" #3. Empty array if none. A region with `visibility: "none"` (a draft/WIP region, never shown to anyone in-game) is excluded — consistent with it never appearing in the exported Scene either. |
| `regions[].id` / `.name` | string | Stable id and the GM-given name (e.g. "The Whispering Woods"). |
| `regions[].visibility` | string | `all` or `gm` — whether this region is meant to be player-visible or secret, per the GM's own setting in the Studio. Exposed rather than filtered — see "Resolved by Ken" #3. |
| `infrastructure.pins` | array | Every infrastructure pin (settlement, landmark, etc.) located in this cell, regardless of visibility (same `none`-exclusion rule as regions). Empty array if none. |
| `infrastructure.pins[].id` / `.name` / `.icon` / `.visibility` | string | Pin identity, its icon key (useful for classification — e.g. distinguishing a settlement from a ruin), and its `all`/`gm` visibility. |
| `infrastructure.routes` | array | Every route (road, river-adjacent path, etc.) passing through this cell, regardless of visibility. Empty array if none. |
| `infrastructure.routes[].id` / `.name` / `.visibility` | string | Route identity and its `all`/`gm` visibility. |

## Resolved by Ken (2026-09-15)

1. **No raw `elevation`/`moisture` values — bands only.** A raw value averaged across a cell is too variable to mean much even for a single cell, let alone comparably across cells. The bands themselves become the defined, stable part of the schema rather than a derived convenience alongside raw numbers.
2. **`terrainBand` gets two ocean bands, not one**, matching the existing `DEEP_OCEAN`/`SHALLOW_OCEAN` biome distinction: `deepOcean` and `shallowOcean`, alongside the land bands `lowland`/`upland`/`highland`/`mountain`. Renamed from `elevationBand` to `terrainBand` to match, since it's no longer purely an elevation-derived value once it has to agree with biome at the ocean end. The land bands are computed relative to each map's own sea level rather than fixed absolute thresholds — see the corrected formula below.
3. **Visibility is exposed everywhere it exists, not just on regions** — pins and routes both get a `visibility` field too, and GM-only (`gm`-visibility) content is included rather than filtered out. Ken's position: he has no concerns exposing GM-secret information in Scene flags — a player determined to read flag data to cheat would find another way regardless, and that's a table-trust problem, not something the module should try to engineer around.
4. **Cell coverage is always complete, never sparse.** Every cell always has biome, terrain, and moisture information — every offset within `bounds` is present in `cells`, none omitted as an implicit default.
5. **Land terrain bands can be legitimately absent on some maps — that's expected, not an edge case to work around.** See the corrected formula below; a high-sea-level "island world" map might have zero `highland` or `mountain` cells, and that's a true statement about that map's terrain, not a bug.

**Proposed band thresholds** (still a strawman for the land bands and for moisture — worth the system developer's opinion before treating as final; the two ocean bands are fixed by definition, always mirroring biome):

- **`terrainBand` land bands are a fixed elevation *distance* above this map's own sea level, clamped — not a fraction of the remaining range.** Two earlier approaches were tried and rejected. A fixed *absolute* offset above sea level (e.g. "+0.70") breaks because sea level is a per-map setting: at sea level 0.4, reaching `mountain` would need an elevation of 1.1, which is impossible, so the band could vanish even at an ordinary sea level. Rescaling to a *fraction of the remaining land range* (e.g. "the top 20% of whatever land elevation exists above sea level") fixes that but breaks the other way at the extremes: on an "island world" map with sea level at 0.8, only 0.2 of elevation range remains above water, and splitting that sliver into four equal-percentage bands would label a cell just barely above the waterline (elevation 0.84) as `mountain` — a meaningless result.

  Instead, each band is a **fixed elevation distance above sea level**, the same absolute distance on every map, with each band simply absent if its starting point would fall above the maximum possible elevation (1.0):

  | Band | Starts at (elevation) | Ends at (elevation) |
  | --- | --- | --- |
  | `lowland` | `seaLevel` | `seaLevel + 0.10` |
  | `upland` | `seaLevel + 0.10` | `seaLevel + 0.22` |
  | `highland` | `seaLevel + 0.22` | `seaLevel + 0.38` |
  | `mountain` | `seaLevel + 0.38` | `1.0` |

  Every band's range is clamped to `[seaLevel, 1.0]`. If a band's start already exceeds `1.0`, it simply has zero cells on that map — it isn't rescaled or forced to exist. Worked examples:
  - **Default sea level (0.35):** `lowland` 0.35–0.45, `upland` 0.45–0.57, `highland` 0.57–0.73, `mountain` 0.73–1.0. All four bands exist with reasonable room.
  - **High sea level (0.8, "island world"):** `lowland` 0.80–0.90, `upland` 0.90–1.0 (clamped — its nominal end of 1.02 is cut off at the max). `highland` would start at 1.02, past the maximum elevation, so it and `mountain` simply don't occur anywhere on this map — no islands reach that high, which is exactly the intended behaviour for a map dominated by shallow islands.
  - **Low sea level (0.1, a dry, mostly-land world):** `lowland` 0.1–0.2, `upland` 0.2–0.32, `highland` 0.32–0.48, `mountain` 0.48–1.0 — a much larger `mountain` range, because there's a much larger elevation range above sea level to begin with. That's expected: these bands describe terrain *character* relative to sea level, not a guarantee of equal-sized bands.

  These threshold numbers (0.10 / 0.22 / 0.38) are a first proposal, smaller and better-calibrated than an earlier broken draft — worth the system developer's sanity check on whether the resulting terrain mix feels right for picking an encounter table, alongside the open questions below.
- `moistureBand`: `dry` below 0.33 · `moderate` 0.33–0.66 · `wet` above 0.66. Worth flagging to the developer that with raw values gone, three bands is all the moisture signal there is — worth confirming that's granular enough for his purposes rather than assuming it.

## Gridless maps

A map exported with no grid (`gridType: "none"`) has no cell geometry to summarise, so the `cells` object — and this feature entirely — is simply absent for that Scene. Nothing to parse, nothing to fall back to.

## Stability

Once in use, this becomes a small public contract other modules build against. `schemaVersion` exists so a future breaking change is detectable rather than silently breaking a consumer; additive changes (a new optional field) won't bump it.

## Still open — for the system developer

1. **Format:** is an object keyed by `"i,j"` string easy to consume, or would an array of cell objects (each carrying its own `i`/`j` fields) suit your parsing better?
2. **Anything missing:** any other per-cell property your system — or one you can imagine another system wanting — would need that isn't listed here (e.g. a distance-to-nearest-settlement value, a GM-settable custom tag per cell)? Also worth his opinion on whether three moisture bands (`dry`/`moderate`/`wet`) is granular enough now that there's no raw value alongside it, and whether the land `terrainBand` cut-points above feel right for picking an encounter table.
