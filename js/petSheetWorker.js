// === 透明化处理：完整克隆 MapCopilot/TerrainTileManager.createBorderedTexture 的管线 ===
//
// 步骤（按格子单独处理，每格 = 4×4 sprite sheet 中的一格）：
//   STEP 0  预计算每像素 L (lightness) 和 S (saturation)，全图共享
//   STEP 1  HSL flood-fill 背景去除（从格子边缘暗 + 低饱和像素 BFS 向内扩张）
//   STEP 1b 块网格 flood-fill（3×3 像素块按平均亮度二次抠图，带 brightness guard）
//   STEP 1c 自适应背景色光晕清理（按采样出的真实背景色移除残边）
//   STEP 2  剥掉格子之间的网格边缘条带（防止 LLM 误生成的细线）
//   STEP 3  迭代轮廓侵蚀（针对暗 + 低饱和的描边墨线，4 pass 渐进阈值）
//   STEP 4  边缘软化（按 8 邻域透明像素数量做 alpha fade，得到抗锯齿）
//   STEP 5  小连通块清理（去掉残留的杂点 / 噪声）
//
// 与原版的差别：
//   - 不做 ellipseClip / groundOffset（宠物精灵不需要"立在地面"的椭圆裁剪）
//   - 不缓存 borderedTexture（这里的 _processed Map 已经在外层做了同样的事）

const SHEET_COLS = 4;
const SHEET_ROWS = 4;
const TRANSPARENT_CORNER_SAMPLE_SIZE = 3;
const DEFAULT_GRID_LINE_RATIO = 0.045;
const DEFAULT_GRID_LINE_MAX_WIDTH = 18;
const CENTER_ALPHA_THRESHOLD = 12;

function getSheetGrid(options = {}) {
    const cols = Math.max(1, Math.min(16, Math.round(Number(options.sheetCols) || SHEET_COLS)));
    const rows = Math.max(1, Math.min(16, Math.round(Number(options.sheetRows) || SHEET_ROWS)));
    return { cols, rows };
}

function areCornersFullyTransparent(data, width, height) {
    if (!data || width <= 0 || height <= 0) return false;
    const sample = Math.max(1, Math.min(TRANSPARENT_CORNER_SAMPLE_SIZE, width, height));
    const corners = [
        { x0: 0, y0: 0 },
        { x0: width - sample, y0: 0 },
        { x0: 0, y0: height - sample },
        { x0: width - sample, y0: height - sample },
    ];
    for (const corner of corners) {
        for (let y = 0; y < sample; y++) {
            for (let x = 0; x < sample; x++) {
                const alpha = data[((corner.y0 + y) * width + corner.x0 + x) << 2 | 3];
                if (alpha !== 0) return false;
            }
        }
    }
    return true;
}

function rgbDistanceSq(data, di, r, g, b) {
    const dr = data[di] - r;
    const dg = data[di + 1] - g;
    const db = data[di + 2] - b;
    return dr * dr + dg * dg + db * db;
}

function resolveGridLineWidth(width, height, options = {}) {
    const explicitWidth = Number(options.gridLineWidth);
    if (Number.isFinite(explicitWidth) && explicitWidth >= 0) return Math.min(DEFAULT_GRID_LINE_MAX_WIDTH, Math.round(explicitWidth));
    const ratio = Number.isFinite(Number(options.gridLineRatio)) ? Number(options.gridLineRatio) : DEFAULT_GRID_LINE_RATIO;
    const { cols, rows } = getSheetGrid(options);
    const approxCell = Math.min(width / cols, height / rows);
    return Math.max(3, Math.min(DEFAULT_GRID_LINE_MAX_WIDTH, Math.ceil(approxCell * ratio)));
}

function clearAlphaBand(data, width, height, x0, y0, x1, y1) {
    const left = Math.max(0, Math.floor(x0));
    const top = Math.max(0, Math.floor(y0));
    const right = Math.min(width, Math.ceil(x1));
    const bottom = Math.min(height, Math.ceil(y1));
    for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
            data[(y * width + x) << 2 | 3] = 0;
        }
    }
}

function clearGridLineBands(data, width, height, options = {}) {
    const { cols, rows } = getSheetGrid(options);
    const lineWidth = resolveGridLineWidth(width, height, options);
    if (lineWidth <= 0) return;
    const half = Math.max(1, Math.ceil(lineWidth / 2));
    for (let col = 1; col < cols; col++) {
        const x = Math.round(col * width / cols);
        clearAlphaBand(data, width, height, x - half, 0, x + half + 1, height);
    }
    for (let row = 1; row < rows; row++) {
        const y = Math.round(row * height / rows);
        clearAlphaBand(data, width, height, 0, y - half, width, y + half + 1);
    }
}

