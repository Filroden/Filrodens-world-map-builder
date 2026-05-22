/**
 * Evaluates the three environmental floats against the sea level to determine a final biome string.
 */
export function determineBiome(elevation, moisture, temperature, seaLevel) {
    // 1. Extreme Cold Overrides (Freezes oceans into polar ice caps)
    if (temperature <= 0.25) return "ice";

    // 2. Water
    if (elevation <= seaLevel) {
        // Calculate the absolute bottom of the coastal shelf, preventing negative values
        const coastalShelfBottom = Math.max(0, seaLevel - 0.05);

        if (elevation < coastalShelfBottom) return "ocean";
        return "coast";
    }

    // 3. Extreme Elevation Overrides
    if (elevation >= 0.8) return "peak";
    if (elevation >= 0.65) return "mountain";

    // 4. The Whittaker Climate Matrix
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
