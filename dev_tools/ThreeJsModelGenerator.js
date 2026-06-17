/*
 * ThreeJsModelGenerator.js — Reusable core for the "3D Vibe DevTools" workflow.
 *
 * 输入：一段普通的 Three.js 建模源码（字符串）。约定：
 *   - 顶部 PARAMS 区：顶格的 `const name = number;  // 注释` 行 → 可拖动的真实参数。
 *   - 对象分段：每组对象前一行顶格注释 `// label 中文说明` → 用作对象名 + 高亮范围。
 *   - 零侵入：用 `scene.add(mesh)` 加入对象，无需任何探针调用。
 *
 * 输出：一个交互式控制器（挂载到 canvas），支持：
 *   - color-id picking：点击 3D 像素 → 反查对象 → 高亮源码块 + 抓取相关参数。
 *   - 实时调参：拖动滑块改写源码字面量并重建（改一处、动多处）。
 *   - 干净导出：getCurrentSource() 返回带最新参数值的纯净 Three.js 源码（无调试色注入）。
 *
 * 用法：
 *   const ctrl = createThreeModelEditor({ canvas, source, helpers, onPick, onSourceChange });
 *   ctrl.getCurrentSource();   // 导出
 *   ctrl.setSource(newSrc);    // 切换 snippet
 *   ctrl.destroy();
 *
 * THREE 直接在本模块内静态 import（keepwork CDN ESM），无需调用方传入、
 * 也无需在 HTML 里再用 <script> 引入。仍可通过 opts.THREE 覆盖。
 */

// Three.js as a static ES module import from the keepwork CDN. This makes the
// widget self-contained — the host HTML no longer needs a <script> tag or to
// pass a THREE instance in.
import * as THREE_DEFAULT from 'https://cdn.keepwork.com/npm/three@0.160.0/build/three.module.min.js';

/* ============================================================
 *  Source parsing helpers (pure, no THREE needed)
 * ============================================================ */

const PARAM_RE = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*;(?:\s*\/\/\s*(.*))?$/;

// 把源码顶部的 `const name = number; // comment` 解析为可调参数列表。
export function parseParams(source) {
	const lines = String(source || '').replace(/\n$/, '').split('\n');
	const params = Object.create(null);
	const order = [];
	lines.forEach((ln, i) => {
		const m = ln.match(PARAM_RE);
		if (!m) return;
		const name = m[1];
		const num = parseFloat(m[2]);
		const comment = (m[3] || '').trim();
		params[name] = { name, line: i + 1, orig: num, value: num, saved: num, comment };
		order.push(name);
	});
	return { params, order, lines };
}

function fmtNum(v) {
	return Number.isInteger(v) ? String(v) : String(+v.toFixed(3));
}

// 用当前参数值重建源码字符串：仅替换 PARAM 行上的字面量，保留变量名 + 注释。
export function buildSource(lines, params, order) {
	const out = lines.slice();
	for (const name of order) {
		const p = params[name];
		const ln = out[p.line - 1];
		out[p.line - 1] = ln.replace(PARAM_RE, (full, nm, _num, cm) =>
			'const ' + nm + ' = ' + fmtNum(p.value) + ';' + (cm !== undefined ? '  // ' + cm : ''));
	}
	return out.join('\n');
}

// 顶格 `// word ...` 注释 = 一个对象段的开始（跳过文件头）。
export function buildSectionRanges(lines, opts = {}) {
	const headerMark = opts.headerMark || /\.three\.js/;
	const sectionLines = [];
	lines.forEach((ln, i) => {
		if (/^\/\/\s*[A-Za-z]/.test(ln)) {
			if (headerMark.test(ln)) return;
			sectionLines.push(i + 1);
		}
	});
	const ranges = [];
	for (let k = 0; k < sectionLines.length; k++) {
		const start = sectionLines[k];
		const end = (k + 1 < sectionLines.length ? sectionLines[k + 1] - 1 : lines.length);
		ranges.push([start, end]);
	}
	return ranges;
}

// 某行往上最近的对象注释 → 标签（注释里第一个英文单词）。
export function labelForLine(lines, line) {
	for (let n = line; n >= 1; n--) {
		const s = (lines[n - 1] || '').trim();
		const m = s.match(/^\/\/\s*([A-Za-z][A-Za-z0-9_]*)/);
		if (m) return m[1];
	}
	return 'object';
}

/* ============================================================
 *  Lightweight syntax highlighting for the code panel
 * ============================================================ */

export function escapeHtml(s) {
	return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlightLine(raw) {
	let h = escapeHtml(raw);
	h = h.replace(/(\/\/.*)$/, '<span class="tok-c">$1</span>');
	if (h.includes('tok-c')) return h;
	h = h.replace(/(&#39;[^&]*?&#39;|'[^']*'|`[^`]*`)/g, '<span class="tok-s">$1</span>');
	h = h.replace(/\b(const|let|var|for|of|in|new|return|function|if|else|continue|break|while)\b/g, '<span class="tok-k">$1</span>');
	h = h.replace(/\b(scene|add|box|boxAt|circle|cyl|sphere|cone|torus|plane|mat|extrudeShape|hideFace|forEach|map|push|set|absarc|moveTo|lineTo)\b/g, '<span class="tok-f">$1</span>');
	h = h.replace(/\b(0x[0-9a-fA-F]+|\d+\.?\d*)\b/g, '<span class="tok-n">$1</span>');
	return h;
}

/* ============================================================
 *  Default geometry helpers exposed to user source code.
 *  调用方可通过 helpers 覆盖/扩展。
 * ============================================================ */

export function createDefaultHelpers(THREE, opts = {}) {
	const segHi = opts.lowPoly ? false : true;
	const mat = (color, rough = 0.7, metal = 0.05) =>
		new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
	const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
	const boxAt = (size, pos, m) => {
		const b = box(size[0], size[1], size[2], m);
		b.position.set(pos[0], pos[1], pos[2]);
		return b;
	};
	const cyl = (rt, rb, h, m, open = false) =>
		new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segHi ? 40 : 18, 1, open), m);
	const cone = (r, h, m) => new THREE.Mesh(new THREE.ConeGeometry(r, h, segHi ? 36 : 16), m);
	const sphere = (r, m) => new THREE.Mesh(new THREE.SphereGeometry(r, segHi ? 28 : 16, segHi ? 20 : 12), m);
	const circle = (r, m) => new THREE.Mesh(new THREE.CircleGeometry(r, segHi ? 56 : 24), m);
	const torus = (r, tube, m) => new THREE.Mesh(new THREE.TorusGeometry(r, tube, 12, segHi ? 40 : 18), m);
	const plane = (w, h, m) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
	const extrudeShape = (shape, depth, m) => {
		const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: segHi ? 30 : 14 });
		const mesh = new THREE.Mesh(g, m);
		mesh.rotation.x = Math.PI / 2;
		return mesh;
	};
	const hideFace = (material, faceIndex) => {
		const hidden = new THREE.MeshBasicMaterial({ visible: false, depthWrite: false });
		return [0, 1, 2, 3, 4, 5].map(i => (i === faceIndex ? hidden : material));
	};
	return { mat, box, boxAt, cyl, cone, sphere, circle, torus, plane, extrudeShape, hideFace };
}

/* ============================================================
 *  Main editor controller
 * ============================================================ */

