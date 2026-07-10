# Roadmap

## Roadmap Feature: Kinematic Tectonic Fault Lines

**Tool Category:** Features
**Concept:** A highly performant, non-simulated geological tool that grants Game Masters explicit, tactile control over mountain ranges and trenches by drawing vector "fault lines", entirely bypassing O(N³) physics simulations.

**UI / UX Integration:**

* Reuses the established "Route" drawing paradigm.
* The user draws a multi-nodal fault line and configures its **Thickness** (magnitude of the geological event) and **Boundary Type** (Convergent, Divergent, or Slip).

**Core Architecture (Signed Distance Fields):**

* Operates in highly performant O(N) time.
* For pixels near the fault line, the engine calculates a Signed Distance Field (SDF) to the nearest vector segment to determine the magnitude of geological deformation.

**Tectonic Behaviours:**

1. **Convergent (Collision):** Applies an additive Gaussian modifier based on proximity, extruding sharp mountain ranges along the fault.
2. **Divergent (Rift):** Applies a subtractive modifier, carving deep oceanic trenches or continental rift valleys.
3. **Slip (Transform):** Utilises a vector cross-product to determine if a pixel sits on the "left" or "right" tectonic plate. It spatially displaces the elevation read-coordinates parallel to the fault line to shear the terrain, feathering the effect outward to prevent clean tears.

**Determinism & Organic Jitter:**

* To prevent perfectly smooth, artificial-looking mountain ranges, the SDF extrusion is modulated by the existing `ProceduralEngine` Simplex noise.
* Driven by the map's Mulberry32 PRNG seed, this creates highly organic, jagged "crumple zones" while maintaining strict mathematical determinism for JSON exports, avoiding any use of `Math.random()`.

**Data Management & Pipeline:**

* Faults are stored as a lightweight array of coordinate objects within the main JSON payload (e.g., `tectonicFaults`).
* Deformation math is processed sequentially in the procedural pipeline immediately after the base elevation noise is generated, maintaining strict separation of concerns between vector state mutation and the rasterised canvas rendering loop.
