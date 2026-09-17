export class ColorMath {
    /**
     * Converts an `[r, g, b]` array (0-255 per channel) into a "#rrggbb" hex string. Used
     * wherever a colour stored as an RGB array (biome palette entries, Custom Biome colours)
     * needs to feed a native `<input type="color">` value or a CSS `background-color` in a
     * Handlebars template.
     */
    static rgbToHex(rgb) {
        return "#" + rgb.map((component) => component.toString(16).padStart(2, "0")).join("");
    }

    /**
     * The inverse of `rgbToHex` - reads a "#rrggbb" hex string, as returned by a native colour
     * input, back into an `[r, g, b]` array.
     */
    static hexToRgb(hex) {
        return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
    }

    /**
     * Converts a "#rrggbb" hex string into the packed `0xrrggbb` integer PIXI's Graphics API
     * expects for `lineStyle`/`beginFill`/etc. colour arguments (routes, regions, tectonic
     * faults, and the cartography border all render this way in StudioCanvas).
     */
    static hexToPackedInt(hex) {
        return Number.parseInt(hex.replace("#", ""), 16);
    }

    /**
     * The inverse of `hexToPackedInt` - converts a packed `0xrrggbb` integer (as used by PIXI)
     * back into a "#rrggbb" hex string, for contexts that need a CSS colour string instead (e.g.
     * the 2D canvas API used to generate StudioCanvas's hatch-fill textures).
     */
    static packedIntToHex(colorInt) {
        return "#" + colorInt.toString(16).padStart(6, "0");
    }

    /**
     * Given a "#rrggbb" background colour, returns whichever of "#ffffff"/"#000000" reads more
     * clearly on top of it, using the standard perceived-luminance formula. Used wherever text
     * or an icon is drawn over a colour that varies at runtime (label strokes on StudioCanvas,
     * biome swatches in the brush toolbar) rather than over a fixed, designed background.
     */
    static getContrastColor(hex) {
        const cleanHex = String(hex).replace("#", "");
        if (cleanHex.length !== 6) return "#000000";

        const [r, g, b] = ColorMath.hexToRgb(`#${cleanHex}`);
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        return luma < 128 ? "#ffffff" : "#000000";
    }
}