export function createThreeModelEditor(config) {
	const {
		THREE = THREE_DEFAULT,   // defaults to the statically-imported keepwork ESM build
		canvas,
		source = '',
		helpers: helperOverrides = {},
		lowPoly = false,
		background = 0x223052,
		onPick = null,            // (meta|null, { relatedParams }) => void
		onSourceChange = null,    // (currentSource) => void
		onReady = null,
	} = config;

	if (!THREE) throw new Error('createThreeModelEditor requires a THREE module');
	if (!canvas) throw new Error('createThreeModelEditor requires a canvas');

	const IS_MOBILE = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;

	// ---- source state ----
	let lines = [];
	let params = Object.create(null);
	let paramOrder = [];
	let sectionRanges = [];
	let buildFn = null;

	function loadSource(src) {
		const parsed = parseParams(src);
		lines = parsed.lines;
		params = parsed.params;
		paramOrder = parsed.order;
		sectionRanges = buildSectionRanges(lines);
	}
	loadSource(source);

	function currentSource() {
		return buildSource(lines, params, paramOrder);
	}

	// ---- helpers passed to user source ----
	const helpers = { ...createDefaultHelpers(THREE, { lowPoly }), ...helperOverrides };

	// ---- renderer / scene ----
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	// Color management — works across Three.js versions:
	//   r152+  : renderer.outputColorSpace = THREE.SRGBColorSpace (default already sRGB)
	//   r128–r151: renderer.outputEncoding = THREE.sRGBEncoding (NOT default → must set,
	//             otherwise lighting/colors render in linear space and look washed-out/dark).
	if (THREE.SRGBColorSpace !== undefined && 'outputColorSpace' in renderer) {
		renderer.outputColorSpace = THREE.SRGBColorSpace;
	} else if (THREE.sRGBEncoding !== undefined) {
		renderer.outputEncoding = THREE.sRGBEncoding;
	}
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.4;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	const vh = () => Math.max(320, canvas.clientHeight || 320);
	const setSize = () => renderer.setSize(canvas.clientWidth, vh(), false);
	setSize();

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(background);
	scene.fog = new THREE.Fog(background, 22, 60);

	const camera = new THREE.PerspectiveCamera(42, canvas.clientWidth / vh(), 0.1, 200);
	const cam = { yaw: -0.6, pitch: 0.7, dist: 13.5, target: new THREE.Vector3(0, -0.2, 0) };
	const DIST_MIN = 3, DIST_MAX = 60, PITCH_MIN = 0.05, PITCH_MAX = 1.5;
	function updateCamera() {
		const hh = Math.cos(cam.pitch) * cam.dist;
		camera.position.set(
			cam.target.x + Math.sin(cam.yaw) * hh,
			cam.target.y + Math.sin(cam.pitch) * cam.dist,
			cam.target.z + Math.cos(cam.yaw) * hh);
		camera.lookAt(cam.target);
	}

	// ---- lights ----
	scene.add(new THREE.HemisphereLight(0xffffff, 0x53606e, 1.1));
	scene.add(new THREE.AmbientLight(0xffffff, 0.35));
	const key = new THREE.DirectionalLight(0xfff6df, 1.8);
	key.position.set(-4.8, 9.5, 5.8);
	key.castShadow = true;
	key.shadow.mapSize.set(2048, 2048);
	key.shadow.camera.near = 1;
	key.shadow.camera.far = 40;
	key.shadow.camera.left = -14;
	key.shadow.camera.right = 14;
	key.shadow.camera.top = 12;
	key.shadow.camera.bottom = -12;
	key.shadow.bias = -0.0004;
	scene.add(key);
	const fill = new THREE.DirectionalLight(0xbfe0ff, 0.85);
	fill.position.set(5.5, 6, -5);
	scene.add(fill);

	// ground (not pickable)
	const floor = new THREE.Mesh(
		new THREE.PlaneGeometry(80, 60),
		new THREE.MeshStandardMaterial({ color: 0x2b3550, roughness: 0.95 }));
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = -1.6;
	floor.receiveShadow = true;
	scene.add(floor);

	// ============================================================
	//  Color-injection picking infrastructure
	// ============================================================
	const group = new THREE.Group();
	scene.add(group);
	const pickGroup = new THREE.Group();
	const pickScene = new THREE.Scene();
	pickScene.add(pickGroup);
	pickScene.background = new THREE.Color(0x000000); // id 0 = nothing

	let nextId = 0;
	const idToMeta = new Map();
	const pickEntries = []; // { id, pickMat, exact }
	const labelSeq = Object.create(null);

	function idToColor(id) {
		return new THREE.Color(((id >> 16) & 255) / 255, ((id >> 8) & 255) / 255, (id & 255) / 255);
	}
	function colorToId(r, g, b) { return (r << 16) | (g << 8) | b; }
	function vizColor(id) {
		const c = new THREE.Color();
		c.setHSL((id * 0.61803398875) % 1, 0.85, 0.55);
		return c;
	}

	function registerMesh(mesh, line) {
		if (!mesh || !mesh.isMesh) return;
		const label = labelForLine(lines, line);
		const id = ++nextId;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		const pickMat = new THREE.MeshBasicMaterial({ color: vizColor(id) });
		const pm = new THREE.Mesh(mesh.geometry, pickMat);
		pm.position.copy(mesh.position);
		pm.quaternion.copy(mesh.quaternion);
		pm.scale.copy(mesh.scale);
		pickGroup.add(pm);
		pickEntries.push({ id, pickMat, exact: idToColor(id) });
		const mats = [];
		const mm = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
		if (mm && mm.emissive) mats.push({ mat: mm });
		const seq = (labelSeq[label] = (labelSeq[label] || 0) + 1);
		idToMeta.set(id, { id, label: label + '_' + seq, baseLabel: label, line, mats, meshes: [mesh] });
	}

	function installPickHook(target) {
		const origAdd = target.add.bind(target);
		target.add = function (...objs) {
			const line = srcLineFromStack();
			const r = origAdd(...objs);
			for (const o of objs) if (o && o.isMesh) registerMesh(o, line);
			return r;
		};
		return () => { target.add = origAdd; };
	}

	let stackOffset = null;
	function srcLineFromStack() {
		const st = (new Error()).stack || '';
		const m = st.match(/threeModelSource\.js:(\d+):\d+/);
		if (!m) return null;
		const raw = parseInt(m[1], 10);
		if (stackOffset == null) {
			let firstAddLine = null;
			for (let i = 0; i < lines.length; i++) {
				if (/scene\.add\s*\(/.test(lines[i])) { firstAddLine = i + 1; break; }
			}
			if (firstAddLine != null) stackOffset = raw - firstAddLine;
		}
		return stackOffset != null ? raw - stackOffset : raw;
	}

	// ---- compile + run user source ----
	let buildError = null;
	function compile() {
		buildError = null;
		const argNames = ['THREE', 'IS_MOBILE', 'scene', ...Object.keys(helpers)];
		const argHelpers = Object.values(helpers);
		try {
			buildFn = new Function(...argNames, currentSource() + '\n//# sourceURL=threeModelSource.js');
			buildFn._args = argHelpers;
		} catch (e) {
			buildError = e;
			buildFn = null;
		}
	}

	function runBuild() {
		if (!buildFn) return;
		stackOffset = null;
		for (const k in labelSeq) delete labelSeq[k];
		const uninstall = installPickHook(group);
		try {
			buildFn(THREE, IS_MOBILE, group, ...buildFn._args);
		} catch (e) {
			buildError = e;
		} finally {
			uninstall();
		}
	}

	function disposeGroup() {
		while (group.children.length) {
			const c = group.children.pop();
			c.geometry && c.geometry.dispose();
		}
		while (pickGroup.children.length) {
			const c = pickGroup.children.pop();
			c.material && c.material.dispose();
		}
		idToMeta.clear();
		pickEntries.length = 0;
		nextId = 0;
	}

	function rebuild() {
		disposeGroup();
		compile();
		runBuild();
	}

	compile();
	runBuild();
	if (buildError && onReady) {/* surfaced via getError */ }

	// ============================================================
	//  Picking read (1x1 pixel from hidden id buffer)
	// ============================================================
	const pickTarget = new THREE.WebGLRenderTarget(1, 1);
	const pixel = new Uint8Array(4);
	function syncPick() {
		pickGroup.rotation.copy(group.rotation);
		pickGroup.position.copy(group.position);
	}

	function pickAt(clientX, clientY) {
		const rect = canvas.getBoundingClientRect();
		const ratio = renderer.getPixelRatio();
		const px = (clientX - rect.left) * ratio;
		const py = (clientY - rect.top) * ratio;
		const w = canvas.clientWidth * ratio;
		const h = vh() * ratio;
		syncPick();
		for (const e of pickEntries) e.pickMat.color.copy(e.exact);
		const prevTone = renderer.toneMapping;
		renderer.toneMapping = THREE.NoToneMapping;
		camera.setViewOffset(w, h, px, py, 1, 1);
		camera.updateProjectionMatrix();
		renderer.setRenderTarget(pickTarget);
		renderer.render(pickScene, camera);
		renderer.readRenderTargetPixels(pickTarget, 0, 0, 1, 1, pixel);
		camera.clearViewOffset();
		camera.updateProjectionMatrix();
		renderer.setRenderTarget(null);
		renderer.toneMapping = prevTone;
		for (const e of pickEntries) e.pickMat.color.copy(vizColor(e.id));
		const id = colorToId(pixel[0], pixel[1], pixel[2]);
		return idToMeta.get(id) || null;
	}

	// ---- block range + related params for a picked object ----
	function sectionForLine(line) {
		for (const [a, b] of sectionRanges) if (line >= a && line <= b) return [a, b];
		return null;
	}
	function blockRange(meta) {
		if (!meta || !meta.line) return null;
		return sectionForLine(meta.line);
	}
	function objectText(meta) {
		const r = blockRange(meta);
		if (!r) return '';
		return lines.slice(r[0] - 1, r[1]).join('\n');
	}
	function relatedParams(meta) {
		const text = objectText(meta);
		const set = new Set();
		if (!text) return set;
		for (const name of paramOrder) {
			if (new RegExp('\\b' + name + '\\b').test(text)) set.add(name);
		}
		return set;
	}

	// ---- ground-truth affected-object count per param ----
	const affected = Object.create(null);
	function sigOf(meta) {
		let s = '';
		for (const mesh of (meta.meshes || [])) {
			if (!mesh.geometry) { s += '|'; continue; }
			if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
			const bb = mesh.geometry.boundingBox;
			s += [mesh.position.x, mesh.position.y, mesh.position.z,
				bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z]
				.map(v => (+v).toFixed(3)).join(',') + '|';
		}
		return s;
	}
	function snapshotByLabel() {
		const map = Object.create(null);
		for (const m of idToMeta.values()) (map[m.label] || (map[m.label] = [])).push(sigOf(m));
		return map;
	}
	function measureAffected() {
		if (buildError) return;
		const base = snapshotByLabel();
		for (const name of paramOrder) {
			const p = params[name];
			const keep = p.value;
			p.value = keep + Math.max(Math.abs(keep) * 0.25, 0.15);
			rebuild();
			const now = snapshotByLabel();
			let n = 0;
			for (const label in base) {
				const a = base[label].join(';');
				const b = (now[label] || []).join(';');
				if (a !== b) n++;
			}
			affected[name] = n;
			p.value = keep;
		}
		rebuild();
	}
	measureAffected();

	// ============================================================
	//  Selection + highlight (emissive glow on selected meshes)
	// ============================================================
	let selectedLabel = null;
	function highlightSelectedMesh() {
		for (const m of idToMeta.values()) m.mats.forEach(({ mat }) => mat.emissive && mat.emissive.setHex(0x000000));
		if (!selectedLabel) return;
		for (const m of idToMeta.values()) {
			if (m.label === selectedLabel) m.mats.forEach(({ mat }) => mat.emissive && mat.emissive.setHex(0x123a55));
		}
	}
	function metaByLabel(label) {
		for (const m of idToMeta.values()) if (m.label === label) return m;
		return null;
	}
	function instanceInfo(meta) {
		if (!meta) return null;
		let total = 0, idx = 0;
		for (const m of idToMeta.values()) {
			if (m.baseLabel === meta.baseLabel) { total++; if (m.id <= meta.id) idx++; }
		}
		return { base: meta.baseLabel, idx, total };
	}
	function displayLabel(meta) {
		const info = instanceInfo(meta);
		if (!info) return meta ? meta.label : '';
		return info.total > 1 ? info.base + ' #' + info.idx + '/' + info.total : info.base;
	}

	function selectMeta(meta) {
		selectedLabel = meta ? meta.label : null;
		highlightSelectedMesh();
		if (onPick) {
			onPick(meta, {
				relatedParams: meta ? [...relatedParams(meta)] : [],
				range: blockRange(meta),
				displayLabel: meta ? displayLabel(meta) : '',
			});
		}
	}

	// ============================================================
	//  Pointer: orbit + pinch + click-pick
	// ============================================================
	const pointers = new Map();
	let gesture = null, downPos = null, moved = false, autoRotate = true;

	function onDown(e) {
		canvas.setPointerCapture?.(e.pointerId);
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		autoRotate = false;
		if (pointers.size === 1) {
			downPos = { x: e.clientX, y: e.clientY };
			moved = false;
			gesture = { type: 'rotate', x: e.clientX, y: e.clientY };
		} else if (pointers.size === 2) {
			const p = [...pointers.values()];
			gesture = { type: 'pinch', dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) };
		}
		e.preventDefault();
	}
	function onMove(e) {
		if (!pointers.has(e.pointerId)) return;
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (gesture?.type === 'rotate' && pointers.size === 1) {
			const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
			if (Math.hypot(dx, dy) > 3) moved = true;
			cam.yaw -= dx * 0.008;
			cam.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, cam.pitch + dy * 0.006));
			gesture.x = e.clientX;
			gesture.y = e.clientY;
			updateCamera();
		} else if (gesture?.type === 'pinch' && pointers.size === 2) {
			const p = [...pointers.values()];
			const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
			cam.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, cam.dist * (gesture.dist / d)));
			gesture.dist = d;
			moved = true;
			updateCamera();
		}
		e.preventDefault();
	}
	function onUp(e) {
		const wasSingle = pointers.size === 1;
		pointers.delete(e.pointerId);
		if (wasSingle && !moved && downPos) selectMeta(pickAt(downPos.x, downPos.y));
		gesture = pointers.size === 1
			? { type: 'rotate', x: [...pointers.values()][0].x, y: [...pointers.values()][0].y }
			: null;
		downPos = null;
	}
	function onWheel(e) {
		autoRotate = false;
		cam.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, cam.dist * (1 + Math.sign(e.deltaY) * 0.08)));
		updateCamera();
		e.preventDefault();
	}

	canvas.addEventListener('pointerdown', onDown);
	canvas.addEventListener('pointermove', onMove);
	canvas.addEventListener('pointerup', onUp);
	canvas.addEventListener('pointercancel', onUp);
	canvas.addEventListener('wheel', onWheel, { passive: false });

	function onResize() {
		camera.aspect = canvas.clientWidth / vh();
		camera.updateProjectionMatrix();
		setSize();
	}
	window.addEventListener('resize', onResize);

	// ============================================================
	//  Render loop
	// ============================================================
	let disposed = false;
	let showPick = false;
	let rafId = 0;
	updateCamera();
	function animate() {
		if (disposed) return;
		rafId = requestAnimationFrame(animate);
		if (autoRotate) { cam.yaw += 0.0025; updateCamera(); }
		if (showPick) { syncPick(); renderer.render(pickScene, camera); }
		else renderer.render(scene, camera);
	}
	animate();
	if (onReady) onReady();

	// ============================================================
	//  Public API
	// ============================================================
	return {
		// source
		getCurrentSource: currentSource,
		getOriginalLines: () => lines.slice(),
		setSource(src) {
			loadSource(src);
			selectedLabel = null;
			rebuild();
			measureAffected();
			if (onSourceChange) onSourceChange(currentSource());
		},
		getError: () => buildError,

		// params
		getParams: () => paramOrder.map(name => ({ ...params[name], affected: affected[name] || 0 })),
		getParamOrder: () => paramOrder.slice(),
		setParam(name, value) {
			if (!params[name]) return;
			params[name].value = Number(value);
			rebuild();
			highlightSelectedMesh();
			if (onSourceChange) onSourceChange(currentSource());
		},
		commitParams() {
			for (const name of paramOrder) params[name].saved = params[name].value;
			if (onSourceChange) onSourceChange(currentSource());
		},
		resetParams() {
			let any = false;
			for (const name of paramOrder) {
				if (Math.abs(params[name].value - params[name].saved) > 1e-9) any = true;
				params[name].value = params[name].saved;
			}
			if (any) { rebuild(); highlightSelectedMesh(); }
			if (onSourceChange) onSourceChange(currentSource());
			return any;
		},
		affectedCount: (name) => affected[name] || 0,
		relatedParamsForSelection() {
			const meta = metaByLabel(selectedLabel);
			return meta ? [...relatedParams(meta)] : [];
		},

		// selection
		getSelectedLabel: () => selectedLabel,
		clearSelection() { selectMeta(null); },

		// rendering modes
		setShowPick(v) { showPick = !!v; },
		isShowingPick: () => showPick,
		setAutoRotate(v) { autoRotate = !!v; },
		resize: onResize,

		// camera
		resetCamera() {
			cam.yaw = -0.6; cam.pitch = 0.7; cam.dist = 13.5;
			cam.target.set(0, -0.2, 0);
			autoRotate = true;
			updateCamera();
		},

		destroy() {
			disposed = true;
			cancelAnimationFrame(rafId);
			window.removeEventListener('resize', onResize);
			canvas.removeEventListener('pointerdown', onDown);
			canvas.removeEventListener('pointermove', onMove);
			canvas.removeEventListener('pointerup', onUp);
			canvas.removeEventListener('pointercancel', onUp);
			canvas.removeEventListener('wheel', onWheel);
			disposeGroup();
			pickTarget.dispose();
			renderer.dispose();
		},
	};
}

