/**
 * Evaluates the three environmental floats against the sea level to determine a final biome string.
 */
export function determineBiome(elevation, moisture, temperature, seaLevel) {
    // 1. Extreme Cold Overrides (Freezes oceans into polar ice caps)
    if (temperature <= 0.25) return "ice";

    // 2. Water
    if (elevation <= seaLevel) {
        return seaLevel - elevation > 0.15 ? "ocean" : "coast";
    }

    // 3. Extreme Elevation Overrides
    if (elevation >= 0.8) return "peak";
    if (elevation >= 0.65) return "mountain";

    // 4. The Whittaker Climate Matrix (Restored bands)
    if (temperature > 0.65) {
        if (moisture > 0.55) return "jungle";
        if (moisture > 0.45) return "savanna";
        return "desert";
    }

    if (temperature > 0.35) {
        if (moisture > 0.55) return "swamp";
        if (moisture > 0.45) return "forest";
        return "plains";
    }

    if (moisture > 0.55) return "taiga";
    return "tundra";
}
