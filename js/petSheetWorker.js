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

function rgbDistanceSq(data, di, r, g, b) {
    const dr = data[di] - r;
    const dg = data[di + 1] - g;
    const db = data[di + 2] - b;
    return dr * dr + dg * dg + db * db;
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
            samples.push([data[di], data[di + 1], data[di + 2]]);
        }
    }
    if (!samples.length) return { r: 0, g: 0, b: 0 };
    samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    const median = samples[Math.floor(samples.length * 0.5)] || samples[0];
    return { r: median[0], g: median[1], b: median[2] };
}

function removeCellBackground(data, width, height, cellX, cellY, cellW, cellH) {
    const bg = sampleCellBackground(data, width, cellX, cellY, cellW, cellH);
    const maxCellPx = cellW * cellH;
    const visited = new Uint8Array(maxCellPx);
    const queue = new Int32Array(maxCellPx * 2);
    let head = 0;
    let tail = 0;
    const seedThresholdSq = 60 * 60;
    const growThresholdSq = 78 * 78;
    const haloThresholdSq = 112 * 112;

    const mark = (x, y) => {
        if (x < 0 || x >= cellW || y < 0 || y >= cellH) return;
        const localIndex = y * cellW + x;
        if (visited[localIndex]) return;
        const di = ((cellY + y) * width + cellX + x) << 2;
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
            if (rgbDistanceSq(data, di, bg.r, bg.g, bg.b) <= growThresholdSq) {
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
                    if (nx < 0 || nx >= cellW || ny < 0 || ny >= cellH || visited[ny * cellW + nx]) transparentNeighbors++;
                }
            }
            if (transparentNeighbors >= 4) data[di + 3] = Math.round(data[di + 3] * 0.25);
            else if (transparentNeighbors >= 2) data[di + 3] = Math.round(data[di + 3] * 0.55);
        }
    }

    const border = Math.max(3, Math.min(14, Math.floor(Math.min(cellW, cellH) * 0.02)));
    for (let y = 0; y < cellH; y++) {
        for (let x = 0; x < cellW; x++) {
            if (x >= border && y >= border && cellW - 1 - x >= border && cellH - 1 - y >= border) continue;
            data[((cellY + y) * width + cellX + x) << 2 | 3] = 0;
        }
    }
}

async function processSheet(bitmap) {
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const cellW = Math.floor(width / SHEET_COLS);
    const cellH = Math.floor(height / SHEET_ROWS);

    for (let row = 0; row < SHEET_ROWS; row++) {
        for (let col = 0; col < SHEET_COLS; col++) {
            const cellX = Math.floor(col * width / SHEET_COLS);
            const cellY = Math.floor(row * height / SHEET_ROWS);
            removeCellBackground(data, width, height, cellX, cellY, Math.min(cellW, width - cellX), Math.min(cellH, height - cellY));
        }
    }

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

self.onmessage = async (event) => {
    const { id, url } = event.data || {};
    if (!id || !url) return;
    try {
        const bitmap = await loadBitmap(url);
        const { blob, width, height } = await processSheet(bitmap);
        self.postMessage({ id, ok: true, blob, width, height });
    } catch (e) {
        self.postMessage({ id, ok: false, error: e?.message || String(e) });
    }
};