/* ============================================================
 *  Self-contained widget: mountThreeModelDevtools(container, opts)
 *  ------------------------------------------------------------
 *  把「前端 demo 同款 UI（深色霓虹风）+ 3 列布局（code | 3D | params）
 *  + color-id picking + 实时调参」整块注入到任意容器里——所有 HTML/CSS/JS
 *  都在本 .js 文件内，方便在不同页面复用。
 *
 *  用法：
 *    import { mountThreeModelDevtools } from './ThreeJsModelGenerator.js';
 *    const ui = await mountThreeModelDevtools(document.getElementById('host'), {
 *      source: '// model.three.js ...',      // 初始源码（可选）
 *      filename: 'model.three.js',           // 标题栏文件名（可选）
 *      THREE,                                // 可传入已加载的 THREE（可选，否则自动从 CDN 加载）
 *      onSourceChange: (src) => {},          // 源码变化回调（参数编辑/保存）
 *      onPick: (meta, info) => {},           // 点选回调
 *    });
 *    ui.getCurrentSource();   // 导出当前（带最新参数）的纯净源码
 *    ui.setSource(newSrc, { filename });     // 切换源码
 *    ui.destroy();
 * ============================================================ */

const WIDGET_STYLE_ID = 'three-model-devtools-style';
const WIDGET_CSS = `
.tmd-root{--bg-900:#060914;--bg-800:#0b1020;--panel:rgba(20,28,54,.72);--panel-line:rgba(120,150,255,.18);--cyan:#2de2e6;--violet:#7b61ff;--amber:#ffb02e;--green:#3ddc84;--ink:#eaf0ff;--ink-soft:#9aa7d0;--ink-dim:#6b78a6;
  /* establish a size-query container so the layout responds to the host
     container's width, not the viewport (the widget can be embedded in a
     narrow column inside a wide page). */
  container-type:inline-size;container-name:tmd;
  /* In the wide (3-column) layout give the widget a self-contained bounded height
     (a share of the viewport) so the columns fill it and the params list scrolls
     inside its own column instead of growing the whole widget. The stacked
     container/media queries below reset this to height:auto so the page scrolls. */
  font-family:"PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;color:var(--ink);height:82vh;max-height:680px;min-height:520px;display:flex;flex-direction:column;}
.tmd-root *{box-sizing:border-box;}
/* thin custom scrollbars (Firefox + WebKit) */
.tmd-root,.tmd-root *{scrollbar-width:thin;scrollbar-color:rgba(123,150,255,.35) transparent;}
.tmd-root *::-webkit-scrollbar{width:8px;height:8px;}
.tmd-root *::-webkit-scrollbar-track{background:transparent;}
.tmd-root *::-webkit-scrollbar-thumb{background:rgba(123,150,255,.28);border-radius:999px;border:2px solid transparent;background-clip:padding-box;}
.tmd-root *::-webkit-scrollbar-thumb:hover{background:rgba(45,226,230,.5);background-clip:padding-box;}
.tmd-root *::-webkit-scrollbar-corner{background:transparent;}
.tmd-card{border:1px solid var(--panel-line);border-radius:18px;background:var(--panel);box-shadow:0 30px 60px -28px rgba(0,0,0,.8);overflow:hidden;backdrop-filter:blur(8px);flex:1 1 auto;min-height:0;display:flex;flex-direction:column;}
.tmd-bar{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--panel-line);flex-wrap:wrap;background:rgba(6,9,20,.35);}
.tmd-bar .histbtns{display:inline-flex;gap:4px;border:1px solid var(--panel-line);border-radius:8px;padding:3px;background:rgba(255,255,255,.03);}
/* !important resets so host base styles (e.g. Tailwind's global button rule with
   min-height/border/background/padding) can't turn these into white boxes. */
.tmd-bar .histbtns button{display:inline-flex!important;align-items:center;justify-content:center;width:28px!important;height:26px!important;min-height:0!important;padding:0!important;margin:0!important;border:none!important;background:transparent!important;color:var(--ink-soft)!important;cursor:pointer;border-radius:6px!important;line-height:1!important;box-shadow:none!important;transition:background .18s,color .18s;}
.tmd-bar .histbtns button:hover:not(:disabled){color:var(--ink)!important;background:rgba(45,226,230,.12)!important;}
.tmd-bar .histbtns button:disabled{opacity:.35;cursor:default;background:transparent!important;}
.tmd-bar .histbtns button svg{width:16px!important;height:16px!important;display:block!important;color:inherit;stroke:currentColor;}
.tmd-bar .file{font-size:12.5px;color:var(--ink-soft);font-family:"JetBrains Mono","Fira Code",Consolas,monospace;}
.tmd-bar .modepill{margin-left:auto;display:flex;gap:6px;align-items:center;font-size:11.5px;color:var(--ink-soft);}
.tmd-bar .sw{display:inline-flex;gap:4px;border:1px solid var(--panel-line);border-radius:999px;padding:3px;background:rgba(255,255,255,.03);}
.tmd-bar .sw button{border:none;background:transparent;color:var(--ink-soft);cursor:pointer;font-size:11px;padding:4px 10px;border-radius:999px;font-family:inherit;transition:background .2s,color .2s;}
.tmd-bar .sw button.active{color:#04121a;font-weight:700;background:linear-gradient(120deg,var(--cyan),var(--violet));}
.tmd-bar .act{border:1px solid var(--panel-line);background:rgba(255,255,255,.04);color:var(--ink-soft);cursor:pointer;font-size:11px;padding:5px 11px;border-radius:8px;font-family:inherit;transition:all .18s;}
.tmd-bar .act:hover{color:var(--ink);border-color:var(--cyan);}
.tmd-bar .act.save{color:#04121a;font-weight:700;border:none;background:linear-gradient(120deg,var(--green),#2bb673);}
.tmd-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.2fr) minmax(300px,.9fr);grid-auto-rows:minmax(0,1fr);flex:1 1 auto;min-height:0;}
.tmd-code{border-right:1px solid var(--panel-line);background:#070b18;overflow:hidden;min-height:0;height:100%;position:relative;display:flex;flex-direction:column;}
.tmd-code .tmd-cm-host{flex:1 1 auto;min-height:0;overflow:hidden;}
/* CodeMirror always-editable code panel */
.tmd-code .CodeMirror{height:100%;font-family:"JetBrains Mono","Fira Code",Consolas,monospace;font-size:12.5px;line-height:1.55;background:#070b18;}
.tmd-code .CodeMirror-gutters{background:#070b18;border-right:1px solid rgba(120,150,255,.08);}
.tmd-code .CodeMirror-linenumber{color:var(--ink-dim);opacity:.6;}
/* highlighted source range for the picked object */
.tmd-code .CodeMirror-line-hl{background:linear-gradient(90deg,rgba(45,226,230,.16),rgba(123,97,255,.10));box-shadow:inset 3px 0 0 var(--cyan);}
.tmd-code .CodeMirror-gutter-hl{color:var(--cyan)!important;opacity:1!important;}
.tmd-edit-bar{flex:0 0 auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;border-top:1px solid var(--panel-line);background:rgba(6,9,20,.6);}
.tmd-edit-hint{font-size:11px;color:var(--ink-dim);flex:1 1 auto;min-width:120px;}
.tmd-edit-hint.err{color:#ff6b6b;}
.tmd-view{position:relative;display:flex;flex-direction:column;border-right:1px solid var(--panel-line);}
.tmd-canvas{width:100%;flex:1;min-height:360px;display:block;cursor:crosshair;background:radial-gradient(circle at 50% 40%,#0e1530,#060914);}
.tmd-hud{position:absolute;top:12px;left:12px;right:12px;display:flex;gap:8px;flex-wrap:wrap;pointer-events:none;}
.tmd-hud .hint{font-size:11px;color:var(--cyan);background:rgba(6,9,20,.6);border:1px solid var(--panel-line);border-radius:999px;padding:4px 12px;backdrop-filter:blur(6px);}
.tmd-side{background:rgba(8,12,26,.45);display:flex;flex-direction:column;min-height:0;height:100%;overflow:hidden;}
.tmd-foot{padding:12px 16px;font-size:12.5px;color:var(--ink-soft);min-height:64px;display:flex;flex-direction:column;gap:6px;justify-content:center;flex:0 0 auto;}
.tmd-foot .row1{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.tmd-foot .pick{color:#04121a;font-weight:700;padding:3px 10px;border-radius:6px;font-size:11.5px;background:linear-gradient(120deg,var(--cyan),var(--violet));}
.tmd-foot code{color:var(--amber);font-family:"JetBrains Mono",monospace;}
.tmd-foot .ai{font-size:12px;color:var(--ink-soft);border-left:2px solid var(--violet);padding-left:10px;}
.tmd-foot .ai b{color:var(--ink);}
.tmd-params{border-top:1px solid var(--panel-line);padding:14px 16px;background:rgba(8,12,26,.55);flex:1 1 auto;min-height:0;overflow-y:auto;}
.tmd-params .pp-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;}
.tmd-params .pp-head .tag2{font-size:11.5px;font-weight:700;color:#04121a;padding:3px 10px;border-radius:6px;background:linear-gradient(120deg,var(--amber),#ff8a3d);}
.tmd-params .pp-head .who{font-size:12.5px;color:var(--ink-soft);}
.tmd-params .pp-head .who b{color:var(--ink);}
.tmd-params .pp-head .who code{color:var(--amber);font-family:"JetBrains Mono",monospace;}
.tmd-params .pp-grid{display:grid;grid-template-columns:1fr;gap:12px 18px;}
.tmd-row{display:flex;flex-direction:column;gap:5px;}
.tmd-row .pp-label{display:flex;justify-content:space-between;align-items:baseline;font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--ink-soft);}
.tmd-row .pp-label .k{color:var(--cyan);}
.tmd-row .pp-label .v{color:var(--amber);}
.tmd-row .pp-label .v.changed{color:var(--green);font-weight:700;}
.tmd-row.rel{padding:6px 8px;margin:-6px -8px;border-radius:8px;background:rgba(45,226,230,.06);box-shadow:inset 2px 0 0 var(--cyan);}
.tmd-row .rel-dot{color:var(--cyan);font-size:9px;font-style:normal;}
.tmd-row .pp-meta{font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--ink-dim);}
.tmd-row .pp-meta b{color:var(--amber);}
/* Use !important + explicit resets so host base styles (e.g. Tailwind's global
   input rule with min-height/border/background/padding) can't break the
   thin gradient track + round thumb. */
.tmd-row input[type=range]{-webkit-appearance:none!important;appearance:none!important;display:block;width:100%!important;height:5px!important;min-height:0!important;padding:0!important;margin:6px 0!important;border:none!important;border-radius:999px!important;background:linear-gradient(90deg,var(--cyan),var(--violet))!important;outline:none;cursor:pointer;box-shadow:none!important;}
.tmd-row input[type=range]:focus{outline:none;box-shadow:none!important;}
.tmd-row input[type=range]::-webkit-slider-runnable-track{-webkit-appearance:none;appearance:none;height:5px;border-radius:999px;background:transparent;border:none;}
.tmd-row input[type=range]::-moz-range-track{height:5px;border-radius:999px;background:transparent;border:none;}
.tmd-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none!important;appearance:none!important;width:15px;height:15px;margin-top:-5px;border-radius:50%;background:#eaf0ff;border:2px solid var(--violet);cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.5);}
.tmd-row input[type=range]::-moz-range-thumb{width:15px;height:15px;border-radius:50%;background:#eaf0ff;border:2px solid var(--violet);cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.5);}
.tmd-empty{font-size:12.5px;color:var(--ink-dim);padding:4px 0;}
.tmd-empty code{color:var(--amber);font-family:"JetBrains Mono",monospace;}
/* ---- container-query responsive (preferred: reacts to the host width) ----
   Keep the 3-column layout (code | 3D | params) as long as there's room — the
   2-column fallback only kicks in below 1000px, so a ~1180–1280px container
   still gets all three columns. Below 1000px we stack into 2 columns, and below
   640px into a single column. In every stacked mode each block is capped with a
   max-height (a share of the viewport) so the params list scrolls instead of
   running off the page. */
@container tmd (max-width:1000px){
  /* stacked layout: grow to natural height (no fixed-height clipping) and let the page scroll */
  .tmd-root{height:auto;max-height:none;min-height:0;}
  .tmd-card{flex:none;height:auto;}
  .tmd-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-auto-rows:auto;flex:none;min-height:0;}
  .tmd-code{height:auto;max-height:min(420px,55vh);}
  .tmd-side{grid-column:1 / -1;height:auto;border-top:1px solid var(--panel-line);overflow:hidden;}
  /* cap the params block height so a long params list scrolls inside the panel */
  .tmd-params{flex:none;min-height:0;max-height:min(420px,55vh);overflow-y:auto;}
  .tmd-params .pp-grid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));}
}
@container tmd (max-width:640px){
  .tmd-grid{grid-template-columns:1fr;}
  .tmd-code{border-right:none;border-bottom:1px solid var(--panel-line);height:auto;max-height:min(340px,45vh);}
  .tmd-view{border-right:none;}
  .tmd-params{max-height:min(360px,48vh);}
}
/* ---- viewport fallback for browsers without container-query support ---- */
@media (max-width:1000px){
  .tmd-root{height:auto;max-height:none;min-height:0;}
  .tmd-card{flex:none;height:auto;}
  .tmd-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-auto-rows:auto;flex:none;min-height:0;}
  .tmd-code{height:auto;max-height:min(420px,55vh);}
  .tmd-side{grid-column:1 / -1;height:auto;border-top:1px solid var(--panel-line);overflow:hidden;}
  .tmd-params{flex:none;min-height:0;max-height:min(420px,55vh);overflow-y:auto;}
  .tmd-params .pp-grid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));}
}
@media (max-width:640px){
  .tmd-grid{grid-template-columns:1fr;}
  .tmd-code{border-right:none;border-bottom:1px solid var(--panel-line);height:auto;max-height:min(340px,45vh);}
  .tmd-view{border-right:none;}
  .tmd-params{max-height:min(360px,48vh);}
}
`;