function transformSheetCells(data, width, height, options = {}) {
    const { cols, rows } = getSheetGrid(options);
    const source = new Uint8ClampedArray(data);
    const output = new Uint8ClampedArray(data.length);
    const transforms = new Map((Array.isArray(options.cellTransforms) ? options.cellTransforms : [])
        .map(transform => [Math.round(Number(transform?.index)), transform])
        .filter(([index]) => index >= 0 && index < cols * rows));
    const claimedBy = new Int16Array(width * height);
    claimedBy.fill(-1);

    const getBleed = transform => {
        const fallback = Math.max(0, Math.round(Number(transform?.bleed) || 0));
        return {
            left: Math.max(0, Math.round(Number(transform?.bleedLeft) || fallback)),
            top: Math.max(0, Math.round(Number(transform?.bleedTop) || fallback)),
            right: Math.max(0, Math.round(Number(transform?.bleedRight) || fallback)),
            bottom: Math.max(0, Math.round(Number(transform?.bleedBottom) || fallback)),
        };
    };

    for (const [index, transform] of transforms) {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const cellX = Math.floor(col * width / cols);
        const cellY = Math.floor(row * height / rows);
        const nextCellX = Math.floor((col + 1) * width / cols);
        const nextCellY = Math.floor((row + 1) * height / rows);
        const bleed = getBleed(transform);
        for (let y = Math.max(0, cellY - bleed.top); y < Math.min(height, nextCellY + bleed.bottom); y++) {
            for (let x = Math.max(0, cellX - bleed.left); x < Math.min(width, nextCellX + bleed.right); x++) {
                const pixelIndex = y * width + x;
                if (source[pixelIndex << 2 | 3] > CENTER_ALPHA_THRESHOLD) claimedBy[pixelIndex] = index;
            }
        }
    }

    for (let index = 0; index < cols * rows; index++) {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const cellX = Math.floor(col * width / cols);
        const cellY = Math.floor(row * height / rows);
        const nextCellX = Math.floor((col + 1) * width / cols);
        const nextCellY = Math.floor((row + 1) * height / rows);
        const cellW = nextCellX - cellX;
        const cellH = nextCellY - cellY;
        const transform = transforms.get(index);
        const bleed = getBleed(transform);
        const sourceX0 = Math.max(0, cellX - bleed.left);
        const sourceY0 = Math.max(0, cellY - bleed.top);
        const sourceX1 = Math.min(width, nextCellX + bleed.right);
        const sourceY1 = Math.min(height, nextCellY + bleed.bottom);
        let minX = nextCellX;
        let minY = nextCellY;
        let maxX = cellX - 1;
        let maxY = cellY - 1;

        for (let y = sourceY0; y < sourceY1; y++) {
            for (let x = sourceX0; x < sourceX1; x++) {
                const pixelIndex = y * width + x;
                const owner = claimedBy[pixelIndex];
                if (source[pixelIndex << 2 | 3] <= CENTER_ALPHA_THRESHOLD || (owner >= 0 && owner !== index)) continue;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
        if (maxX < minX || maxY < minY) continue;

        const autoCenter = transform?.autoCenter ?? (options.autoCenter !== false);
        const autoOffsetX = autoCenter ? Math.round((cellX + nextCellX - 1 - minX - maxX) / 2) : 0;
        const autoOffsetY = autoCenter ? Math.round((cellY + nextCellY - 1 - minY - maxY) / 2) : 0;
        const manualOffsetX = Math.round(Number(transform?.offsetX) || 0);
        const manualOffsetY = Math.round(Number(transform?.offsetY) || 0);
        const offsetX = autoOffsetX + manualOffsetX;
        const offsetY = autoOffsetY + manualOffsetY;

        for (let y = sourceY0; y < sourceY1; y++) {
            const targetY = y + offsetY;
            if (targetY < cellY || targetY >= nextCellY) continue;
            for (let x = sourceX0; x < sourceX1; x++) {
                const targetX = x + offsetX;
                if (targetX < cellX || targetX >= nextCellX) continue;
                const pixelIndex = y * width + x;
                const owner = claimedBy[pixelIndex];
                const sourceIndex = pixelIndex << 2;
                if (source[sourceIndex + 3] === 0 || (owner >= 0 && owner !== index)) continue;
                const targetIndex = (targetY * width + targetX) << 2;
                output[targetIndex] = source[sourceIndex];
                output[targetIndex + 1] = source[sourceIndex + 1];
                output[targetIndex + 2] = source[sourceIndex + 2];
                output[targetIndex + 3] = source[sourceIndex + 3];
            }
        }
    }
    data.set(output);
}

function hasOpaqueInternalGridBands(data, width, height, options = {}) {
    const { cols, rows } = getSheetGrid(options);
    const lineWidth = Math.max(3, resolveGridLineWidth(width, height, options));
    const half = Math.max(1, Math.ceil(lineWidth / 2));
    const alphaThreshold = 12;
    const opaqueRatioThreshold = 0.08;
    const measure = (x0, y0, x1, y1) => {
        const left = Math.max(0, Math.floor(x0));
        const top = Math.max(0, Math.floor(y0));
        const right = Math.min(width, Math.ceil(x1));
        const bottom = Math.min(height, Math.ceil(y1));
        let total = 0;
        let opaque = 0;
        const step = Math.max(1, Math.floor(Math.max(right - left, bottom - top) / 160));
        for (let y = top; y < bottom; y += step) {
            for (let x = left; x < right; x += step) {
                total++;
                if (data[(y * width + x) << 2 | 3] > alphaThreshold) opaque++;
            }
        }
        return total > 0 && opaque / total >= opaqueRatioThreshold;
    };
    for (let col = 1; col < cols; col++) {
        const x = Math.round(col * width / cols);
        if (measure(x - half, 0, x + half + 1, height)) return true;
    }
    for (let row = 1; row < rows; row++) {
        const y = Math.round(row * height / rows);
        if (measure(0, y - half, width, y + half + 1)) return true;
    }
    return false;
}

function sampleCellBackground(data, width, cellX, cellY, cellW, cellH) {
    const samples = [];
    const edge = Math.max(4, Math.min(18, Math.round(Math.min(cellW, cellH) * 0.045)));
    const step = Math.max(1, Math.floor(Math.min(cellW, cellH) / 96));
    for (let y = 0; y < cellH; y += step) {
        for (let x = 0; x < cellW; x += step) {
            const onEdge = x < edge || y < edge || cellW - 1 - x < edge || cellH - 1 - y < edge;
            if (!onEdge) continue;
            const di = ((cellY + y) * width + cellX + x) << 2;
            if (data[di + 3] < 16) continue;
            samples.push([data[di], data[di + 1], data[di + 2]]);
        }
    }
    if (!samples.length) return { r: 0, g: 0, b: 0 };
    samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    const median = samples[Math.floor(samples.length * 0.5)] || samples[0];
    return { r: median[0], g: median[1], b: median[2] };
}

function removeCellBackground(data, width, height, cellX, cellY, cellW, cellH, options = {}) {
    const bg = sampleCellBackground(data, width, cellX, cellY, cellW, cellH);
    const maxCellPx = cellW * cellH;
    const visited = new Uint8Array(maxCellPx);
    const queue = new Int32Array(maxCellPx * 2);
    let head = 0;
    let tail = 0;
    const seedThreshold = Number(options.seedThreshold) || 60;
    const growThreshold = Number(options.growThreshold) || 78;
    const haloThreshold = Number(options.haloThreshold) || 112;
    const borderRatio = Number.isFinite(Number(options.borderRatio)) ? Number(options.borderRatio) : 0.02;
    const seedThresholdSq = seedThreshold * seedThreshold;
    const growThresholdSq = growThreshold * growThreshold;
    const haloThresholdSq = haloThreshold * haloThreshold;

    const mark = (x, y) => {
        if (x < 0 || x >= cellW || y < 0 || y >= cellH) return;
        const localIndex = y * cellW + x;
        if (visited[localIndex]) return;
        const di = ((cellY + y) * width + cellX + x) << 2;
        if (data[di + 3] === 0) {
            visited[localIndex] = 1;
            queue[tail++] = x;
            queue[tail++] = y;
            return;
        }
        if (rgbDistanceSq(data, di, bg.r, bg.g, bg.b) > seedThresholdSq) return;
        visited[localIndex] = 1;
        queue[tail++] = x;
        queue[tail++] = y;
    };

    for (let x = 0; x < cellW; x++) {
        mark(x, 0);
        mark(x, cellH - 1);
    }
    for (let y = 1; y < cellH - 1; y++) {
        mark(0, y);
        mark(cellW - 1, y);
    }

    while (head < tail) {
        const x = queue[head++];
        const y = queue[head++];
        const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const [nx, ny] of neighbors) {
            if (nx < 0 || nx >= cellW || ny < 0 || ny >= cellH) continue;
            const localIndex = ny * cellW + nx;
            if (visited[localIndex]) continue;
            const di = ((cellY + ny) * width + cellX + nx) << 2;
            if (data[di + 3] === 0 || rgbDistanceSq(data, di, bg.r, bg.g, bg.b) <= growThresholdSq) {
                visited[localIndex] = 1;
                queue[tail++] = nx;
                queue[tail++] = ny;
            }
        }
    }

    for (let y = 0; y < cellH; y++) {
        for (let x = 0; x < cellW; x++) {
            const di = ((cellY + y) * width + cellX + x) << 2;
            if (visited[y * cellW + x]) {
                data[di + 3] = 0;
                continue;
            }
            const distSq = rgbDistanceSq(data, di, bg.r, bg.g, bg.b);
            if (distSq > haloThresholdSq) continue;
            let transparentNeighbors = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || nx >= cellW || ny < 0 || ny >= cellH || visited[ny * cellW + nx]) {
                        transparentNeighbors++;
                        continue;
                    }
                    const ni = ((cellY + ny) * width + cellX + nx) << 2;
                    if (data[ni + 3] === 0) transparentNeighbors++;
                }
            }
            if (transparentNeighbors >= 4) data[di + 3] = Math.round(data[di + 3] * 0.25);
            else if (transparentNeighbors >= 2) data[di + 3] = Math.round(data[di + 3] * 0.55);
        }
    }

    const border = Math.max(0, Math.min(24, Math.floor(Math.min(cellW, cellH) * borderRatio)));
    for (let y = 0; y < cellH; y++) {
        for (let x = 0; x < cellW; x++) {
            if (x >= border && y >= border && cellW - 1 - x >= border && cellH - 1 - y >= border) continue;
            data[((cellY + y) * width + cellX + x) << 2 | 3] = 0;
        }
    }
}

