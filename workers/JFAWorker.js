/**
 * Dedicated Web Worker for asynchronous Jump Flood Algorithm (JFA) execution.
 * Calculates exact Signed Distance Fields without blocking the main rendering thread.
 */
self.onmessage = function (event) {
    const { width, height, validMasks } = event.data;

    if (!validMasks || validMasks.length === 0) {
        self.postMessage({ error: "No valid masks provided to JFA Worker." });
        return;
    }

    const distanceField = generateJFADistanceField(width, height, validMasks);

    // Return the Float32Array to the main thread using Transferable Objects
    // This transfers memory ownership directly (zero-copy), operating near instantaneously.
    self.postMessage({ distanceField: distanceField }, [distanceField.buffer]);
};

/**
 * Generates the JFA distance field, utilising a pre-calculated ownership
 * grid to completely eliminate redundant point-in-polygon ray-casting.
 */
function generateJFADistanceField(width, height, validMasks) {
    const totalPixels = width * height;
    let seedGrid = new Int32Array(totalPixels * 2).fill(-1);
    const distanceGrid = new Float32Array(totalPixels);

    // 1. Pre-calculate land/ocean ownership exactly once per pixel
    const ownershipGrid = generateOwnershipGrid(width, height, validMasks);

    // 2. Pass the cached ownership grid to the boundary initialiser
    initialiseJFABoundaries(seedGrid, ownershipGrid, width, height);

    let step = Math.max(width, height) / 2;
    while (step >= 1) {
        step = Math.floor(step);
        seedGrid = executeJFAPass(seedGrid, width, height, step);
        step /= 2;
    }

    // Final two passes to ensure convergence "JFA+1"/"JFA+2"
    seedGrid = executeJFAPass(seedGrid, width, height, 1);
    seedGrid = executeJFAPass(seedGrid, width, height, 1);

    // 3. Pass the cached ownership grid to the final resolver
    resolveAbsoluteDistances(seedGrid, distanceGrid, ownershipGrid, width, height);

    return distanceGrid;
}

/**
 * Creates a flat, memory-efficient binary map of land/ocean ownership.
 */
function generateOwnershipGrid(width, height, validMasks) {
    const grid = new Uint8Array(width * height);
    const compiledMasks = compileMaskData(validMasks);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            grid[y * width + x] = resolvePixelOwnership(x, y, compiledMasks);
        }
    }

    return grid;
}

/**
 * Converts an array of coordinate objects into a flat Float32Array and calculates bounding boxes.
 * This prepares the mask data for high-speed, cache-friendly iteration.
 */
function compileMaskData(validMasks) {
    const compiledMasks = [];

    for (const mask of validMasks) {
        const vertexCount = mask.points.length;
        const flatCoordinates = new Float32Array(vertexCount * 2);
        const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

        for (let i = 0; i < vertexCount; i++) {
            const ptX = mask.points[i].x;
            const ptY = mask.points[i].y;

            flatCoordinates[i * 2] = ptX;
            flatCoordinates[i * 2 + 1] = ptY;

            if (ptX < bounds.minX) bounds.minX = ptX;
            if (ptY < bounds.minY) bounds.minY = ptY;
            if (ptX > bounds.maxX) bounds.maxX = ptX;
            if (ptY > bounds.maxY) bounds.maxY = ptY;
        }

        compiledMasks.push({
            isAddOperation: mask.operation !== "subtract",
            coordinates: flatCoordinates,
            vertexCount: vertexCount,
            bounds: bounds,
        });
    }

    return compiledMasks;
}

/**
 * Evaluates a single pixel against all compiled masks, returning 1 for land or 0 for ocean.
 */
function resolvePixelOwnership(x, y, compiledMasks) {
    let isInside = false;

    for (const mask of compiledMasks) {
        if (isOutsideBounds(x, y, mask.bounds)) {
            continue;
        }

        if (isPointInCompiledPolygon(x, y, mask.coordinates, mask.vertexCount)) {
            isInside = mask.isAddOperation;
        }
    }

    return isInside ? 1 : 0;
}