function ensureWidgetStyles(doc) {
	if (doc.getElementById(WIDGET_STYLE_ID)) return;
	const style = doc.createElement('style');
	style.id = WIDGET_STYLE_ID;
	style.textContent = WIDGET_CSS;
	doc.head.appendChild(style);
}

/* ============================================================
 *  CodeMirror 5 loader (classic <script>/<link>, global window.CodeMirror).
 *  Self-contained so this widget can be dropped into any page without an
 *  external config module. URLs default to the keepwork CDN mirror.
 * ============================================================ */
const CODEMIRROR_CDN = {
	css: 'https://cdn.keepwork.com/keepwork/cdn/vendor/codemirror/codemirror.min.css',
	theme: 'https://cdn.keepwork.com/keepwork/cdn/vendor/codemirror/material-darker.min.css',
	core: 'https://cdn.keepwork.com/keepwork/cdn/vendor/codemirror/codemirror.min.js',
	javascript: 'https://cdn.keepwork.com/keepwork/cdn/vendor/codemirror/javascript.min.js',
};

function loadStyleOnce(doc, href) {
	if (!href || doc.querySelector(`link[href="${href}"]`)) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const link = doc.createElement('link');
		link.rel = 'stylesheet';
		link.href = href;
		link.onload = resolve;
		link.onerror = reject;
		doc.head.appendChild(link);
	});
}