async function processSheet(bitmap, options = {}) {
    const width = bitmap.width;
    const height = bitmap.height;
    const { cols, rows } = getSheetGrid(options);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    const shouldCenter = options.autoCenter !== false || (Array.isArray(options.cellTransforms) && options.cellTransforms.length > 0);
    if (!shouldCenter && areCornersFullyTransparent(data, width, height) && !hasOpaqueInternalGridBands(data, width, height, options)) {
        return { direct: true, width, height };
    }

    const alreadyTransparent = areCornersFullyTransparent(data, width, height);
    if (!alreadyTransparent || hasOpaqueInternalGridBands(data, width, height, options)) clearGridLineBands(data, width, height, options);

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const cellX = Math.floor(col * width / cols);
            const cellY = Math.floor(row * height / rows);
            const nextCellX = Math.floor((col + 1) * width / cols);
            const nextCellY = Math.floor((row + 1) * height / rows);
            const cellW = nextCellX - cellX;
            const cellH = nextCellY - cellY;
            if (!alreadyTransparent) removeCellBackground(data, width, height, cellX, cellY, cellW, cellH, options);
        }
    }
    if (shouldCenter) transformSheetCells(data, width, height, options);

    ctx.putImageData(imageData, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { blob, width, height };
}

async function loadBitmap(url) {
    if (typeof createImageBitmap !== 'function') throw new Error('createImageBitmap is not available in worker');
    const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) throw new Error(`image fetch failed: ${response.status}`);
    const blob = await response.blob();
    return await createImageBitmap(blob);
}

async function loadBitmapFromBlob(blob) {
    if (typeof createImageBitmap !== 'function') throw new Error('createImageBitmap is not available in worker');
    return await createImageBitmap(blob);
}

self.onmessage = async (event) => {
    const { id, url, blob, options } = event.data || {};
    if (!id || (!url && !blob)) return;
    try {
        const bitmap = blob ? await loadBitmapFromBlob(blob) : await loadBitmap(url);
        const result = await processSheet(bitmap, options || {});
        self.postMessage({ id, ok: true, blob: result.blob, direct: !!result.direct, width: result.width, height: result.height });
    } catch (e) {
        self.postMessage({ id, ok: false, error: e?.message || String(e) });
    }
};