/**
 * Bounding box short-circuit to bypass expensive floating-point math for pixels
 * entirely outside the polygon's footprint.
 */
function isOutsideBounds(x, y, bounds) {
    return x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY;
}

/**
 * Highly optimised ray-casting algorithm operating directly on a flat Float32Array.
 * Eliminates object property lookups in the innermost loop and flattens conditions.
 */
function isPointInCompiledPolygon(x, y, coordinates, vertexCount) {
    let isInside = false;

    for (let i = 0, j = vertexCount - 1; i < vertexCount; j = i++) {
        const indexI = i * 2;
        const indexJ = j * 2;

        const xi = coordinates[indexI];
        const yi = coordinates[indexI + 1];
        const xj = coordinates[indexJ];
        const yj = coordinates[indexJ + 1];

        const crossesY = yi > y !== yj > y;
        if (!crossesY) {
            continue;
        }

        const intersectX = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (x < intersectX) {
            isInside = !isInside;
        }
    }

    return isInside;
}

/**
 * Identifies boundary pixels using O(1) lookups against the cached ownership grid.
 */
function initialiseJFABoundaries(seedGrid, ownershipGrid, width, height) {
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = y * width + x;

            const isInside = ownershipGrid[index] === 1;
            const isRightInside = x < width - 1 ? ownershipGrid[index + 1] === 1 : isInside;
            const isBelowInside = y < height - 1 ? ownershipGrid[index + width] === 1 : isInside;

            if (isInside !== isRightInside || isInside !== isBelowInside) {
                const seedIndex = index * 2;
                seedGrid[seedIndex] = x;
                seedGrid[seedIndex + 1] = y;
            }
        }
    }
}

function executeJFAPass(inputGrid, width, height, step) {
    const outputGrid = new Int32Array(inputGrid.length);
    outputGrid.set(inputGrid);
    const offsets = [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
    ];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            processSingleJFAPixel(x, y, width, height, step, inputGrid, outputGrid, offsets);
        }
    }
    return outputGrid;
}

function processSingleJFAPixel(x, y, width, height, step, inputGrid, outputGrid, offsets) {
    const currentIndex = (y * width + x) * 2;
    let bestDist = Infinity;
    let bestX = inputGrid[currentIndex];
    let bestY = inputGrid[currentIndex + 1];

    if (bestX !== -1) {
        bestDist = calculateSquaredDistance(x, y, bestX, bestY);
    }

    for (const [dx, dy] of offsets) {
        const nx = x + dx * step;
        const ny = y + dy * step;

        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const neighbourIndex = (ny * width + nx) * 2;
            const seedX = inputGrid[neighbourIndex];
            const seedY = inputGrid[neighbourIndex + 1];

            if (seedX !== -1 && seedY !== -1) {
                const dist = calculateSquaredDistance(x, y, seedX, seedY);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestX = seedX;
                    bestY = seedY;
                }
            }
        }
    }

    outputGrid[currentIndex] = bestX;
    outputGrid[currentIndex + 1] = bestY;
}

/**
 * Resolves final signed distances using O(1) lookups against the cached ownership grid.
 */
function resolveAbsoluteDistances(seedGrid, distanceGrid, ownershipGrid, width, height) {
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = y * width + x;
            const seedX = seedGrid[index * 2];
            const seedY = seedGrid[index * 2 + 1];

            let distance = 0;
            if (seedX !== -1 && seedY !== -1) {
                distance = Math.hypot(x - seedX, y - seedY);
            }

            const isInside = ownershipGrid[index] === 1;
            distanceGrid[index] = isInside ? distance : -distance;
        }
    }
}

function calculateSquaredDistance(x1, y1, x2, y2) {
    return (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
}