function loadScriptOnce(doc, src) {
	if (!src) return Promise.resolve();
	const existing = doc.querySelector(`script[src="${src}"]`);
	if (existing?.dataset.loaded === '1') return Promise.resolve();
	return new Promise((resolve, reject) => {
		if (existing) {
			existing.addEventListener('load', resolve, { once: true });
			existing.addEventListener('error', reject, { once: true });
			return;
		}
		const script = doc.createElement('script');
		script.src = src;
		script.onload = () => { script.dataset.loaded = '1'; resolve(); };
		script.onerror = reject;
		doc.head.appendChild(script);
	});
}

let _cmLoading = null;
async function loadCodeMirror(doc, cdn = {}) {
	const urls = { ...CODEMIRROR_CDN, ...cdn };
	if (window.CodeMirror) {
		await loadStyleOnce(doc, urls.css);
		await loadStyleOnce(doc, urls.theme);
		return window.CodeMirror;
	}
	if (!_cmLoading) {
		_cmLoading = (async () => {
			await Promise.all([loadStyleOnce(doc, urls.css), loadStyleOnce(doc, urls.theme)]);
			await loadScriptOnce(doc, urls.core);
			await loadScriptOnce(doc, urls.javascript);
			return window.CodeMirror || null;
		})();
	}
	return _cmLoading;
}

export async function mountThreeModelDevtools(container, opts = {}) {
	if (!container) throw new Error('mountThreeModelDevtools requires a container element');
	const doc = container.ownerDocument || document;
	ensureWidgetStyles(doc);

	const {
		THREE: providedTHREE = null,
		source = '',
		filename = 'model.three.js',
		showToolbarActions = true,    // 重置 / 保存 buttons in the title bar
		onSourceChange = null,
		onPick = null,
		lowPoly = false,
		background = 0x223052,
	} = opts;

	// THREE comes from the static module import by default; opts.THREE still wins.
	const THREE = providedTHREE || THREE_DEFAULT;

	// ---- build the widget DOM (front-page live-card layout) ----
	const root = doc.createElement('div');
	root.className = 'tmd-root';
	root.innerHTML = `
	<div class="tmd-card">
		<div class="tmd-bar">
			<span class="histbtns">
				<button data-tmd="undo" type="button" title="撤销 (Ctrl/⌘+Z)" disabled aria-label="撤销">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>
				</button>
				<button data-tmd="redo" type="button" title="重做 (Ctrl/⌘+Y)" disabled aria-label="重做">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>
				</button>
			</span>
			<span class="file" data-tmd="file">${escapeHtml(filename)}</span>
			<span class="modepill">
				<span class="sw">
					<button data-tmd="modeNormal" class="active">正常渲染</button>
					<button data-tmd="modePick">显示 color id</button>
				</span>
				${showToolbarActions ? '<button class="act" data-tmd="reset">↺ 重置</button><button class="act save" data-tmd="save">✓ 保存</button>' : ''}
			</span>
		</div>
		<div class="tmd-grid">
			<div class="tmd-code">
				<div class="tmd-cm-host" data-tmd="cmhost"></div>
				<div class="tmd-edit-bar">
					<span class="tmd-edit-hint" data-tmd="edithint">代码可直接编辑，停止输入后自动重跑（Ctrl/⌘+Enter 立即重跑）。</span>
				</div>
			</div>
			<div class="tmd-view">
				<canvas data-tmd="canvas" class="tmd-canvas"></canvas>
				<div class="tmd-hud"><span class="hint">↳ 点击部件 → 定位代码 + 调参 · 拖动旋转 · 滚轮/双指缩放</span></div>
			</div>
			<div class="tmd-side">
				<div class="tmd-foot" data-tmd="foot">
					<div class="row1"><span class="pick">picking</span><span>点击 3D 部件，工具会定位代码并抓取相关真实参数 →</span></div>
				</div>
				<div class="tmd-params">
					<div class="pp-head">
						<span class="tag2">params</span>
						<span class="who" data-tmd="who">源码顶部的真实参数（PARAMS）—— 拖动滑块直接改写源码字面量并重跑。</span>
					</div>
					<div class="pp-grid" data-tmd="ppgrid"></div>
				</div>
			</div>
		</div>
	</div>`;
	container.appendChild(root);

	const q = (sel) => root.querySelector(`[data-tmd="${sel}"]`);
	const cmHost = q('cmhost');
	const canvas = q('canvas');
	const foot = q('foot');
	const who = q('who');
	const ppGrid = q('ppgrid');
	const btnNormal = q('modeNormal');
	const btnPick = q('modePick');
	const btnReset = q('reset');
	const btnSave = q('save');
	const btnUndo = q('undo');
	const btnRedo = q('redo');
	const editHint = q('edithint');

	let picked = null;

	// ---- CodeMirror (always-editable, single view) ----
	let cm = null;               // CodeMirror instance
	let hlMarks = [];            // 0-based line numbers currently highlighted
	let lastRange = null;        // last picked source range [start,end] (1-based)
	let editTimer = null;        // debounce timer for auto re-run
	let suppressChange = false;  // skip change handler during programmatic setValue
	let savedBaseline = '';      // editor text as of the last save / snippet load

	function setEditHint(text, isErr) {
		if (!editHint) return;
		editHint.textContent = text;
		editHint.classList.toggle('err', !!isErr);
	}

	// Enable/disable the undo/redo buttons based on CodeMirror's history depth.
	function updateHistoryButtons() {
		if (!cm) return;
		const h = cm.historySize ? cm.historySize() : { undo: 0, redo: 0 };
		if (btnUndo) btnUndo.disabled = !(h.undo > 0);
		if (btnRedo) btnRedo.disabled = !(h.redo > 0);
	}

	// Fold all the (history-less) slider edits made since the last save into a
	// single undoable entry: briefly restore the baseline text (no history), then
	// re-apply the current text *with* history so one undo reverts the whole save.
	function commitHistoryFromBaseline() {
		if (!cm) return;
		const current = editor.getCurrentSource();
		if (current === savedBaseline) { savedBaseline = current; return; }
		suppressChange = true;
		const snap = cm.getHistory();
		cm.setValue(savedBaseline);   // back to baseline …
		cm.setHistory(snap);          // … without leaving a history trace
		cm.replaceRange(current,      // one recorded edit: baseline → current
			{ line: 0, ch: 0 },
			{ line: cm.lineCount(), ch: 0 });
		suppressChange = false;
		savedBaseline = current;
		updateHistoryButtons();
	}

	// Re-run the model from the current editor text. Validates syntax first so a
	// typo mid-edit doesn't wipe the working scene; on success rebuilds + repaints.
	function rerunFromEditor() {
		if (!cm) return;
		const src = cm.getValue();
		try {
			// eslint-disable-next-line no-new-func
			new Function(src);
		} catch (e) {
			setEditHint('语法错误（未重跑）：' + e.message, true);
			return;
		}
		setEditHint('代码可直接编辑，停止输入后自动重跑（Ctrl/⌘+Enter 立即重跑）。', false);
		picked = null;
		editor.setSource(src);            // triggers onSourceChange → setCodeValue (suppressed)
		const e2 = editor.getError();
		if (e2) {
			foot.innerHTML = `<div class="row1"><span class="pick" style="background:#ff5f57">error</span><span>建模脚本执行失败：${escapeHtml(e2.message)}</span></div>`;
		}
		// typed edits keep their own (real) history; treat the typed text as the
		// new save-folding baseline so later slider edits fold cleanly onto it.
		savedBaseline = editor.getCurrentSource();
		clearHighlight();
		renderParams();
		if (onSourceChange) onSourceChange(editor.getCurrentSource());
	}

	function scheduleRerun() {
		clearTimeout(editTimer);
		editTimer = setTimeout(rerunFromEditor, 600);
	}

	// Push source text into the editor without firing the auto-rerun (used when
	// the engine itself changes the source, e.g. slider edits / setSource).
	// When `skipHistory` is true (the default for slider/reset/save edits) the
	// programmatic change is made invisible to undo/redo by snapshotting the
	// CodeMirror history before the edit and restoring it afterwards — otherwise
	// dragging a slider would flood the undo stack with hundreds of entries.
	function setCodeValue(src, skipHistory = true) {
		if (!cm) return;                 // pre-init: CodeMirror reads getCurrentSource() on mount
		const text = String(src || '');
		if (cm.getValue() === text) return;
		const snapshot = skipHistory ? cm.getHistory() : null;
		suppressChange = true;
		cm.setValue(text);
		if (snapshot) cm.setHistory(snapshot);   // drop the edit from undo history
		suppressChange = false;
		updateHistoryButtons();
	}

	// ---- highlight the source range of the picked object ----
	function clearHighlight() {
		lastRange = null;
		if (!cm) return;
		hlMarks.forEach((ln) => {
			cm.removeLineClass(ln, 'background', 'CodeMirror-line-hl');
			cm.removeLineClass(ln, 'gutter', 'CodeMirror-gutter-hl');
		});
		hlMarks = [];
	}
	function applyHighlight(range) {
		if (!cm) { lastRange = range || null; return; } // buffer until CodeMirror mounts
		clearHighlight();
		lastRange = range || null;   // (re)set after clear, which nulls it
		if (!range) return;
		const [a, b] = range;
		const last = cm.lineCount();
		for (let n = a; n <= b && n <= last; n++) {
			const ln = n - 1; // CodeMirror is 0-based
			cm.addLineClass(ln, 'background', 'CodeMirror-line-hl');
			cm.addLineClass(ln, 'gutter', 'CodeMirror-gutter-hl');
			hlMarks.push(ln);
		}
		if (a >= 1 && a <= last) {
			cm.scrollIntoView({ line: a - 1, ch: 0 }, 60);
		}
	}

	// ---- params render ----
	function renderParams() {
		if (!editor) { ppGrid.innerHTML = '<div class="tmd-empty">载入源码后显示真实参数。</div>'; return; }
		const params = editor.getParams();
		const related = new Set(editor.relatedParamsForSelection());
		if (picked) {
			who.innerHTML = `已选中 <b>${escapeHtml(picked.displayLabel || '')}</b> · 源码 <code>L${picked.line || '—'}</code> · 下方为它引用的真实参数：`;
		} else {
			who.innerHTML = '源码顶部的<b>真实参数</b>（PARAMS）—— 拖动滑块直接改写源码字面量并重跑。';
		}
		if (!params.length) { ppGrid.innerHTML = '<div class="tmd-empty">源码顶部没有可识别的 <code>const name = number;</code> 参数。</div>'; return; }
		const ordered = params.slice().sort((x, y) => (related.has(x.name) ? 0 : 1) - (related.has(y.name) ? 0 : 1));
		ppGrid.innerHTML = ordered.map(p => {
			const span = Math.max(Math.abs(p.orig) * 1.2, 0.4);
			const min = +(p.orig - span).toFixed(3), max = +(p.orig + span).toFixed(3);
			const step = +(span / 120).toFixed(4) || 0.001;
			const changed = Math.abs(p.value - p.saved) > 1e-9;
			const isRel = related.has(p.name);
			const fmt = Number.isInteger(p.value) ? String(p.value) : String(+p.value.toFixed(3));
			return `<div class="tmd-row${isRel ? ' rel' : ''}" data-name="${escapeHtml(p.name)}">
				<div class="pp-label"><span class="k">${escapeHtml(p.name)}${isRel ? ' <em class="rel-dot">●</em>' : ''}</span><span class="v${changed ? ' changed' : ''}">${fmt}</span></div>
				<input type="range" min="${min}" max="${max}" step="${step}" value="${p.value}">
				<div class="pp-meta">L${p.line} · ${escapeHtml(p.comment || 'const ' + p.name)} · 影响 <b>${p.affected || 0}</b> 个对象</div>
			</div>`;
		}).join('');
		ppGrid.querySelectorAll('.tmd-row').forEach(row => {
			const name = row.getAttribute('data-name');
			const input = row.querySelector('input');
			const vEl = row.querySelector('.v');
			input.addEventListener('input', () => {
				editor.setParam(name, parseFloat(input.value));
				vEl.textContent = Number.isInteger(+input.value) ? input.value : String(+parseFloat(input.value).toFixed(3));
				vEl.classList.add('changed');
			});
		});
	}

	// ---- the engine ----
	const editor = createThreeModelEditor({
		THREE, canvas, source, lowPoly, background,
		onPick: (meta, info) => {
			picked = meta ? { displayLabel: info.displayLabel, line: meta.line } : null;
			applyHighlight(info ? info.range : null);
			renderParams();
			if (meta) {
				foot.innerHTML = `<div class="row1"><span class="pick">picked</span><span><b style="color:var(--ink)">${escapeHtml(info.displayLabel)}</b> · hook 自动捕获 · 源码 <code>L${meta.line}</code></span></div>`
					+ `<div class="ai">该对象引用的真实参数 <code>${info.relatedParams.length ? escapeHtml(info.relatedParams.join(', ')) : '（无）'}</code> → 改一个参数会同步影响所有用到它的对象。</div>`;
			} else {
				foot.innerHTML = '<div class="row1"><span class="pick">picking</span><span>没点到部件，下方仍可直接调全局真实参数（改一处、动多处）。</span></div>';
			}
			if (onPick) onPick(meta, info);
		},
		onSourceChange: (src) => {
			// engine-driven source change (slider edits / setSource) → mirror into the
			// editor without re-triggering the auto-rerun.
			setCodeValue(src);
			if (onSourceChange) onSourceChange(src);
		},
	});

	const err = editor.getError();
	if (err) {
		foot.innerHTML = `<div class="row1"><span class="pick" style="background:#ff5f57">error</span><span>建模脚本执行失败：${escapeHtml(err.message)}</span></div>`;
	}
	renderParams();

	// ---- mount the always-editable CodeMirror code panel ----
	loadCodeMirror(doc, opts.codeMirrorCdn).then((CodeMirror) => {
		if (!CodeMirror || !cmHost || !cmHost.isConnected) return;
		cm = CodeMirror(cmHost, {
			value: editor.getCurrentSource(),
			mode: 'javascript',
			theme: 'material-darker',
			lineNumbers: true,
			lineWrapping: false,
			indentUnit: 2,
			tabSize: 2,
			indentWithTabs: false,
			viewportMargin: 80,
			extraKeys: {
				'Ctrl-Enter': () => { clearTimeout(editTimer); rerunFromEditor(); },
				'Cmd-Enter': () => { clearTimeout(editTimer); rerunFromEditor(); },
				Tab: (instance) => instance.replaceSelection('  ', 'end'),
			},
		});
		cm.setSize('100%', '100%');
		savedBaseline = editor.getCurrentSource();   // baseline for save-folding
		cm.on('change', () => { if (!suppressChange) scheduleRerun(); updateHistoryButtons(); });
		// re-apply any highlight that was requested before the editor mounted
		if (lastRange) applyHighlight(lastRange);
		updateHistoryButtons();
		requestAnimationFrame(() => cm && cm.refresh());
	}).catch((e) => {
		setEditHint('CodeMirror 加载失败：' + (e && e.message || e), true);
	});

	// ---- toolbar wiring ----
	btnNormal.addEventListener('click', () => { editor.setShowPick(false); btnNormal.classList.add('active'); btnPick.classList.remove('active'); });
	btnPick.addEventListener('click', () => { editor.setShowPick(true); btnPick.classList.add('active'); btnNormal.classList.remove('active'); });

	// undo / redo drive CodeMirror's built-in history; the change handler then
	// reruns the model + refreshes button state.
	if (btnUndo) btnUndo.addEventListener('click', () => { if (cm) { cm.undo(); cm.focus(); updateHistoryButtons(); } });
	if (btnRedo) btnRedo.addEventListener('click', () => { if (cm) { cm.redo(); cm.focus(); updateHistoryButtons(); } });

	if (btnReset) btnReset.addEventListener('click', () => { if (editor.resetParams()) { setCodeValue(editor.getCurrentSource()); renderParams(); } });
	if (btnSave) btnSave.addEventListener('click', () => {
		editor.commitParams();
		// Slider edits don't touch undo history; clicking Save folds the net change
		// (since the last save / snippet load) into a single undoable history entry.
		commitHistoryFromBaseline();
		renderParams();
		const t = btnSave.textContent; btnSave.textContent = '✓ 已写回'; setTimeout(() => { btnSave.textContent = t; }, 1200);
	});

	// ---- public API ----
	return {
		root,
		editor,
		getCurrentSource: () => editor.getCurrentSource(),
		setSource(src, o = {}) {
			picked = null;
			clearTimeout(editTimer);
			editor.setSource(src);
			if (o.filename && q('file')) q('file').textContent = o.filename;
			const e2 = editor.getError();
			foot.innerHTML = e2
				? `<div class="row1"><span class="pick" style="background:#ff5f57">error</span><span>${escapeHtml(e2.message)}</span></div>`
				: '<div class="row1"><span class="pick">picking</span><span>点击 3D 部件 → 定位代码 + 抓取相关参数。</span></div>';
			setCodeValue(editor.getCurrentSource());
			// loading a new snippet starts a fresh edit history (no undo across snippets)
			savedBaseline = editor.getCurrentSource();
			if (cm) { cm.clearHistory(); updateHistoryButtons(); }
			clearHighlight();
			renderParams();
		},
		setFilename(name) { if (q('file')) q('file').textContent = name; },
		resize: () => { editor.resize(); if (cm) cm.refresh(); },
		destroy() {
			clearTimeout(editTimer);
			try { editor.destroy(); } catch (_) {}
			cm = null;
			root.remove();
		},
	};
}
